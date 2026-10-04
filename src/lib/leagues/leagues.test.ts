import { describe, expect, it } from 'vitest';
import { boardPlaces, currentVest, teamLeader, currentHolder, leagueEvent, leagueSlug, nextPopUp, niceDate, validSlug, weekLeader, weekName, type LeagueWeek, type PublicEvent } from './leagues';

const ev = (slug: string, name: string, starts_on: string, archived = false, ends_on: string | null = null, league_id: string | null = null): PublicEvent => ({ slug, name, starts_on, ends_on, archived, league_id });

describe('leagueEvent', () => {
  const events = [
    ev('lb1', 'Lazy Boners League', '2026-09-20', false, null, 'lazy'),
    ev('lb2', 'Anything named', '2026-09-27', false, null, 'lazy'),
    ev('lb3', 'Lazy Boners · Oct 4', '2026-10-04', false, null, 'lazy'), // future
    ev('lbx', 'Lazy Boners (old)', '2026-09-28', true, null, 'lazy'), // archived
    ev('rb1', 'Root Beer Float League', '2026-09-24', false, null, 'rbfl'),
    ev('nm', 'Lazy Boners named but not attached', '2026-09-28'),
  ];
  it('picks the newest started, non-archived week attached to that league (names don\'t matter)', () => {
    expect(leagueEvent('lazy', events, '2026-09-29')?.slug).toBe('lb2');
    expect(leagueEvent('rbfl', events, '2026-09-29')?.slug).toBe('rb1');
  });
  it('null when the league has nothing yet (button hides)', () => {
    expect(leagueEvent('new', events, '2026-09-29')).toBeNull();
  });
});

describe('league setup helpers', () => {
  it('slug from a name', () => {
    expect(leagueSlug('Thursday Thumpers!')).toBe('thursday-thumpers');
    expect(leagueSlug('  RBFL  ')).toBe('rbfl');
    expect(validSlug(leagueSlug('Thursday Thumpers!'))).toBe(true);
    expect(validSlug('x')).toBe(false);
    expect(validSlug('Bad Slug')).toBe(false);
  });
  it('default week name', () => {
    expect(weekName({ name: 'Lazy Boners' }, '2026-10-11')).toBe('Lazy Boners · Oct 11');
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

describe('vest page', () => {
  it('dubs leader is the lone low team', () => {
    const t = (team_id: string, to_par: number | null, holes_played = 18) => ({ team_id, to_par, holes_played });
    expect(teamLeader([t('a', -2), t('b', -5), t('c', 0)])).toBe('b');
    expect(teamLeader([t('a', -5), t('b', -5)])).toBeNull();
    expect(teamLeader([t('a', null, 0)])).toBeNull();
  });
  it('current holders = newest week that has any', () => {
    const w = (slug: string, holders: string[]) => ({ slug, name: slug, starts_on: '2026-10-04', course: null, holders, note: null, photo: null });
    expect(currentVest([w('3', []), w('2', ['Alex', 'Bo']), w('1', ['Cal'])])?.slug).toBe('2');
    expect(currentVest([w('3', [])])).toBeNull();
  });
  it('board places share ties', () => {
    expect(boardPlaces([{ weeks: 3 }, { weeks: 2 }, { weeks: 2 }, { weeks: 1 }])).toEqual(['1', 'T2', 'T2', '4']);
  });
});
