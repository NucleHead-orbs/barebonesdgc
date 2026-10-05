import { describe, expect, it } from 'vitest';
import { padShort, tourFit, tourLines } from './tour';

const pads = [{ id: 'am', label: 'AM pad', sort: 2 }, { id: 'rec', label: 'Rec / Ladies pad', sort: 1 }];

describe('tour shirt back', () => {
  it('pad labels shorten', () => {
    expect(padShort('AM pad')).toBe('AM');
    expect(padShort('Rec / Ladies pad')).toBe('REC');
  });
  it('orders by hole, main tee before pads, then sort; unassigned close the list as STOP nn', () => {
    const lines = tourLines([
      { hole: null, tee_id: null, name: 'Greg Mayer', sort: 2 },
      { hole: 13, tee_id: 'am', name: 'Pad Pimp', sort: 1 },
      { hole: 13, tee_id: null, name: 'Fixer & The Lazy Boners', sort: 1 },
      { hole: 3, tee_id: null, name: 'Robert Ellis', sort: 1 },
      { hole: 13, tee_id: 'rec', name: 'Rec Rocker', sort: 1 },
      { hole: null, tee_id: null, name: 'Brandon Mauk', sort: 1 },
      { hole: 6, tee_id: null, name: '  ', sort: 1 },
    ], pads);
    expect(lines).toEqual([
      { when: 'HOLE 03', name: 'Robert Ellis' },
      { when: 'HOLE 13', name: 'Fixer & The Lazy Boners' },
      { when: 'HOLE 13 REC', name: 'Rec Rocker' },
      { when: 'HOLE 13 AM', name: 'Pad Pimp' },
      { when: 'STOP 05', name: 'Brandon Mauk' },
      { when: 'STOP 06', name: 'Greg Mayer' },
    ]);
  });
  it('half-hole sponsors share a hole line number', () => {
    const l = tourLines([{ hole: 6, tee_id: null, name: 'B', sort: 2 }, { hole: 6, tee_id: null, name: 'A', sort: 1 }], []);
    expect(l.map((x) => x.when + ' ' + x.name)).toEqual(['HOLE 06 A', 'HOLE 06 B']);
  });
  it('fits: one column to 18, two after, rows fill the box, font has a floor', () => {
    expect(tourFit(7)).toEqual({ cols: 1, rowH: 72, font: 34 });
    expect(tourFit(18).cols).toBe(1);
    expect(tourFit(19).cols).toBe(2);
    const big = tourFit(40);
    expect(big.rowH * 20).toBeLessThanOrEqual(620);
    expect(big.font).toBeGreaterThanOrEqual(12);
  });
});
