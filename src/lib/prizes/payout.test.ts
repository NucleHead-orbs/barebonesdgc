import { describe, expect, it } from 'vitest';
import type { LbRow } from '../jewel/leaderboard';
import { defaultConfig, defaultPaid, defaultPcts, effectivePcts, isPro, payout, pools, standings, type Finisher } from './payout';

const f = (id: string, total: number): Finisher => ({ id, name: id, total });
const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 10) / 10;

describe('defaults', () => {
  it('pros are cash, ams are credit', () => {
    expect(isPro('MPO')).toBe(true);
    expect(isPro('FP40')).toBe(true);
    expect(isPro('MA1')).toBe(false);
    expect(defaultConfig('MA40').currency).toBe('credit');
  });
  it('pays ≈40% of pros, ≈1/3 of ams, at least 1, never more than the field', () => {
    expect(defaultPaid(10, 'cash')).toBe(4);
    expect(defaultPaid(10, 'credit')).toBe(4);
    expect(defaultPaid(9, 'credit')).toBe(3);
    expect(defaultPaid(1, 'cash')).toBe(1);
    expect(defaultPaid(0, 'cash')).toBe(0);
  });
  it('tables are top-heavy and sum to exactly 100', () => {
    for (const n of [1, 2, 3, 5, 8, 13]) {
      const p = defaultPcts(n);
      expect(sum(p)).toBe(100);
      for (let i = 1; i < p.length; i++) expect(p[i]).toBeLessThan(p[i - 1]);
    }
    expect(defaultPcts(3)).toEqual([57.6, 31.3, 11.1]);
  });
  it('a custom table shorter than the places pads with 0', () => {
    expect(effectivePcts({ ...defaultConfig('MPO'), pcts: [60, 40] }, 3)).toEqual([60, 40, 0]);
  });
});

describe('pools', () => {
  const cfg = [
    { ...defaultConfig('MPO'), entryFee: 60 },
    { ...defaultConfig('MA1'), entryFee: 40, paybackPct: 70 },
    { ...defaultConfig('FA1'), entryFee: 40, paybackPct: 70, addedOverride: 50 },
  ];
  it('entry × payback, plus added spread by field size (fixed divisions excluded)', () => {
    const r = pools(cfg, { MPO: 10, MA1: 30, FA1: 5 }, 450);
    expect(r.spread).toBe(400);
    expect(r.lines).toEqual([
      { div: 'MPO', players: 10, entryPart: 600, added: 100, total: 700 },
      { div: 'MA1', players: 30, entryPart: 840, added: 300, total: 1140 },
      { div: 'FA1', players: 5, entryPart: 140, added: 50, total: 190 },
    ]);
  });
  it('never loses a cent of the spread (goes to the biggest field)', () => {
    const r = pools(cfg.slice(0, 2), { MPO: 1, MA1: 2 }, 100);
    expect(r.lines.reduce((a, l) => a + l.added, 0)).toBeCloseTo(100, 10);
    expect(r.lines[1].added).toBe(66.67);
  });
  it('flags fixed amounts that exceed the added total', () => {
    expect(pools(cfg, { MPO: 1, MA1: 1, FA1: 1 }, 20).overBy).toBe(30);
  });
});

describe('payout: PDGA ties', () => {
  const pcts = [50, 30, 20];
  it('no ties: straight table, cash rounded down to whole dollars', () => {
    const r = payout([f('a', -5), f('b', -3), f('c', 0), f('d', 2)], 101, pcts, 'cash', 1);
    expect(r.rows.map((x) => [x.place, x.amount])).toEqual([['1', 50], ['2', 30], ['3', 20], ['4', 0]]);
    expect(r.leftover).toBe(1);
  });
  it('a tie for 2nd splits 2nd + 3rd money', () => {
    const r = payout([f('a', -5), f('b', -3), f('c', -3), f('d', 2)], 100, pcts, 'cash', 1);
    expect(r.rows.map((x) => [x.place, x.amount])).toEqual([['1', 50], ['T2', 25], ['T2', 25], ['4', 0]]);
  });
  it('a tie across the cash line splits the last paid spot among everyone tied', () => {
    const r = payout([f('a', -5), f('b', -3), f('c', 0), f('d', 0), f('e', 0)], 100, pcts, 'credit', 1);
    expect(r.rows.map((x) => [x.place, x.amount])).toEqual([['1', 50], ['2', 30], ['T3', 6], ['T3', 6], ['T3', 6]]);
    expect(r.leftover).toBe(2);
  });
  it('a tie for 1st needs a playoff; the recorded winner takes 1st, the rest split 2nd + 3rd', () => {
    const tie = [f('a', -5), f('b', -5), f('c', -5), f('d', 0)];
    expect(payout(tie, 100, pcts, 'cash', 1).needsPlayoff).toBe(true);
    const r = payout(tie, 100, pcts, 'cash', 1, 'c');
    expect(r.needsPlayoff).toBe(false);
    expect(r.rows.map((x) => [x.id, x.place, x.amount])).toEqual([['c', '1', 50], ['a', 'T2', 25], ['b', 'T2', 25], ['d', '4', 0]]);
  });
  it('credit rounds down to $5 when asked', () => {
    const r = payout([f('a', 0), f('b', 1)], 97, [60, 40], 'credit', 5);
    expect(r.rows.map((x) => x.amount)).toEqual([55, 35]);
    expect(r.leftover).toBe(7);
  });
  it('fewer finishers than paid places: unclaimed money is leftover, not lost', () => {
    const r = payout([f('a', 0)], 100, pcts, 'cash', 1);
    expect(r.awarded).toBe(50);
    expect(r.leftover).toBe(50);
  });
});

describe('standings', () => {
  const row = (id: string, r1: [number, number, boolean], r2: [number, number, boolean] = [0, 0, false]): LbRow => ({
    player_id: id, name: id, div_code: 'MA1', div_sort: 1, r1_holes: r1[0], r1_to_par: r1[1], r1_official: r1[2],
    r2_holes: r2[0], r2_to_par: r2[1], r2_official: r2[2], hole_count: 18,
  });
  const rows = [row('a', [18, -2, true]), row('b', [18, 1, false]), row('c', [12, -9, false]), row('d', [18, -8, true])];
  it('official: signed cards only; DNF/DQ/NS drop out; best total first', () => {
    const s = standings(rows, 1, { d: 'dq' }, 'official');
    expect(s.ranked.map((x) => x.id)).toEqual(['a']);
    expect(s.unfinished.map((x) => x.id)).toEqual(['b', 'c']);
    expect(s.out).toEqual([{ id: 'd', name: 'd', status: 'dq' }]);
  });
  it('live: every hole in counts, signed or not', () => {
    expect(standings(rows, 1, {}, 'live').ranked.map((x) => x.id)).toEqual(['d', 'a', 'b']);
  });
  it('two-round events need both rounds and add them up', () => {
    const two = [row('a', [18, -2, true], [18, -1, true]), row('b', [18, -9, true])];
    const s = standings(two, 2, {}, 'official');
    expect(s.ranked).toEqual([{ id: 'a', name: 'a', total: -3 }]);
    expect(s.unfinished.map((x) => x.id)).toEqual(['b']);
  });
});
