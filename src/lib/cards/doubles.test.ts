import { describe, expect, it } from 'vitest';
import { addToDraw, captainMap, drawTeams, generateDoubles, membersOf, moveTeam, pruneTeams, swapPlayers, type TeamPair } from './doubles';
import { DEFAULT_SETTINGS, type BuilderPlayer, type Card } from './generate';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${String(i + 1).padStart(2, '0')}`);
const players = (n: number): BuilderPlayer[] => ids(n).map((id, i) => ({ id, name: id.toUpperCase(), div: 'MA1', rating: null, regOrder: i + 1 }));
const flat = (t: TeamPair[]) => t.flatMap(membersOf).sort();
const S = { ...DEFAULT_SETTINGS, pmDivisions: [], doubleUp: [], sortBy: 'random' as const };
const key = (c: Card) => `${c.wave}-${c.startHole}-${c.groupNo}`;

describe('drawTeams', () => {
  it('pairs everyone once, deterministic by seed, odd one out is the Cali', () => {
    const t = drawTeams(ids(9), 7);
    expect(flat(t)).toEqual(ids(9));
    expect(t.filter((x) => x[1] === null)).toHaveLength(1);
    expect(drawTeams(ids(9), 7)).toEqual(t);
    expect(drawTeams(ids(9), 8)).not.toEqual(t);
    expect(drawTeams([...ids(9)].reverse(), 7)).toEqual(t); // input order never matters
  });
  it('never partners a keep-apart pair', () => {
    for (let seed = 1; seed < 40; seed++) {
      const t = drawTeams(ids(8), seed, [['p01', 'p02'], ['p03', 'p04']]);
      expect(t.some(([a, b]) => (a === 'p01' && b === 'p02') || (a === 'p02' && b === 'p01') || (a === 'p03' && b === 'p04') || (a === 'p04' && b === 'p03'))).toBe(false);
    }
  });
  it('latecomers fill the Cali first, then pair up', () => {
    const t = drawTeams(ids(5), 3);
    const cali = t.find((x) => x[1] === null)![0];
    const next = addToDraw(t, ['x1', 'x2', 'x3', 'p01'], 3);
    expect(next.find((x) => x[0] === cali)![1]).not.toBeNull();
    expect(flat(next)).toEqual([...ids(5), 'x1', 'x2', 'x3'].sort());
    expect(next.filter((x) => x[1] === null)).toHaveLength(0);
  });
  it('swap and prune', () => {
    const t: TeamPair[] = [['a', 'b'], ['c', 'd'], ['e', null]];
    expect(swapPlayers(t, 'b', 'c')).toEqual([['a', 'c'], ['b', 'd'], ['e', null]]);
    expect(swapPlayers(t, 'a', 'b')).toEqual(t);
    expect(pruneTeams(t, new Set(['a', 'c', 'd']))).toEqual([['a', null], ['c', 'd']]);
  });
});

describe('generateDoubles', () => {
  const run = (n: number, extra: Partial<typeof S> = {}, pairing?: Parameters<typeof generateDoubles>[0]['pairing']) => {
    const teams = drawTeams(ids(n), 11);
    const res = generateDoubles({ players: players(n), settings: { ...S, ...extra }, divOrder: ['MA1'], holeCount: 18, teams, pairing });
    return { teams, ...res };
  };
  const together = (cards: Card[], teams: TeamPair[]) => teams.every((t) => cards.some((c) => membersOf(t).every((id) => c.playerIds.includes(id))));
  it('9 players: a 2-team card and a 2-team + Cali card, partners together', () => {
    const { cards, teams } = run(9);
    expect(cards.map((c) => c.playerIds.length).sort()).toEqual([4, 5]);
    expect(together(cards, teams)).toBe(true);
    expect(cards.flatMap((c) => c.playerIds).sort()).toEqual(ids(9));
  });
  it('12 players: three cards of 2 teams', () => {
    expect(run(12).cards.map((c) => c.playerIds.length)).toEqual([4, 4, 4]);
  });
  it('14 players (7 teams): one card takes a 3rd team', () => {
    const { cards, warnings } = run(14);
    expect(cards.map((c) => c.playerIds.length).sort()).toEqual([4, 4, 6]);
    expect(warnings).toEqual([]);
  });
  it('a card request pulls both teams onto one card', () => {
    const teams = drawTeams(ids(12), 11);
    const [x, y] = [teams[0][0], teams[5][1]!];
    const { cards } = generateDoubles({ players: players(12), settings: S, divOrder: ['MA1'], holeCount: 18, teams, pairing: { groups: [[x, y]], apart: [], vibe: {} } });
    expect(cards.some((c) => c.playerIds.includes(x) && c.playerIds.includes(y))).toBe(true);
    expect(together(cards, teams)).toBe(true);
  });
  it('a hand move carries the whole team and locks the card', () => {
    const { cards, teams } = run(12);
    const cap = captainMap(teams);
    const t = teams[0]; const from = cards.find((c) => c.playerIds.includes(t[0]))!; const to = cards.find((c) => c !== from)!;
    const moved = moveTeam(cards, t[1]!, key(to), key, cap);
    const land = moved.find((c) => key(c) === key(to))!;
    expect(land.locked).toBe(true);
    expect(membersOf(t).every((id) => land.playerIds.includes(id))).toBe(true);
    expect(together(moved, teams)).toBe(true);
  });
});
