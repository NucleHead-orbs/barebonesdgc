/**
 * Card requests + private tags: the glue between the TD-only tables and the generator (pure).
 * Rule: approved requests and ⭐/☺ shape Round 1 only (Round 2 seeds by score);
 * keep-apart pairs apply to every round.
 */
import { cardIssues, type PairingInput, type Vibe } from '../cards/pairing';
import type { Card } from '../cards/generate';

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

/**
 * Approved after cards are out (locked 2026-09-30): pull the request's players onto one card by swapping, never
 * touching locked cards, never breaking a team (doubles: a unit = a team), never over the card limit, never creating a
 * new keep-apart clash. The card they land on locks so a regenerate keeps it. Pure: the caller republishes.
 */
export type SeatResult = { ok: true; cards: Card[]; moved: number; target: Card } | { ok: false; reason: 'already' | 'missing' | 'locked' | 'no_room' | 'conflict' };
export function seatRequest(cards: Card[], ids: string[], opts: { unitOf: (id: string) => string; max: number; keyOf: (c: Card) => string; pairing: PairingInput; nameOf: (id: string) => string }): SeatResult {
  const { unitOf, max, keyOf } = opts;
  const where = new Map<string, number>(); cards.forEach((c, i) => c.playerIds.forEach((id) => where.set(unitOf(id), i)));
  const unitsOf = (c: Card) => [...new Set(c.playerIds.map(unitOf))];
  const members = (u: string, c: Card) => c.playerIds.filter((id) => unitOf(id) === u);
  const want = [...new Set(ids.map(unitOf))];
  if (want.some((u) => !where.has(u))) return { ok: false, reason: 'missing' };
  const homes = new Map<number, number>(); for (const u of want) homes.set(where.get(u)!, (homes.get(where.get(u)!) ?? 0) + 1);
  if (homes.size === 1) return { ok: false, reason: 'already' };
  const ti = [...homes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  const out = cards.map((c) => ({ ...c, playerIds: c.playerIds.slice() }));
  const target = out[ti];
  if (target.locked) return { ok: false, reason: 'locked' };
  let moved = 0;
  for (const u of want) {
    const si = where.get(u)!; if (si === ti) continue;
    const src = out[si]; if (src.locked) return { ok: false, reason: 'locked' };
    const mine = members(u, src);
    if (target.playerIds.length + mine.length <= max) {
      src.playerIds = src.playerIds.filter((id) => !mine.includes(id)); target.playerIds.push(...mine);
    } else {
      // swap with a same-size unit on the target that isn't part of this request
      const asked = new Set(opts.pairing.groups.flat().map(unitOf));
      const apartPairs = new Set(opts.pairing.apart.map(([x, y]) => (x < y ? `${x}|${y}` : `${y}|${x}`)));
      const clash = (xs: string[], ys: string[]) => xs.some((x) => ys.some((y) => apartPairs.has(x < y ? `${x}|${y}` : `${y}|${x}`)));
      const fits = unitsOf(target).filter((x) => !want.includes(x) && members(x, target).length === mine.length
        && !clash(members(x, target), src.playerIds.filter((id) => !mine.includes(id))));
      const v = fits.find((x) => !asked.has(x)) ?? fits[0];
      if (!v) return { ok: false, reason: 'no_room' };
      const theirs = members(v, target);
      target.playerIds = [...target.playerIds.filter((id) => !theirs.includes(id)), ...mine];
      src.playerIds = [...src.playerIds.filter((id) => !mine.includes(id)), ...theirs];
    }
    moved += mine.length;
  }
  const before = new Set(cardIssues(cards.map((c) => c.playerIds), opts.pairing, opts.nameOf));
  const after = cardIssues(out.map((c) => c.playerIds), opts.pairing, opts.nameOf).filter((x) => !before.has(x) && /^(Keep-apart|Request split)/.test(x));
  if (after.length) return { ok: false, reason: 'conflict' };
  target.locked = true;
  const final = out.filter((c) => c.playerIds.length > 0);
  return { ok: true, cards: final, moved, target: final.find((c) => keyOf(c) === keyOf(target))! };
}

export const SEAT_REASON: Record<Exclude<SeatResult, { ok: true }>['reason'], string> = {
  already: 'They were already on the same card.',
  missing: "Someone in it isn't on a Round 1 card (not checked in?), so cards didn't change. It'll apply next time you generate.",
  locked: 'One of their cards is locked (hand-placed), so cards didn\'t change. Move them by hand in Cards.',
  no_room: 'No room to swap them together without breaking a full card. Move them by hand in Cards.',
  conflict: 'Seating them together would put a keep-apart pair on one card or split another request. Move them by hand in Cards.',
};
