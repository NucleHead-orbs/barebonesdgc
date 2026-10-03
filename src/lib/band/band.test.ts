import { describe, expect, it } from 'vitest';
import { isUpload, moveSorts, nextSort, type BandMember } from './band';

const m = (id: string, sort: number): BandMember => ({ id, name: id, role: '', card: null, sort, hidden: false });

describe('band', () => {
  it('knows uploads from site assets', () => {
    expect(isUpload('band/abc.webp')).toBe(true);
    expect(isUpload('/assets/band/beard.webp')).toBe(false);
    expect(isUpload(null)).toBe(false);
  });
  it('appends new members after the last one', () => {
    expect(nextSort([m('a', 1), m('b', 7)])).toBe(8);
    expect(nextSort([])).toBe(1);
  });
  it('moves a member by swapping with its neighbour', () => {
    const ms = [m('a', 1), m('b', 2), m('c', 3)];
    expect(moveSorts(ms, 'b', -1)).toEqual([{ id: 'b', sort: 1 }, { id: 'a', sort: 2 }]);
    expect(moveSorts(ms, 'a', -1)).toEqual([]);
    expect(moveSorts(ms, 'c', 1)).toEqual([]);
    expect(moveSorts([m('a', 5), m('b', 5)], 'a', 1)).toEqual([{ id: 'a', sort: 6 }, { id: 'b', sort: 5 }]);
  });
});
