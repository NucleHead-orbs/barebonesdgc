import { describe, it, expect } from 'vitest';
import { rankDivision, divisionsPresent, onCourse, statusLine, toPar, parTone, type LbRow } from './leaderboard';

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
