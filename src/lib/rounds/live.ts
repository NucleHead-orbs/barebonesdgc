/**
 * Live rounds (migration 20261105): the scorer's phone mirrors its card to club_live while the round is played.
 * The phone's card stays the truth until SAVE; this is the public look-in. Pure helpers (no Supabase).
 */
import { running, type Draft } from './rounds';

export interface LivePlayer { name: string; member_id: string | null; scores: Array<number | null> }
export interface LiveCard { course: string; pars: number[]; labels: string[] | null; players: LivePlayer[] }
export interface LiveRound { id: string; course: string; card: LiveCard; started_at: string; updated_at: string; ended: boolean }

/** Live is on unless the scorer switched SHARE LIVE off. */
export const liveOn = (d: Pick<Draft, 'live'>) => d.live !== false;

/** The card as the public sees it. Names as typed on the card; trailing empty holes trimmed. */
export function toLiveCard(d: Draft): LiveCard {
  return {
    course: d.course.trim() || 'A course',
    pars: d.pars.slice(),
    labels: d.labels && d.labels.length === d.pars.length ? d.labels.slice() : null,
    players: d.players.map((p, i) => {
      const s = (d.scores[i] ?? []).slice(0, d.pars.length).map((x) => (x == null ? null : x));
      while (s.length && s[s.length - 1] == null) s.pop();
      return { name: p.name.trim() || `Player ${i + 1}`, member_id: p.memberId, scores: s };
    }),
  };
}

/** Standings for a live card: thru, to par, best first (players with no holes last). */
export function liveStandings(c: LiveCard) {
  const rows = c.players.map((p) => ({ name: p.name, ...running(c.pars, p.scores) }));
  return rows.slice().sort((a, b) => (a.thru === 0 ? 1 : 0) - (b.thru === 0 ? 1 : 0) || a.toPar - b.toPar || b.thru - a.thru);
}

/** Holes everyone has finished (the group's "thru"). */
export const groupThru = (c: LiveCard) => (c.players.length ? Math.min(...c.players.map((p) => p.scores.filter((x) => x != null).length)) : 0);

/** "just now" / "4 min ago" / "1 hr ago" */
export function agoLabel(iso: string, now: number): string {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} hr ago`;
}

/** The phone's live id + secret for the card it's keeping (kept beside the draft, not in it). */
export const LIVE_KEY = 'bb-scorecard-live';
export function newLiveIds(): { id: string; secret: string } {
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
  return { id: crypto.randomUUID(), secret };
}
