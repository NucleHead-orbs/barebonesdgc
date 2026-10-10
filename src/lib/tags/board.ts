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

/**
 * Board threads (migration 20261116): a message + the replies pointing at it (reply_to is always the thread's first
 * message). Newest activity first, so a fresh reply brings its thread back to the top. A reply whose first message
 * isn't loaded (hidden) stands alone with root = null.
 */
export interface Thread { root: ChatLine | null; replies: ChatLine[]; last: number }
export function threads(lines: ChatLine[]): Thread[] {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const out = new Map<number, Thread>();
  for (const l of [...lines].sort((a, b) => a.id - b.id)) {
    const rootId = l.reply_to && byId.has(l.reply_to) ? l.reply_to : null;
    if (rootId === null) {
      if (!out.has(l.id)) out.set(l.id, { root: l.reply_to ? null : l, replies: l.reply_to ? [l] : [], last: l.id });
      continue;
    }
    const t = out.get(rootId) ?? { root: byId.get(rootId)!, replies: [], last: rootId };
    t.replies.push(l); t.last = Math.max(t.last, l.id);
    out.set(rootId, t);
  }
  return [...out.values()].sort((a, b) => b.last - a.last);
}
/** Long threads show the last few replies until opened. */
export const THREAD_PEEK = 3;

/** House posts get a label + tone by event. */
export function newsTone(event: string | null | undefined): { label: string; tone: 'boom' | 'fight' | 'match' | 'meh' } {
  switch (event) {
    case 'bomb': return { label: 'BOOM', tone: 'boom' };
    case 'penalty': return { label: 'PENALTY', tone: 'boom' };
    case 'challenge': case 'accepted': return { label: 'CHALLENGE', tone: 'fight' };
    case 'played': return { label: 'SETTLED', tone: 'fight' };
    case 'result': return { label: 'RESULTS', tone: 'fight' };
    case 'matchmaker': return { label: 'MATCHMAKER', tone: 'match' };
    case 'invite': return { label: 'LET\'S PLAY', tone: 'match' };
    case 'invite_off': return { label: 'CALLED OFF', tone: 'meh' };
    default: return { label: 'NEWS', tone: 'meh' };
  }
}

export type MyTagTab = 'tags' | 'board' | 'matchups' | 'rounds';
export const asTab = (s: string | null): MyTagTab => (s === 'board' || s === 'matchups' || s === 'rounds' ? s : 'tags');

// ---------- challenge rounds (migration 20261103): a slot (time + course) and up to 2 jump-ins ----------
export interface RoundPerson { id: string; name: string; nickname: string | null; number: number | null }
export interface ChallengeRound {
  id: string; pool_id: string; pool: string; pool_name: string; challenger: RoundPerson; challenged: RoundPerson;
  role: 'challenger' | 'challenged' | 'joined' | null; tee_at: string | null; course_id: string | null; course: string | null;
  slot_mine: boolean; locked: boolean; closes_at: string | null; due_at: string | null; joins: RoundPerson[];
}
/** Challenge rounds: up to 8 jump-ins, so a card of 10 (migration 20261113). */
export const MAX_JUMP_INS = 8;
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
/** A jump-in can drop out until tee time (jumping in closes 2 hours before; migration 20261114). */
export const canDropOut = (r: ChallengeRound, now: number) => r.role === 'joined' && (!r.tee_at || now < new Date(r.tee_at).getTime());
export const canJumpIn = (r: ChallengeRound, now: number) => r.role === null && roundStep(r, now) === 'open' && r.joins.length < MAX_JUMP_INS;

// ---------- @mentions (migration 20261109): the database decides who was mentioned; these only help type and show it ----------
export interface MentionPerson { id: string; label: string; number: number | null }
export interface Mention { chat_id: number; pool_id: string; pool: string; from: string | null; body: string; at: string; /** a reply to my message (not an @) */ reply?: boolean }

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

// ---------- casual round invites (migration 20261112): any distance on the board, up to 10 (migration 20261113), tags decided at tee-off ----------
export const CARD_MAX = 10;
export const MAX_INVITED = 9;
export type CasualStatus = 'in' | 'invited' | 'out';
export interface CasualPerson extends RoundPerson { status: CasualStatus; invited: boolean }
export interface CasualRound {
  id: string; pool_id: string; pool: string; pool_name: string; host: RoundPerson; tee_at: string; course_id: string | null; course: string | null;
  note: string | null; mine: CasualStatus | null; host_me: boolean; open: boolean; players: CasualPerson[];
}
export const casualIn = (r: CasualRound) => r.players.filter((p) => p.status === 'in');
export const seatsLeft = (r: CasualRound) => Math.max(0, CARD_MAX - casualIn(r).length);
/** What I can do on it: host (call off), in (drop out), say yes (invited / declined / open seat), full, or closed. */
export function casualAction(r: CasualRound): 'host' | 'leave' | 'join' | 'full' | 'closed' {
  if (!r.open) return 'closed';
  if (r.host_me) return 'host';
  if (r.mine === 'in') return 'leave';
  return seatsLeft(r) > 0 ? 'join' : 'full';
}

