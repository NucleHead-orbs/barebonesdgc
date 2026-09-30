/**
 * Card Builder glue: pure helpers between the UI, generate.ts, dgs.ts and the TD RPCs.
 * No assignment or import logic lives here — those stay in generate.ts / dgs.ts / the database.
 * Labels ('7', '7B') are never computed here; they only ever come back from td_publish_round.
 */
import { DEFAULT_SETTINGS, type BuilderSettings, type Card, type SortBy, type Wave } from '../cards/generate';
import { nameKey, type ImportRow } from '../import/dgs';
import { setupMessage } from './setup';

// ---------- auth ----------
export const isTd = (user: { app_metadata?: Record<string, unknown> } | null | undefined): boolean =>
  user?.app_metadata?.role === 'td';

// ---------- settings ----------
const SORTS: SortBy[] = ['rating', 'r1', 'reg', 'random'];

/**
 * Round 2 seeds from R1 scores by default (handoff: switching to R2 changes the sort to R1 score).
 * Without pmDefault: the original Jewel defaults (kept as the generator's fixture).
 * With pmDefault (every real event): PM = the divisions marked PM in the build menu, and no
 * double-up order (that is course-specific; Jewel's lives in its saved builder_settings).
 */
export function defaultSettings(round: 1 | 2, pmDefault?: string[]): BuilderSettings {
  const sortBy = round === 2 ? 'r1' : DEFAULT_SETTINGS.sortBy;
  if (!pmDefault) return { ...DEFAULT_SETTINGS, sortBy };
  return { ...DEFAULT_SETTINGS, pmDivisions: [...pmDefault], doubleUp: [], sortBy };
}

const intList = (v: unknown, max: number): number[] | null =>
  Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= max))] : null;

/** Saved builder_settings JSON -> valid settings. Anything missing or malformed falls back to the default. */
export function mergeSettings(saved: unknown, round: 1 | 2, holeCount: number, pmDefault?: string[]): BuilderSettings {
  const d = defaultSettings(round, pmDefault);
  if (!saved || typeof saved !== 'object') return d;
  const s = saved as Record<string, unknown>;
  return {
    pmDivisions: Array.isArray(s.pmDivisions) ? s.pmDivisions.filter((x): x is string => typeof x === 'string') : d.pmDivisions,
    size: s.size === 3 || s.size === 4 || s.size === 5 ? s.size : d.size,
    sortBy: SORTS.includes(s.sortBy as SortBy) ? (s.sortBy as SortBy) : d.sortBy,
    keepDivisions: typeof s.keepDivisions === 'boolean' ? s.keepDivisions : d.keepDivisions,
    mergeSmall: typeof s.mergeSmall === 'boolean' ? s.mergeSmall : d.mergeSmall,
    balance: typeof s.balance === 'boolean' ? s.balance : d.balance,
    doubleUp: intList(s.doubleUp, holeCount) ?? d.doubleUp,
    skip: intList(s.skip, holeCount) ?? d.skip,
    ...(s.teamsPerCard === 3 ? { teamsPerCard: 3 as const } : {}),
    seed: Number.isInteger(s.seed) ? (s.seed as number) : d.seed,
  };
}

/** "6, 15 14;19" -> [6, 15, 14, 19]. Keeps order, drops junk, out-of-range and repeats. */
export function parseHoleList(text: string, holeCount: number): number[] {
  return intList(text.split(/[^0-9]+/).filter(Boolean), holeCount) ?? [];
}

// ---------- cards ----------
export const slotKey = (c: Pick<Card, 'wave' | 'startHole' | 'groupNo'>) => `${c.wave}-${c.startHole}-${c.groupNo}`;

/**
 * Hand move: take the player off whatever card they're on and put them on the target.
 * The target card locks, so the move survives Regenerate. Cards left empty disappear.
 */
export function movePlayer(cards: Card[], playerId: string, targetKey: string): Card[] {
  const target = cards.find((c) => slotKey(c) === targetKey);
  if (!target) throw new Error(`No card ${targetKey}`);
  if (target.playerIds.includes(playerId)) return cards;
  return cards
    .map((c) => {
      const ids = c.playerIds.filter((id) => id !== playerId);
      if (slotKey(c) === targetKey) return { ...c, locked: true, playerIds: [...ids, playerId] };
      return ids.length === c.playerIds.length ? c : { ...c, playerIds: ids };
    })
    .filter((c) => c.playerIds.length > 0);
}

export const toggleLock = (cards: Card[], key: string): Card[] =>
  cards.map((c) => (slotKey(c) === key ? { ...c, locked: !c.locked } : c));

export interface PublishCard { wave: Wave; start_hole: number; group_no: number; locked: boolean; player_ids: string[] }
export const toPublishPayload = (cards: Card[]): PublishCard[] =>
  cards.map((c) => ({ wave: c.wave, start_hole: c.startHole, group_no: c.groupNo, locked: c.locked, player_ids: [...c.playerIds] }));

/** Rows as td_publish_round returns them. */
export interface PublishedCard { card_id: string; wave: Wave; label: string; start_hole: number; token: string; players: string[] }

/**
 * Link builder cards to what the server published. A card only gets the server's label
 * (and token) when its wave, start hole AND players match exactly; anything else is an unpublished edit.
 */
