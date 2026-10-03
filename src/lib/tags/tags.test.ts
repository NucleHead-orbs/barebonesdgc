import { describe, expect, it } from 'vitest';
import { display, projectPending, matchMembers, parseScore, swap, tagSources } from './tags';

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

describe('tagSources', () => {
  it('pop up (R1 dubs + R2 singles) records the tag round', () => {
    expect(tagSources({ rounds: 2, r1_format: 'doubles', r2_format: 'singles' })).toEqual({ options: [[2, 'Round 2 (the singles round)']], dflt: 2 });
  });
  it('all-singles 2-rounder keeps the event total by default', () => {
    expect(tagSources({ rounds: 2, r1_format: 'singles', r2_format: 'singles' }).dflt).toBe('total');
  });
  it('a doubles-only event cannot record tags', () => {
    expect(tagSources({ rounds: 1, r1_format: 'doubles', r2_format: 'singles' })).toEqual({ options: [], dflt: null });
  });
  it('old rows without formats are singles', () => {
    expect(tagSources({ rounds: 1 }).dflt).toBe(1);
  });
});

describe('pending swaps on the board', () => {
  const tags = [{ number: 1, holder_id: 'yt' }, { number: 2, holder_id: 'jason' }, { number: 6, holder_id: 'hay' }];
  const sw = (id: string, at: string, players: Array<[string, number]>, status: 'pending' | 'disputed' = 'pending') =>
    ({ id, status, round_id: null, course: null, played_on: '2026-10-03', created_at: at, players: players.map(([member_id, place]) => ({ member_id, place, confirmed: false, disputed: false })) });
  it('re-ranks with the swap rule and marks who moved', () => {
    const r = projectPending(tags, [sw('a', '1', [['hay', 1], ['yt', 2]])]);
    expect(r.map((x) => [x.number, x.holder_id, x.was])).toEqual([[1, 'hay', 6], [2, 'jason', null], [6, 'yt', 1]]);
    expect(r[1].swaps).toEqual([]);
  });
  it('applies waiting swaps oldest first; ties keep their order; disputed ones do not move tags', () => {
    const r = projectPending(tags, [sw('b', '2', [['jason', 1], ['hay', 1]]), sw('a', '1', [['hay', 1], ['yt', 2]]), sw('c', '3', [['yt', 1], ['jason', 2]], 'disputed')]);
    // a: hay #1, yt #6. b: hay (#1) and jason (#2) tie -> keep order. c disputed: no move.
    expect(r.map((x) => `${x.number}:${x.holder_id}`)).toEqual(['1:hay', '2:jason', '6:yt']);
    expect(r.find((x) => x.holder_id === 'jason')!.swaps).toEqual(['b', 'c']);
  });
});
