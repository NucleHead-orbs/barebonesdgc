/**
 * Card requests, keep-apart pairs and ⭐ seating (pure, deterministic).
 * Runs on one wave's freshly generated (unlocked) cards and only ever SWAPS players between
 * them, so card sizes and the hole plan never change. Locked cards are never passed in.
 *
 * Rules, in priority order:
 *   1. Keep-apart pairs never share a card (hard: the generator never creates one).
 *   2. Approved request groups share a card. Requests chain: A+B and B+C => A+B+C.
 *      A group bigger than a card (5) is split in request order, with a warning.
 *   3. ⭐ players sit with their group, ☺ ("plays with anyone") players or other ⭐s before strangers.
 * Anything left unsatisfied is reported by cardIssues() (one source for generate AND hand moves),
 * so seatPairing itself only warns about request groups too big for one card.
 */
export type Vibe = 'star' | 'easy';
export interface PairingInput {
  groups: string[][];           // approved requests, each = all players named in it (requester first)
  apart: Array<[string, string]>;
  vibe: Record<string, Vibe>;
}
export interface PairingOptions {
  keepDivisions: boolean;       // prefer same-division swaps so division cards stay tidy
  divOf: (id: string) => string;
  nameOf: (id: string) => string;
}

export const MAX_GROUP = 5;

