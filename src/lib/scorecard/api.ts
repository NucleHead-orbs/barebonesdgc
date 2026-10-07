/**
 * Scorecard reads/writes. Everything goes through the card's QR token:
 *  - get_card / sign_card / submit_card are SECURITY DEFINER RPCs keyed by token.
 *  - scores and holes are public-read, so the phone reads them directly.
 *  - The last good snapshot is kept in IndexedDB so the card reopens with zero signal.
 */
import { createStore, get, set } from 'idb-keyval';
import { supabase } from '../supabase';
import { scoringSeats, type CardPlayer, type HoleInfo, type ScoreMap, type TeamRef } from './logic';

export interface CardInfo {
  id: string; event_id: string; round: number; wave: string; label: string; start_hole: number;
  /** Missing on snapshots cached before doubles (= singles). */
  format?: 'singles' | 'doubles'; dubs_style?: string;
}
export interface CardEvent { name: string; slug: string; club_name: string | null; skin: 'event' | 'jewel-xi'; palette: string; rounds: number; waves: number }
export interface CardSnapshot {
  card: CardInfo;
  /** Missing on snapshots cached before multi-event (treated as Jewel XI). */
  event?: CardEvent;
  players: CardPlayer[];
  signoffs: Record<string, string>;
  submitted: boolean;
  complete: boolean;
  holes: HoleInfo[];
  scores: ScoreMap;
  fetchedAt: string;
}

/** A thrown error the screen can show as-is. `code` is the server's word for it, when there is one. */
export class CardError extends Error {
  code: 'invalid_token' | 'network' | 'other';
  constructor(message: string, code: CardError['code']) { super(message); this.code = code; }
}

const cache = createStore('jewel-cards', 'cards');
export const cachedCard = (token: string) => get<CardSnapshot>(token, cache).catch(() => undefined);

export async function fetchCard(token: string): Promise<CardSnapshot> {
  const r = await supabase.rpc('get_card', { p_token: token });
  if (r.error) {
    if (/invalid_token/.test(r.error.message)) throw new CardError("This QR code doesn't match a live card. Check with the TD.", 'invalid_token');
    throw new CardError("Couldn't reach the scoring server. Your taps are saved on this phone.", 'network');
  }
  const raw = r.data as Omit<CardSnapshot, 'holes' | 'scores' | 'fetchedAt'> & { teams?: TeamRef[] };
  // Doubles: one line per team (keyed to the captain). Everything below (scores, taps, signing) then works per team.
  const { teams, ...rest } = raw;
  const d = raw.card.format === 'doubles' ? { ...rest, players: scoringSeats(raw.players, teams ?? []) } : rest;
  const ids = d.players.map((p) => p.id);
  const [h, s] = await Promise.all([
    supabase.from('holes').select('n, par, dist_ft, ob, ctp_prize').eq('event_id', d.card.event_id).order('n'),
    ids.length
      ? supabase.from('scores').select('player_id, hole, strokes').eq('round', d.card.round).in('player_id', ids)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (h.error || s.error) throw new CardError("Couldn't load the course or scores. Your taps are saved on this phone.", 'network');
  const scores: ScoreMap = {};
  for (const row of (s.data ?? []) as Array<{ player_id: string; hole: number; strokes: number }>) {
    (scores[row.player_id] ??= {})[row.hole] = row.strokes;
  }
  const snap: CardSnapshot = { ...d, holes: (h.data ?? []) as HoleInfo[], scores, fetchedAt: new Date().toISOString() };
  await set(token, snap, cache).catch(() => undefined);
  return snap;
}

async function rpcText(fn: string, args: Record<string, unknown>): Promise<string> {
  const r = await supabase.rpc(fn, args);
  if (r.error) {
    if (/invalid_token/.test(r.error.message)) return 'invalid_token';
    if (/forbidden|not_td|42501/.test(r.error.message + (r.error.code ?? ''))) return 'forbidden';
    throw new CardError('No signal right now. Try again in a moment.', 'network');
  }
  return (r.data as string | null) ?? 'ok';
}

export const signCard = (token: string, playerId: string, initials: string) =>
  rpcText('sign_card', { p_token: token, p_player_id: playerId, p_initials: initials });
export const submitCard = (token: string) => rpcText('submit_card', { p_token: token });
export const unlockCard = (cardId: string) => rpcText('td_unlock_card', { p_card_id: cardId });

// ---------- Round 2 confirm (migration 20261111) ----------
export interface R2Status { asks: boolean; open: boolean; players: Array<{ id: string; r2_in: boolean | null; locked: boolean }> }
/** Who on this card has answered for Round 2 (asks = this event asks; open = this card can answer now). */
export async function r2Status(token: string): Promise<R2Status> {
  const r = await supabase.rpc('card_r2_status', { p_token: token });
  if (r.error) throw new CardError('No signal right now. Try again in a moment.', 'network');
  return r.data as R2Status;
}
/** 'saved' | 'not_open' | 'rejected_not_on_card' | 'r2_closed' */
export const r2Set = (token: string, playerId: string, inR2: boolean) => rpcText('card_r2_set', { p_token: token, p_player: playerId, p_in: inR2 });
