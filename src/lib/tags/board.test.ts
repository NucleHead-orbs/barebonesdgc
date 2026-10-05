import { describe, it, expect } from 'vitest';
import { asTab, whoLine, daysSummary, hasDay, mergeLines, newsTone, pickReasons, toggleDay, type Pick } from './board';
import type { ChatLine } from './heat';

const line = (id: number): ChatLine => ({ id, member_id: null, name: null, nickname: null, body: String(id), at: '', number: null, hidden: false });
const pick = (p: Partial<Pick>): Pick => ({ member_id: 'x', name: 'X', nickname: null, number: 3, score: 1, days: [], courses: [], idle: 0, their_days: [], busy: false, ...p });

describe('days', () => {
  it('bit 0 = Monday, toggles stay in a week', () => {
    expect(hasDay(1, 0)).toBe(true);
    expect(hasDay(32, 5)).toBe(true);
    expect(toggleDay(0, 6)).toBe(64);
    expect(toggleDay(64, 6)).toBe(0);
  });
  it('summarizes', () => {
    expect(daysSummary(32, 32 | 64)).toBe('Sat all day, Sun PM');
    expect(daysSummary(0, 0)).toBe('');
  });
});

describe('matchups', () => {
  it('explains a pick', () => {
    expect(pickReasons(pick({ days: ['Sat'], courses: ['Papago'], idle: 9, their_days: ['Sat'] }))).toEqual(['Both free Sat', 'Both love Papago', "#3 hasn't moved in 9 days"]);
    expect(pickReasons(pick({ their_days: ['Wed', 'Thu'] }))).toEqual(["They're free Wed/Thu"]);
    expect(pickReasons(pick({ busy: true }))).toEqual(['No schedule shared yet', 'Busy with another challenge']);
  });
});

describe('who reacted', () => {
  it('lists names', () => {
    expect(whoLine(['Dave'])).toBe('Dave');
    expect(whoLine(['Dave', 'Sam', 'Whitey'])).toBe('Dave, Sam and Whitey');
    expect(whoLine(['a', 'b', 'c', 'd'], 2)).toBe('a, b and 2 more');
    expect(whoLine([])).toBe('');
  });
});

describe('board', () => {
  it('merges new lines once, in order, capped', () => {
    expect(mergeLines([line(1), line(2)], [line(2), line(4), line(3)]).map((l) => l.id)).toEqual([1, 2, 3, 4]);
    expect(mergeLines([line(1)], [line(2), line(3)], 2).map((l) => l.id)).toEqual([2, 3]);
  });
  it('tones and tabs', () => {
    expect(newsTone('bomb').tone).toBe('boom');
    expect(newsTone('matchmaker').label).toBe('MATCHMAKER');
    expect(newsTone(null).tone).toBe('meh');
    expect(asTab('board')).toBe('board');
    expect(asTab('nope')).toBe('tags');
  });
});
