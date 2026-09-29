/**
 * Card requests + private tags: the glue between the TD-only tables and the generator (pure).
 * Rule: approved requests and ⭐/☺ shape Round 1 only (Round 2 seeds by score);
 * keep-apart pairs apply to every round.
 */
import type { PairingInput, Vibe } from '../cards/pairing';

export interface RequestLike { status: 'new' | 'approved' | 'declined'; players: string[] }
export interface PrivateLike { vibe: Record<string, Vibe>; apart: Array<[string, string]> }

export function pairingFor(requests: RequestLike[], priv: PrivateLike, round: 1 | 2): PairingInput {
  if (round === 2) return { groups: [], apart: priv.apart, vibe: {} };
  return { groups: requests.filter((r) => r.status === 'approved' && r.players.length > 1).map((r) => r.players), apart: priv.apart, vibe: priv.vibe };
}

export const cycleVibe = (v: Vibe | undefined): Vibe | null => (v === undefined ? 'star' : v === 'star' ? 'easy' : null);
export const VIBE_MARK: Record<Vibe, string> = { star: '⭐', easy: '☺' };
export const VIBE_LABEL: Record<Vibe, string> = { star: 'Needs a good card', easy: 'Plays with anyone' };

/** "Amy → Ben, Cal" (requester first). Unknown ids (player removed) are dropped. */
export function requestLine(players: string[], nameOf: (id: string) => string | undefined): string {
  const names = players.map(nameOf).filter((n): n is string => !!n);
  return names.length > 1 ? `${names[0]} → ${names.slice(1).join(', ')}` : names[0] ?? '(players removed)';
}

export function ago(iso: string, now: number): string {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

/** Player-facing words for submit_card_request refusals. */
export function requestError(raw: string): string {
  if (/too_many/.test(raw)) return 'You already have 3 requests waiting. The TD will get to them.';
  if (/unknown_player/.test(raw)) return "Someone you picked isn't on this event's list. Check in first, then try again.";
  if (/event_closed/.test(raw)) return 'Requests are closed for this event.';
  if (/invalid_request/.test(raw)) return 'Pick 1 to 4 people (and keep the note short).';
  if (/fetch|network|load failed/i.test(raw)) return 'No signal. Try again in a moment.';
  return 'That didn’t go through. Try again, or tell the TD.';
}
