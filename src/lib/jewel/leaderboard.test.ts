import { describe, it, expect } from 'vitest';
import { rankDivision, divisionsPresent, onCourse, statusLine, toPar, parTone, rankTeams, onlyRound, settlePlayoff, type LbRow, type TeamRow } from './leaderboard';

const row = (name: string, o: Partial<LbRow> = {}): LbRow => ({
  player_id: name, name, div_code: 'MA1', div_sort: 7, hole_count: 20,
  r1_holes: 0, r1_to_par: null, r1_official: false, r2_holes: 0, r2_to_par: null, r2_official: false, ...o,
});

describe('rankDivision', () => {
  const rows = [
    row('Axl', { r1_holes: 20, r1_to_par: -3, r1_official: true }),
    row('Lita', { r1_holes: 20, r1_to_par: 2, r1_official: true }),
    row('Joan', { r1_holes: 20, r1_to_par: 2, r1_official: true }),
    row('Ozzy', { r1_holes: 12, r1_to_par: -5 }),               // live, unsigned
    row('Dee'),                                                  // not started
  ];

  it('live mode counts unsigned rounds; ties show T; not-started sorts last with –', () => {
    const r = rankDivision(rows, 'live');
    expect(r.map((x) => [x.name, x.pos])).toEqual([['Ozzy', '1'], ['Axl', '2'], ['Joan', 'T3'], ['Lita', 'T3'], ['Dee', '–']]);
    expect(r[0].first).toBe(true);
    expect(r[4].total).toBeNull();
  });

  it('official mode hides unsigned rounds', () => {
    const r = rankDivision(rows, 'official');
    expect(r.map((x) => [x.name, x.pos])).toEqual([['Axl', '1'], ['Joan', 'T2'], ['Lita', 'T2'], ['Dee', '–'], ['Ozzy', '–']]);
    expect(r.find((x) => x.name === 'Ozzy')!.r1).toBeNull();
  });

  it('total adds both rounds; a tie for first is T1 and both are gold', () => {
    const r = rankDivision([
      row('A', { r1_holes: 20, r1_to_par: 1, r1_official: true, r2_holes: 20, r2_to_par: -2, r2_official: true }),
      row('B', { r1_holes: 20, r1_to_par: -1, r1_official: true }),
    ], 'official');
    expect(r.map((x) => [x.name, x.total, x.pos, x.first])).toEqual([['A', -1, 'T1', true], ['B', -1, 'T1', true]]);
  });

  it('pre-event (nobody scored) lists the whole field alphabetically', () => {
    expect(rankDivision([row('Zed'), row('Amy')], 'live').map((x) => [x.name, x.pos])).toEqual([['Amy', '–'], ['Zed', '–']]);
  });
});

describe('display helpers', () => {
  it('status lines match the design copy', () => {
    expect(statusLine(row('a'))).toBe('Not started');
    expect(statusLine(row('a', { r1_holes: 12 }))).toBe('R1 · thru 12 · unofficial');
    expect(statusLine(row('a', { r1_holes: 20, r1_official: true }))).toBe('R1 ✓ signed');
    expect(statusLine(row('a', { r1_holes: 20, r1_official: true, r2_holes: 5 }))).toBe('R2 · thru 5 · unofficial');
    expect(statusLine(row('a', { r2_holes: 20, r2_official: true }))).toBe('R2 ✓ signed');
  });
  it('to-par formatting and tone', () => {
    expect([toPar(0), toPar(3), toPar(-2), toPar(null)]).toEqual(['E', '+3', '-2', '–']);
    expect([parTone(-1), parTone(0), parTone(2)]).toEqual(['under', 'even', 'over']);
  });
  it('divisions in canonical order, only those with players; on-course count', () => {
    const rs = [row('a', { div_code: 'MA2', div_sort: 12 }), row('b', { div_code: 'MPO', div_sort: 1, r1_holes: 4 }), row('c', { div_code: 'MA2', div_sort: 12, r1_holes: 20 })];
    expect(divisionsPresent(rs)).toEqual(['MPO', 'MA2']);
    expect(onCourse(rs)).toBe(1);
  });
});

