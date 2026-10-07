/**
 * TD ROUNDS (migration 20261115): every upcoming tag round in a set, for the pool admin, with ADD / REMOVE.
 * The server owns the rules (card of 10, the two challenge players and the casual host stay on); these helpers just
 * decide what the panel shows.
 */
import { CARD_MAX } from './board';
import { display, type Tag } from './tags';

export type TdRoundKind = 'challenge' | 'casual';
export type TdRole = 'challenger' | 'challenged' | 'jumpin' | 'host' | 'in' | 'invited' | 'out';
export interface TdRoundPlayer { id: string; name: string; nickname: string | null; number: number | null; role: TdRole }
export interface TdRound {
  kind: TdRoundKind; id: string; title: string; tee_at: string | null; course: string | null; locked: boolean;
  due_at: string | null; created_at: string; note: string | null; players: TdRoundPlayer[];
}

/** On the card = actually playing (casual invitees who haven't said IN, or said OUT, don't count). */
export const onCard = (p: TdRoundPlayer) => p.role !== 'invited' && p.role !== 'out';
export const cardCount = (r: TdRound) => r.players.filter(onCard).length;
export const cardFull = (r: TdRound) => cardCount(r) >= CARD_MAX;
/** The TD can take off anyone playing except the two challenge players and the host; casual invitees too. */
export const removable = (p: TdRoundPlayer) => p.role === 'jumpin' || p.role === 'in' || p.role === 'invited';

/** Tag holders in the set who aren't on this card yet (casual invitees/outs can be put IN), sorted by tag number. */
export function addable(r: TdRound, held: Tag[], names: Record<string, { name: string; nickname: string | null }>): { id: string; label: string }[] {
  const on = new Set(r.players.filter(onCard).map((p) => p.id));
  return held
    .filter((t) => t.holder_id && !on.has(t.holder_id))
    .sort((a, b) => a.number - b.number)
    .map((t) => ({ id: t.holder_id!, label: `#${t.number} ${names[t.holder_id!] ? display(names[t.holder_id!]) : '?'}` }));
}

/** Where the round stands, in a few words. */
export function roundState(r: TdRound, now: number): string {
  if (r.kind === 'challenge' && !r.tee_at) return 'NO TIME YET';
  if (r.kind === 'challenge' && !r.locked) return 'TIME NOT OK\'D';
  if (r.tee_at && now >= new Date(r.tee_at).getTime()) return 'PLAYING';
  return r.kind === 'challenge' ? 'ON' : 'CASUAL';
}

export const ROLE_LABEL: Record<TdRole, string> = {
  challenger: 'CHALLENGER', challenged: 'DEFENDER', jumpin: 'JUMP-IN', host: 'HOST', in: 'IN', invited: 'INVITED', out: 'OUT',
};

/** TD round errors in plain words. null = not one of these. */
export function tdRoundMessage(err: unknown): string | null {
  const m = err && typeof err === 'object' && 'message' in err ? String((err as { message?: string }).message) : String(err ?? '');
  if (/td_round_full/.test(m)) return `That card is full (${CARD_MAX}). Take someone off first.`;
  if (/td_already_on/.test(m)) return 'They\'re already on that card.';
  if (/td_not_in_set/.test(m)) return 'They need a tag in this set first.';
  if (/td_main_player/.test(m)) return 'The two challenge players stay on. Void the challenge instead.';
  if (/td_host/.test(m)) return 'The host stays on. They can call the round off from My Tag.';
  if (/td_not_on/.test(m)) return 'They\'re not on that card anymore. Refresh.';
  if (/td_round_over/.test(m)) return 'That round was played (over 6 hours past tee).';
  if (/not_found/.test(m)) return 'That round is gone (called off or answered). Refresh.';
  return null;
}
