/**
 * Music listening stats, client side. Anonymous: the browser invents a random listener id and keeps it.
 * Server rules live in supabase/migrations/20261011000000_music_listens.sql (heartbeat, log play, stats).
 */
export const PLAY_AFTER_S = 30;      // a play counts after this much actual listening (seeking doesn't count)
export const HEARTBEAT_S = 30;       // "still listening" ping while playing (server counts you live for 75 s)

export interface ListenClock { playId: string; slug: string; last: number; heard: number; logged: boolean }
export interface MusicStats { live: number; plays: Record<string, number> }

export const newClock = (slug: string, playId: string, at = 0): ListenClock => ({ playId, slug, last: at, heard: 0, logged: false });

/**
 * Feed every timeupdate. Only real listening adds up: small forward steps while playing.
 * A jump back to the start (repeat one / replay) begins a new play. Returns the clock and
 * whether this tick is the one that should log the play.
 */
export function tick(c: ListenClock, slug: string, time: number, playing: boolean, mkId: () => string): { clock: ListenClock; log: boolean } {
  if (slug !== c.slug) return { clock: newClock(slug, mkId(), time), log: false };
  if (c.logged && time < 2 && c.last - time > 5) return { clock: newClock(slug, mkId(), time), log: false };
  const step = time - c.last;
  const heard = playing && step > 0 && step < 2 ? c.heard + step : c.heard;
  const log = !c.logged && heard >= PLAY_AFTER_S;
  return { clock: { ...c, last: time, heard, logged: c.logged || log }, log };
}

export function parseStats(raw: unknown): MusicStats {
  const r = (raw ?? {}) as { live?: unknown; plays?: unknown };
  const plays: Record<string, number> = {};
  if (r.plays && typeof r.plays === 'object') for (const [k, v] of Object.entries(r.plays)) if (typeof v === 'number') plays[k] = v;
  return { live: typeof r.live === 'number' ? r.live : 0, plays };
}

export const fmtPlays = (n: number) => `${n.toLocaleString('en-US')} play${n === 1 ? '' : 's'}`;
