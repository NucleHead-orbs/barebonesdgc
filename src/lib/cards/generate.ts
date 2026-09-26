/**
 * Card + shotgun start-hole assignment.
 * Port of generate() from the Card Builder prototype, with its defects fixed:
 *  - group numbers never collide with a locked card on the same hole
 *  - running out of start slots is an error, not a silent pile-up on hole 1
 *  - missing R1 scores always seed last (never counted as 0)
 * Pure and deterministic: same inputs + seed => same cards.
 * Labels ('7', '7A') are NOT computed here; the database owns that rule.
 */
export type Wave = 'AM' | 'PM';
export type SortBy = 'rating' | 'r1' | 'reg' | 'random';

export interface BuilderPlayer {
  id: string;
  name: string;
  div: string;
  rating: number | null;
  regOrder: number | null;
}

export interface BuilderSettings {
  pmDivisions: string[];
  size: 3 | 4 | 5;
  sortBy: SortBy;
  keepDivisions: boolean;
  mergeSmall: boolean;
  balance: boolean;
  doubleUp: number[]; // hole order for 2nd+ cards once every hole is used
  skip: number[]; // never used as a start hole
  seed: number;
}

export interface Card {
  wave: Wave;
  startHole: number;
  groupNo: number;
  locked: boolean;
  playerIds: string[];
}

export interface GenerateInput {
  players: BuilderPlayer[];
  settings: BuilderSettings;
  divOrder: string[]; // canonical division order
  holeCount: number;
  lockedCards?: Card[];
  r1Strokes?: Record<string, number>; // official, complete R1 totals only (r2_seed view)
}

export interface GenerateResult {
  cards: Card[];
  warnings: string[];
}

export const MAX_GROUPS_PER_HOLE = 5; // A–E

export class CardGenerationError extends Error {}

export const DEFAULT_SETTINGS: BuilderSettings = {
  pmDivisions: ['MPO', 'FPO', 'MP40', 'FP40', 'MP50', 'MP55', 'MA1', 'MA40'],
  size: 4,
  sortBy: 'reg', // locked 2026-09-26: DGS exports carry no ratings
  keepDivisions: true,
  mergeSmall: true,
  balance: true,
  doubleUp: [6, 15, 14, 19, 17, 16], // locked 2026-09-26: longest holes first; covers last year's 26 PM cards
  skip: [],
  seed: 7,
};

export function rng(seed: number): () => number {
  let s = Math.abs(Math.trunc(seed)) % 233280;
  return () => (s = (s * 9301 + 49297) % 233280) / 233280;
}

export function waveOf(div: string, pmDivisions: string[]): Wave {
  return pmDivisions.includes(div) ? 'PM' : 'AM';
}

export const MIN_CARD = 3;
export const MAX_CARD = 5;

/**
 * Card sizes for a group of n players.
 * Balanced: as even as possible (11 -> 4,4,3). If even-splitting would leave a card
 * under 3, use one fewer card as long as none exceeds 5 (5 -> one card of 5, not 3+2).
 */
export function splitSizes(n: number, size: number, balance: boolean): number[] {
  if (n <= 0) return [];
  let k = Math.ceil(n / size);
  if (balance) while (k > 1 && Math.floor(n / k) < MIN_CARD && Math.ceil(n / (k - 1)) <= MAX_CARD) k--;
  if (balance) return Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0));
  return Array.from({ length: k }, (_, i) => Math.min(size, n - i * size));
}

function sortGroup(g: BuilderPlayer[], s: BuilderSettings, r1: Record<string, number>, rand: () => number): BuilderPlayer[] {
  const out = g.slice();
  const rating = (p: BuilderPlayer) => p.rating ?? -Infinity;
  const byName = (a: BuilderPlayer, b: BuilderPlayer) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  switch (s.sortBy) {
    case 'rating':
      return out.sort((a, b) => rating(b) - rating(a) || byName(a, b));
    case 'reg':
      return out.sort((a, b) => (a.regOrder ?? Infinity) - (b.regOrder ?? Infinity) || byName(a, b));
    case 'r1':
      return out.sort((a, b) => (r1[a.id] ?? Infinity) - (r1[b.id] ?? Infinity) || rating(b) - rating(a) || byName(a, b));
    case 'random':
      out.sort(byName); // stable base so the seed alone decides the order
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
  }
}

