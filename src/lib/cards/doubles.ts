/**
 * Random draw doubles (locked 2026-09-30, Mike): pure random partners (seeded, re-drawable), an odd player is a Cali
 * (a one-person team), cards are built from TEAMS so partners always share a card. Pure + deterministic.
 * The draw is saved with td_set_teams; the database refuses a published card that splits a team.
 */
import { generateCards, rng, type BuilderPlayer, type Card, type GenerateInput, type GenerateResult } from './generate';
import type { PairingInput } from './pairing';

/** [captain, partner | null]. Captain = the first name; the team's score is kept on the captain. */
export type TeamPair = [string, string | null];

const sortedIds = (ids: string[]) => [...new Set(ids)].sort();
const shuffle = <T,>(xs: T[], seed: number): T[] => {
  const out = xs.slice(); const rand = rng(seed);
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
};
const apartKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Pair everyone at random. Keep-apart pairs are never partners (swapped with the next team when possible). Odd one out = Cali. */
export function drawTeams(ids: string[], seed: number, apart: Array<[string, string]> = []): TeamPair[] {
  const order = shuffle(sortedIds(ids), seed);
  const teams: TeamPair[] = [];
  for (let i = 0; i < order.length; i += 2) teams.push([order[i], order[i + 1] ?? null]);
  return fixApart(teams, apart);
}

function fixApart(teams: TeamPair[], apart: Array<[string, string]>): TeamPair[] {
  const bad = new Set(apart.map(([a, b]) => apartKey(a, b)));
  const clash = (t: TeamPair) => !!t[1] && bad.has(apartKey(t[0], t[1]));
  const out = teams.map((t) => [...t] as TeamPair);
  for (let i = 0; i < out.length; i++) {
    if (!clash(out[i])) continue;
    for (let j = 0; j < out.length; j++) {
      if (j === i || !out[j][1]) continue;
      const a: TeamPair = [out[i][0], out[j][1]], b: TeamPair = [out[j][0], out[i][1]];
      if (!clash(a) && !clash(b)) { out[i] = a; out[j] = b; break; }
    }
  }
  return out;
}

/** Latecomers: the first one joins the Cali (if any), the rest pair up in a random order; a new odd one out is the new Cali. */
export function addToDraw(teams: TeamPair[], newIds: string[], seed: number, apart: Array<[string, string]> = []): TeamPair[] {
  const have = new Set(teams.flatMap(([a, b]) => (b ? [a, b] : [a])));
  const fresh = shuffle(sortedIds(newIds.filter((id) => !have.has(id))), seed);
  if (!fresh.length) return teams;
  const out = teams.map((t) => [...t] as TeamPair);
  const cali = out.findIndex((t) => t[1] === null);
  if (cali >= 0) out[cali] = [out[cali][0], fresh.shift()!];
  for (let i = 0; i < fresh.length; i += 2) out.push([fresh[i], fresh[i + 1] ?? null]);
  return fixApart(out, apart);
}

/** Swap two players between teams (or partners within one team → no change). Returns new teams. */
export function swapPlayers(teams: TeamPair[], x: string, y: string): TeamPair[] {
  const at = (id: string): [number, 0 | 1] | null => {
    for (let i = 0; i < teams.length; i++) { if (teams[i][0] === id) return [i, 0]; if (teams[i][1] === id) return [i, 1]; }
    return null;
  };
  const p = at(x), q = at(y); if (!p || !q || p[0] === q[0]) return teams;
  const out = teams.map((t) => [...t] as TeamPair);
  out[p[0]][p[1]] = y; out[q[0]][q[1]] = x;
  return out;
}

/** Remove players who are gone (e.g. un-checked-in); a team that loses a partner becomes a Cali; empty teams vanish. */
export function pruneTeams(teams: TeamPair[], keep: Set<string>): TeamPair[] {
  return teams.flatMap(([a, b]) => {
    const m = [a, b].filter((x): x is string => !!x && keep.has(x));
    return m.length ? [[m[0], m[1] ?? null] as TeamPair] : [];
  });
}

export const membersOf = ([a, b]: TeamPair) => (b ? [a, b] : [a]);
export function captainMap(teams: TeamPair[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const t of teams) for (const id of membersOf(t)) m.set(id, t[0]);
  return m;
}