export function matchPublished(cards: Card[], published: PublishedCard[]): Map<string, PublishedCard> {
  const byPlayers = new Map(published.map((p) => [`${p.wave}|${p.start_hole}|${p.players.join(',')}`, p]));
  const out = new Map<string, PublishedCard>();
  for (const c of cards) {
    const hit = byPlayers.get(`${c.wave}|${c.startHole}|${c.playerIds.join(',')}`);
    if (hit) out.set(slotKey(c), hit);
  }
  return out;
}

/** True when the builder differs from the published round. */
export function hasUnpublishedChanges(cards: Card[], published: PublishedCard[]): boolean {
  if (cards.length !== published.length) return true;
  return matchPublished(cards, published).size !== cards.length;
}

export function unassignedIds(playerIds: string[], cards: Card[]): string[] {
  const on = new Set(cards.flatMap((c) => c.playerIds));
  return playerIds.filter((id) => !on.has(id));
}

// ---------- import preview ----------
export interface ExistingPlayer { id: string; name: string; div_code: string; rating: number | null; pdga: string | null; reg_order: number | null; checked_in?: boolean; finish_status?: 'dnf' | 'dq' | 'ns' | null; shirt_size?: string | null }
export interface ImportDiff { inserts: ImportRow[]; updates: Array<{ row: ImportRow; fields: string[] }>; unchanged: ImportRow[] }

/**
 * Preview what td_import_players will do, using the same match order (PDGA#, then exact name)
 * and the same keep-rules (a blank rating/PDGA# never wipes an existing value).
 * The RPC counts every match as "updated"; this tells the TD which ones actually change.
 */
export function importDiff(rows: ImportRow[], existing: ExistingPlayer[]): ImportDiff {
  const byPdga = new Map(existing.filter((p) => p.pdga).map((p) => [p.pdga!, p]));
  const byName = new Map(existing.map((p) => [nameKey(p.name), p]));
  const diff: ImportDiff = { inserts: [], updates: [], unchanged: [] };
  for (const r of rows) {
    const ex = (r.pdga ? byPdga.get(r.pdga) : undefined) ?? byName.get(nameKey(r.name));
    if (!ex) { diff.inserts.push(r); continue; }
    const fields: string[] = [];
    if (r.name !== ex.name) fields.push('name');
    if (r.div_code !== ex.div_code) fields.push('division');
    if (r.rating != null && r.rating !== ex.rating) fields.push('rating');
    if (r.pdga != null && r.pdga !== ex.pdga) fields.push('PDGA#');
    if (r.reg_order !== ex.reg_order) fields.push('registration order');
    if (r.shirt_size != null && r.shirt_size !== (ex.shirt_size ?? null)) fields.push('shirt size');
    if (fields.length) diff.updates.push({ row: r, fields });
    else diff.unchanged.push(r);
  }
  return diff;
}

// ---------- errors ----------
export type RpcErrorKind = 'has_scores' | 'forbidden' | 'empty_card' | 'unknown_player' | 'auth' | 'network' | 'other';

/** Supabase/PostgREST error -> a message a TD can act on. Never throws. */
export function rpcError(err: unknown, round?: number): { kind: RpcErrorKind; message: string } {
  const e = (err && typeof err === 'object' ? err : {}) as { message?: string; code?: string; details?: string };
  const msg = `${e.message ?? ''} ${e.details ?? ''}`.trim() || String(err);
  const r = round ? `Round ${round}` : 'This round';
  const setup = setupMessage(msg);
  if (setup) return { kind: 'other', message: setup };
  if (/team_split/.test(msg)) return { kind: 'other', message: 'A card splits a team. Partners must share a card: regenerate, or move the whole team.' };
  if (/player_without_team/.test(msg)) return { kind: 'other', message: 'Someone on a card isn\'t in the draw. Add latecomers to the draw, then regenerate.' };
  if (/not_doubles/.test(msg)) return { kind: 'other', message: `${r} is set to singles. Switch it to doubles in Setup to draw partners.` };
  if (/round_has_scores/.test(msg))
    return { kind: 'has_scores', message: `${r} already has scores, so publishing was refused. Nothing changed. Force republish keeps every score but drops signatures and submissions on the rebuilt cards.` };
  if (/forbidden|permission denied/i.test(msg) || e.code === '42501') return { kind: 'forbidden', message: "This account isn't a TD for this event. Ask the organizer to add your email." };
  if (/empty_card/.test(msg)) return { kind: 'empty_card', message: 'A card has no players. Regenerate, then publish again.' };
  if (/unknown_player/.test(msg)) return { kind: 'unknown_player', message: 'A card has a player who is not in this event. Reload the page and regenerate.' };
  if (/jwt/i.test(msg) || e.code === 'PGRST301' || e.code === 'PGRST303') return { kind: 'auth', message: 'Your session expired. Sign in again; nothing was saved.' };
  if (/fetch|network|load failed/i.test(msg)) return { kind: 'network', message: 'Could not reach the server. Nothing was saved. Check signal and try again.' };
  return { kind: 'other', message: `Server said: ${msg}` };
}

// ---------- QR ----------
export const cardUrl = (origin: string, token: string) => `${origin.replace(/\/$/, '')}/c/${encodeURIComponent(token)}`;
