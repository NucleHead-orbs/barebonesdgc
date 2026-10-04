/**
 * Digital bag tags (pure). Source of truth: supabase/migrations/20261004000000_bag_tags.sql.
 * One numbered set per league (pool). #1 is best. A round swaps tags among the players on it who hold one
 * in that pool: best score takes the lowest of their numbers; ties keep their order from before.
 * The database does the real swap (_tag_apply); swap() here is the same rule for previews.
 */
export interface TagPool { id: string; slug: string; name: string; sort: number; invite_only: boolean }
export interface Tag { pool_id: string; number: number; holder_id: string | null; status: 'held' | 'available' | 'retired'; issued_at: string; moved_at: string | null; moves: number }
export interface TagMember { id: string; name: string; nickname: string | null }
export type MatchStatus = 'pending' | 'applied' | 'disputed' | 'void';

export interface SwapIn { id: string; score: number; tag: number | null }
export interface SwapOut { id: string; score: number; before: number | null; after: number | null }

/** Same rule as the database. Players without a tag pass through untouched (before = after = null). */
export function swap(players: SwapIn[]): SwapOut[] {
  const holders = players.filter((p) => p.tag !== null);
  const nums = holders.map((p) => p.tag as number).sort((a, b) => a - b);
  const order = holders.slice().sort((a, b) => a.score - b.score || (a.tag as number) - (b.tag as number));
  const after = new Map(order.map((p, i) => [p.id, nums[i]]));
  return players.map((p) => ({ id: p.id, score: p.score, before: p.tag, after: p.tag === null ? null : after.get(p.id) ?? null }));
}

/** A swap waiting on confirmations (tag_pending). place: 1 = best on that round, ties share a place. */
export interface PendingSwap {
  id: string; status: 'pending' | 'disputed'; round_id: string | null; course: string | null; played_on: string; created_at: string;
  players: Array<{ member_id: string; place: number; confirmed: boolean; disputed: boolean }>;
}
export interface ProjectedRow { number: number; holder_id: string; was: number | null; swaps: string[] }

/**
 * The board if every waiting swap goes through, oldest first, using the same rule as the database:
 * best place takes the lowest of those players' numbers; ties keep their (projected) order. Disputed swaps don't project.
 * was = the holder's official number when it changed; swaps = the pending swaps that touch this holder.
 */
export function projectPending(tags: Array<{ number: number; holder_id: string | null }>, pending: PendingSwap[]): ProjectedRow[] {
  const numOf = new Map(tags.filter((t) => t.holder_id).map((t) => [t.holder_id!, t.number]));
  const official = new Map(numOf);
  const touched = new Map<string, string[]>();
  for (const sw of pending.slice().sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const ps = sw.players.filter((p) => numOf.has(p.member_id));
    ps.forEach((p) => touched.set(p.member_id, [...(touched.get(p.member_id) ?? []), sw.id]));
    if (sw.status !== 'pending' || ps.length < 2) continue;
    const nums = ps.map((p) => numOf.get(p.member_id)!).sort((a, b) => a - b);
    ps.slice().sort((a, b) => a.place - b.place || numOf.get(a.member_id)! - numOf.get(b.member_id)!)
      .forEach((p, i) => numOf.set(p.member_id, nums[i]));
  }
  return [...numOf].map(([holder_id, number]) => ({
    number, holder_id, was: official.get(holder_id) === number ? null : official.get(holder_id)!, swaps: touched.get(holder_id) ?? [],
  })).sort((a, b) => a.number - b.number);
}

/** "Mike 'Whitey' Minnier" style display. */
export const display = (m: { name: string; nickname?: string | null }) => (m.nickname ? `${m.name} "${m.nickname}"` : m.name);

