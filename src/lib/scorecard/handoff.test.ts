import { describe, expect, it } from 'vitest';
import { handoffKey, handoffStep, handoffUrl, holesDone } from './handoff';

describe('card handoff', () => {
  it('links to the same card, flagged as a handoff', () => {
    expect(handoffUrl('https://barebonesdiscgolf.club/', 'abc123')).toBe('https://barebonesdiscgolf.club/c/abc123?handoff=1');
    expect(handoffKey('abc123')).toBe('bb-card-handed-abc123');
  });
  it('never shows the QR while taps are stuck on this phone', () => {
    expect(handoffStep({ checking: true, pending: 0 })).toBe('syncing');
    expect(handoffStep({ checking: false, pending: 2 })).toBe('unsynced');
    expect(handoffStep({ checking: false, pending: 0 })).toBe('ready');
  });
  it('counts holes the whole card has scores on', () => {
    const s = { a: { 1: 3, 2: 4, 3: 3 }, b: { 1: 3, 2: 5 } };
    expect(holesDone([1, 2, 3], ['a', 'b'], s)).toBe(2);
    expect(holesDone([1, 2, 3], [], s)).toBe(0);
  });
});
