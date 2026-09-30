import { describe, it, expect } from 'vitest';
import {
  holeOrder, mergeScores, holeDone, firstOpenHole, playerLine, cardComplete, tileTone, bump, cleanInitials,
  signState, signStatusLine, toParText, resultMessage, shortNames, scoringSeats, type CardPlayer, type HoleInfo,
} from './logic';
import type { QueuedScore } from '../offline/queue';

const H = (n: number, par = 3): HoleInfo => ({ n, par, dist_ft: 300, ob: null });
const holes = [H(1), H(2), H(3, 4)];
const P = (id: string): CardPlayer => ({ id, name: id, div_code: 'MA1', seat: 1 });
const q = (playerId: string, hole: number, strokes: number, token = 'tok'): QueuedScore =>
  ({ token, playerId, hole, strokes, clientTs: '2026-11-21T10:00:00Z', deviceId: 'd' });

describe('shotgun order', () => {
  it('starts at the start hole and wraps', () => {
    expect(holeOrder(7, Array.from({ length: 20 }, (_, i) => i + 1)).slice(0, 3)).toEqual([7, 8, 9]);
    expect(holeOrder(19, [1, 2, 19, 20])).toEqual([19, 20, 1, 2]);
    expect(holeOrder(1, [3, 1, 2])).toEqual([1, 2, 3]);
    expect(holeOrder(99, [1, 2])).toEqual([1, 2]); // unknown start: plain order
  });
});

describe('merge server scores with unsynced taps', () => {
  it('pending taps for THIS card win; other cards ignored; server untouched', () => {
    const server = { a: { 1: 3, 2: 4 } };
    const m = mergeScores(server, [q('a', 2, 3), q('b', 1, 5), q('a', 3, 9, 'other')], 'tok');
    expect(m).toEqual({ a: { 1: 3, 2: 3 }, b: { 1: 5 } });
    expect(server.a[2]).toBe(4);
  });
});

describe('progress', () => {
  const players = [P('a'), P('b')];
  const partial = { a: { 1: 3, 2: 3, 3: 4 }, b: { 1: 2 } };
  it('hole done only when every player has it', () => {
    expect(holeDone(players, partial, 1)).toBe(true);
    expect(holeDone(players, partial, 2)).toBe(false);
    expect(holeDone([], partial, 1)).toBe(false);
  });
  it('first open hole follows playing order', () => {
    expect(firstOpenHole([2, 3, 1], players, partial)).toBe(2);
    expect(firstOpenHole([1, 2, 3], players, { a: { 1: 3, 2: 3, 3: 3 }, b: { 1: 3, 2: 3, 3: 3 } })).toBe(1);
  });
  it('player line sums strokes and to-par over played holes only', () => {
    expect(playerLine('a', holes, partial)).toEqual({ strokes: 10, toPar: 0, thru: 3 });
    expect(playerLine('b', holes, partial)).toEqual({ strokes: 2, toPar: -1, thru: 1 });
    expect(playerLine('zz', holes, partial)).toEqual({ strokes: 0, toPar: 0, thru: 0 });
  });
  it('card complete needs every player on every hole', () => {
    expect(cardComplete(players, holes, partial)).toBe(false);
    expect(cardComplete(players, holes, { a: { 1: 3, 2: 3, 3: 4 }, b: { 1: 3, 2: 3, 3: 4 } })).toBe(true);
    expect(cardComplete(players, [], {})).toBe(false);
  });
});

describe('score entry', () => {
  it('tile tone: empty / birdie-or-better / par / bogey-or-worse', () => {
    expect([tileTone(undefined, 3), tileTone(2, 3), tileTone(3, 3), tileTone(5, 3)]).toEqual(['empty', 'under', 'even', 'over']);
  });
  it('first −/+ on an empty tile lands on par; clamps 1..12', () => {
    expect(bump(undefined, 3, 1)).toBe(3);
    expect(bump(undefined, 4, -1)).toBe(4);
    expect(bump(3, 3, 1)).toBe(4);
    expect(bump(1, 3, -1)).toBe(1);
    expect(bump(12, 3, 1)).toBe(12);
  });
  it('initials: 1–4 letters/numbers, uppercased', () => {
    expect(cleanInitials(' mm ')).toBe('MM');
    expect(cleanInitials('j.d.')).toBe('JD');
    expect(cleanInitials('')).toBeNull();
    expect(cleanInitials('ABCDE')).toBeNull();
  });
});

describe('sign-off flow', () => {
  const base = { submitted: false, complete: true, pending: 0, signed: 0, players: 4 };
  it('walks scoring -> syncing -> signing -> ready -> submitted', () => {
    expect(signState({ ...base, complete: false })).toBe('scoring');
    expect(signState({ ...base, pending: 2 })).toBe('syncing');
    expect(signState({ ...base, signed: 2 })).toBe('signing');
    expect(signState({ ...base, signed: 4 })).toBe('ready');
    expect(signState({ ...base, submitted: true, complete: false })).toBe('submitted');
  });
  it('status lines match the design copy', () => {
    expect(signStatusLine('signing', 2, 4)).toBe('2 of 4 signed');
    expect(signStatusLine('ready', 4, 4)).toBe('Everyone signed. Submit it!');
    expect(signStatusLine('submitted', 4, 4)).toBe('✓ Card submitted — scores are locked');
  });
  it('to-par text and friendly server messages', () => {
    expect([toParText(0), toParText(2), toParText(-1)]).toEqual(['E', '+2', '-1']);
    expect(resultMessage('rejected_submitted')).toMatch(/already submitted/);
    expect(resultMessage('invalid_token')).toMatch(/doesn't match a live card/);
    expect(resultMessage('something_new')).toBe('something_new');
  });
});

describe('shortNames', () => {
  it('uses first names, adding a last initial only where they collide', () => {
    expect(shortNames([{ id: 'a', name: 'Test Alpha' }, { id: 'b', name: 'Test Bravo' }, { id: 'c', name: 'Mike Minnier' }]))
      .toEqual({ a: 'Test A.', b: 'Test B.', c: 'Mike' });
    expect(shortNames([{ id: 'a', name: 'Cher' }])).toEqual({ a: 'Cher' });
    expect(shortNames([{ id: 'a', name: 'Ann Smith & Bob Jones' }, { id: 'e', name: 'Eve Long' }])).toEqual({ a: 'Ann/Bob', e: 'Eve' });
  });
});

describe('scoringSeats (doubles)', () => {
  const ps = [
    { id: 'a', name: 'Ann', div_code: 'MA1', seat: 1 }, { id: 'b', name: 'Bob', div_code: 'MA1', seat: 2 },
    { id: 'e', name: 'Eve', div_code: 'MA1', seat: 3 },
  ];
  it('one line per team keyed to the captain; Cali labelled', () => {
    expect(scoringSeats(ps, [{ team_no: 1, a: 'a', b: 'b' }, { team_no: 3, a: 'e', b: null }])).toEqual([
      { id: 'a', name: 'Ann & Bob', div_code: 'TEAM 1', seat: 1 },
      { id: 'e', name: 'Eve', div_code: 'CALI · TEAM 3', seat: 2 },
    ]);
  });
  it('anyone not in a team still gets a line (never hidden)', () => {
    expect(scoringSeats(ps, [{ team_no: 1, a: 'a', b: 'b' }]).map((p) => p.id)).toEqual(['a', 'e']);
  });
});
