/**
 * Early access tag league + raffle: shared types and pure helpers. The rules live in the database
 * (20261019000000_early_access.sql: _ea_rounds / _ea_standings); this file only labels and shapes them.
 */

export interface EaRosterRow { player_id: string; name: string; joined: boolean; eligible?: boolean }
export interface EaPublicRow { name: string; nickname: string | null; tag: number | null; tickets: number }
export interface EaPublic {
  event: { id: string; slug: string; name: string; starts_on: string };
  pool: string; opens_on: string; closes_on: string; min_players: number; weekly_cap: number; today: string;
  max_players?: number | null; registered?: number; // first N registrants only (null = everyone)
  roster: EaRosterRow[]; standings: EaPublicRow[]; winners: Array<{ name: string; nickname: string | null; at: string }>;
}
export interface EaStanding {
  member_id: string; player_id: string; name: string; nickname: string | null; tag: number | null; start_tag: number | null;
  rounds: number; round_tickets: number; partners: number; bonus: number; tickets: number;
}
export interface EaMine {
  slug: string; name: string; starts_on: string; opens_on: string; closes_on: string; min_players: number; weekly_cap: number;
  status: 'approved' | 'pending' | 'open'; me: EaStanding | null;
}
export interface EaClaimStatus { status: 'pending' | 'approved' | 'declined' | 'removed'; name: string; token: string | null }
export interface EaClaim {
  id: string; player_id: string; player: string; nickname: string | null; via: 'page' | 'mytag'; created_at: string;
  member: { id: string; name: string } | null; others: number;
}
export interface EaLinked { claim_id: string; player: string; member_id: string; member: string; nickname: string | null; via: 'page' | 'mytag'; at: string; tag: number | null }
export interface EaBonus { id: number; member_id: string; name: string; tickets: number; reason: string; by: string | null; at: string }
export interface EaDraw { id: number; member_id: string; name: string; nickname: string | null; tickets: number; at: string }
export interface EaTd {
  on: boolean; pool?: string; opens_on?: string; closes_on?: string; min_players?: number; weekly_cap?: number; today?: string; players?: number;
  max_players?: number | null;
  claims?: EaClaim[]; linked?: EaLinked[]; bonus?: EaBonus[]; standings?: EaStanding[];
  awards?: { iron: EaStanding[]; collector: EaStanding[]; climb: EaStanding[] }; draws?: EaDraw[];
}

/** The public page for an event's early access (Jewel XI lives on its microsite). */
export const earlyPath = (slug: string) => (slug === 'jewel-xi-2026' ? '/jewel-xi/early-access' : `/e/${slug}/early-access`);

/** Where a page claim's device secret is kept (one per event). */
export const claimKey = (slug: string) => `bb-ea-claim:${slug}`;

export type EaWindow = 'before' | 'open' | 'closed';
/** ISO dates compare as strings. */
export function windowState(today: string, opens: string, closes: string): EaWindow {
  if (today < opens) return 'before';
  if (today > closes) return 'closed';
  return 'open';
}

/** Days left including today (0 once closed). */
export function daysLeft(today: string, closes: string): number {
  const ms = Date.parse(`${closes}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 86_400_000) + 1) : 0;
}

/** The plain-English rules, from the event's own numbers (one source for the page, My Tag and /td). */
export function rulesText(min: number, cap: number): string[] {
  return [
    `Save your rounds on the Scorecard with at least ${min} Jewel players on the card (guests are fine, they just don't count).`,
    'A round counts once every Jewel player on it confirms from their My Tag.',
    `Each counting round = 1 raffle ticket, up to ${cap} a week (Monday to Sunday).`,
    'First time you play a counting round with someone new from the Jewel = 1 bonus ticket each.',
    'Find a bug and tell us = bonus tickets.',
    'Winners are drawn at the players meeting. More tickets, better odds.',
  ];
}

/** "3 tickets" / "1 ticket" */
export const tickets = (n: number) => `${n} ticket${n === 1 ? '' : 's'}`;

/** Rank of a ticket total among public standings (ties share; 1 = most). */
export function rankOf(rows: Array<{ tickets: number }>, mine: number): number {
  return 1 + rows.filter((r) => r.tickets > mine).length;
}

export function earlyMessage(err: unknown): string {
  const e = (err && typeof err === 'object' ? err : {}) as { message?: string; code?: string };
  const m = e.message ?? String(err);
  if (/no_early_access/.test(m)) return "Early access isn't running for this event.";
  if (/window_closed/.test(m)) return 'Early access is closed. See you at the event.';
  if (/early_access_full/.test(m)) return "Early access is full: it's for the first registrants only. See you at the event!";
  if (/unknown_player/.test(m)) return "That name isn't on the registration list. Reload and try again.";
  if (/already_joined/.test(m)) return "That player already joined. If it isn't you, tell a TD.";
  if (/already_claimed/.test(m)) return "You've already asked to join. Hang tight for a TD.";
  if (/too_many_claims/.test(m)) return 'Too many requests waiting for that name. A TD will sort it out.';
  if (/invalid_nickname/.test(m)) return 'Nickname: 40 characters max.';
  if (/invalid_claim/.test(m)) return "We can't find that request anymore. Pick your name again.";
  if (/invalid_link/.test(m)) return "This link doesn't work anymore. Ask your league TD for a new one.";
  if (/member_already_joined/.test(m)) return 'That club member is already linked to another registrant.';
  if (/member_mismatch/.test(m)) return 'This request came from a My Tag link, so it can only link that member.';
  if (/already_(approved|declined|removed)/.test(m)) return 'Somebody already answered that request. Reload.';
  if (/not_joined/.test(m)) return "That player hasn't joined early access.";
  if (/reason_required/.test(m)) return 'Give a reason (what they found).';
  if (/invalid_tickets/.test(m)) return 'Bonus is 1 to 5 tickets.';
  if (/invalid_dates/.test(m)) return 'Window: opens before it closes, and closes before the event starts.';
  if (/invalid_rules/.test(m)) return 'Jewel players per round: 2 to 8. Weekly cap: 1 to 7.';
  if (/window_open/.test(m)) return "The window is still open. Draw after it closes.";
  if (/nobody_left/.test(m)) return 'Everyone with tickets has already won.';
  if (/already_on/.test(m)) return 'Early access is already on for this event.';
  if (/event_started/.test(m)) return 'This event already started.';
  if (/forbidden|permission denied/i.test(m) || e.code === '42501') return "This account isn't a TD of this event.";
  return 'Something went wrong. Try again.';
}

/** Spots by registration order: how many are in, how many are left (null limit = no limit). */
export function spots(max: number | null | undefined, registered: number): { max: number; taken: number; left: number } | null {
  if (!max) return null;
  const taken = Math.min(registered, max);
  return { max, taken, left: max - taken };
}