/** Casual-round errors in plain words (same codes as challenge rounds mean different limits here). null = not one of these. */
export function casualMessage(err: unknown): string | null {
  const m = (err && typeof err === 'object' && 'message' in err ? String((err as { message?: string }).message) : String(err ?? ''));
  if (/slot_too_soon/.test(m)) return 'Pick a time at least 15 minutes out.';
  if (/slot_too_far/.test(m)) return 'Pick a time within the next 30 days.';
  if (/slot_closed/.test(m)) return 'Too late: it closed at tee time.';
  if (/not_open/.test(m)) return 'That round was called off.';
  if (/round_full/.test(m)) return `That card is full (${CARD_MAX}).`;
  if (/not_in_set/.test(m)) return 'Everyone you invite needs a tag in this set.';
  if (/too_many_players/.test(m)) return `Invite up to ${MAX_INVITED} players (a card of ${CARD_MAX}).`;
  if (/invite_yourself/.test(m)) return "You're already on it: you're the host.";
  if (/too_many_invites/.test(m)) return 'You already have 3 rounds coming up in this set. Play one (or call one off) first.';
  if (/host_cancels/.test(m)) return "You're the host: call it off instead.";
  if (/not_your_invite/.test(m)) return 'Only the host can call it off.';
  if (/note_too_long/.test(m)) return 'Keep the note under 200 characters.';
  return null;
}

// ---------- check-in rounds (migration 20261122): one night, many cards, every tag set swaps across the field ----------
export interface NightPerson { id: string | null; name: string; nickname: string | null; guest: boolean; carded: boolean }
export interface Night {
  id: string; title: string; starts_at: string; course_id: string | null; course: string | null; note: string | null;
  host: { id: string; name: string; nickname: string | null }; host_me: boolean; closed: boolean; closed_at: string | null;
  /** Check-in is open (from 3 h before the start until it closes). */
  open: boolean; me_in: boolean; cards: number; my_card: string | null; players: NightPerson[];
  swaps: Array<{ pool_name: string; status: 'pending' | 'applied' | 'disputed' | 'void' }>;
  /** singles = Scorecard cards + field-wide tag swap; dubs = scored elsewhere, the host posts team results (migration 20261125). */
  format: NightFormat; results_at: string | null; results_note: string | null; results: NightTeam[];
}
export type NightFormat = 'singles' | 'dubs';
export interface NightTeam { team: number; place: number; to_par: number; players: Array<{ id: string | null; name: string }> }
/** One team as the host types it: up to 2 players (member or guest) and a score to par. */
export interface TeamDraft { players: Array<{ memberId: string | null; name: string }>; toPar: number }
/** Places from scores to par: ties share the place (1, 2, 2, 4). */
export function teamPlaces(scores: number[]): number[] {
  return scores.map((s) => 1 + scores.filter((x) => x < s).length);
}
/** What's wrong with the teams before posting, or null when they're good to go. */
export function teamsProblem(teams: TeamDraft[]): string | null {
  if (teams.length < 2) return 'Add at least 2 teams.';
  if (teams.some((t) => !t.players.length || t.players.some((p) => !p.name.trim()))) return 'Every team needs at least one player.';
  const keys = teams.flatMap((t) => t.players.map((p) => p.memberId ?? `g:${p.name.trim().toLowerCase()}`));
  if (new Set(keys).size !== keys.length) return 'Someone is on two teams.';
  if (teams.some((t) => !Number.isInteger(t.toPar) || t.toPar < -99 || t.toPar > 99)) return 'Scores to par run -99 to +99.';
  return null;
}
/** Checked-in members who aren't on a saved card yet (what's holding the night open). */
export const nightWaiting = (n: Night) => n.players.filter((p) => !p.guest && !p.carded);
/** Who's left for a new card: everyone checked in (members + guests) not on a saved card yet. */
export const nightFree = (n: Night) => n.players.filter((p) => !p.carded);
export function nightMessage(err: unknown): string | null {
  const m = (err && typeof err === 'object' && 'message' in err ? String((err as { message?: string }).message) : String(err ?? ''));
  if (/no_tag\b/.test(m)) return 'Hosting a check-in round takes a tag in any set.';
  if (/title_required/.test(m)) return 'Give the night a name (up to 60 characters).';
  if (/slot_too_soon/.test(m)) return 'Pick a start time that isn\'t already over.';
  if (/slot_too_far/.test(m)) return 'Pick a start within the next 30 days.';
  if (/unknown_course/.test(m)) return 'Pick a course.';
  if (/too_many_nights/.test(m)) return 'You already have 2 check-in rounds open. Close or call one off first.';
  if (/night_not_open/.test(m)) return 'Check-in opens 3 hours before the start.';
  if (/night_closed/.test(m)) return 'That night is closed: the tags already went up.';
  if (/night_off|not_found/.test(m)) return 'That night was called off.';
  if (/host_stays/.test(m)) return "You're the host: you stay checked in (call it off instead).";
  if (/already_on_card/.test(m)) return "They're on a saved card already, so they stay in.";
  if (/not_your_night/.test(m)) return 'Only the host can do that.';
  if (/guest_taken/.test(m)) return 'There\'s already a guest by that name. Add a last initial.';
  if (/name_too_long/.test(m)) return 'Guest names run up to 40 characters.';
  if (/no_cards_yet/.test(m)) return 'No cards are in yet, so there\'s nothing to close. Call it off instead?';
  if (/cards_saved/.test(m)) return 'Cards are in already. Close the night instead.';
  if (/night_dubs/.test(m)) return 'It\'s a dubs night: no Scorecard cards or tag swap. The host posts the results at the end.';
  if (/not_dubs/.test(m)) return 'Results are for dubs nights. Singles nights close from their cards.';
  if (/teams_2_to_60/.test(m)) return 'Post 2 to 60 teams.';
  if (/team_1_or_2/.test(m)) return 'A team is 1 or 2 players.';
  if (/player_twice/.test(m)) return 'Someone is on two teams.';
  if (/invalid_score/.test(m)) return 'Scores to par run -99 to +99.';
  if (/name_required/.test(m)) return 'Every guest needs a name.';
  if (/cards_saved/.test(m)) return 'Scorecard cards are already in, so it stays singles.';
  if (/night_full/.test(m)) return 'That\'s 120 people. The night is full.';
  return null;
}
