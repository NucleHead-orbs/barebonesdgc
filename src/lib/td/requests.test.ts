import { describe, expect, it } from 'vitest';
import { ago, cycleVibe, pairingFor, requestError, requestLine } from './requests';

describe('pairingFor', () => {
  const reqs = [
    { status: 'approved' as const, players: ['a', 'b'] },
    { status: 'new' as const, players: ['c', 'd'] },
    { status: 'declined' as const, players: ['e', 'f'] },
    { status: 'approved' as const, players: ['g'] }, // partner removed
  ];
  const priv = { vibe: { a: 'star' as const }, apart: [['x', 'y']] as Array<[string, string]> };
  it('round 1: approved requests only, plus tags and keep-apart', () => {
    expect(pairingFor(reqs, priv, 1)).toEqual({ groups: [['a', 'b']], apart: [['x', 'y']], vibe: { a: 'star' } });
  });
  it('round 2: keep-apart only (seeded by score)', () => {
    expect(pairingFor(reqs, priv, 2)).toEqual({ groups: [], apart: [['x', 'y']], vibe: {} });
  });
});

describe('small helpers', () => {
  it('cycles none → ⭐ → ☺ → none', () => {
    expect(cycleVibe(undefined)).toBe('star');
    expect(cycleVibe('star')).toBe('easy');
    expect(cycleVibe('easy')).toBeNull();
  });
  it('writes the request line requester-first and drops removed players', () => {
    const n: Record<string, string> = { a: 'Amy', b: 'Ben', c: 'Cal' };
    expect(requestLine(['a', 'b', 'c'], (id) => n[id])).toBe('Amy → Ben, Cal');
    expect(requestLine(['a', 'zz'], (id) => n[id])).toBe('Amy');
  });
  it('says how long ago', () => {
    const now = Date.parse('2026-09-29T12:00:00Z');
    expect(ago('2026-09-29T11:59:40Z', now)).toBe('just now');
    expect(ago('2026-09-29T11:48:00Z', now)).toBe('12 min ago');
    expect(ago('2026-09-29T09:00:00Z', now)).toBe('3 h ago');
  });
  it('turns server refusals into player words', () => {
    expect(requestError('too_many')).toMatch(/3 requests/);
    expect(requestError('unknown_player')).toMatch(/Check in first/);
    expect(requestError('weird')).toMatch(/tell the TD/);
  });
});
