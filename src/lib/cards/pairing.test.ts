import { describe, expect, it } from 'vitest';
import { cardIssues, requestClusters, seatPairing, type PairingInput } from './pairing';
import { generateCards, mixDivisions, DEFAULT_SETTINGS, type BuilderPlayer } from './generate';

const name = (id: string) => id;
const opt = { keepDivisions: false, divOf: () => 'X', nameOf: name };
const none: PairingInput = { groups: [], apart: [], vibe: {} };
const flatSorted = (cards: string[][]) => cards.flat().sort();
const cardWith = (cards: string[][], id: string) => cards.find((c) => c.includes(id))!;

describe('requestClusters', () => {
  it('chains overlapping requests into one group, in first-seen order', () => {
    expect(requestClusters([['a', 'b'], ['b', 'c'], ['x', 'y']]).clusters).toEqual([['a', 'b', 'c'], ['x', 'y']]);
  });
  it('splits a group bigger than a card and reports it', () => {
    const r = requestClusters([['a', 'b', 'c'], ['c', 'd', 'e'], ['e', 'f']]);
    expect(r.oversized).toHaveLength(1);
    expect(r.clusters).toEqual([['a', 'b', 'c', 'd', 'e']]); // the leftover single can't form a group
  });
  it('ignores players outside the pool', () => {
    expect(requestClusters([['a', 'zz']], new Set(['a'])).clusters).toEqual([]);
  });
});

describe('seatPairing', () => {
  const base = [['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h'], ['i', 'j', 'k', 'l']];

  it('seats a request group together and keeps everyone on exactly one card with the same sizes', () => {
    const r = seatPairing(base, { ...none, groups: [['a', 'e', 'i']] }, opt);
    expect(cardWith(r.cards, 'a')).toEqual(expect.arrayContaining(['a', 'e', 'i']));
    expect(flatSorted(r.cards)).toEqual(flatSorted(base));
    expect(r.cards.map((c) => c.length)).toEqual([4, 4, 4]);
  });

  it('never leaves a keep-apart pair together', () => {
    const r = seatPairing(base, { ...none, apart: [['a', 'b'], ['e', 'h']] }, opt);
    expect(cardIssues(r.cards, { ...none, apart: [['a', 'b'], ['e', 'h']] }, name)).toEqual([]);
  });

  it('does not seat a requested friend next to someone the requester must be kept from', () => {
    const ctx: PairingInput = { groups: [['a', 'e']], apart: [['e', 'b']], vibe: {} };
    const r = seatPairing(base, ctx, opt);
    expect(cardIssues(r.cards, ctx, name)).toEqual([]);
    expect(cardWith(r.cards, 'a')).toContain('e');
  });

  it('gives a ⭐ player ☺ cardmates instead of strangers', () => {
    const ctx: PairingInput = { groups: [], apart: [], vibe: { a: 'star', e: 'easy', f: 'easy', g: 'easy' } };
    const r = seatPairing(base, ctx, opt);
    const card = cardWith(r.cards, 'a');
    expect(card.filter((m) => m !== 'a').every((m) => ctx.vibe[m] === 'easy')).toBe(true);
    expect(cardIssues(r.cards, ctx, name)).toEqual([]);
  });

  it('never moves a request group apart to comfort a ⭐', () => {
    const ctx: PairingInput = { groups: [['b', 'c']], apart: [], vibe: { a: 'star', e: 'easy', f: 'easy' } };
    const r = seatPairing(base, ctx, opt);
    expect(cardWith(r.cards, 'b')).toContain('c');
  });

  it('is deterministic', () => {
    const ctx: PairingInput = { groups: [['a', 'k'], ['f', 'l']], apart: [['a', 'b']], vibe: { c: 'star', h: 'easy' } };
    expect(seatPairing(base, ctx, opt)).toEqual(seatPairing(base, ctx, opt));
  });

  it('with divisions kept, swaps prefer a player from the same division', () => {
    const div: Record<string, string> = { a: 'A', b: 'A', c: 'A', d: 'B', e: 'B', f: 'B', g: 'B', h: 'A' };
    const cards = [['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h']];
    const r = seatPairing(cards, { ...none, groups: [['a', 'e']] }, { keepDivisions: true, divOf: (id) => div[id], nameOf: name });
    expect(cardWith(r.cards, 'a')).toEqual(expect.arrayContaining(['a', 'e']));
    expect(cardWith(r.cards, 'f')).toContain('d'); // e swapped with the other B (d), not an A
  });
});

describe('cardIssues (hand moves)', () => {
  it('reports keep-apart, split requests and a ⭐ with only strangers', () => {
    const ctx: PairingInput = { groups: [['a', 'e']], apart: [['b', 'c']], vibe: { d: 'star' } };
    const issues = cardIssues([['a', 'b', 'c', 'd'], ['e', 'f', 'g']], ctx, name);
    expect(issues).toHaveLength(3);
    expect(issues.join(' ')).toMatch(/Keep-apart: b and c/);
    expect(issues.join(' ')).toMatch(/Request split: a, e/);
    expect(issues.join(' ')).toMatch(/⭐ d/);
  });
});

describe('generateCards with pairing + social mix', () => {
  const mk = (div: string, n: number): BuilderPlayer[] =>
    Array.from({ length: n }, (_, i) => ({ id: `${div}-${i}`, name: `${div}-${i}`, div, rating: null, regOrder: i }));
  const players = [...mk('MA1', 6), ...mk('MA2', 6)];
  const settings = { ...DEFAULT_SETTINGS, pmDivisions: [], doubleUp: [] };

  it('mixDivisions deals divisions round-robin', () => {
    expect(mixDivisions(players, ['MA1', 'MA2'], (g) => g).slice(0, 4).map((p) => p.div)).toEqual(['MA1', 'MA2', 'MA1', 'MA2']);
  });

  it('social mix puts both divisions on every card', () => {
    const { cards } = generateCards({ players, settings: { ...settings, keepDivisions: false }, divOrder: ['MA1', 'MA2'], holeCount: 18 });
    for (const c of cards) expect(new Set(c.playerIds.map((id) => id.split('-')[0])).size).toBe(2);
  });

  it('a lone 1-player division rides with the division before it (no card of 1)', () => {
    const six = [...mk('OPEN', 5), ...mk('REC', 1)];
    const { cards } = generateCards({ players: six, settings: { ...settings, size: 3 }, divOrder: ['OPEN', 'REC'], holeCount: 9 });
    expect(cards.map((c) => c.playerIds.length)).toEqual([3, 3]);
  });

  it('honors an approved cross-division request and a keep-apart pair', () => {
    const pairing: PairingInput = { groups: [['MA1-0', 'MA2-5']], apart: [['MA1-0', 'MA1-1']], vibe: {} };
    const { cards } = generateCards({ players, settings, divOrder: ['MA1', 'MA2'], holeCount: 18, pairing });
    const ids = cards.map((c) => c.playerIds);
    expect(cardIssues(ids, pairing, name)).toEqual([]);
    expect(ids.flat()).toHaveLength(12);
  });
});