/** Union-find over approved requests. Order = first appearance. Oversized groups split into chunks of MAX_GROUP. */
export function requestClusters(groups: string[][], within?: Set<string>): { clusters: string[][]; oversized: string[][] } {
  const parent = new Map<string, string>();
  const order: string[] = [];
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  for (const g of groups) {
    const ids = g.filter((id) => !within || within.has(id));
    for (const id of ids) if (!parent.has(id)) { parent.set(id, id); order.push(id); }
    for (let i = 1; i < ids.length; i++) {
      const a = find(ids[0]), b = find(ids[i]);
      if (a !== b) parent.set(b, a);
    }
  }
  const byRoot = new Map<string, string[]>();
  for (const id of order) { const r = find(id); byRoot.set(r, [...(byRoot.get(r) ?? []), id]); }
  const clusters: string[][] = [];
  const oversized: string[][] = [];
  for (const c of byRoot.values()) {
    if (c.length < 2) continue;
    if (c.length > MAX_GROUP) oversized.push(c);
    for (let i = 0; i < c.length; i += MAX_GROUP) { const part = c.slice(i, i + MAX_GROUP); if (part.length > 1) clusters.push(part); }
  }
  return { clusters, oversized };
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export const apartSet = (apart: Array<[string, string]>) => new Set(apart.map(([a, b]) => pairKey(a, b)));
const clashes = (id: string, mates: string[], apart: Set<string>) => mates.some((m) => m !== id && apart.has(pairKey(id, m)));

export function seatPairing(input: string[][], ctx: PairingInput, opt: PairingOptions): { cards: string[][]; warnings: string[] } {
  const cards = input.map((c) => [...c]);
  const warnings: string[] = [];
  const all = new Set(cards.flat());
  const apart = apartSet(ctx.apart);
  const { clusters, oversized } = requestClusters(ctx.groups, all);
  for (const o of oversized) warnings.push(`Request group of ${o.length} (${o.map(opt.nameOf).join(', ')}) is bigger than a card, so it was split.`);

  const clusterOf = new Map<string, number>();
  clusters.forEach((c, i) => c.forEach((id) => clusterOf.set(id, i)));
  const cardOf = (id: string) => cards.findIndex((c) => c.includes(id));
  /** With at least one of their own group on the card: never moved by later steps. */
  const anchored = (id: string, ci: number) => clusterOf.has(id) && cards[ci].some((m) => m !== id && clusterOf.get(m) === clusterOf.get(id));
  const swap = (a: string, ca: number, b: string, cb: number) => {
    cards[ca][cards[ca].indexOf(a)] = b;
    cards[cb][cards[cb].indexOf(b)] = a;
  };
  const okSwap = (a: string, ca: number, b: string, cb: number) =>
    !clashes(b, cards[ca].filter((m) => m !== a), apart) && !clashes(a, cards[cb].filter((m) => m !== b), apart);
  const rank = (id: string, like?: string) => [
    clusterOf.has(id) ? 1 : 0,
    ctx.vibe[id] === 'star' ? 1 : 0,
    opt.keepDivisions && like && opt.divOf(id) !== opt.divOf(like) ? 1 : 0,
    ctx.vibe[id] === 'easy' ? 0 : 1,
  ];
  const byRank = (like?: string) => (x: string, y: string) => {
    const a = rank(x, like), b = rank(y, like);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return x.localeCompare(y);
  };

  // ---- 2. seat each request group on one card (the card its first member landed on)
  clusters.forEach((cl, ci) => {
    const target = cardOf(cl[0]);
    for (const m of cl.slice(1)) {
      const from = cardOf(m);
      if (from === target) continue;
      const cands = cards[target].filter((x) => clusterOf.get(x) !== ci && !anchored(x, target)).sort(byRank(m));
      const x = cands.find((c) => okSwap(m, from, c, target));
      if (x) swap(m, from, x, target); // else: cardIssues reports the split
    }
  });

  // ---- 1. keep-apart repair: move the less-anchored one to another card
  for (let ci = 0; ci < cards.length; ci++) {
    for (const a of [...cards[ci]]) {
      if (!cards[ci].includes(a)) continue;
      const bad = cards[ci].find((b) => b !== a && apart.has(pairKey(a, b)));
      if (!bad) continue;
      const mover = [a, bad].sort((x, y) => Number(anchored(x, ci)) - Number(anchored(y, ci)) || byRank()(x, y))[0];
      if (anchored(mover, ci)) continue; // both held by request groups: cardIssues reports it
      let done = false;
      for (let cj = 0; cj < cards.length && !done; cj++) {
        if (cj === ci) continue;
        const y = cards[cj].filter((c) => !anchored(c, cj)).sort(byRank(mover)).find((c) => okSwap(mover, ci, c, cj));
        if (y) { swap(mover, ci, y, cj); done = true; }
      }
    }
  }

  // ---- 3. ⭐ comfort: swap strangers for ☺ players from cards without a ⭐
  const comfy = (s: string, m: string) => ctx.vibe[m] === 'easy' || ctx.vibe[m] === 'star' || (clusterOf.has(s) && clusterOf.get(s) === clusterOf.get(m));
  for (let ci = 0; ci < cards.length; ci++) {
    for (const s of cards[ci].filter((id) => ctx.vibe[id] === 'star')) {
      for (const t of cards[ci].filter((m) => m !== s && !comfy(s, m) && !anchored(m, ci))) {
        let done = false;
        for (let cj = 0; cj < cards.length && !done; cj++) {
          if (cj === ci || cards[cj].some((id) => ctx.vibe[id] === 'star')) continue;
          const y = cards[cj]
            .filter((c) => ctx.vibe[c] === 'easy' && !anchored(c, cj) && (!opt.keepDivisions || opt.divOf(c) === opt.divOf(t)))
            .sort((a, b) => a.localeCompare(b))
            .find((c) => okSwap(t, ci, c, cj));
          if (y) { swap(t, ci, y, cj); done = true; }
        }
      }
    }
  }

  return { cards, warnings };
}

/** Problems on the cards as they stand now (after generate, or after hand moves). */
export function cardIssues(cards: string[][], ctx: PairingInput, nameOf: (id: string) => string): string[] {
  const out: string[] = [];
  const apart = apartSet(ctx.apart);
  const where = new Map<string, number>();
  cards.forEach((c, i) => c.forEach((id) => where.set(id, i)));
  cards.forEach((c) => {
    for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++)
      if (apart.has(pairKey(c[i], c[j]))) out.push(`Keep-apart: ${nameOf(c[i])} and ${nameOf(c[j])} are on the same card.`);
  });
  for (const cl of requestClusters(ctx.groups, new Set(where.keys())).clusters) {
    const cardsUsed = new Set(cl.map((id) => where.get(id)));
    if (cardsUsed.size > 1) out.push(`Request split: ${cl.map(nameOf).join(', ')} aren't all on one card.`);
  }
  const { clusters } = requestClusters(ctx.groups, new Set(where.keys()));
  const clusterOf = new Map<string, number>();
  clusters.forEach((c, i) => c.forEach((id) => clusterOf.set(id, i)));
  cards.forEach((c) => {
    for (const s of c.filter((id) => ctx.vibe[id] === 'star')) {
      const mates = c.filter((m) => m !== s);
      const good = mates.some((m) => ctx.vibe[m] === 'easy' || ctx.vibe[m] === 'star' || (clusterOf.has(s) && clusterOf.get(m) === clusterOf.get(s)));
      if (mates.length && !good) out.push(`⭐ ${nameOf(s)} has no requested or ☺ cardmates.`);
    }
  });
  return out;
}