export function generateCards(input: GenerateInput): GenerateResult {
  const { players, settings: s, divOrder, holeCount } = input;
  const locked = (input.lockedCards ?? []).filter((c) => c.locked);
  const r1 = input.r1Strokes ?? {};
  const rand = rng(s.seed);
  const warnings: string[] = [];

  const skip = new Set(s.skip);
  const holes = Array.from({ length: holeCount }, (_, i) => i + 1).filter((n) => !skip.has(n));
  if (holes.length === 0) throw new CardGenerationError('Every hole is skipped. Leave at least one start hole.');
  const doubles = s.doubleUp.filter((n) => holes.includes(n));

  const lockedIds = new Set(locked.flatMap((c) => c.playerIds));
  const known = new Set(players.map((p) => p.id));
  const out: Card[] = locked.map((c) => ({ ...c, playerIds: c.playerIds.filter((id) => known.has(id)) }));

  for (const wave of ['AM', 'PM'] as const) {
    const pool = players.filter((p) => waveOf(p.div, s.pmDivisions) === wave && !lockedIds.has(p.id));

    let groups: BuilderPlayer[][];
    if (s.keepDivisions) {
      const unknownDivs = [...new Set(pool.map((p) => p.div))].filter((d) => !divOrder.includes(d)).sort();
      groups = [...divOrder, ...unknownDivs].map((d) => pool.filter((p) => p.div === d)).filter((g) => g.length);
    } else {
      groups = pool.length ? [pool] : [];
    }
    groups = groups.map((g) => sortGroup(g, s, r1, rand));
    if (s.keepDivisions && s.mergeSmall) {
      const small = groups.filter((g) => g.length < 3);
      if (small.length > 1) groups = [...groups.filter((g) => g.length >= 3), small.flat()];
    }

    const fresh: Card[] = [];
    for (const g of groups) {
      let at = 0;
      for (const n of splitSizes(g.length, s.size, s.balance)) {
        fresh.push({ wave, startHole: 0, groupNo: 0, locked: false, playerIds: g.slice(at, at + n).map((p) => p.id) });
        at += n;
      }
    }

    // Occupancy per hole, and which group numbers are already used on it.
    const used = new Map<number, Set<number>>();
    for (const c of out.filter((c) => c.wave === wave)) {
      if (!used.has(c.startHole)) used.set(c.startHole, new Set());
      used.get(c.startHole)!.add(c.groupNo);
    }
    const occ = (n: number) => used.get(n)?.size ?? 0;

    const order: Array<[hole: number, pass: number]> = [];
    for (let pass = 0; pass < MAX_GROUPS_PER_HOLE; pass++) {
      const base = pass === 0 ? holes : [...doubles, ...holes.filter((n) => !doubles.includes(n))];
      for (const n of base) order.push([n, pass]);
    }

    let oi = 0;
    for (const c of fresh) {
      while (oi < order.length && occ(order[oi][0]) > order[oi][1]) oi++;
      if (oi >= order.length) {
        throw new CardGenerationError(
          `${wave} wave needs more start slots than ${holes.length} holes × ${MAX_GROUPS_PER_HOLE} groups. Raise the card size or add a wave.`,
        );
      }
      const n = order[oi][0];
      const set = used.get(n) ?? new Set<number>();
      let g = 1;
      while (set.has(g)) g++;
      set.add(g);
      used.set(n, set);
      c.startHole = n;
      c.groupNo = g;
      out.push(c);
      oi++;
    }

    const waveCards = out.filter((c) => c.wave === wave);
    if (waveCards.length > holes.length * 2)
      warnings.push(`${wave}: ${waveCards.length} cards on ${holes.length} holes, more than 2 per hole.`);
  }

  for (const c of out) {
    if (c.playerIds.length > 5) warnings.push(`${c.wave} hole ${c.startHole}: ${c.playerIds.length} players (over 5).`);
    if (c.playerIds.length > 0 && c.playerIds.length < 3 && !c.locked)
      warnings.push(`${c.wave} hole ${c.startHole}: only ${c.playerIds.length} player(s).`);
  }

  const cards = out
    .filter((c) => c.playerIds.length > 0)
    .sort((a, b) => a.wave.localeCompare(b.wave) || a.startHole - b.startHole || a.groupNo - b.groupNo);
  return { cards, warnings };
}
