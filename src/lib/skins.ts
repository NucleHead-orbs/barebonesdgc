import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';

/**
 * Skins for My Tag, the Scorecard and the TD Builder (Mike, 2026-10-08; migration 20261119 skins).
 * Source of truth: the phone's pick (localStorage bb-skin) and the club default (skin_default_get, set by a super admin).
 * Rule: the phone's pick wins; no pick = the club default while it runs; no default = Night Card.
 * Applied on <html data-skin> (and data-card for the printed-card family) only while a screen calling useSkinApply is mounted.
 */
export type SkinId = 'night' | 'gmode' | 'spooky' | 'sweater' | 'electric';
export interface Skin {
  id: SkinId; name: string; blurb: string;
  /** printed-card family (data-card) vs the Jewel look */
  card: boolean;
  /** phone status bar */
  themeColor: string;
  /** mini preview: band, rule, card, ink, button */
  mini: [string, string, string, string, string];
}
export const SKINS: Skin[] = [
  { id: 'night', name: 'Night Card', blurb: 'The house look. Green-black card, bone ink, lime.', card: true, themeColor: '#0a0f0c', mini: ['#0a0f0c', '#a6d93b', '#18221c', '#efe8cf', '#a6d93b'] },
  { id: 'gmode', name: 'G-Mode', blurb: 'Grandpa mode. Lights on, bigger print.', card: true, themeColor: '#1f4a2a', mini: ['#1f4a2a', '#f2cf5b', '#fffdf6', '#1d2a22', '#2f6b3a'] },
  { id: 'spooky', name: 'Spooky Season', blurb: 'Pumpkin and witch purple on charcoal.', card: true, themeColor: '#0d0911', mini: ['#0d0911', '#ff8a1f', '#201a28', '#f4ead6', '#ff8a1f'] },
  { id: 'sweater', name: 'Ugly Sweater', blurb: 'Cranberry, pine and a knit stripe.', card: true, themeColor: '#9e1b2e', mini: ['#9e1b2e', '#f6e7c1', '#fffdfb', '#24201c', '#1f6b3a'] },
  { id: 'electric', name: 'Jewel Electric', blurb: 'The Jewel XI glow. Navy, cyan, magenta.', card: false, themeColor: '#141c2e', mini: ['#141c2e', '#7b5cff', '#101728', '#ffffff', '#29e1ff'] },
];
export const FALLBACK: SkinId = 'night';
export const SKIN_KEY = 'bb-skin';
const LEGACY_GMODE_KEY = 'bb-gmode'; // the G-Mode switch before skins: '1' = G-Mode
const DEFAULT_CACHE_KEY = 'bb-skin-default';

export const parseSkin = (v: unknown): SkinId | null => (SKINS.some((s) => s.id === v) ? v as SkinId : null);
export const skinOf = (id: SkinId) => SKINS.find((s) => s.id === id) ?? SKINS[0];
/** A club default still runs on `today` (YYYY-MM-DD, Arizona) when it has no end or ends today or later. */
export const defaultRuns = (until: string | null | undefined, today: string) => !until || until >= today;
export function resolveSkin(pick: SkinId | null, dflt: { skin: SkinId; until: string | null } | null, today: string): SkinId {
  if (pick) return pick;
  if (dflt && defaultRuns(dflt.until, today)) return dflt.skin;
  return FALLBACK;
}
/** The phone's saved pick; an old G-Mode switch that was on counts as picking G-Mode. */
export function pickFrom(skin: string | null, legacyGmode: string | null): SkinId | null {
  return parseSkin(skin) ?? (legacyGmode === '1' ? 'gmode' : null);
}
export const arizonaToday = (d = new Date()) => new Date(d.getTime() - 7 * 3600_000).toISOString().slice(0, 10); // Arizona: UTC-7, no DST

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode: this visit only */ } },
};
const readDefault = (): { skin: SkinId; until: string | null } | null => {
  try { const x = JSON.parse(ls.get(DEFAULT_CACHE_KEY) ?? 'null'); const s = parseSkin(x?.skin); return s ? { skin: s, until: x.until ?? null } : null; } catch { return null; }
};

// one state for the page, so every picker and the screen applying the skin agree
interface State { pick: SkinId | null; dflt: { skin: SkinId; until: string | null } | null }
let state: State = { pick: pickFrom(ls.get(SKIN_KEY), ls.get(LEGACY_GMODE_KEY)), dflt: readDefault() };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => { state = { ...state, ...next }; listeners.forEach((f) => f()); };
const subscribe = (f: () => void) => {
  listeners.add(f);
  const s = (e: StorageEvent) => { if (e.key === SKIN_KEY || e.key === DEFAULT_CACHE_KEY) set({ pick: pickFrom(ls.get(SKIN_KEY), null), dflt: readDefault() }); };
  window.addEventListener('storage', s);
  return () => { listeners.delete(f); window.removeEventListener('storage', s); };
};

/** The phone picks a skin (null = follow the club default). */
export function pickSkin(id: SkinId | null) {
  ls.set(SKIN_KEY, id); ls.set(LEGACY_GMODE_KEY, null);
  set({ pick: id });
}
/** Remember the club default (after reading or setting it). */
export function rememberDefault(d: { skin: SkinId; until: string | null } | null) {
  ls.set(DEFAULT_CACHE_KEY, d ? JSON.stringify(d) : null);
  set({ dflt: d });
}

export function useSkin() {
  const s = useSyncExternalStore(subscribe, () => state, () => state);
  return { skin: resolveSkin(s.pick, s.dflt, arizonaToday()), pick: s.pick, dflt: s.dflt, pickSkin };
}

let fetched = false;
/** Call once at the root of a screen with skins: applies the skin before paint, refreshes the club default, cleans up on unmount. */
export function useSkinApply(): SkinId {
  const { skin } = useSkin();
  useEffect(() => {
    if (fetched) return;
    fetched = true;
    void (async () => {
      const { supabase } = await import('./supabase'); // lazy: keeps this module's rules testable without a database
      const r = await supabase.rpc('skin_default_get');
      const d = r.data as { skin?: string; until?: string | null } | null;
      const s = parseSkin(d?.skin);
      if (!r.error && s) rememberDefault({ skin: s, until: d?.until ?? null });
    })();
  }, []);
  useLayoutEffect(() => {
    const el = document.documentElement;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const prev = meta?.content ?? null;
    const k = skinOf(skin);
    el.dataset.skin = k.id;
    if (k.card) el.dataset.card = ''; else delete el.dataset.card;
    if (meta) meta.content = k.themeColor;
    return () => { delete el.dataset.skin; delete el.dataset.card; if (meta && prev !== null) meta.content = prev; };
  }, [skin]);
  return skin;
}

/** Super admin: set the club default (skin, last day or null). */
export async function setClubDefault(skin: SkinId, until: string | null) {
  const { supabase } = await import('./supabase');
  const r = await supabase.rpc('td_skin_default_set', { p_skin: skin, p_until: until });
  if (r.error) return { error: r.error };
  const d = r.data as { skin: string; until: string | null };
  const s = parseSkin(d.skin) ?? FALLBACK;
  rememberDefault({ skin: s, until: d.until });
  return { data: { skin: s, until: d.until } };
}
export function skinMessage(e: unknown): string {
  const m = String((e as { message?: string } | null)?.message ?? e ?? '');
  if (/not_allowed/.test(m)) return 'Only a super admin can set the club skin.';
  if (/invalid_until/.test(m)) return 'The end date has to be today or later.';
  if (/invalid_skin/.test(m)) return 'Pick one of the skins.';
  return 'Could not save the club skin. Try again.';
}
