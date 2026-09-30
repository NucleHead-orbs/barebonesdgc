import { describe, expect, it } from 'vitest';
import { ago, cycleVibe, pairingFor, requestError, requestLine, seatRequest } from './requests';
import type { Card } from '../cards/generate';

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

describe('seatRequest (approved after cards are out)', () => {
  const card = (hole: number, ids: string[], locked = false): Card => ({ wave: 'AM', startHole: hole, groupNo: 1, locked, playerIds: ids });
  const keyOf = (c: Card) => `${c.wave}-${c.startHole}-${c.groupNo}`;
  const self = (id: string) => id;
  const none = { groups: [], apart: [], vibe: {} };
  const opts = (o: Partial<Parameters<typeof seatRequest>[2]> = {}) => ({ unitOf: self, max: 5, keyOf, pairing: none, nameOf: self, ...o });
  it('moves into free room and locks the card', () => {
    const r = seatRequest([card(1, ['a', 'b', 'c']), card(2, ['d', 'e', 'f', 'g'])], ['a', 'd'], opts());
    expect(r.ok && r.cards.map((c) => [c.playerIds, c.locked])).toEqual([[['a', 'b', 'c', 'd'], true], [['e', 'f', 'g'], false]]);
  });
  it('swaps when the card is full', () => {
    const r = seatRequest([card(1, ['a', 'b', 'c', 'x', 'y']), card(2, ['d', 'e', 'f', 'g'])], ['a', 'd'], opts());
    expect(r.ok && r.cards.map((c) => c.playerIds)).toEqual([['a', 'c', 'x', 'y', 'd'], ['e', 'f', 'g', 'b']]); // first free seat-mate swaps out
  });
  it('never touches locked cards, and says why', () => {
    expect(seatRequest([card(1, ['a', 'b']), card(2, ['d', 'e'], true)], ['a', 'd'], opts())).toEqual({ ok: false, reason: 'locked' });
    expect(seatRequest([card(1, ['a', 'b']), card(2, ['d'])], ['a', 'b'], opts())).toEqual({ ok: false, reason: 'already' });
    expect(seatRequest([card(1, ['a'])], ['a', 'zz'], opts())).toEqual({ ok: false, reason: 'missing' });
  });
  it('picks a swap that keeps keep-apart pairs apart', () => {
    const r = seatRequest([card(1, ['a', 'b', 'c', 'x', 'y']), card(2, ['d', 'e', 'f', 'g'])], ['a', 'd'], opts({ pairing: { groups: [], apart: [['b', 'e']], vibe: {} } }));
    expect(r.ok && r.cards[1].playerIds).toEqual(['e', 'f', 'g', 'c']);
  });
  it('refuses a request whose players are marked keep-apart', () => {
    const r = seatRequest([card(1, ['a', 'b', 'c', 'x', 'y']), card(2, ['d', 'e', 'f', 'g'])], ['a', 'd'], opts({ pairing: { groups: [], apart: [['d', 'a']], vibe: {} } })); // asked together but marked keep-apart
    expect(r).toEqual({ ok: false, reason: 'conflict' });
  });
  it('doubles: whole teams move together and swap for another team', () => {
    const team: Record<string, string> = { a: 'a', b: 'a', c: 'c', d: 'c', e: 'e', f: 'e', g: 'g', h: 'g' };
    const r = seatRequest([card(1, ['a', 'b', 'c', 'd']), card(2, ['e', 'f', 'g', 'h'])], ['b', 'g'], opts({ unitOf: (id) => team[id], max: 6 }));
    expect(r.ok && r.cards[0].playerIds.sort()).toEqual(['a', 'b', 'c', 'd', 'g', 'h']);
  });
});
