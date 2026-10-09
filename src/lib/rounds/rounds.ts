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
  /** Tag sets declared on the line before tee-off (pool ids). Locked once a score is in; saved with the round. */
  onLine?: string[];
  /** SHARE LIVE: mirror this card to the public live view while playing. Absent = on. */
  live?: boolean;
  /** PULL OUT: player key -> holes finished before they left (DNF). Later holes are par +3 (migration 20261120). */
  out?: Record<string, number>;
  /** The scheduled round this card was started from ('casual:<id>' | 'challenge:<id>'): one saved card per round. */
  source?: string | null;
  /** What to call that round on the card ("Danny vs Nick", "April's round"). */
  sourceLabel?: string | null;
}

/** The round has started (any score in): tags on the line are locked. */
export const started = (d: Pick<Draft, 'scores'>) => d.scores.some((s) => s.some((x) => x != null));

/** What hole i (0-based) is called on the course. */
export const holeName = (d: { labels?: string[] | null }, i: number) => d.labels?.[i] ?? String(i + 1);
export const MAX_PLAYERS = 10;
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

/** DNF: holes after a pulled-out player's last are par +3 (same rule the database applies on save). */
export const DNF_OVER = 3;
export const isOut = (d: Pick<Draft, 'out' | 'players'>, i: number) => d.out?.[d.players[i]?.key] != null;

/** PULL OUT player i: DNF after the holes they finished (first blank hole); the rest fill with par +3. Undone by putBack. */
export function pullOut(d: Draft, i: number): Draft {
  const p = d.players[i];
  if (!p || isOut(d, i)) return d;
  const row = d.scores[i] ?? [];
  const done = d.pars.findIndex((_, h) => row[h] == null);
  if (done < 0) return d;   // finished every hole: nothing to pull out of
  const scores = d.scores.map((r, j) => (j !== i ? r : d.pars.map((par, h) => (h < done ? r[h] ?? null : par + DNF_OVER))));
  return { ...d, scores, out: { ...(d.out ?? {}), [p.key]: done } };
}
/** Undo a PULL OUT: back in, the auto-filled holes go blank again. */
export function putBack(d: Draft, i: number): Draft {
  const p = d.players[i];
  const done = p ? d.out?.[p.key] : undefined;
  if (!p || done == null) return d;
  const out = { ...(d.out ?? {}) }; delete out[p.key];
  return { ...d, out, scores: d.scores.map((r, j) => (j !== i ? r : d.pars.map((_, h) => (h < done ? r[h] ?? null : null)))) };
}

/**
 * Tee order for hole h (0-based): the card's order on the first hole; after that, lowest score on the previous hole
 * throws first and ties keep the order they had. A hole someone hasn't scored yet doesn't reshuffle anyone.
 * Pulled-out players drop to the end once they're out. Returns player indexes; [0] owns the box.
 */
export function teeOrder(d: Pick<Draft, 'players' | 'scores' | 'out'>, h: number): number[] {
  let order = d.players.map((_, i) => i);
  for (let prev = 0; prev < h; prev++) {
    const live = order.filter((i) => !(d.out?.[d.players[i].key] != null && d.out[d.players[i].key] <= prev));
    if (live.every((i) => d.scores[i]?.[prev] != null)) {
      const ranked = live.slice().sort((a, b) => (d.scores[a]![prev]! - d.scores[b]![prev]!) || (order.indexOf(a) - order.indexOf(b)));
      order = [...ranked, ...order.filter((i) => !live.includes(i))];
    }
  }
  const outNow = (i: number) => d.out?.[d.players[i].key] != null && d.out[d.players[i].key] <= h;
  return [...order.filter((i) => !outNow(i)), ...order.filter(outNow)];
}

