import { describe, it, expect } from 'vitest';
import { draftFromRound, pullOut, putBack, teeOrder, finishCheck, started, holeName, confirmState, exchangeOptions, fmtToPar, holeDone, leaders, newDraft, parseTagLink, running, saveProblems, setHoles, toPayload } from './rounds';

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
      'Pick or type the course.', 'Connect your My Tag link to save (it\'s how the round knows who you are).', 'YT is missing hole 2.']);
    expect(saveProblems({ ...base, scores: [[3, 3]] }, 'other')).toEqual(['You have to be on the round to save it. Add yourself in Edit round.']);
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

describe('declaring tags', () => {
  it('locks once any score is in', () => {
    expect(started({ scores: [[], [null]] })).toBe(false);
    expect(started({ scores: [[], [null, 3]] })).toBe(true);
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

describe('finish check: say what is holding the save up', () => {
  const base = newDraft('2026-10-08', me);
  const card = (o: Partial<typeof base>) => ({ ...base, course: 'Emerald Park', pars: [3, 3, 3, 3, 3, 3, 3, 3], ...o });
  it('names the holes each player is missing and where to jump', () => {
    const d = card({ players: [...base.players, { key: 'b', memberId: 'm2', name: 'Bo' }, { key: 'c', memberId: null, name: 'Cy' }],
      scores: [[3, 3, 3, 3, 3, 3, 3, 3], [3, null, 3, null, 3, 3, 3, 3], []] });
    const c = finishCheck(d, 'm1');
    expect(c.blockers.map((b) => b.text)).toEqual(['Bo is missing holes 2 and 4.', 'Cy has no scores yet. Every player needs a score on every hole (or take them off the card in Edit round).']);
    expect(c.blockers[0]).toMatchObject({ fix: 'hole', hole: 1 });
  });
  it('long lists get trimmed; course hole names are used', () => {
    const d = card({ labels: ['1', '2', '3', '4', '5', 'A', 'B', 'C'], scores: [[3]] });
    expect(finishCheck(d, 'm1').blockers[0].text).toBe('YT is missing holes 2, 3, 4, 5, A, B and 1 more.');
  });
  it('old cards, Early Access blocks, and tags that can no longer swap', () => {
    const full = { scores: [[3, 3, 3, 3, 3, 3, 3, 3]] };
    expect(finishCheck(card({ ...full, playedOn: '2026-09-20' }), 'm1', { today: '2026-10-08' }).blockers[0].text).toMatch(/more than two weeks/);
    const ea = finishCheck(card({ ...full, onLine: ['p1'] }), 'm1', { sets: [{ pool: { id: 'p1', name: 'Jewel EA' }, holders: [], blocked: true }] });
    expect(ea.blockers[0]).toMatchObject({ fix: 'setup' });
    const alone = finishCheck(card({ ...full, onLine: ['p2'] }), 'm1', { sets: [], tagNames: { p2: 'Lazy Boners' } });
    expect(alone.blockers).toEqual([]);
    expect(alone.warnings[0]).toBe("Lazy Boners tags were on the line, but you're the only Lazy Boners tag holder left on this card, so no tags will swap. Tags only swap between holders on the same card.");
    expect(finishCheck(card(full), 'm1', { today: '2026-10-08' })).toEqual({ blockers: [], warnings: [] });
  });
});


describe('tee order, pull out, cards from scheduled rounds', () => {
  const base = { ...newDraft('2026-10-09'), course: 'Emerald Park', pars: [3, 3, 3, 4],
    players: [{ key: 'a', memberId: 'a', name: 'A' }, { key: 'b', memberId: 'b', name: 'B' }, { key: 's', memberId: 's', name: 'Salty' }] };
  it('first hole: card order; then best score on the last hole tees first, ties keep their order', () => {
    const d = { ...base, scores: [[3, 3], [2, 3], [3, 2]] };
    expect(teeOrder(d, 0)).toEqual([0, 1, 2]);
    expect(teeOrder(d, 1)).toEqual([1, 0, 2]);       // B birdied 1
    expect(teeOrder(d, 2)).toEqual([2, 1, 0]);       // Salty birdied 2; A and B tie, B stays ahead
  });
  it('an unfinished hole doesn\'t reshuffle anyone', () => {
    const d = { ...base, scores: [[3, 4], [2, null], [3, 2]] };
    expect(teeOrder(d, 2)).toEqual(teeOrder(d, 1));
  });
  it('PULL OUT: DNF after the holes played, the rest par +3, last in tee order, out of the lead; back in undoes it', () => {
    const d = pullOut({ ...base, scores: [[3, 3], [3, 3], [2, 2]] }, 2);
    expect(d.out).toEqual({ s: 2 });
    expect(d.scores[2]).toEqual([2, 2, 6, 7]);
    expect(teeOrder(d, 2)).toEqual([0, 1, 2]);
    expect(leaders(d)).toEqual([0, 1]);
    expect(toPayload(d).players[2]).toEqual({ member_id: 's', scores: [2, 2, 6, 7], dnf_after: 2 });
    expect(finishCheck(d, 'a').blockers.map((b) => b.text)).toEqual(['A is missing holes 3 and 4.', 'B is missing holes 3 and 4.']);
    const back = putBack(d, 2);
    expect(back.out).toEqual({});
    expect(back.scores[2]).toEqual([2, 2, null, null]);
  });
  it('a card from a scheduled round: course layout, the players, tags on the line, the source', () => {
    const courses = [{ id: 'k1', name: 'Emerald Park', layouts: [{ id: 'l1', pars: [3, 3, 4], labels: null, ft: [200, 210, 330] }] }];
    const d = draftFromRound({ source: 'challenge:x', label: 'Danny vs Nick', course: 'Emerald Park', courseId: 'k1', onLine: ['p1'],
      players: [{ memberId: 'd', name: 'Danny' }, { memberId: 'n', name: 'Nick' }, { memberId: 'd', name: 'Danny' }] }, '2026-10-09', courses);
    expect([d.course, d.courseId, d.layoutId, d.pars]).toEqual(['Emerald Park', 'k1', 'l1', [3, 3, 4]]);
    expect(d.players.map((p) => p.name)).toEqual(['Danny', 'Nick']);
    expect([d.onLine, d.source, d.sourceLabel, d.scores]).toEqual([['p1'], 'challenge:x', 'Danny vs Nick', [[], []]]);
    expect(toPayload({ ...d, scores: [[3, 3, 4], [3, 3, 4]] }).source).toBe('challenge:x');
  });
  it('a card for a check-in night: just the scorer, the pick list, no tags on the card, sends the night (not a source)', () => {
    const d = draftFromRound({ source: 'night:n1', label: 'Glow League', course: 'Freestone', courseId: null, night: 'n1', players: [],
      pick: [{ memberId: 'b', name: 'Blake', guest: false }, { memberId: null, name: 'Glow Guest', guest: true }] }, '2026-10-09', [], { id: 'm1', name: 'YT' });
    expect(d.players.map((p) => p.memberId)).toEqual(['m1']);
    expect([d.night, d.onLine, d.pick?.length]).toEqual(['n1', [], 2]);
    const pay = toPayload({ ...d, scores: [[3, 3, 3]] });
    expect(pay.night).toBe('n1');
    expect(pay.source).toBeUndefined();
  });
});
