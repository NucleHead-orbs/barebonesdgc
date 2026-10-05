/**
 * The Board, profiles and Matchups (migration 20261031). The rules live in the database; this is types + pure helpers.
 * Days are a 7-bit mask: bit 0 = Mon ... bit 6 = Sun, one mask for mornings (am) and one for afternoons/evenings (pm).
 */
import type { ChatLine } from './heat';

export type ReactionKind = 'skull' | 'fire' | 'trash' | 'flex';
export const REACTIONS: Array<{ kind: ReactionKind; label: string }> = [
  { kind: 'skull', label: 'Dead' }, { kind: 'fire', label: 'Fire' }, { kind: 'trash', label: 'Trash talk' }, { kind: 'flex', label: 'Flex' },
];
/** counts per reaction, which ones I tapped, and who tapped each (names, first first). */
export interface Reactions { counts: Partial<Record<ReactionKind, number>>; mine: ReactionKind[]; who?: Partial<Record<ReactionKind, string[]>> }

/** "Dave, Sam and 3 more" */
export function whoLine(names: string[], max = 6): string {
  if (names.length <= max) return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? '';
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}
export interface BoardRead { lines: ChatLine[]; reactions: Record<string, Reactions> }

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const hasDay = (mask: number, i: number) => ((mask >> i) & 1) === 1;
export const toggleDay = (mask: number, i: number) => (mask ^ (1 << i)) & 127;
/** "Sat AM, Sun all day" style summary of a profile's days. '' when nothing is set. */
export function daysSummary(am: number, pm: number): string {
  return DAYS.map((d, i) => {
    const a = hasDay(am, i), p = hasDay(pm, i);
    return a && p ? `${d} all day` : a ? `${d} AM` : p ? `${d} PM` : '';
  }).filter(Boolean).join(', ');
}

export interface LibCourseLite { id: string; name: string; city: string | null }
export interface Profile { am: number; pm: number; courses: string[]; saved: boolean; library: LibCourseLite[] }
export const MAX_COURSES = 3;

export interface Pick {
  member_id: string; name: string; nickname: string | null; number: number; score: number;
  days: string[]; courses: string[]; idle: number; their_days: string[]; busy: boolean;
}
export interface MatchupSet { pool_id: string; pool: string; pool_name: string; number: number; open: boolean; picks: Pick[] }

/** Why the Matchmaker likes this pairing, as short chips. */
export function pickReasons(p: Pick): string[] {
  const out: string[] = [];
  if (p.days.length) out.push(`Both free ${p.days.slice(0, 3).join('/')}`);
  if (p.courses.length) out.push(`Both love ${p.courses.join(' & ')}`);
  if (p.idle >= 7) out.push(`#${p.number} hasn't moved in ${p.idle} days`);
  if (!p.days.length && p.their_days.length) out.push(`They're free ${p.their_days.slice(0, 3).join('/')}`);
  if (!p.their_days.length) out.push('No schedule shared yet');
  if (p.busy) out.push('Busy with another challenge');
  return out;
}

/** Add newly read lines (by id, no dupes), keep the last `keep`. */
export function mergeLines(prev: ChatLine[], got: ChatLine[], keep = 200): ChatLine[] {
  if (!got.length) return prev;
  const seen = new Set(prev.map((l) => l.id));
  return [...prev, ...got.filter((l) => !seen.has(l.id))].sort((a, b) => a.id - b.id).slice(-keep);
}

/** House posts get a label + tone by event. */
export function newsTone(event: string | null | undefined): { label: string; tone: 'boom' | 'fight' | 'match' | 'meh' } {
  switch (event) {
    case 'bomb': return { label: 'BOOM', tone: 'boom' };
    case 'penalty': return { label: 'PENALTY', tone: 'boom' };
    case 'challenge': case 'accepted': return { label: 'CHALLENGE', tone: 'fight' };
    case 'played': return { label: 'SETTLED', tone: 'fight' };
    case 'matchmaker': return { label: 'MATCHMAKER', tone: 'match' };
    default: return { label: 'NEWS', tone: 'meh' };
  }
}

export type MyTagTab = 'tags' | 'board' | 'matchups';
export const asTab = (s: string | null): MyTagTab => (s === 'board' || s === 'matchups' ? s : 'tags');