/** Card requests / keep-apart / vibes in player ids → the same rules over teams. */
export function teamPairing(p: PairingInput | undefined, cap: Map<string, string>): PairingInput | undefined {
  if (!p) return p;
  const c = (id: string) => cap.get(id) ?? id;
  const groups = p.groups.map((g) => [...new Set(g.map(c))]).filter((g) => g.length > 1);
  const apart = p.apart.map(([a, b]) => [c(a), c(b)] as [string, string]).filter(([a, b]) => a !== b);
  const vibe: PairingInput['vibe'] = {};
  for (const [id, v] of Object.entries(p.vibe)) vibe[c(id)] ??= v;
  return { groups, apart, vibe };
}

/**
 * Cards for a doubles round. Each team is one seat unit (2 players, a Cali is 1). Target = teamsPerCard (default 2);
 * when the field doesn't split evenly one card takes a 3rd team, and the Cali is moved onto that card when it can be.
 * Returns cards in PLAYER ids (partners next to each other), ready for publish.
 */
export function generateDoubles(input: GenerateInput & { teams: TeamPair[] }): GenerateResult {
  const { teams, players } = input;
  const byId = new Map(players.map((p) => [p.id, p]));
  const inPool = teams.filter((t) => membersOf(t).every((id) => byId.has(id)));
  const cap = captainMap(inPool);
  const units: BuilderPlayer[] = inPool.map((t) => {
    const ms = membersOf(t).map((id) => byId.get(id)!);
    const rated = ms.map((m) => m.rating).filter((r): r is number => r != null);
    return {
      id: t[0], name: ms.map((m) => m.name).join(' & '), div: ms[0].div,
      rating: rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null,
      regOrder: Math.min(...ms.map((m) => m.regOrder ?? Infinity)) === Infinity ? null : Math.min(...ms.map((m) => m.regOrder ?? Infinity)),
    };
  });
  const tpc = input.settings.teamsPerCard ?? 2;
  const toUnit = (c: Card): Card => ({ ...c, playerIds: [...new Set(c.playerIds.map((id) => cap.get(id) ?? id))].filter((id) => cap.has(id)) });
  const res = generateCards({
    ...input,
    players: units,
    settings: { ...input.settings, size: tpc as 3, keepDivisions: false, mergeSmall: false, balance: true },
    lockedCards: (input.lockedCards ?? []).map(toUnit),
    pairing: teamPairing(input.pairing, cap),
    sizing: { min: 2, max: 3, noun: 'team' },
  });
  const unitCards = res.cards.map((c) => ({ ...c, playerIds: c.playerIds.slice() }));
  // The Cali belongs on the big card (2 teams + Cali = 5 players) rather than making a 6-player card elsewhere.
  const cali = inPool.find((t) => t[1] === null)?.[0];
  const requested = new Set((teamPairing(input.pairing, cap)?.groups ?? []).flat());
  if (cali) {
    const home = unitCards.find((c) => c.playerIds.includes(cali));
    const big = unitCards.find((c) => c.playerIds.length === 3 && !c.locked && !c.playerIds.includes(cali));
    if (home && big && !home.locked && !requested.has(cali)) {
      const out = big.playerIds.find((id) => id !== cali && !requested.has(id));
      if (out) { big.playerIds = big.playerIds.map((id) => (id === out ? cali : id)); home.playerIds = home.playerIds.map((id) => (id === cali ? out : id)); }
    }
  }
  const team = new Map(inPool.map((t) => [t[0], t]));
  const cards = unitCards.map((c) => ({ ...c, playerIds: c.playerIds.flatMap((u) => membersOf(team.get(u) ?? [u, null])) }));
  return { cards, warnings: res.warnings };
}

/** Hand move in a doubles round: the whole team moves; the card it lands on locks. */
export function moveTeam(cards: Card[], playerId: string, targetKey: string, keyOf: (c: Card) => string, cap: Map<string, string>): Card[] {
  const captain = cap.get(playerId) ?? playerId;
  const members = [...cap.entries()].filter(([, c]) => c === captain).map(([id]) => id);
  const who = members.length ? members : [playerId];
  const target = cards.find((c) => keyOf(c) === targetKey);
  if (!target || who.every((id) => target.playerIds.includes(id))) return cards;
  return cards
    .map((c) => {
      const ids = c.playerIds.filter((id) => !who.includes(id));
      if (keyOf(c) === targetKey) return { ...c, locked: true, playerIds: [...ids, ...who] };
      return ids.length === c.playerIds.length ? c : { ...c, playerIds: ids };
    })
    .filter((c) => c.playerIds.length > 0);
}
