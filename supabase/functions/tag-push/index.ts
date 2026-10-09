/**
 * tag-push: sends My Tag phone alerts (migration 20261118). Poked by the database (pg_net) when alerts are queued,
 * and every minute by cron. Claims waiting alerts, sends each to every phone of its member, reports back.
 * Auth: the x-push-secret header must match Vault's tag_push_secret. Keys come from Vault, never from git.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

interface Sub { endpoint: string; p256dh: string; auth: string }
interface Alert { id: number; kind: string; ref: string; title: string; body: string; url: string; subs: Sub[] }

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });
  const cfg = await db.rpc('tag_push_config');
  if (cfg.error) return new Response(`config: ${cfg.error.message}`, { status: 500 });
  const c = (cfg.data ?? {}) as Record<string, string>;
  if (!c.tag_push_secret || req.headers.get('x-push-secret') !== c.tag_push_secret) return new Response('nope', { status: 401 });
  if (!c.tag_vapid_public || !c.tag_vapid_private) return new Response('no vapid keys', { status: 500 });
  webpush.setVapidDetails('https://barebonesdiscgolf.club', c.tag_vapid_public, c.tag_vapid_private);

  let total = 0;
  for (let round = 0; round < 5; round++) {   // a few batches per poke, then the next poke / cron picks up the rest
    const claim = await db.rpc('tag_push_claim');
    if (claim.error) return new Response(`claim: ${claim.error.message}`, { status: 500 });
    const alerts = (claim.data ?? []) as Alert[];
    if (!alerts.length) break;
    const sent: number[] = []; const failed: Record<string, string> = {}; const ok = new Set<string>(); const gone = new Set<string>();
    await Promise.all(alerts.map(async (a) => {
      const payload = JSON.stringify({ title: a.title, body: a.body, url: a.url, tag: `${a.kind}:${a.ref}`.slice(0, 64) });
      const results = await Promise.all(a.subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 12, urgency: 'high' });
          ok.add(s.endpoint); return null;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) { gone.add(s.endpoint); return null; }   // that phone unsubscribed: forget it
          return `${code ?? ''} ${(e as Error).message ?? e}`.trim();
        }
      }));
      const errs = results.filter(Boolean) as string[];
      // delivered to at least one phone (or every phone is gone) = done; otherwise retry later
      if (!a.subs.length || errs.length < a.subs.length) sent.push(a.id); else failed[String(a.id)] = errs[0];
    }));
    const rep = await db.rpc('tag_push_report', { p_sent: sent, p_failed: failed, p_ok: [...ok], p_gone: [...gone] });
    if (rep.error) return new Response(`report: ${rep.error.message}`, { status: 500 });
    total += alerts.length;
    if (alerts.length < 100) break;
  }
  return new Response(JSON.stringify({ handled: total }), { headers: { 'content-type': 'application/json' } });
});
