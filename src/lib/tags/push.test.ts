import { describe, it, expect } from 'vitest';
import { PUSH_KINDS, VAPID_PUBLIC, keyBytes, pushMessage } from './push';

describe('phone alerts', () => {
  it('VAPID public key is a 65-byte P-256 point', () => {
    const b = keyBytes(VAPID_PUBLIC);
    expect(b.length).toBe(65);
    expect(b[0]).toBe(4);
  });
  it('every server kind has a label', () => {
    expect(PUSH_KINDS.map((k) => k.kind).sort()).toEqual(['answer', 'challenge', 'confirm', 'fuse', 'invite', 'mention', 'slot']);
  });
  it('plain-words errors', () => {
    expect(pushMessage(new Error('blocked'))).toMatch(/phone settings/);
    expect(pushMessage({ message: 'no_phone' })).toMatch(/first/);
  });
});
