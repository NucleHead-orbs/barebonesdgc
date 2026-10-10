import { describe, it, expect } from 'vitest';
import { agoLabel, groupThru, liveOn, liveStandings, newLiveIds, startsIn, toLiveCard, whenLabel } from './live';
import { newDraft, type Draft } from './rounds';

const d: Draft = { ...newDraft('2026-10-05'), course: ' Papago ', pars: [3, 3, 4],
  players: [{ key: 'a', memberId: 'm1', name: 'Blake' }, { key: 'b', memberId: null, name: ' Guest Gus ' }],
  scores: [[2, 3, null], [3, null, null]] };

describe('live card', () => {
  it('mirrors the draft, trims empty holes, names as typed', () => {
    const c = toLiveCard(d);
    expect(c.course).toBe('Papago');
    expect(c.players[0]).toEqual({ name: 'Blake', member_id: 'm1', scores: [2, 3] });
    expect(c.players[1]).toEqual({ name: 'Guest Gus', member_id: null, scores: [3] });
  });
  it('standings and group thru', () => {
    const c = toLiveCard(d);
    expect(liveStandings(c).map((r) => [r.name, r.toPar, r.thru])).toEqual([['Blake', -1, 2], ['Guest Gus', 0, 1]]);
    expect(groupThru(c)).toBe(1);
  });
  it('on by default', () => {
    expect(liveOn({})).toBe(true);
    expect(liveOn({ live: false })).toBe(false);
  });
  it('ids and ages', () => {
    const x = newLiveIds();
    expect(x.secret.length).toBe(48);
    expect(x.id).toMatch(/^[0-9a-f-]{36}$/);
    const now = Date.parse('2026-10-05T12:00:00Z');
    expect(agoLabel('2026-10-05T11:59:50Z', now)).toBe('just now');
    expect(agoLabel('2026-10-05T11:56:00Z', now)).toBe('4 min ago');
  });
});

describe('coming up live', () => {
  it('the live card carries the scheduled round it came from (and nothing for a plain card)', () => {
    expect(toLiveCard({ ...d, source: 'night:7b1e2c3d-4a5b-4c6d-8e9f-0a1b2c3d4e5f' }).source).toBe('night:7b1e2c3d-4a5b-4c6d-8e9f-0a1b2c3d4e5f');
    expect('source' in toLiveCard(d)).toBe(false);
  });
  it('when, in Arizona time', () => {
    const now = Date.parse('2026-10-09T19:00:00Z'); // Fri noon in Mesa
    expect(whenLabel('2026-10-10T01:30:00Z', now)).toBe('Tonight 6:30 PM');
    expect(whenLabel('2026-10-09T21:00:00Z', now)).toBe('Today 2:00 PM');
    expect(whenLabel('2026-10-10T16:00:00Z', now)).toBe('Tomorrow 9:00 AM');
    expect(whenLabel('2026-10-14T16:00:00Z', now)).toBe('Wed, Oct 14, 9:00 AM');
  });
  it('starts in', () => {
    const now = Date.parse('2026-10-09T19:00:00Z');
    expect([startsIn('2026-10-09T19:45:00Z', now), startsIn('2026-10-10T01:00:00Z', now), startsIn('2026-10-12T19:00:00Z', now), startsIn('2026-10-09T18:00:00Z', now)])
      .toEqual(['in 45 min', 'in 6 hr', 'in 3 days', 'teeing off']);
  });
});

describe('live reactions', () => {
  it('lines and particles', async () => {
    const { reactionLine, particles, LIVE_REACTIONS } = await import('./live');
    expect(LIVE_REACTIONS.filter((r) => r.tone === 'razz').length).toBe(4);
    expect(reactionLine({ who: 'Woody', kind: 'skull', target: 'Blake' })).toBe('Woody sent Skull rain to Blake');
    expect(reactionLine({ who: 'Woody', kind: 'clap', target: null })).toBe('Woody sent Golf clap to everyone');
    expect(particles(7)).toEqual(particles(7));
    expect(particles(7).every((p) => p.x >= 0 && p.x <= 92)).toBe(true);
  });
});