/** Name matching for event results -> tag holders: case, spacing and punctuation don't matter. */
export const normName = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export function matchMembers<T extends { name: string }>(rows: T[], members: TagMember[]): Array<T & { member_id: string | null }> {
  const byName = new Map<string, string>();
  for (const m of members) {
    byName.set(normName(m.name), m.id);
    if (m.nickname && !byName.has(normName(m.nickname))) byName.set(normName(m.nickname), m.id);
  }
  return rows.map((r) => ({ ...r, member_id: byName.get(normName(r.name)) ?? null }));
}

export const myTagUrl = (origin: string, token: string) => `${origin.replace(/\/$/, '')}/tag/${encodeURIComponent(token)}`;
export const tagPageUrl = (origin: string, pool: string, n: number) => `${origin.replace(/\/$/, '')}/tags/${encodeURIComponent(pool)}/${n}`;

/** A score box value -> integer or null (blank / junk). */
export function parseScore(v: string): number | null {
  const t = v.trim();
  return /^-?\d{1,3}$/.test(t) ? Number(t) : null;
}

export function tagMessage(err: unknown): string {
  const e = (err && typeof err === 'object' ? err : {}) as { message?: string; code?: string };
  const m = e.message ?? String(err);
  if (/invalid_link/.test(m)) return "This link doesn't work anymore. Ask your league TD for a new one.";
  if (/no_tag_in_pool/.test(m)) return "Everyone on the round needs a tag in this league. Someone doesn't have one.";
  if (/must_include_you/.test(m)) return 'You can only log rounds you played in.';
  if (/players_2_to_6/.test(m)) return 'A tag round needs 2 to 6 tag holders.';
  if (/duplicate_player/.test(m)) return 'Someone is on the round twice.';
  if (/invalid_score/.test(m)) return 'Every player needs a score (whole number).';
  if (/invalid_date/.test(m)) return 'Pick a date in the last two weeks.';
  if (/too_many_open/.test(m)) return 'You already have 3 rounds waiting on confirmations. Get those confirmed (or withdraw one) first.';
  if (/not_your_round/.test(m)) return "That round isn't one of yours.";
  if (/round_expired/.test(m)) return 'Nobody confirmed that round within 7 days, so it expired. Log it again if it still counts.';
  if (/round_applied|already_applied/.test(m)) return 'That round already counted.';
  if (/round_disputed/.test(m)) return 'That round is disputed. Your league TD will settle it.';
  if (/round_void|already_void/.test(m)) return 'That round was withdrawn or voided.';
  if (/cannot_withdraw/.test(m)) return 'Only whoever logged it can withdraw it, and only before anyone else confirms.';
  if (/already_has_tag/.test(m)) return 'That person already has a tag in this league.';
  if (/tag_taken/.test(m)) return 'Somebody already holds that number.';
  if (/name_required/.test(m)) return 'Type a name.';
  if (/invalid_number/.test(m)) return 'Tag numbers run 1 to 9999.';
  if (/event_already_recorded/.test(m)) return 'That event already moved tags in this league. Undo it first to record it again.';
  if (/nothing_to_undo/.test(m)) return 'Nothing to undo yet.';
  if (/tags_changed_since/.test(m)) return "Can't undo: one of those tags changed hands since. Fix it by hand with release/issue.";
  if (/unknown_member/.test(m)) return 'Someone on that list isn\'t in the tag roster. Reload and try again.';
  if (/forbidden|permission denied|row-level security/i.test(m) || e.code === '42501') return "This account doesn't run that league's tags. Ask the super admin to add your email.";
  if (/Failed to fetch|NetworkError|network|load failed/i.test(m)) return 'No signal. Nothing was saved. Try again in a moment.';
  return `Something went wrong: ${m}`;
}

/**
 * Digital tag art per league (the physical tag's own design, from the club Drive: Tags/<league>/<year>).
 * back = the number side (portrait, number drawn live in the circle); front = the art side (landscape).
 * Pools without art fall back to the plain number card.
 */
