import { describe, it, expect } from 'vitest';
import { holeName, confirmState, exchangeOptions, fmtToPar, holeDone, leaders, newDraft, parseTagLink, running, saveProblems, setHoles, toPayload } from './rounds';

const me = { id: 'm1', name: 'YT' };

describe('scorecard math', () => {
  it('runs totals over scored holes only', () => {
    expect(running([3, 3, 4], [3, null, 6])).toEqual({ strokes: 9, toPar: 2, thru: 2 });
    expect(running([3, 3], [])).toEqual({ strokes: 0, toPar: 0, thru: 0 });
  });
  it('formats to-par', () => {
    expect([fmtToPar(0), fmtToPar(4), fmtToPar(-2)]).toEqual(['E', '+4', '-2']);
  });
  it('leaders by to-par, ties share it, nobody before a hole is played', () => {
    expect(leaders({ pars: [3, 3], scores: [[], []] })).toEqual([]);
    expect(leaders({ pars: [3, 3], scores: [[3, 4], [2, 5], [5]] })).toEqual([0, 1]);
  });
  it('changing holes keeps entered scores and pars', () => {
    const d = { ...newDraft('2026-10-03', me), pars: [3, 4, 3], scores: [[3, 4, 3]], cur: 2 };
    const nine = setHoles(d, 2);
    expect(nine.pars).toEqual([3, 4]);
    expect(nine.scores).toEqual([[3, 4]]);
    expect(nine.cur).toBe(1);
    expect(setHoles(d, 4).pars).toEqual([3, 4, 3, 3]);
  });
  it('a hole is done when everyone has a score', () => {
    const d = { ...newDraft('2026-10-03', me), players: [{ key: 'a', memberId: 'm1', name: 'YT' }, { key: 'b', memberId: null, name: 'Guest' }], scores: [[3], [null]] };
    expect(holeDone(d, 0)).toBe(false);
    expect(holeDone({ ...d, scores: [[3], [4]] }, 0)).toBe(true);
  });
});

describe('saving', () => {
  const base = { ...newDraft('2026-10-03', me), course: 'Buffalo Ridge', pars: [3, 3] };
  it('lists what is missing', () => {
    expect(saveProblems({ ...base, course: '', scores: [[3]] }, null)).toEqual([
      'Pick or type the course.', 'Connect your My Tag link to save.', 'YT is missing 1 hole.']);
    expect(saveProblems({ ...base, scores: [[3, 3]] }, 'other')).toEqual(['You have to be on the round to save it.']);
  });
  it('builds the payload with members by id and guests by name', () => {
    const d = { ...base, players: [...base.players, { key: 'g', memberId: null, name: ' Uncle Buck ' }], scores: [[3, 4], [5, 5]] };
    expect(saveProblems(d, 'm1')).toEqual([]);
    expect(toPayload(d)).toEqual({ course: 'Buffalo Ridge', course_id: null, layout_id: null, played_on: '2026-10-03', pars: [3, 3],
      players: [{ member_id: 'm1', scores: [3, 4] }, { guest_name: 'Uncle Buck', scores: [5, 5] }] });
  });
  it('reads a pasted My Tag link or code', () => {
    expect(parseTagLink('https://barebonesdiscgolf.club/tag/0123456789abcdef0123456789abcdef')).toBe('0123456789abcdef0123456789abcdef');
    expect(parseTagLink('  0123456789abcdef0123456789abcdef ')).toBe('0123456789abcdef0123456789abcdef');
    expect(parseTagLink('hello')).toBeNull();
  });
});

describe('hole names', () => {
  it('uses the course labels when the layout has them', () => {
    const d = { ...newDraft('2026-10-03', me), course: 'Buffalo Ridge', pars: [3, 4], labels: ['5', 'A'], scores: [[3, 4]] };
    expect([holeName(d, 0), holeName(d, 1), holeName({}, 6)]).toEqual(['5', 'A', '7']);
    expect(toPayload(d).labels).toEqual(['5', 'A']);
    expect(setHoles(d, 3).labels).toBeNull();
  });
});

describe('Boner Rounds', () => {
  it('confirmation state', () => {
    const p = (name: string, member: boolean, c = false, d = false) => ({ member_id: member ? name : null, name, confirmed: c, disputed: d });
    expect(confirmState([p('YT', true, true), p('Hayden', true), p('Guest', false)])).toEqual({ kind: 'waiting', waiting: ['Hayden'] });
    expect(confirmState([p('YT', true, true), p('Guest', false)]).kind).toBe('confirmed');
    expect(confirmState([p('YT', true, true), p('Hayden', true, false, true)]).kind).toBe('disputed');
  });
  it('exchange options need 2+ holders from the round in a set', () => {
    const pools = [{ id: 'g', slug: 'golden-boners', name: 'Golden Boners' }, { id: 'l', slug: 'lazy-boners', name: 'Lazy Boners' }];
    const tags = [{ pool_id: 'g', number: 1, holder_id: 'yt' }, { pool_id: 'g', number: 6, holder_id: 'hay' }, { pool_id: 'l', number: 4, holder_id: 'yt' }, { pool_id: 'g', number: 2, holder_id: 'jason' }];
    const o = exchangeOptions(['yt', 'hay'], tags, pools);
    expect(o.map((x) => x.pool.slug)).toEqual(['golden-boners']);
    expect(o[0].holders).toEqual([{ member_id: 'yt', number: 1 }, { member_id: 'hay', number: 6 }]);
  });
});
