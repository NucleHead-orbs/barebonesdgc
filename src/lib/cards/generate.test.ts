import { describe, it, expect } from 'vitest';
import { generateCards, splitSizes, DEFAULT_SETTINGS, CardGenerationError, type BuilderPlayer, type Card } from './generate';

const DIVS = ['MPO','FPO','MP40','FP40','MP50','MP55','MA1','FA1','MA40','MA50','MA60','MA2','FA2','MA3','FA3'];
const mk = (div: string, n: number, start = 0): BuilderPlayer[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${div}-${start + i}`, name: `${div} ${start + i}`, div, rating: 900 - i, regOrder: start + i }));
const run = (players: BuilderPlayer[], over: Partial<typeof DEFAULT_SETTINGS> = {}, extra: object = {}) =>
  generateCards({ players, settings: { ...DEFAULT_SETTINGS, ...over }, divOrder: DIVS, holeCount: 20, ...extra });
const slotKeys = (cards: Card[]) => cards.map((c) => `${c.wave}-${c.startHole}-${c.groupNo}`);

describe('splitSizes', () => {
  it('balances 11 into 4-4-3 and 13 into 4-3-3-3', () => {
    expect(splitSizes(11, 4, true)).toEqual([4, 4, 3]);
    expect(splitSizes(13, 4, true)).toEqual([4, 3, 3, 3]);
  });
  it('unbalanced 13 is 4-4-4-1', () => expect(splitSizes(13, 4, false)).toEqual([4, 4, 4, 1]));
  it('never splits into a sub-3 card when one card of 5 fits (Jewel X: FA2 had 5)', () => {
    expect(splitSizes(5, 4, true)).toEqual([5]);
    expect(splitSizes(6, 4, true)).toEqual([3, 3]);
    expect(splitSizes(2, 4, true)).toEqual([2]); // tiny divisions are mergeSmall's job
    for (let n = 3; n <= 60; n++) for (const size of [3, 4, 5]) {
      const out = splitSizes(n, size, true);
      expect(out.reduce((a, b) => a + b, 0)).toBe(n);
      expect(Math.min(...out)).toBeGreaterThanOrEqual(3);
      expect(Math.max(...out)).toBeLessThanOrEqual(Math.max(size, 5));
    }
  });
});

describe('generateCards', () => {
  it('puts every player on exactly one card, in the right wave', () => {
    const players = [...mk('MPO', 14), ...mk('MA2', 14), ...mk('FA3', 3)];
    const { cards } = run(players);
    const ids = cards.flatMap((c) => c.playerIds);
    expect(ids.length).toBe(players.length);
    expect(new Set(ids).size).toBe(players.length);
    for (const c of cards) for (const id of c.playerIds) expect(c.wave).toBe(id.startsWith('MPO') ? 'PM' : 'AM');
  });

  it('defaults are the locked Jewel settings', () => {
    expect(DEFAULT_SETTINGS.sortBy).toBe('reg');
    expect(DEFAULT_SETTINGS.doubleUp).toEqual([6, 15, 14, 19, 17, 16]);
  });

  it('keeps divisions together and sorts by rating high to low', () => {
    const { cards } = run(mk('MA2', 8), { sortBy: 'rating' });
    expect(cards[0].playerIds).toEqual(['MA2-0', 'MA2-1', 'MA2-2', 'MA2-3']);
  });

  it('merges tiny divisions onto a shared card', () => {
    const { cards } = run([...mk('MA60', 2), ...mk('FA3', 1)]);
    expect(cards).toHaveLength(1);
    expect(cards[0].playerIds).toHaveLength(3);
  });

  it('uses all 20 holes before doubling, then doubles in the given order', () => {
    const { cards } = run(mk('MA2', 96)); // 24 cards
    const am = cards.filter((c) => c.wave === 'AM');
    expect(new Set(am.map((c) => c.startHole)).size).toBe(20);
    expect(am.filter((c) => c.groupNo === 2).map((c) => c.startHole).sort((a, b) => a - b)).toEqual([6, 14, 15, 19]);
  });

  it('never starts a card on a skipped hole', () => {
    const { cards } = run(mk('MA2', 120), { skip: [20] });
    expect(cards.some((c) => c.startHole === 20)).toBe(false);
  });

  it('never produces two cards in the same slot, even around locked cards', () => {
    const lockedCards: Card[] = [{ wave: 'AM', startHole: 7, groupNo: 2, locked: true, playerIds: ['MA2-0'] }];
    const { cards } = run(mk('MA2', 100), {}, { lockedCards });
    const keys = slotKeys(cards);
    expect(new Set(keys).size).toBe(keys.length);
    expect(cards.find((c) => c.locked)?.playerIds).toEqual(['MA2-0']);
    expect(cards.filter((c) => !c.locked).flatMap((c) => c.playerIds)).not.toContain('MA2-0');
  });

  it('is deterministic for a seed and changes with the seed', () => {
    const p = mk('MA2', 24);
    const a = run(p, { sortBy: 'random', seed: 3 }).cards;
    expect(run(p, { sortBy: 'random', seed: 3 }).cards).toEqual(a);
    expect(run(p, { sortBy: 'random', seed: 4 }).cards).not.toEqual(a);
  });

  it('R2 seeding: missing R1 scores sort last, never as 0', () => {
    const p = mk('MA2', 5);
    const { cards } = run(p, { sortBy: 'r1', size: 5 }, { r1Strokes: { 'MA2-3': 55, 'MA2-4': 60, 'MA2-1': 58 } });
    expect(cards[0].playerIds.slice(0, 3)).toEqual(['MA2-3', 'MA2-1', 'MA2-4']);
  });

  it('errors plainly when a wave cannot fit', () => {
    expect(run(mk('MA2', 300), { size: 3 }).cards).toHaveLength(100); // exactly full is fine
    expect(() => run(mk('MA2', 303), { size: 3 })).toThrow(CardGenerationError);
  });

  it('errors when every hole is skipped', () => {
    expect(() => run(mk('MA2', 4), { skip: Array.from({ length: 20 }, (_, i) => i + 1) })).toThrow(CardGenerationError);
  });

  it('warns past 2 cards per hole', () => {
    expect(run(mk('MA2', 170)).warnings.join()).toMatch(/more than 2 per hole/);
  });
});
