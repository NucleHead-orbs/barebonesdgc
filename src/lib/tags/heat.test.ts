import { describe, expect, it } from 'vitest';
import { declineNote, heatMessage, timeLeft } from './heat';

describe('tag heat helpers', () => {
  const now = new Date('2026-10-04T12:00:00Z').getTime();
  it('counts down days, hours, minutes; hot under a day; gone when past', () => {
    expect(timeLeft('2026-10-07T16:30:00Z', now)).toEqual({ label: '3d 4h', hot: false, gone: false });
    expect(timeLeft('2026-10-04T17:05:00Z', now)).toEqual({ label: '5h 5m', hot: true, gone: false });
    expect(timeLeft('2026-10-04T12:09:00Z', now)?.label).toBe('9m');
    expect(timeLeft('2026-10-04T11:00:00Z', now)?.gone).toBe(true);
    expect(timeLeft(null, now)).toBeNull();
  });
  it('warns on the 4th decline', () => {
    expect(declineNote(0)).toMatch(/Free decline 1 of 3/);
    expect(declineNote(3)).toMatch(/4th decline: you drop 5/);
  });
  it('translates the database codes', () => {
    expect(heatMessage('out_of_range')).toMatch(/5 spots above/);
    expect(heatMessage('challenge_expired')).toMatch(/48 hours/);
    expect(heatMessage('slow_down')).toMatch(/few seconds/);
    expect(heatMessage('something_else')).toBeNull();
  });
});