describe('doubles + per-round boards', () => {
  const t = (id: string, a: string, b: string | null, holes: number, toPar: number | null, official: boolean): TeamRow =>
    ({ team_id: id, round: 1, team_no: 1, a_name: a, b_name: b, holes_played: holes, hole_count: 18, to_par: toPar, official, card_label: '1' });
  it('ranks teams with ties, Cali named, unstarted last', () => {
    const r = rankTeams([t('1', 'Ann', 'Bob', 18, -5, true), t('2', 'Cal', 'Dee', 18, -5, true), t('3', 'Eve', null, 18, -7, true), t('4', 'Fay', 'Gus', 0, null, false)], 'official');
    expect(r.map((x) => [x.pos, x.name])).toEqual([['1', 'Eve (Cali)'], ['T2', 'Ann & Bob'], ['T2', 'Cal & Dee'], ['–', 'Fay & Gus']]);
  });
  it('official mode ignores unsigned teams', () => {
    expect(rankTeams([t('1', 'Ann', 'Bob', 9, -3, false)], 'official')[0].pos).toBe('–');
    expect(rankTeams([t('1', 'Ann', 'Bob', 9, -3, false)], 'live')[0].status).toBe('thru 9 · unofficial');
  });
  it('onlyRound(2) puts round 2 in the r1 slots and never sums', () => {
    const row = { player_id: 'p', name: 'P', div_code: 'MA1', div_sort: 1, r1_holes: 18, r1_to_par: -4, r1_official: true, r2_holes: 18, r2_to_par: 2, r2_official: true, hole_count: 18 };
    const [only] = onlyRound([row], 2);
    expect(rankDivision([only], 'official')[0].total).toBe(2);
    expect(rankDivision(onlyRound([row], 1), 'official')[0].total).toBe(-4);
  });
});

describe('playoffs settle a tie for 1st', () => {
  const tied = [
    row('Axl', { r1_holes: 20, r1_to_par: -3, r1_official: true }),
    row('Bo', { r1_holes: 20, r1_to_par: -3, r1_official: true }),
    row('Cy', { r1_holes: 20, r1_to_par: -3, r1_official: true }),
    row('Di', { r1_holes: 20, r1_to_par: 1, r1_official: true }),
  ];
  it('the winner shows 1 and moves to the top; the rest of the tie share 2nd; places below stay put', () => {
    expect(rankDivision(tied, 'official', 'Cy').map((x) => [x.name, x.pos, x.first])).toEqual(
      [['Cy', '1', true], ['Axl', 'T2', false], ['Bo', 'T2', false], ['Di', '4', false]]);
  });
  it('a two-way tie: the loser is a plain 2', () => {
    expect(rankDivision(tied.filter((x) => x.name !== 'Cy'), 'official', 'Bo').map((x) => x.pos)).toEqual(['1', '2', '3']);
  });
  it('ignored when the winner isn\'t in the tie for 1st (or there is no tie)', () => {
    expect(rankDivision(tied, 'official', 'Di').map((x) => x.pos)).toEqual(['T1', 'T1', 'T1', '4']);
    expect(settlePlayoff([{ pos: '1', first: true }], () => true)).toEqual([{ pos: '1', first: true }]);
  });
  it('doubles: the captain names the winning team', () => {
    const t = (id: string, a: string, b: string, to: number): TeamRow => ({ team_id: id, round: 1, team_no: Number(id), a_name: a, b_name: b, holes_played: 22, hole_count: 22, to_par: to, official: true, card_label: null, player_a: `p-${a}` });
    const rows = [t('1', 'Saul', 'Jaden', -18), t('2', 'Danny', 'Roger', -18), t('3', 'Blake', 'Matt', -13)];
    expect(rankTeams(rows, 'official').map((x) => x.pos)).toEqual(['T1', 'T1', '3']);
    expect(rankTeams(rows, 'official', 'p-Danny').map((x) => [x.name, x.pos])).toEqual([['Danny & Roger', '1'], ['Saul & Jaden', '2'], ['Blake & Matt', '3']]);
  });
});
