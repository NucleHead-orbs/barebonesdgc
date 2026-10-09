/**
 * My Tag phone alerts (migration 20261118): Web Push through /sw.js. The server owns what gets sent (triggers +
 * tag-push Edge Function); this file is the phone side: can this browser do it, subscribe, and the kind labels.
 */
import { supabase } from '../supabase';
import { isStandalone } from '../rounds/useInstall';
import { platformOf } from '../rounds/install';

/** VAPID public key (the private half lives in Supabase Vault). */
export const VAPID_PUBLIC = 'BKe2P-q5pWxrITBqkU-WU7E2BnHU20PVdHB7nIhhXeKXhTIPrgc_c_IpyYFViD90XikknIyg8YqJn2fGvDDIHk4';

export type PushKind = 'challenge' | 'answer' | 'slot' | 'mention' | 'invite' | 'confirm' | 'fuse';
export const PUSH_KINDS: Array<{ kind: PushKind; label: string }> = [
  { kind: 'challenge', label: 'Someone challenges you' },
  { kind: 'answer', label: 'Your challenge is accepted, declined or expires' },
  { kind: 'slot', label: 'A tee time is picked or locked in' },
  { kind: 'mention', label: '@mentions and replies on the Board' },
  { kind: 'invite', label: 'Casual round invites' },
  { kind: 'confirm', label: 'Rounds waiting on your confirm' },
  { kind: 'fuse', label: 'Your time-bomb fuse has under 24 hours left' },
];

/** What this phone/browser can do right now. */
export type PushSupport = 'ok' | 'install-first' | 'blocked' | 'unsupported';
export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  const ios = platformOf(navigator.userAgent, navigator.maxTouchPoints, navigator.platform) === 'ios';
  const has = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (ios && !isStandalone()) return 'install-first';   // iPhone: only home-screen apps get push
  if (!has) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return 'ok';
}

/** base64url -> bytes (for applicationServerKey). */
export function keyBytes(b64url: string): Uint8Array {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export const registerSw = () => navigator.serviceWorker.register('/sw.js', { scope: '/' });
export async function currentSub(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export interface PushStatus { device: boolean; devices: number; off: PushKind[]; kinds: PushKind[] }
type R<T> = { data: T; error?: undefined } | { data?: undefined; error: unknown };
const run = async <T>(f: () => PromiseLike<{ data: unknown; error: unknown }>): Promise<R<T>> => {
  try { const r = await f(); return r.error ? { error: r.error } : { data: r.data as T }; } catch (error) { return { error }; }
};
export const pushStatus = (token: string, endpoint: string | null) => run<PushStatus>(() => supabase.rpc('tag_push_status', { p_token: token, p_endpoint: endpoint }));
export const pushPrefs = (token: string, off: PushKind[]) => run<null>(() => supabase.rpc('tag_push_prefs', { p_token: token, p_off: off }));
export const pushTest = (token: string) => run<boolean>(() => supabase.rpc('tag_push_test', { p_token: token }));
export const pushUnsubscribe = (token: string, endpoint: string) => run<null>(() => supabase.rpc('tag_push_unsubscribe', { p_token: token, p_endpoint: endpoint }));

/** Ask permission, subscribe this browser, save it to this member. Throws a plain-words Error. */
export async function turnOn(token: string): Promise<void> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'blocked' : 'not_allowed');
  const reg = await registerSw();
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC) as BufferSource });
  const j = sub.toJSON();
  const r = await run<null>(() => supabase.rpc('tag_push_subscribe', {
    p_token: token, p_endpoint: sub.endpoint, p_p256dh: j.keys?.p256dh ?? '', p_auth: j.keys?.auth ?? '', p_ua: navigator.userAgent.slice(0, 300),
  }));
  if (r.error) throw r.error;
}

/** Turn alerts off on this phone only. */
export async function turnOff(token: string): Promise<void> {
  const sub = await currentSub();
  if (!sub) return;
  await pushUnsubscribe(token, sub.endpoint);
  await sub.unsubscribe();
}

export function pushMessage(e: unknown): string {
  const m = e && typeof e === 'object' && 'message' in e ? String((e as { message?: string }).message) : String(e ?? '');
  if (/blocked/.test(m)) return 'Alerts are blocked for this site. Allow notifications for it in your phone settings, then try again.';
  if (/not_allowed/.test(m)) return 'No alerts without your OK. Tap TURN ON again when you\'re ready.';
  if (/no_phone/.test(m)) return 'Turn alerts on for this phone first.';
  if (/invalid_subscription/.test(m)) return 'This browser gave us a bad push address. Try again, or try another browser.';
  return `Couldn't set up alerts: ${m}`;
}
