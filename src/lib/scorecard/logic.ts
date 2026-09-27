/**
 * Scorecard rules (pure). The database owns truth (score_upsert / sign_card / submit_card);
 * this file only decides what the phone SHOWS from server state + its own unsynced taps.
 *  - Shotgun: play every hole once, starting at the card's start hole, wrapping N -> 1.
 *  - A pending (unsynced) tap always wins over the server value on this phone: it is newer
 *    by construction (the queue keeps only the latest tap per player+hole).
 *  - The card is "complete" when every player has a score on every hole.
 */
import type { QueuedScore } from '../offline/queue';

export interface CardPlayer { id: string; name: string; div_code: string; seat: number }
export interface HoleInfo { n: number; par: number; dist_ft: number | null; ob: string | null }
export type ScoreMap = Record<string, Record<number, number>>; // playerId -> hole -> strokes

export const MIN_STROKES = 1;
export const MAX_STROKES = 12;

/** Holes in playing order for a shotgun start. */
export function holeOrder(startHole: number, holeNumbers: number[]): number[] {
  const sorted = [...holeNumbers].sort((a, b) => a - b);
  const i = sorted.indexOf(startHole);
  return i < 0 ? sorted : [...sorted.slice(i), ...sorted.slice(0, i)];
}

/** Server scores overlaid with this phone's unsynced taps for this card. */
export function mergeScores(server: ScoreMap, pending: QueuedScore[], token: string): ScoreMap {
  const out: ScoreMap = {};
  for (const [pid, holes] of Object.entries(server)) out[pid] = { ...holes };
  for (const p of pending) {
    if (p.token !== token) continue;
    (out[p.playerId] ??= {})[p.hole] = p.strokes;
  }
  return out;
}

export const holeDone = (players: CardPlayer[], scores: ScoreMap, hole: number) =>
  players.length > 0 && players.every((p) => scores[p.id]?.[hole] != null);

/** First hole in playing order that someone still needs a score on; start hole if all done. */
export function firstOpenHole(order: number[], players: CardPlayer[], scores: ScoreMap): number {
  return order.find((h) => !holeDone(players, scores, h)) ?? order[0];
}

export interface PlayerLine { strokes: number; toPar: number; thru: number }
export function playerLine(pid: string, holes: HoleInfo[], scores: ScoreMap): PlayerLine {
  let strokes = 0, par = 0, thru = 0;
  for (const h of holes) {
    const s = scores[pid]?.[h.n];
    if (s == null) continue;
    strokes += s; par += h.par; thru++;
  }
  return { strokes, toPar: strokes - par, thru };
}

export const cardComplete = (players: CardPlayer[], holes: HoleInfo[], scores: ScoreMap) =>
  holes.length > 0 && holes.every((h) => holeDone(players, scores, h.n));

/** Score tile colour: birdie or better / par / bogey or worse (handoff scorecard spec). */
export const tileTone = (strokes: number | undefined, par: number): 'empty' | 'under' | 'even' | 'over' =>
  strokes == null ? 'empty' : strokes < par ? 'under' : strokes === par ? 'even' : 'over';

export const clampStrokes = (n: number) => Math.min(MAX_STROKES, Math.max(MIN_STROKES, n));

/** Next value for −/+ : from an empty tile, start at par. */
export function bump(current: number | undefined, par: number, delta: 1 | -1): number {
  return clampStrokes((current ?? par) + (current == null ? 0 : delta));
}

/** Initials: 1–4 letters/numbers, uppercased (sign_card enforces 1–4 too). */
export function cleanInitials(raw: string): string | null {
  const v = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return v.length >= 1 && v.length <= 4 ? v : null;
}

export type SignState = 'scoring' | 'syncing' | 'signing' | 'ready' | 'submitted';
/**
 * Where the sign-off panel is. Signing needs the server to see a complete card,
 * so nothing is signable while this phone still has unsynced taps.
 */
export function signState(o: { submitted: boolean; complete: boolean; pending: number; signed: number; players: number }): SignState {
  if (o.submitted) return 'submitted';
  if (!o.complete) return 'scoring';
  if (o.pending > 0) return 'syncing';
  return o.signed >= o.players && o.players > 0 ? 'ready' : 'signing';
}

export function signStatusLine(s: SignState, signed: number, players: number): string {
  switch (s) {
    case 'submitted': return '✓ Card submitted — scores are locked';
    case 'ready': return 'Everyone signed. Submit it!';
    case 'syncing': return 'Syncing scores… sign-off opens when every score is saved.';
    case 'signing': return `${signed} of ${players} signed`;
    default: return '';
  }
}

export const toParText = (n: number) => (n === 0 ? 'E' : n > 0 ? `+${n}` : String(n));

/** Friendly text for server results the player can hit. Never a raw code on screen. */
export function resultMessage(r: string): string {
  switch (r) {
    case 'rejected_submitted': return 'This card was already submitted, so that score was not saved. Ask the TD to unlock it.';
    case 'rejected_not_on_card': return "That player isn't on this card anymore. Reload the card.";
    case 'rejected_invalid': return 'That score was not valid (1–12 strokes on a real hole).';
    case 'incomplete': return 'Every player needs a score on every hole before signing.';
    case 'missing_signatures': return 'Everyone on the card has to sign before it can be submitted.';
    case 'already_submitted': return 'This card was already submitted.';
    case 'invalid_token': return "This QR code doesn't match a live card. Check with the TD.";
    default: return r;
  }
}
