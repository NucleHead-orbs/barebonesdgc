/**
 * Boner Rounds + the club scorecard: pure helpers (no Supabase).
 * Source of truth: supabase/migrations/20261014000000_club_rounds.sql (club_rounds, club_round_players,
 * tag_matches.round_id). The database computes strokes/to-par on save; these helpers mirror it for the live card.
 */

export interface CardPlayer { key: string; memberId: string | null; name: string }
export interface Draft {
  course: string; courseId: string | null; layoutId: string | null; playedOn: string;
  pars: number[]; players: CardPlayer[]; scores: Array<Array<number | null>>; cur: number;
  /** The course's own hole names (Buffalo Ridge: 1 2 3 4 5 A B …) and feet, from the library layout. Absent = 1..n, no feet. */
  labels?: string[] | null; ft?: Array<number | null> | null;
}

/** What hole i (0-based) is called on the course. */
export const holeName = (d: { labels?: string[] | null }, i: number) => d.labels?.[i] ?? String(i + 1);
export const MAX_PLAYERS = 8;
export const HOLE_CHOICES = [9, 18, 19, 20, 21, 24, 27];

export function newDraft(today: string, me?: { id: string; name: string } | null): Draft {
  return {
    course: '', courseId: null, layoutId: null, playedOn: today, pars: Array(18).fill(3),
    players: me ? [{ key: me.id, memberId: me.id, name: me.name }] : [], scores: me ? [[]] : [], cur: 0,
  };
}

/** Change the hole count, keeping what's already entered. New holes are par 3. */
export function setHoles(d: Draft, n: number): Draft {
  const pars = Array.from({ length: n }, (_, i) => d.pars[i] ?? 3);
  return { ...d, pars, scores: d.scores.map((r) => r.slice(0, n)), cur: Math.min(d.cur, n - 1), layoutId: null, labels: null, ft: null };
}

