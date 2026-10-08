import { describe, it, expect } from 'vitest';
import { holeCounts, myPlace, ordinal, tagMove, type MyCardRound, type MyTagRound } from './myRounds';

const card: MyCardRound = { kind: 'card', id: 'c', course: 'X', played_on: '2026-10-01', pars: [3, 3, 4], hole_labels: null, totals_only: false, note: null, tags: [],
  players: [
    { member_id: 'a', name: 'A', nickname: null, guest: false, scores: [2, 3, 4], strokes: 9, to_par: -1, confirmed: true, disputed: false },
    { member_id: 'b', name: 'B', nickname: null, guest: false, scores: [3, 3, 4], strokes: 10, to_par: 0, confirmed: true, disputed: false },
    { member_id: null, name: 'G', nickname: null, guest: true, scores: [3, 3, 4], strokes: 10, to_par: 0, confirmed: false, disputed: false },
  ] };
const tag: MyTagRound = { kind: 'tag', id: 't', course: null, played_on: '2026-10-01', pool_name: 'P', source: 'casual',
  players: [{ member_id: 'a', name: 'A', nickname: null, score: 50, before: 2, after: 1 }, { member_id: 'b', name: 'B', nickname: null, score: 52, before: 1, after: 2 }] };

describe('my rounds', () => {
  it('place, with ties', () => {
    expect(myPlace(card, 'a')).toEqual({ place: 1, of: 3, tied: false });
    expect(myPlace(card, 'b')).toEqual({ place: 2, of: 3, tied: true });
    expect(myPlace(tag, 'b')).toEqual({ place: 2, of: 2, tied: false });
    expect(myPlace(tag, 'z')).toBeNull();
  });
  it('ordinals', () => { expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']); });
  it('tag moves', () => {
    expect(tagMove(4, 2)).toBe('#4 → #2');
    expect(tagMove(3, 3)).toBe('kept #3');
    expect(tagMove(null, null)).toBe('');
  });
  it('hole counts', () => {
    expect(holeCounts([3, 3, 4], [2, 4, 4])).toEqual({ under: 1, over: 1 });
    expect(holeCounts([3], null)).toBeNull();
  });
});