/** A scheduled round (casual invite or challenge) -> a fresh card: course + first layout, the players who are in, tags. */
export interface RoundSource {
  source: string; label: string; course: string | null; courseId: string | null;
  players: Array<{ memberId: string; name: string }>; onLine?: string[];
}
export function draftFromRound(src: RoundSource, today: string, courses: Array<{ id: string; name: string; layouts: Array<{ id: string; pars: number[]; labels: string[] | null; ft: Array<number | null> }> }>): Draft {
  const c = src.courseId ? courses.find((x) => x.id === src.courseId) : undefined;
  const l = c?.layouts[0];
  const base = newDraft(today);
  const seen = new Set<string>();
  const players = src.players.filter((p) => !seen.has(p.memberId) && seen.add(p.memberId)).slice(0, MAX_PLAYERS)
    .map((p) => ({ key: p.memberId, memberId: p.memberId, name: p.name }));
  return {
    ...base, course: c?.name ?? src.course ?? '', courseId: c?.id ?? null, layoutId: l?.id ?? null,
    ...(l ? { pars: l.pars.slice(), labels: l.labels, ft: l.ft } : {}),
    players, scores: players.map(() => []), onLine: src.onLine ?? [], source: src.source, sourceLabel: src.label,
  };
}

/** Leaders by to-par over holes played (only players with at least one hole). */
export function leaders(d: Pick<Draft, 'pars' | 'scores'> & Partial<Pick<Draft, 'out' | 'players'>>): number[] {
  const t = d.scores.map((s) => running(d.pars, s));
  const played = t.map((x, i) => ({ ...x, i })).filter((x) => x.thru > 0 && !(d.players?.[x.i] && d.out?.[d.players[x.i].key] != null));
  if (!played.length) return [];
  const best = Math.min(...played.map((x) => x.toPar));
  return played.filter((x) => x.toPar === best).map((x) => x.i);
}

export const holeDone = (d: Pick<Draft, 'players' | 'scores'>, h: number) => d.players.length > 0 && d.players.every((_, p) => d.scores[p]?.[h] != null);

/** What's still missing before a round can be saved (empty = ready). */
/**
 * Why this card can't be saved yet, in plain words, plus what to tap (bug squasher, 2026-10-09: a solo card never got
 * saved because FINISH only scrolled and nobody said what was holding it up). blockers stop the save; warnings don't.
 * Mirrors round_save's own rules (course, you on it, names, every hole for everyone, played in the last 14 days).
 */
export type FinishFix = 'connect' | 'setup' | 'hole';
export interface Blocker { text: string; fix?: FinishFix; hole?: number }
export interface FinishSet { pool: { id: string; name: string }; holders: Array<{ member_id: string }>; blocked?: boolean }
export function finishCheck(d: Draft, meId: string | null, opts: { today?: string; sets?: FinishSet[]; tagNames?: Record<string, string> } = {}):
  { blockers: Blocker[]; warnings: string[] } {
  const blockers: Blocker[] = [];
  const warnings: string[] = [];
  if (!d.course.trim()) blockers.push({ text: 'Pick or type the course.', fix: 'setup' });
  if (!meId) blockers.push({ text: 'Connect your My Tag link to save (it\'s how the round knows who you are).', fix: 'connect' });
  else if (!d.players.some((p) => p.memberId === meId)) blockers.push({ text: 'You have to be on the round to save it. Add yourself in Edit round.', fix: 'setup' });
  if (!d.players.length) blockers.push({ text: 'Add a player.', fix: 'setup' });
  d.players.forEach((p, i) => {
    const who = p.name.trim() || `Player ${i + 1}`;
    if (!p.name.trim()) blockers.push({ text: `Player ${i + 1} needs a name.`, fix: 'setup' });
    const miss = d.pars.map((_, h) => h).filter((h) => d.scores[i]?.[h] == null);
    if (!miss.length) return;
    const names = miss.map((h) => holeName(d, h));
    const list = names.length > 6 ? `${names.slice(0, 6).join(', ')} and ${names.length - 6} more` : names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
    blockers.push({ text: miss.length === d.pars.length ? `${who} has no scores yet. Every player needs a score on every hole (or take them off the card in Edit round).`
      : `${who} is missing hole${miss.length === 1 ? '' : 's'} ${list}.`, fix: 'hole', hole: miss[0] });
  });
  if (opts.today && d.playedOn) {
    const days = Math.round((Date.parse(opts.today) - Date.parse(d.playedOn)) / 86400000);
    if (days > 14) blockers.push({ text: `This card is dated ${d.playedOn}, more than two weeks ago. Rounds save within two weeks of the day they're played.` });
  }
  const sets = opts.sets ?? [];
  for (const id of d.onLine ?? []) {
    const s = sets.find((x) => x.pool.id === id);
    if (!s) {
      const name = opts.tagNames?.[id];
      warnings.push(name
        ? `${name} tags were on the line, but you're the only ${name} tag holder left on this card, so no tags will swap. Tags only swap between holders on the same card.`
        : 'Tags were on the line, but nobody else on this card holds one from that set anymore, so no tags will swap. Tags only swap between holders on the same card.');
    } else if (s.blocked) {
      blockers.push({ text: `${s.pool.name} tags can't go on the line on this card: Early Access needs 3 Jewel players, or 2 with a challenge you've accepted. Untick it in Edit round, then save.`, fix: 'setup' });
    }
  }
  return { blockers, warnings };
}

