import { describe, expect, it } from 'vitest';
import { LEAGUES, currentHolder, leagueByPool, leagueEvent, nextPopUp, niceDate, weekLeader, type LeagueWeek, type PublicEvent } from './leagues';

const ev = (slug: string, name: string, starts_on: string, archived = false, ends_on: string | null = null): PublicEvent => ({ slug, name, starts_on, ends_on, archived });
const lazy = LEAGUES.find((l) => l.id === 'lazy')!;
const rbfl = LEAGUES.find((l) => l.id === 'rbfl')!;

describe('leagueEvent', () => {
  const events = [
    ev('lb1', 'Lazy Boners League', '2026-09-20'),
    ev('lb2', 'Lazy Boners League Week 2', '2026-09-27'),
    ev('lb3', 'Lazy Boners League Week 3', '2026-10-04'), // future
    ev('lbx', 'Lazy Boners (old)', '2026-09-28', true), // archived
    ev('rb1', 'Root Beer Float League', '2026-09-24'),
    ev('j', 'The Bare Bones Jewel XI', '2026-11-21'),
  ];
  it('picks the newest started, non-archived event of that league', () => {
    expect(leagueEvent(lazy, events, '2026-09-29')?.slug).toBe('lb2');
    expect(leagueEvent(rbfl, events, '2026-09-29')?.slug).toBe('rb1');
  });
  it('matches RBFL by either name and ignores case/punctuation', () => {
    expect(leagueEvent(rbfl, [ev('r', 'RBFL: week 1', '2026-09-01')], '2026-09-29')?.slug).toBe('r');
  });
  it('null when the league has nothing yet (button hides)', () => {
    expect(leagueEvent(rbfl, [ev('x', 'Lazy Boners', '2026-09-01')], '2026-09-29')).toBeNull();
  });
});

describe('nextPopUp', () => {
  it('soonest upcoming Pop Up; today counts; archived and past never show', () => {
    const events = [
      ev('old', 'Boner Pop Up', '2026-09-01'),
      ev('a', 'Halloween Pop-Up', '2026-10-31'),
      ev('b', 'Boner Popup at Greenfield', '2026-10-10'),
      ev('c', 'Pop Up (cancelled)', '2026-10-05', true),
      ev('t', 'Lazy Boners League', '2026-10-01'),
    ];
    expect(nextPopUp(events, '2026-09-29')?.slug).toBe('b');
    expect(nextPopUp([ev('d', 'Pop Up', '2026-09-29')], '2026-09-29')?.slug).toBe('d');
    expect(nextPopUp([ev('e', 'Pop Up weekend', '2026-09-27', false, '2026-09-29')], '2026-09-29')?.slug).toBe('e');
    expect(nextPopUp(events, '2026-11-01')).toBeNull();
  });
});

describe('niceDate', () => {
  it('formats without shifting the day', () => expect(niceDate('2026-11-07')).toBe('Sat, Nov 7'));
});

describe('league week', () => {
  it('finds the league by tag set and its award', () => {
    expect(leagueByPool('lazy-boners')?.award).toBe('Lazy Boner Safety Vest');
    expect(leagueByPool('nope')).toBeNull();
    expect(leagueByPool(null)).toBeNull();
  });
  it('leader is the lone low score; ties and empty boards pick nobody', () => {
    const r = (player_id: string, r1_to_par: number | null, hole_count = 18) => ({ player_id, r1_to_par, hole_count });
    expect(weekLeader([])).toBeNull();
    expect(weekLeader([r('a', null, 0)])).toBeNull();
    expect(weekLeader([r('a', 2), r('b', -3), r('c', 0)])).toBe('b');
    expect(weekLeader([r('a', -3), r('b', -3)])).toBeNull();
  });
  it('current holder = newest week with a vest', () => {
    const w = (slug: string, vest: string | null): LeagueWeek => ({ slug, name: slug, starts_on: '2026-10-04', vest, vest_note: null, photo: null });
    expect(currentHolder([w('wk3', null), w('wk2', 'Hayden'), w('wk1', 'YT')])?.vest).toBe('Hayden');
    expect(currentHolder([w('wk3', null)])).toBeNull();
  });
});
