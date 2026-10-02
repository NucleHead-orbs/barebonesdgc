import { describe, it, expect } from 'vitest';
import { announcement, ballotBars, fromLocalInput, isOpen, notVoted, tally, toLocalInput, voteMessage, waiting, type Ballot, type Poll } from './votes';

const now = new Date('2026-10-05T12:00:00Z');
const poll = (over: Partial<Poll> = {}): Poll => ({
  id: 'p', event_id: 'e', title: '1st place', question: 'Which?', closes_at: null, closed_at: null, winner_option_id: null,
  created_by: null, created_at: '', options: [
    { id: 'o2', poll_id: 'p', asset_id: 'b', sort: 1 },
    { id: 'o1', poll_id: 'p', asset_id: 'a', sort: 0 },
  ],
  votes: [
    { id: 'v1', poll_id: 'p', option_id: 'o1', crew_id: 'amy', td_email: null, comment: 'glows', updated_at: '' },
    { id: 'v2', poll_id: 'p', option_id: 'o2', crew_id: 'bo', td_email: null, comment: null, updated_at: '' },
    { id: 'v3', poll_id: 'p', option_id: 'o1', crew_id: null, td_email: 'mike@x.com', comment: null, updated_at: '' },
  ],
  ...over,
});

describe('open / closed', () => {
  it('matches the database rule', () => {
    expect(isOpen(poll(), now)).toBe(true);
    expect(isOpen(poll({ closes_at: '2026-10-06T00:00:00Z' }), now)).toBe(true);
    expect(isOpen(poll({ closes_at: '2026-10-05T11:59:00Z' }), now)).toBe(false);
    expect(isOpen(poll({ closed_at: '2026-10-05T10:00:00Z' }), now)).toBe(false);
  });
});

describe('TD tally', () => {
  const names: Record<string, string> = { amy: 'Amy', bo: 'Bo' };
  it('rows in ballot order with names, TD flagged, leader', () => {
    const t = tally(poll(), (id) => names[id]);
    expect(t.total).toBe(3);
    expect(t.rows.map((r) => [r.option.id, r.count, r.pct])).toEqual([['o1', 2, 67], ['o2', 1, 33]]);
    expect(t.rows[0].voters.map((v) => `${v.name}${v.td ? ' (TD)' : ''}`)).toEqual(['Amy', 'mike@x.com (TD)']);
    expect(t.leaders).toEqual(['o1']);
  });
  it('ties lead together; no votes = no leader; removed crew labelled', () => {
    expect(tally(poll({ votes: poll().votes.slice(0, 2) }), (id) => names[id]).leaders).toEqual(['o1', 'o2']);
    expect(tally(poll({ votes: [] }), () => undefined).leaders).toEqual([]);
    expect(tally(poll(), () => undefined).rows[1].voters[0].name).toBe('Removed crew member');
  });
  it('lists live crew who have not voted', () => {
    const crew = [{ id: 'cy', name: 'Cy' }, { id: 'amy', name: 'Amy' }, { id: 'dee', name: 'Dee', revoked_at: 'x' }, { id: 'al', name: 'Al' }];
    expect(notVoted(poll(), crew).map((c) => c.name)).toEqual(['Al', 'Cy']);
  });
});

describe('crew ballot', () => {
  const b: Ballot = {
    id: 'p', title: 't', question: null, closes_at: null, open: true, winner_option_id: null, mine: null, total: null,
    options: [{ id: 'o1', asset_id: 'a', title: 'A', notes: null, votes: null, file: null }, { id: 'o2', asset_id: 'b', title: 'B', notes: null, votes: null, file: null }],
  };
  it('no bars before voting', () => expect(ballotBars(b)).toEqual({ pct: {}, leaders: [] }));
  it('bars after voting', () => {
    const v = { ...b, total: 4, mine: { option_id: 'o2', comment: null, updated_at: '' }, options: [{ ...b.options[0], votes: 1 }, { ...b.options[1], votes: 3 }] };
    expect(ballotBars(v)).toEqual({ pct: { o1: 25, o2: 75 }, leaders: ['o2'] });
  });
  it('badge counts open ballots not voted yet', () => {
    expect(waiting([b, { ...b, open: false }, { ...b, mine: { option_id: 'o1', comment: null, updated_at: '' } }])).toBe(1);
  });
});

describe('misc', () => {
  it('datetime-local round trips', () => {
    const iso = fromLocalInput('2026-10-10T18:30')!;
    expect(toLocalInput(iso)).toBe('2026-10-10T18:30');
    expect(fromLocalInput('')).toBeNull();
    expect(toLocalInput(null)).toBe('');
  });
  it('announcement text', () => {
    const a = announcement({ title: '1st place trophy', question: 'Which one?', closes_at: null });
    expect(a.title).toBe('Vote: 1st place trophy');
    expect(a.body).toMatch(/^Which one\?\n\nOpen the VOTE tab/);
  });
  it('friendly errors', () => {
    expect(voteMessage('ERROR: poll_closed')).toBe('Voting on this one is closed.');
    expect(voteMessage('violates foreign key constraint "design_poll_votes_option_id_poll_id_fkey"')).toMatch(/already has votes/);
    expect(voteMessage('something else')).toBeNull();
  });
});