/** Just the blocker texts (kept for callers that only need yes/no + words). */
export function saveProblems(d: Draft, meId: string | null): string[] {
  return finishCheck(d, meId).blockers.map((b) => b.text);
}

/** The round_save payload. Call only when finishCheck() has no blockers. */
export function toPayload(d: Draft) {
  return {
    course: d.course.trim(), course_id: d.courseId, layout_id: d.layoutId, played_on: d.playedOn, pars: d.pars,
    ...(d.labels && d.labels.length === d.pars.length ? { labels: d.labels } : {}),
    ...(d.source ? { source: d.source } : {}),
    players: d.players.map((p, i) => {
      const dnf = d.out?.[p.key];
      const scores = d.pars.map((par, h) => (dnf != null && h >= dnf ? par + DNF_OVER : d.scores[i]?.[h] ?? null));
      return { ...(p.memberId ? { member_id: p.memberId } : { guest_name: p.name.trim() }), scores, ...(dnf != null ? { dnf_after: dnf } : {}) };
    }),
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
  if (/players_1_to_(8|10)/.test(m)) return 'A round has 1 to 10 players.';
  if (/duplicate_player/.test(m)) return 'Someone is on the card twice.';
  if (/name_required/.test(m)) return 'Every guest needs a name.';
  if (/too_many_rounds/.test(m)) return "That's 20 rounds today. Save the rest tomorrow.";
  if (/not_your_round/.test(m)) return "That round isn't one of yours.";
  if (/no_tag_in_pool/.test(m)) return "You don't hold a tag in that set.";
  if (/not_live/.test(m)) return 'That round isn\'t live anymore.';
  if (/muted/.test(m)) return 'The scorer muted reactions for this round.';
  if (/slow_down/.test(m)) return 'Easy. One reaction every 15 seconds.';
  if (/invalid_reaction/.test(m)) return "That reaction isn't on the menu.";
  if (/invalid_card|invalid_live/.test(m)) return 'The live view didn\'t take that update. Your card is safe on this phone.';
  if (/forbidden/.test(m)) return 'Only that tag set\'s league admins can vouch for a round.';
  if (/already_saved/.test(m)) return 'Someone on your card already saved this round. Check Boner Rounds (or your My Tag) and confirm your score there.';
  if (/needs_challenge/.test(m)) return 'Early Access tags need 3 Jewel players on the card, or 2 with a challenge you\'ve accepted (My Tag → MATCHUPS). Untick that set and save again.';
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
