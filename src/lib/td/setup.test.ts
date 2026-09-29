import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../cards/generate';
import { defaultSettings, mergeSettings, rpcError } from './builder';
import {
  cardPool, coursePar, divisionsProblem, emailOk, eventTabs, formatSummary, holesProblem, normEmail, normalizeDivCode,
  resizeHoles, settingsForFormat, setupMessage, withWaves, type HoleRow,
} from './setup';

describe('holes', () => {
  it('resizes 1..n, keeping existing holes and adding par-3 blanks', () => {
    const h: HoleRow[] = [{ n: 1, par: 4, dist_ft: 400, ob: 'road' }, { n: 2, par: 3, dist_ft: null, ob: null }];
    const r = resizeHoles(h, 4);
    expect(r.map((x) => x.n)).toEqual([1, 2, 3, 4]);
    expect(r[0]).toEqual(h[0]);
    expect(r[3]).toEqual({ n: 4, par: 3, dist_ft: null, ob: null });
    expect(resizeHoles(h, 1)).toEqual([h[0]]);
  });
  it('clamps to 1..40', () => {
    expect(resizeHoles([], 0)).toHaveLength(1);
    expect(resizeHoles([], 99)).toHaveLength(40);
  });
  it('flags bad par, bad distance and gaps (same rules as td_set_holes)', () => {
    expect(holesProblem(resizeHoles([], 18))).toBeNull();
    expect(holesProblem([{ n: 1, par: 7, dist_ft: null, ob: null }])).toMatch(/par/);
    expect(holesProblem([{ n: 1, par: 3, dist_ft: 0, ob: null }])).toMatch(/distance/);
    expect(holesProblem([{ n: 2, par: 3, dist_ft: null, ob: null }])).toMatch(/gaps/);
    expect(holesProblem([])).toMatch(/1 to 40/);
  });
  it('totals par', () => expect(coursePar(resizeHoles([], 18))).toBe(54));
});

describe('divisions', () => {
  it('normalizes codes like the server', () => {
    expect(normalizeDivCode(' ma40 ')).toBe('MA40');
    expect(normalizeDivCode('MA 40')).toBeNull();
    expect(normalizeDivCode('TOOLONGCODE')).toBeNull();
  });
  it('needs one, refuses repeats and junk', () => {
    expect(divisionsProblem([])).toMatch(/at least one/);
    expect(divisionsProblem([{ code: 'MA1', wave: 'AM' }, { code: 'MA1', wave: 'PM' }])).toMatch(/twice/);
    expect(divisionsProblem([{ code: 'M A', wave: 'AM' }])).toMatch(/not a valid/);
    expect(divisionsProblem([{ code: 'OPEN', wave: 'AM' }])).toBeNull();
  });
  it('single wave puts everyone in AM', () => {
    expect(withWaves([{ code: 'MPO', wave: 'PM' }], 1)).toEqual([{ code: 'MPO', wave: 'AM' }]);
    expect(withWaves([{ code: 'MPO', wave: 'PM' }], 2)).toEqual([{ code: 'MPO', wave: 'PM' }]);
  });
});

describe('format', () => {
  it('summarizes', () => {
    expect(formatSummary({ rounds: 2, waves: 2 }, 20)).toBe('20 holes · 2 rounds · AM/PM shotgun');
    expect(formatSummary({ rounds: 1, waves: 1 }, 9)).toBe('9 holes · 1 round · single shotgun');
  });
  it('shows Sponsors only when the event uses it', () => {
    expect(eventTabs({ use_sponsors: false })).not.toContain('sponsors');
    expect(eventTabs({ use_sponsors: false })).toEqual(['setup', 'players', 'requests', 'cards']);
    expect(eventTabs({ use_sponsors: true })).toContain('sponsors');
  });
  it('builds cards from checked-in players only when check-in is on', () => {
    const ps = [{ id: 'a', checked_in: true }, { id: 'b', checked_in: false }];
    expect(cardPool(ps, true).map((p) => p.id)).toEqual(['a']);
    expect(cardPool(ps, false)).toHaveLength(2);
  });
  it('single-wave events never generate PM cards', () => {
    expect(settingsForFormat({ ...DEFAULT_SETTINGS }, 1).pmDivisions).toEqual([]);
    expect(settingsForFormat({ ...DEFAULT_SETTINGS }, 2).pmDivisions).toEqual(DEFAULT_SETTINGS.pmDivisions);
  });
});

describe('card-rule defaults per event', () => {
  it('a real event starts from its build-menu PM divisions and no double-up order', () => {
    const d = defaultSettings(1, ['MPO']);
    expect(d.pmDivisions).toEqual(['MPO']);
    expect(d.doubleUp).toEqual([]);
    expect(mergeSettings(null, 2, 18, []).sortBy).toBe('r1');
  });
  it("saved settings (Jewel's double-up order) win over the defaults", () => {
    expect(mergeSettings({ doubleUp: [6, 15, 14, 19, 17, 16] }, 1, 20, ['MPO']).doubleUp).toEqual([6, 15, 14, 19, 17, 16]);
  });
});

describe('server refusals', () => {
  it('turns build-menu codes into instructions', () => {
    expect(setupMessage('division_in_use MA40')).toMatch(/Division MA40 still has players/);
    expect(setupMessage('pm_cards_exist')).toMatch(/single wave/);
    expect(setupMessage('something else')).toBeNull();
    expect(rpcError({ message: 'holes_have_cards' }).message).toMatch(/starts on a hole you removed/);
    expect(rpcError({ message: 'forbidden' }).kind).toBe('forbidden');
  });
  it('checks emails', () => {
    expect(emailOk('a@b.co')).toBe(true);
    expect(emailOk('nope')).toBe(false);
    expect(normEmail(' A@B.CO ')).toBe('a@b.co');
  });
});
