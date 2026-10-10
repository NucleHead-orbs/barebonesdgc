/**
 * Live rounds (migration 20261105): the scorer's phone mirrors its card to club_live while the round is played.
 * The phone's card stays the truth until SAVE; this is the public look-in. Pure helpers (no Supabase).
 */
import { running, type Draft } from './rounds';

export interface LivePlayer { name: string; member_id: string | null; scores: Array<number | null> }
export interface LiveCard { course: string; pars: number[]; labels: string[] | null; players: LivePlayer[]; /** the scheduled round it was started from (migration 20261123) */ source?: string }
export interface LiveRound { id: string; course: string; card: LiveCard; started_at: string; updated_at: string; ended: boolean; muted?: boolean }

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
    ...(d.source ? { source: d.source } : {}),
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

// ---------- live reactions (migration 20261106) ----------
export type LiveKind = 'skull' | 'choke' | 'trash' | 'cry' | 'eggplant' | 'pickle' | 'clap' | 'fire' | 'goat' | 'cheers';
export const LIVE_REACTIONS: Array<{ kind: LiveKind; glyph: string; label: string; tone: 'razz' | 'congrats' }> = [
  { kind: 'skull', glyph: '\u{1F480}', label: 'Skull rain', tone: 'razz' },
  { kind: 'choke', glyph: '\u{1F414}', label: 'Choke', tone: 'razz' },
  { kind: 'trash', glyph: '\u{1F5D1}\u{FE0F}', label: 'Trash', tone: 'razz' },
  { kind: 'cry', glyph: '\u{1F62D}', label: 'Waaah', tone: 'razz' },
  { kind: 'eggplant', glyph: '\u{1F346}', label: 'Eggplant', tone: 'razz' },
  { kind: 'pickle', glyph: '\u{1F952}', label: 'Pickle', tone: 'razz' },
  { kind: 'clap', glyph: '\u{1F44F}', label: 'Golf clap', tone: 'congrats' },
  { kind: 'fire', glyph: '\u{1F525}', label: 'On fire', tone: 'congrats' },
  { kind: 'goat', glyph: '\u{1F410}', label: 'GOAT', tone: 'congrats' },
  { kind: 'cheers', glyph: '\u{1F37B}', label: 'Cheers', tone: 'congrats' },
];
export interface LiveReaction { id: number; kind: LiveKind; target: string | null; at: string; who: string }
export const reactionOf = (k: LiveKind) => LIVE_REACTIONS.find((r) => r.kind === k) ?? LIVE_REACTIONS[0];
/** "Woody sent Skull rain to Blake" / "… to everyone" */
export const reactionLine = (r: Pick<LiveReaction, 'who' | 'kind' | 'target'>) => `${r.who} sent ${reactionOf(r.kind).label} to ${r.target ?? 'everyone'}`;
/** Deterministic particle spots for an overlay (same reaction = same pattern on every screen). */
export function particles(seed: number, n = 14): Array<{ x: number; delay: number; size: number }> {
  let s = (seed * 9301 + 49297) % 233280;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  return Array.from({ length: n }, () => ({ x: Math.round(rnd() * 92), delay: Math.round(rnd() * 900), size: 28 + Math.round(rnd() * 28) }));
}

// ---------- coming up live (migration 20261123): scheduled rounds, advertised before tee-off ----------
export interface UpcomingRound {
  kind: 'night' | 'challenge' | 'casual'; id: string; at: string; title: string; course: string | null;
  host: string | null; set: string | null; players: string[]; live: LiveRound[];
  /** nights only (migration 20261125) */
  format?: 'singles' | 'dubs'; results?: Array<{ team: number; place: number; to_par: number; players: Array<{ id: string | null; name: string }> }> | null;
}
export const UPCOMING_KIND: Record<UpcomingRound['kind'], string> = { night: 'LEAGUE NIGHT', challenge: 'TAG CHALLENGE', casual: 'CASUAL ROUND' };
/** "Tonight 6:30 PM" / "Tomorrow 9:00 AM" / "Sat Oct 11, 9:00 AM" (Arizona time, like the club). */
export function whenLabel(iso: string, now: number): string {
  const tz = 'America/Phoenix';
  const day = (t: number) => new Date(t).toLocaleDateString('en-CA', { timeZone: tz });
  const time = new Date(iso).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  const t = new Date(iso).getTime();
  const hour = Number(new Date(t).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }));
  if (day(t) === day(now)) return `${hour >= 17 ? 'Tonight' : 'Today'} ${time}`;
  if (day(t) === day(now + 86_400_000)) return `Tomorrow ${time}`;
  return `${new Date(t).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`;
}
/** "in 45 min" / "in 3 hr" / "teeing off" (started, nobody live yet). */
export function startsIn(iso: string, now: number): string {
  const m = Math.round((new Date(iso).getTime() - now) / 60000);
  if (m <= 0) return 'teeing off';
  if (m < 60) return `in ${m} min`;
  if (m < 48 * 60) return `in ${Math.round(m / 60)} hr`;
  return `in ${Math.round(m / 1440)} days`;
}
