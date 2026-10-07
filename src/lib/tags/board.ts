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
    case 'result': return { label: 'RESULTS', tone: 'fight' };
    case 'matchmaker': return { label: 'MATCHMAKER', tone: 'match' };
    default: return { label: 'NEWS', tone: 'meh' };
  }
}

export type MyTagTab = 'tags' | 'board' | 'matchups';
export const asTab = (s: string | null): MyTagTab => (s === 'board' || s === 'matchups' ? s : 'tags');

// ---------- challenge rounds (migration 20261103): a slot (time + course) and up to 2 jump-ins ----------
export interface RoundPerson { id: string; name: string; nickname: string | null; number: number | null }
export interface ChallengeRound {
  id: string; pool_id: string; pool: string; pool_name: string; challenger: RoundPerson; challenged: RoundPerson;
  role: 'challenger' | 'challenged' | 'joined' | null; tee_at: string | null; course_id: string | null; course: string | null;
  slot_mine: boolean; locked: boolean; closes_at: string | null; due_at: string | null; joins: RoundPerson[];
}
export const MAX_JUMP_INS = 2;
/** Where a challenge round stands for the player looking at it. */
export type RoundStep = 'pick' | 'wait_pick' | 'ok' | 'wait_ok' | 'open' | 'closed';
export function roundStep(r: ChallengeRound, now: number): RoundStep {
  if (!r.tee_at) return r.role === 'challenged' ? 'pick' : 'wait_pick';
  if (r.closes_at && now >= new Date(r.closes_at).getTime()) return 'closed';
  if (!r.locked) return r.slot_mine ? 'wait_ok' : r.role === 'challenger' || r.role === 'challenged' ? 'ok' : 'wait_ok';
  return 'open';
}
/** "Sat Oct 10, 9:00 AM at Papago" in the device's time. */
export function slotLabel(tee: string | null, course: string | null): string {
  if (!tee) return '';
  const d = new Date(tee).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return course ? `${d} at ${course}` : d;
}
/** datetime-local value <-> ISO (device time zone). */
export const toLocalInput = (ms: number) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
export const canJumpIn = (r: ChallengeRound, now: number) => r.role === null && roundStep(r, now) === 'open' && r.joins.length < MAX_JUMP_INS;

// ---------- @mentions (migration 20261109): the database decides who was mentioned; these only help type and show it ----------
export interface MentionPerson { id: string; label: string; number: number | null }
export interface Mention { chat_id: number; pool_id: string; pool: string; from: string | null; body: string; at: string }

/** The "@som" being typed right before the caret: where its "@" is and what's typed after it. Not inside an email. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && /[\p{L}\p{N}_]/u.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > 30 || /[\n@]/.test(query) || /\s\s/.test(query) || /^\s/.test(query)) return null;
  return { start: at, query };
}

/** Who to offer for "@query": names starting with it first, then any word starting with it. Never yourself. */
export function mentionPicks(people: MentionPerson[], query: string, meId: string, max = 6): MentionPerson[] {
  const q = query.trim().toLowerCase();
  const others = people.filter((p) => p.id !== meId);
  const starts = others.filter((p) => p.label.toLowerCase().startsWith(q));
  const words = others.filter((p) => !starts.includes(p) && p.label.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)));
  return [...starts, ...words].slice(0, max);
}

/** Put "@Label " in place of the "@query" being typed; returns the new text and where the caret goes. */
export function applyMention(text: string, at: { start: number; query: string }, label: string): { text: string; caret: number } {
  const head = `${text.slice(0, at.start)}@${label} `;
  const tail = text.slice(at.start + 1 + at.query.length).replace(/^ /, '');
  return { text: head + tail, caret: head.length };
}

/** Split a message so the mentioned names can be highlighted (longest names first, any case). */
export function mentionParts(body: string, labels: string[]): Array<{ text: string; at: boolean }> {
  const ls = [...new Set(labels.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!ls.length) return [{ text: body, at: false }];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`@(?:${ls.map(esc).join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
  const out: Array<{ text: string; at: boolean }> = [];
  let last = 0;
  for (const m of body.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > 0 && /[\p{L}\p{N}_]/u.test(body[i - 1])) continue;
    if (i > last) out.push({ text: body.slice(last, i), at: false });
    out.push({ text: m[0], at: true });
    last = i + m[0].length;
  }
  if (last < body.length) out.push({ text: body.slice(last), at: false });
  return out.length ? out : [{ text: body, at: false }];
}
