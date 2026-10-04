import { describe, expect, it } from 'vitest';
import { countdown, roomMessage, roomUrl, tileTitle } from './room';

describe('tag room helpers', () => {
  it('room url', () => {
    expect(roomUrl('https://x.club/', 'abc')).toBe('https://x.club/room/abc');
  });
  it('tile shows the nickname when there is one', () => {
    expect(tileTitle({ name: 'Sam Coffey', nickname: 'Beard' })).toBe('Beard');
    expect(tileTitle({ name: 'Hayden', nickname: '  ' })).toBe('Hayden');
    expect(tileTitle({ name: 'Hayden', nickname: null })).toBe('Hayden');
  });
  it('countdown', () => {
    expect(countdown(0)).toBe('');
    expect(countdown(-5)).toBe('');
    expect(countdown(61_000)).toBe('1:01');
    expect(countdown(1_400)).toBe('0:02');
    expect(countdown(3_723_000)).toBe('1:02:03');
  });
  it('plain messages', () => {
    expect(roomMessage({ message: 'room_not_yet' })).toMatch(/Not yet/);
    expect(roomMessage({ message: 'room_closed' })).toMatch(/closed/);
    expect(roomMessage({ message: 'already_active' })).toMatch(/already tapped/);
    expect(roomMessage({ message: 'invalid_room' })).toMatch(/doesn't work/);
    expect(roomMessage({ code: '42501', message: '' })).toMatch(/doesn't run/);
    expect(roomMessage('x')).toMatch(/went wrong/);
  });
});