export const fmtToPar = (n: number) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`);
export const toParClass = (n: number) => (n < 0 ? 'under' : n > 0 ? 'over' : 'even');

/** Totals over the holes this player has scored so far. */
export function running(pars: number[], scores: Array<number | null>): { strokes: number; toPar: number; thru: number } {
  let strokes = 0, par = 0, thru = 0;
  pars.forEach((p, i) => { const s = scores[i]; if (s != null) { strokes += s; par += p; thru++; } });
  return { strokes, toPar: strokes - par, thru };
}

/** Leaders by to-par over holes played (only players with at least one hole). */
export function leaders(d: Pick<Draft, 'pars' | 'scores'>): number[] {
  const t = d.scores.map((s) => running(d.pars, s));
  const played = t.map((x, i) => ({ ...x, i })).filter((x) => x.thru > 0);
  if (!played.length) return [];
  const best = Math.min(...played.map((x) => x.toPar));
  return played.filter((x) => x.toPar === best).map((x) => x.i);
}

export const holeDone = (d: Pick<Draft, 'players' | 'scores'>, h: number) => d.players.length > 0 && d.players.every((_, p) => d.scores[p]?.[h] != null);

/** What's still missing before a round can be saved (empty = ready). */
export function saveProblems(d: Draft, meId: string | null): string[] {
  const out: string[] = [];
  if (!d.course.trim()) out.push('Pick or type the course.');
  if (!meId) out.push('Connect your My Tag link to save.');
  else if (!d.players.some((p) => p.memberId === meId)) out.push('You have to be on the round to save it.');
  if (!d.players.length) out.push('Add a player.');
  d.players.forEach((p, i) => {
    if (!p.name.trim()) out.push(`Player ${i + 1} needs a name.`);
    const missing = d.pars.filter((_, h) => d.scores[i]?.[h] == null).length;
    if (missing) out.push(`${p.name || `Player ${i + 1}`} is missing ${missing} hole${missing === 1 ? '' : 's'}.`);
  });
  return out;
}

/** The round_save payload. Call only when saveProblems() is empty. */
export function toPayload(d: Draft) {
  return {
    course: d.course.trim(), course_id: d.courseId, layout_id: d.layoutId, played_on: d.playedOn, pars: d.pars,
    ...(d.labels && d.labels.length === d.pars.length ? { labels: d.labels } : {}),
    players: d.players.map((p, i) => ({ ...(p.memberId ? { member_id: p.memberId } : { guest_name: p.name.trim() }), scores: d.scores[i].slice(0, d.pars.length) })),
  };
}

/** A My Tag link (or the bare code) -> its token. */
export function parseTagLink(s: string): string | null {
  const t = s.trim();
  const m = t.match(/\/tag\/([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(t) ? t : null;
}

export const ME_KEY = 'bb-mytag-token';
export const DRAFT_KEY = 'bb-scorecard-draft-v1';

/** Saved-round status for display: everyone confirmed, someone disputed, or who it's waiting on. */
export function confirmState(players: Array<{ member_id: string | null; name: string; confirmed: boolean; disputed: boolean }>) {
  const members = players.filter((p) => p.member_id);
  if (members.some((p) => p.disputed)) return { kind: 'disputed' as const, waiting: [] as string[] };
  const waiting = members.filter((p) => !p.confirmed).map((p) => p.name);
  return waiting.length ? { kind: 'waiting' as const, waiting } : { kind: 'confirmed' as const, waiting };
}

/** Tag sets where 2+ members on the round hold a tag (an exchange is possible), with who'd be in it. */
export function exchangeOptions(
  memberIds: string[],
  tags: Array<{ pool_id: string; number: number; holder_id: string | null }>,
  pools: Array<{ id: string; slug: string; name: string }>,
) {
  return pools.map((pool) => ({
    pool, holders: tags.filter((t) => t.pool_id === pool.id && t.holder_id && memberIds.includes(t.holder_id)).map((t) => ({ member_id: t.holder_id!, number: t.number })),
  })).filter((x) => x.holders.length >= 2);
}

export function roundMessage(err: unknown): string {
  const e = (err && typeof err === 'object' ? err : {}) as { message?: string };
  const m = e.message ?? String(err);
  if (/invalid_link/.test(m)) return "That My Tag link doesn't work. Ask your league TD for a new one.";
  if (/must_include_you/.test(m)) return 'You can only save rounds you played in. Add yourself to the card.';
  if (/every_hole_scored/.test(m)) return 'Every player needs a score on every hole.';
  if (/invalid_score/.test(m)) return 'Hole scores run 1 to 20.';
  if (/invalid_pars/.test(m)) return 'Pars run 2 to 6.';
  if (/invalid_labels/.test(m)) return 'The hole names don\'t match the card. Pick the layout again.';
  if (/invalid_date/.test(m)) return 'Rounds have to be from the last two weeks.';
  if (/course_required/.test(m)) return 'Pick or type the course.';
  if (/players_1_to_8/.test(m)) return 'A round has 1 to 8 players.';
  if (/duplicate_player/.test(m)) return 'Someone is on the card twice.';
  if (/name_required/.test(m)) return 'Every guest needs a name.';
  if (/too_many_rounds/.test(m)) return "That's 20 rounds today. Save the rest tomorrow.";
  if (/not_your_round/.test(m)) return "That round isn't one of yours.";
  if (/no_tag_in_pool/.test(m)) return "You don't hold a tag in that set.";
  if (/need_two_holders/.test(m)) return 'A tag exchange needs at least two tag holders from that set on the round.';
  if (/already_exchanged/.test(m)) return 'Tags from that set are already on the line for this round.';
  if (/round_disputed/.test(m)) return "Someone disputed this round. Sort it out first (or void it and save it again).";
  if (/too_many_open/.test(m)) return 'You already have 3 tag rounds waiting on confirmations. Get those confirmed first.';
  if (/tags_already_moved/.test(m)) return 'Tags already moved on this round, so it stays. Your league TD can undo the swap.';
  if (/round_expired/.test(m)) return 'That tag exchange expired (7 days). Put the tags on the line again.';
  if (/unknown_member/.test(m)) return 'Someone on the card isn\'t in the member list anymore. Reload and try again.';
  if (/Failed to fetch|NetworkError|network|load failed/i.test(m)) return 'No signal. Nothing was saved. Your card is still on this phone; try again in a moment.';
  return `Something went wrong: ${m}`;
}
