import { describe, it, expect } from 'vitest';
import { generateCards, DEFAULT_SETTINGS, type BuilderPlayer, type Card } from '../cards/generate';
import { parseDgsCsv } from '../import/dgs';
import {
  isTd, defaultSettings, mergeSettings, parseHoleList, slotKey, movePlayer, toggleLock, toPublishPayload,
  matchPublished, hasUnpublishedChanges, unassignedIds, importDiff, rpcError, cardUrl, type PublishedCard, type ExistingPlayer,
} from './builder';

const DIVS = ['MPO','FPO','MP40','FP40','MP50','MP55','MA1','FA1','MA40','MA50','MA60','MA2','FA2','MA3','FA3'];
const mk = (div: string, n: number): BuilderPlayer[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${div}-${i}`, name: `${div} ${i}`, div, rating: null, regOrder: i + 1 }));
const gen = (players: BuilderPlayer[], lockedCards: Card[] = []) =>
  generateCards({ players, settings: DEFAULT_SETTINGS, divOrder: DIVS, holeCount: 20, lockedCards }).cards;

describe('isTd', () => {
  it('only accepts app_metadata.role = td', () => {
    expect(isTd({ app_metadata: { role: 'td' } })).toBe(true);
    expect(isTd({ app_metadata: { role: 'player' } })).toBe(false);
    expect(isTd({ app_metadata: {} })).toBe(false);
    expect(isTd(null)).toBe(false);
  });
});

describe('settings', () => {
  it('R2 defaults to R1-score seeding; R1 keeps the locked defaults', () => {
    expect(defaultSettings(1).sortBy).toBe('reg');
    expect(defaultSettings(2).sortBy).toBe('r1');
    expect(defaultSettings(1).doubleUp).toEqual([6, 15, 14, 19, 17, 16]);
  });
  it('merges saved JSON and rejects junk field by field', () => {
    const s = mergeSettings({ size: 5, sortBy: 'nope', skip: [20, 20, 99, 'x'], balance: false }, 1, 20);
    expect(s).toMatchObject({ size: 5, sortBy: 'reg', skip: [20], balance: false, keepDivisions: true });
    expect(mergeSettings(null, 2, 20)).toEqual(defaultSettings(2));
  });
  it('parses hole lists in order, dropping repeats and out-of-range', () => {
    expect(parseHoleList('6, 15 14;19, 6, 0, 21', 20)).toEqual([6, 15, 14, 19]);
    expect(parseHoleList('', 20)).toEqual([]);
  });
});

describe('manual moves and locks', () => {
  const players = mk('MA2', 12); // 3 AM cards of 4
  const cards = gen(players);

  it('moves a player, locks the target, and never duplicates', () => {
    const from = cards[0], to = cards[1];
    const next = movePlayer(cards, from.playerIds[0], slotKey(to));
    const target = next.find((c) => slotKey(c) === slotKey(to))!;
    expect(target.locked).toBe(true);
    expect(target.playerIds).toContain(from.playerIds[0]);
    const all = next.flatMap((c) => c.playerIds);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(12);
  });

  it('drops a card that a move leaves empty, and ignores a move onto the same card', () => {
    const two: Card[] = [
      { wave: 'AM', startHole: 1, groupNo: 1, locked: false, playerIds: ['a'] },
      { wave: 'AM', startHole: 2, groupNo: 1, locked: false, playerIds: ['b'] },
    ];
    expect(movePlayer(two, 'a', 'AM-2-1')).toHaveLength(1);
    expect(movePlayer(two, 'a', 'AM-1-1')).toBe(two);
    expect(() => movePlayer(two, 'a', 'AM-9-9')).toThrow();
  });

  it('can place an unassigned player (walk-up imported after generating)', () => {
    const next = movePlayer(cards, 'late-1', slotKey(cards[2]));
    expect(next.find((c) => slotKey(c) === slotKey(cards[2]))!.playerIds).toContain('late-1');
  });

  it('locked and moved cards hold through Regenerate', () => {
    const moved = movePlayer(cards, cards[0].playerIds[0], slotKey(cards[2]));
    const locked = toggleLock(moved, slotKey(moved[0]));
    const kept = locked.filter((c) => c.locked);
    expect(kept).toHaveLength(2);
    const regen = gen(players, locked);
    for (const k of kept) expect(regen).toContainEqual(k);
    const all = regen.flatMap((c) => c.playerIds);
    expect(new Set(all).size).toBe(12);
    expect(all).toHaveLength(12);
  });

  it('toggleLock flips only the one card', () => {
    const t = toggleLock(cards, slotKey(cards[1]));
    expect(t.map((c) => c.locked)).toEqual([false, true, false]);
    expect(toggleLock(t, slotKey(cards[1]))[1].locked).toBe(false);
  });

  it('lists players not on any card', () => {
    expect(unassignedIds(['MA2-0', 'late-1'], cards)).toEqual(['late-1']);
  });
});

describe('publish payload and matching', () => {
  const cards: Card[] = [
    { wave: 'AM', startHole: 7, groupNo: 1, locked: false, playerIds: ['a', 'b', 'c'] },
    { wave: 'AM', startHole: 7, groupNo: 2, locked: true, playerIds: ['d', 'e', 'f'] },
  ];
  const published: PublishedCard[] = [
    { card_id: '1', wave: 'AM', label: '7A', start_hole: 7, token: 'tokA', players: ['a', 'b', 'c'] },
    { card_id: '2', wave: 'AM', label: '7B', start_hole: 7, token: 'tokB', players: ['d', 'e', 'f'] },
  ];

  it('sends exactly the RPC shape, locked cards included, no labels', () => {
    expect(toPublishPayload(cards)).toEqual([
      { wave: 'AM', start_hole: 7, group_no: 1, locked: false, player_ids: ['a', 'b', 'c'] },
      { wave: 'AM', start_hole: 7, group_no: 2, locked: true, player_ids: ['d', 'e', 'f'] },
    ]);
    expect(JSON.stringify(toPublishPayload(cards))).not.toMatch(/label/);
  });

  it('takes labels and tokens from the server, and flags any edit as unpublished', () => {
    const m = matchPublished(cards, published);
    expect(m.get('AM-7-2')?.label).toBe('7B');
    expect(m.get('AM-7-1')?.token).toBe('tokA');
    expect(hasUnpublishedChanges(cards, published)).toBe(false);
    const edited = movePlayer(cards, 'a', 'AM-7-2');
    expect(hasUnpublishedChanges(edited, published)).toBe(true);
    expect(matchPublished(edited, published).size).toBe(0);
    expect(hasUnpublishedChanges(cards, [])).toBe(true);
  });

  it('QR links point at /c/<token>', () => {
    expect(cardUrl('https://barebonesdiscgolf.club/', 'ab12cd34ef56ab78')).toBe('https://barebonesdiscgolf.club/c/ab12cd34ef56ab78');
  });
});

describe('import preview (mirrors td_import_players matching)', () => {
  const H = 'Division,Name,First name,Last name,PDGA#,Email,Registration date MDT';
  const csv = [H,
    'MA1,Axl Anhyzer,Axl,Anhyzer,111,a@example.com,2025-10-02 10:00:00',
    'MA1,Lita Ford,Lita,Ford,,b@example.com,2025-09-13 02:49:55',
    'MA2,Jane  Doe,Jane,Doe,,c@example.com,2025-09-20 12:00:00',
  ].join('\n');
  const { rows } = parseDgsCsv(csv, DIVS);
  const asDb = (): ExistingPlayer[] => rows.map((r, i) => ({ id: `p${i}`, name: r.name, div_code: r.div_code, rating: r.rating, pdga: r.pdga, reg_order: r.reg_order }));

  it('first import inserts everyone', () => {
    const d = importDiff(rows, []);
    expect(d.inserts).toHaveLength(3);
    expect(d.updates).toHaveLength(0);
  });

  it('re-importing the same file changes nothing', () => {
    const d = importDiff(parseDgsCsv(csv, DIVS).rows, asDb());
    expect(d.inserts).toHaveLength(0);
    expect(d.updates).toHaveLength(0);
    expect(d.unchanged).toHaveLength(3);
  });

  it('matches PDGA# first, then name case/space-insensitively, and never wipes a hand rating', () => {
    const db = asDb();
    const at = (n: string) => db.findIndex((p) => p.name === n);
    db[at('Axl Anhyzer')] = { ...db[at('Axl Anhyzer')], name: 'Axl Old-Name' };      // same PDGA#, renamed on DGS
    db[at('Lita Ford')] = { ...db[at('Lita Ford')], name: 'LITA  ford', rating: 910 }; // hand-entered rating, no PDGA#
    const d = importDiff(rows, db);
    expect(d.inserts).toHaveLength(0);
    expect(d.updates.map((u) => [u.row.name, u.fields]).sort()).toEqual([['Axl Anhyzer', ['name']], ['Lita Ford', ['name']]]);
  });

  it('reports a division change', () => {
    const db = asDb(); const i = db.findIndex((p) => p.name === 'Jane Doe'); db[i] = { ...db[i], div_code: 'MA3' };
    expect(importDiff(rows, db).updates[0].fields).toEqual(['division']);
  });
});

describe('rpcError', () => {
  it('turns round_has_scores into a clear refusal, not a crash', () => {
    const e = rpcError({ message: 'round_has_scores', code: 'P0001' }, 1);
    expect(e.kind).toBe('has_scores');
    expect(e.message).toMatch(/Round 1 already has scores/);
    expect(e.message).toMatch(/Nothing changed/);
  });
  it('maps forbidden, network and unknown errors without throwing', () => {
    expect(rpcError({ message: 'forbidden' }).kind).toBe('forbidden');
    expect(rpcError({ code: '42501', message: 'permission denied for function td_publish_round' }).kind).toBe('forbidden');
    expect(rpcError(new TypeError('Failed to fetch')).kind).toBe('network');
    expect(rpcError({ message: 'JWT expired', code: 'PGRST303' }).kind).toBe('auth');
    expect(rpcError(undefined).kind).toBe('other');
    expect(rpcError({ message: 'weird' }).message).toBe('Server said: weird');
  });
});
