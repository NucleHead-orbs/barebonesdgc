import { describe, it, expect } from 'vitest';
import { addable, cardCount, cardFull, removable, roundState, tdRoundMessage, type TdRound, type TdRoundPlayer } from './tdRounds';
import type { Tag } from './tags';

const p = (id: string, role: TdRoundPlayer['role']): TdRoundPlayer => ({ id, name: id.toUpperCase(), nickname: null, number: null, role });
const round = (x: Partial<TdRound>): TdRound => ({ kind: 'challenge', id: 'r', title: 'A vs B', tee_at: null, course: null, locked: false, due_at: null, created_at: '', note: null, players: [], ...x });
const tag = (number: number, holder_id: string | null): Tag => ({ pool_id: 'p', number, holder_id, status: 'held', issued_at: '', moved_at: null, moves: 0 });

describe('TD rounds', () => {
  it('counts only players on the card', () => {
    const r = round({ kind: 'casual', players: [p('h', 'host'), p('a', 'in'), p('b', 'invited'), p('c', 'out')] });
    expect(cardCount(r)).toBe(2);
    expect(cardFull(round({ players: Array.from({ length: 10 }, (_, i) => p(String(i), 'jumpin')) }))).toBe(true);
  });
  it('the two challenge players and the host stay on', () => {
    expect(['challenger', 'challenged', 'host', 'out'].map((r) => removable(p('x', r as TdRoundPlayer['role'])))).toEqual([false, false, false, false]);
    expect(['jumpin', 'in', 'invited'].map((r) => removable(p('x', r as TdRoundPlayer['role'])))).toEqual([true, true, true]);
  });
  it('addable: holders not playing, invitees/outs included, by tag number', () => {
    const r = round({ kind: 'casual', players: [p('h', 'host'), p('a', 'in'), p('b', 'invited'), p('c', 'out')] });
    const names = { h: { name: 'Hank', nickname: null }, a: { name: 'Al', nickname: null }, b: { name: 'Bo', nickname: 'Bomber' }, c: { name: 'Cy', nickname: null }, d: { name: 'Di', nickname: null } };
    expect(addable(r, [tag(9, 'd'), tag(2, 'b'), tag(1, 'h'), tag(4, 'a'), tag(5, 'c'), tag(7, null)], names).map((x) => x.id)).toEqual(['b', 'c', 'd']);
  });
  it('state', () => {
    const now = Date.parse('2026-10-07T20:00:00Z');
    expect(roundState(round({}), now)).toBe('NO TIME YET');
    expect(roundState(round({ tee_at: '2026-10-08T00:00:00Z' }), now)).toBe("TIME NOT OK'D");
    expect(roundState(round({ tee_at: '2026-10-08T00:00:00Z', locked: true }), now)).toBe('ON');
    expect(roundState(round({ tee_at: '2026-10-07T19:00:00Z', locked: true }), now)).toBe('PLAYING');
    expect(roundState(round({ kind: 'casual', tee_at: '2026-10-08T00:00:00Z', locked: true }), now)).toBe('CASUAL');
  });
  it('messages', () => {
    expect(tdRoundMessage({ message: 'td_round_full' })).toMatch(/full \(10\)/);
    expect(tdRoundMessage({ message: 'td_main_player' })).toMatch(/stay on/);
    expect(tdRoundMessage({ message: 'something else' })).toBeNull();
  });
});
