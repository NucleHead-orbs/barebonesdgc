import { describe, expect, it } from 'vitest';
import { display, matchMembers, parseScore, swap } from './tags';

describe('swap (same rule as the database)', () => {
  it('best score takes the lowest of the numbers on the round', () => {
    const out = swap([{ id: 'cara', score: 50, tag: 3 }, { id: 'alice', score: 52, tag: 1 }]);
    expect(out.find((p) => p.id === 'cara')?.after).toBe(1);
    expect(out.find((p) => p.id === 'alice')?.after).toBe(3);
  });
  it('ties keep their order from before', () => {
    const out = swap([{ id: 'alice', score: 48, tag: 3 }, { id: 'bob', score: 48, tag: 2 }]);
    expect(out.map((p) => [p.id, p.after])).toEqual([['alice', 3], ['bob', 2]]);
  });
  it('only the numbers on the round move; players without a tag pass through', () => {
    const out = swap([
      { id: 'bob', score: -6, tag: 4 }, { id: 'alice', score: -2, tag: 3 }, { id: 'cara', score: 3, tag: 1 }, { id: 'eve', score: -9, tag: null },
    ]);
    expect(Object.fromEntries(out.map((p) => [p.id, p.after]))).toEqual({ bob: 1, alice: 3, cara: 4, eve: null });
  });
});

describe('matchMembers', () => {
  const members = [{ id: 'm1', name: 'Mike Minnier', nickname: 'Whitey' }, { id: 'm2', name: 'José Pérez', nickname: null }];
  it('matches by name or nickname, ignoring case, accents and punctuation', () => {
    const r = matchMembers([{ name: 'mike  minnier' }, { name: 'WHITEY' }, { name: 'Jose Perez' }, { name: 'Stranger' }], members);
    expect(r.map((x) => x.member_id)).toEqual(['m1', 'm1', 'm2', null]);
  });
});

describe('small helpers', () => {
  it('parseScore takes whole numbers only', () => {
    expect([parseScore('54'), parseScore('-3'), parseScore(''), parseScore('5.5'), parseScore('abc')]).toEqual([54, -3, null, null, null]);
  });
  it('display shows the nickname when there is one', () => {
    expect(display({ name: 'Mike', nickname: 'Whitey' })).toBe('Mike "Whitey"');
    expect(display({ name: 'Bob', nickname: null })).toBe('Bob');
  });
});
