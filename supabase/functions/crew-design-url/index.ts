// crew-design-url: a crew link asks for a short-lived download link to one design file.
// The database decides (crew_design_file checks the link, the event and crew_visible); this function only signs.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  let token = '', file = '';
  try { ({ token, file } = await req.json()); } catch { return json({ error: 'bad_request' }, 400); }
  if (typeof token !== 'string' || typeof file !== 'string' || token.length < 20 || !/^[0-9a-f-]{36}$/i.test(file)) return json({ error: 'bad_request' }, 400);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { data, error } = await anon.rpc('crew_design_file', { p_token: token, p_file: file });
  if (error || !data?.path) return json({ error: /invalid_link|event_closed/.test(error?.message ?? '') ? 'invalid_link' : 'not_found' }, 403);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const signed = await admin.storage.from('event-assets').createSignedUrl(data.path as string, 3600);
  if (signed.error) return json({ error: 'sign_failed' }, 500);
  return json({ url: signed.data.signedUrl, file_name: data.file_name });
});
