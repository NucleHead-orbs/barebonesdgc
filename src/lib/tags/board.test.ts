import { describe, it, expect } from 'vitest';
import { applyMention, mentionAt, mentionParts, mentionPicks, asTab, canJumpIn, roundStep, slotLabel, whoLine, daysSummary, type ChallengeRound, hasDay, mergeLines, newsTone, pickReasons, toggleDay, type Pick } from './board';
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

describe('challenge rounds', () => {
  const p = { id: 'x', name: 'X', nickname: null, number: 2 };
  const base: ChallengeRound = { id: 'c', pool_id: 'p', pool: 'p', pool_name: 'P', challenger: p, challenged: p, role: 'challenged', tee_at: null, course_id: null, course: null,
    slot_mine: false, locked: false, closes_at: null, due_at: null, joins: [] };
  const now = Date.parse('2026-10-05T12:00:00Z');
  const tee = '2026-10-07T16:00:00Z', closes = '2026-10-07T14:00:00Z';
  it('walks pick -> ok -> open -> closed', () => {
    expect(roundStep(base, now)).toBe('pick');
    expect(roundStep({ ...base, role: 'challenger' }, now)).toBe('wait_pick');
    expect(roundStep({ ...base, role: 'challenger', tee_at: tee, closes_at: closes }, now)).toBe('ok');
    expect(roundStep({ ...base, tee_at: tee, closes_at: closes, slot_mine: true }, now)).toBe('wait_ok');
    expect(roundStep({ ...base, tee_at: tee, closes_at: closes, locked: true }, now)).toBe('open');
    expect(roundStep({ ...base, tee_at: tee, closes_at: closes, locked: true }, Date.parse(closes))).toBe('closed');
  });
  it('jump in only when open with a spot, and not already on it', () => {
    const open = { ...base, role: null, tee_at: tee, closes_at: closes, locked: true };
    expect(canJumpIn(open, now)).toBe(true);
    expect(canJumpIn({ ...open, joins: [p, p] }, now)).toBe(false);
    expect(canJumpIn({ ...open, role: 'joined' as const }, now)).toBe(false);
    expect(canJumpIn({ ...open, locked: false }, now)).toBe(false);
  });
  it('labels the slot', () => {
    expect(slotLabel(null, 'X')).toBe('');
    expect(slotLabel(tee, 'Papago')).toMatch(/ at Papago$/);
  });
});

describe('@mentions', () => {
  const people = [
    { id: 'a', label: 'Danny Walden', number: 4 }, { id: 'b', label: 'Bullockey', number: 18 },
    { id: 'c', label: 'Dan', number: 9 }, { id: 'me', label: 'Mike', number: 1 },
  ];
  it('finds the @ being typed, not emails', () => {
    expect(mentionAt('yo @Dan', 7)).toEqual({ start: 3, query: 'Dan' });
    expect(mentionAt('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionAt('yo @Danny Wa', 12)).toEqual({ start: 3, query: 'Danny Wa' });
    expect(mentionAt('mail mike@x', 11)).toBeNull();
    expect(mentionAt('no at here', 10)).toBeNull();
    expect(mentionAt('@Dan  done', 10)).toBeNull();
  });
  it('offers starts-with first, then word matches, never me', () => {
    expect(mentionPicks(people, 'dan', 'me').map((p) => p.id)).toEqual(['a', 'c']);
    expect(mentionPicks(people, 'wal', 'me').map((p) => p.id)).toEqual(['a']);
    expect(mentionPicks(people, '', 'me').map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(mentionPicks(people, 'mi', 'me')).toEqual([]);
  });
  it('drops the name in with a space after', () => {
    expect(applyMention('yo @da see you', { start: 3, query: 'da' }, 'Danny Walden')).toEqual({ text: 'yo @Danny Walden see you', caret: 17 });
    expect(applyMention('@', { start: 0, query: '' }, 'Dan')).toEqual({ text: '@Dan ', caret: 5 });
  });
  it('splits a message for highlighting, longest name first, any case', () => {
    expect(mentionParts('@danny walden and @Dan!', ['Dan', 'Danny Walden'])).toEqual([
      { text: '@danny walden', at: true }, { text: ' and ', at: false }, { text: '@Dan', at: true }, { text: '!', at: false }]);
    expect(mentionParts('mail dan@Dan.com or @Danish', ['Dan'])).toEqual([{ text: 'mail dan@Dan.com or @Danish', at: false }]);
    expect(mentionParts('plain', [])).toEqual([{ text: 'plain', at: false }]);
  });
  it('labels the new house posts', () => {
    expect(newsTone('result')).toEqual({ label: 'RESULTS', tone: 'fight' });
  });
});
