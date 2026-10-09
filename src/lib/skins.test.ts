import { describe, expect, it } from 'vitest';
import { SKINS, arizonaToday, defaultRuns, parseSkin, pickFrom, resolveSkin } from './skins';

describe('skins', () => {
  it('knows exactly the five skins the database allows', () => {
    expect(SKINS.map((s) => s.id)).toEqual(['night', 'gmode', 'spooky', 'sweater', 'electric']);
    expect(parseSkin('spooky')).toBe('spooky');
    expect(parseSkin('hotdog')).toBeNull();
    expect(parseSkin(null)).toBeNull();
  });
  it('the phone pick wins, then a running club default, then Night Card', () => {
    const spooky = { skin: 'spooky' as const, until: '2026-10-31' };
    expect(resolveSkin('gmode', spooky, '2026-10-10')).toBe('gmode');
    expect(resolveSkin(null, spooky, '2026-10-10')).toBe('spooky');
    expect(resolveSkin(null, spooky, '2026-10-31')).toBe('spooky');
    expect(resolveSkin(null, spooky, '2026-11-01')).toBe('night');
    expect(resolveSkin(null, { skin: 'sweater', until: null }, '2027-01-01')).toBe('sweater');
    expect(resolveSkin(null, null, '2026-10-10')).toBe('night');
    expect(defaultRuns(null, '2026-10-10')).toBe(true);
  });
  it('a phone that had the old G-Mode switch on keeps G-Mode', () => {
    expect(pickFrom(null, '1')).toBe('gmode');
    expect(pickFrom(null, '0')).toBeNull();
    expect(pickFrom('sweater', '1')).toBe('sweater');
    expect(pickFrom('junk', null)).toBeNull();
  });
  it('Arizona date is UTC-7 all year', () => {
    expect(arizonaToday(new Date('2026-11-01T06:59:00Z'))).toBe('2026-10-31');
    expect(arizonaToday(new Date('2026-11-01T07:00:00Z'))).toBe('2026-11-01');
    expect(arizonaToday(new Date('2026-07-01T06:00:00Z'))).toBe('2026-06-30');
  });
});