export interface TagArt {
  front: string; back: string; numColor: string; cx: number; cy: number;
  /** 'tall' (default) = portrait number side + landscape art side; 'square' = both sides square, plain flip. */
  shape?: 'tall' | 'square'; numStroke?: string; numSize?: number;
  /** Optional CSS gradient for the number's fill (drawn over a numStroke outline), e.g. the Lazy Boners drip colours. */
  numFill?: string;
  /** Font size (cqw) for 3-digit numbers; default numSize * 0.68. */
  numSize3?: number;
}
export const TAG_ART: Record<string, TagArt> = {
  // Art 2026-10-04 (Mike): number side = the psychedelic leaf with the medallion, art side = Safety Sundays.
  // Both square; the swirl, leaf glow and sun cycle colours (animations live in the SVGs).
  'lazy-boners': {
    front: '/assets/tags/lazy-boners/front.svg', back: '/assets/tags/lazy-boners/back.svg', shape: 'square',
    numColor: '#f2ff3a', numStroke: '#0b0710', numSize: 30, cx: 0.502, cy: 0.59, // medallion centre on the 1000x1000 back
    numFill: 'linear-gradient(180deg, #f2ff3a 0%, #e6ff2e 38%, #ff9a1f 62%, #ff3fa8 88%)',
  },
  // Jewel XI Early Access (Mike, 2026-10-04): number side = the All Access pass, the number on the stage marquee
  // (chasing bulbs); art side = the skull laminate. Skulls bounce, gems light up, the skull's eyes spin.
  'jewel-xi-ea': {
    front: '/assets/tags/jewel-xi-ea/front.svg', back: '/assets/tags/jewel-xi-ea/back.svg', shape: 'square',
    numColor: '#ffa62b', numStroke: '#0b0710', numSize: 13.5, numSize3: 11, cx: 0.5, cy: 0.542, // marquee centre on the 1000x1000 back
    numFill: 'linear-gradient(180deg, #ffe14a 0%, #ffa62b 45%, #ff3fa8 90%)',
  },
  // Invite-only set (admins + core members). Art: Mike's Golden Boners tag; number side drawn to match (public/assets/tags/golden-boners).
  'golden-boners': {
    front: '/assets/tags/golden-boners/front.svg', back: '/assets/tags/golden-boners/back.svg', shape: 'square',
    numColor: '#ffe12e', numStroke: '#22061f', numSize: 24, cx: 0.5, cy: 0.6, // medallion centre on the 1000x1000 back
  },
  // RBFL: art side = Mike's Root Beer Float League tag (2026-10-04); number side drawn to match, number on the full moon.
  rbfl: {
    front: '/assets/tags/rbfl/front.svg', back: '/assets/tags/rbfl/back.svg', shape: 'square',
    numColor: '#c35ff0', numStroke: '#0b0710', numSize: 24, cx: 0.5, cy: 0.455, // moon centre on the 1000x1000 back
  },
};

/**
 * Which scores a tag round is recorded from (locked 2026-09-30): only singles rounds count. A 2-round all-singles event
 * can use the event total (the Jewel way) or one round; a mixed event (e.g. Pop Up: R1 dubs + R2 tag round) uses its
 * singles round. No singles round = nothing to record.
 */
export type TagSource = 'total' | 1 | 2;
export function tagSources(ev: { rounds: number; r1_format?: string; r2_format?: string }): { options: Array<[TagSource, string]>; dflt: TagSource | null } {
  const singles = ([1, 2] as const).filter((n) => n <= ev.rounds && ((n === 1 ? ev.r1_format : ev.r2_format) ?? 'singles') === 'singles');
  if (!singles.length) return { options: [], dflt: null };
  if (singles.length === 2) return { options: [['total', 'Both rounds (event total)'], [1, 'Round 1 only'], [2, 'Round 2 only']], dflt: 'total' };
  return { options: singles.map((n) => [n, ev.rounds === 2 ? `Round ${n} (the singles round)` : `Round ${n}`] as [TagSource, string]), dflt: singles[singles.length - 1] };
}
