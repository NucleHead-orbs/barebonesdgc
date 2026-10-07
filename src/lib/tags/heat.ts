/**
 * Tag heat (migration 20261028): time bombs on the top 5, challenges, group chat. The rules live in the database; this is
 * types + pure display helpers. Switches are per tag set (TD: BAG TAGS).
 */
export interface HeatChallenge {
  id: string; status: 'open' | 'accepted' | 'declined' | 'expired' | 'cancelled' | 'played' | 'lapsed'; mine: boolean;
  other: { id: string; name: string; nickname: string | null; number: number | null } | null;
  created_at: string; expires_at: string; due_at: string | null; responded_at: string | null;
}
export interface HeatTarget { member_id: string; name: string; nickname: string | null; number: number }
/** One tag_heat row: the set's switches + this player's fuse, declines, challenge targets and challenges. */
export interface HeatRow {
  pool_id: string; pool: string; bombs: boolean; challenges: boolean; chat: boolean; number: number; top5: boolean;
  fuse_at: string | null; declines: number; targets: HeatTarget[]; list: HeatChallenge[]; last_chat: number | null;
}

/** One Board line. kind 'system' = the house posting news (event says what); member_id is null then. */
export interface ChatLine {
  id: number; member_id: string | null; name: string | null; nickname: string | null; body: string; at: string; number: number | null; hidden: boolean;
  kind?: 'chat' | 'system'; event?: string | null; mentions?: Array<{ id: string; label: string }>;
}
export interface BoardHeat {
  bombs: boolean; challenges: boolean; chat: boolean;
  fuses: Array<{ number: number; fuse_at: string }>;
  live: Array<{ status: 'open' | 'accepted'; from: string; to: string; from_number: number | null; to_number: number | null; expires_at: string; due_at: string | null }>;
  declines: Record<string, number>;
  drops: Array<{ kind: 'bomb' | 'decline'; name: string | null; from: number; to: number; at: string }>;
}

export const FREE_DECLINES = 3;
export const DROP_PLACES = 5;

/** Time left until `iso`: "3d 4h", "5h 12m", "12m"; gone = already past. hot = under a day. */
export function timeLeft(iso: string | null, now: number): { label: string; hot: boolean; gone: boolean } | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return { label: '0m', hot: true, gone: true };
  const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  const label = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${mm}m` : `${mm}m`;
  return { label, hot: ms < 86_400_000, gone: false };
}

/** What a decline does now: free (n of 3) or the drop. */
export function declineNote(declines: number): string {
  return declines >= FREE_DECLINES
    ? `This is your 4th decline: you drop ${DROP_PLACES} spots.`
    : `Free decline ${declines + 1} of ${FREE_DECLINES}. The 4th drops you ${DROP_PLACES} spots.`;
}

/** Heat error codes -> plain words (falls back to tagMessage for the rest). */
export function heatMessage(m: string): string | null {
  if (/challenges_off/.test(m)) return 'Challenges are off for this tag set.';
  if (/out_of_range/.test(m)) return 'You can challenge up to 5 spots above you.';
  if (/one_at_a_time/.test(m)) return 'You already have a challenge out. Wait for it to finish (or cancel it).';
  if (/too_soon/.test(m)) return 'You challenged them in the last 7 days. Pick someone else for now.';
  if (/invalid_target/.test(m)) return "They don't hold a tag in this set anymore.";
  if (/not_your_challenge/.test(m)) return "That challenge isn't yours.";
  if (/challenge_expired/.test(m)) return 'Too late: 48 hours passed, so it counted as a decline.';
  if (/challenge_(\w+)/.test(m)) return 'That challenge was already answered.';
  if (/cannot_cancel/.test(m)) return "It's already been answered, so it can't be cancelled.";
  if (/chat_off/.test(m)) return 'The chat is off for this tag set.';
  if (/slow_down/.test(m)) return 'Easy, tiger. One message every few seconds.';
  if (/invalid_message/.test(m)) return 'Messages are 1 to 500 characters.';
  if (/needs_challenge/.test(m)) return 'Early Access tag rounds need 3 Jewel players, or 2 with a challenge you\'ve accepted.';
  if (/defender_picks/.test(m)) return 'The challenged player picks the time and course first.';
  if (/slot_too_soon/.test(m)) return 'Pick a time at least 2 hours out.';
  if (/slot_after_due/.test(m)) return 'Pick a time before the 7-day play-by date.';
  if (/slot_closed/.test(m)) return 'Too late: it locks 2 hours before tee time.';
  if (/other_player_oks/.test(m)) return 'The other player has to OK your pick.';
  if (/no_slot/.test(m)) return 'No time picked yet.';
  if (/not_open/.test(m)) return "That round isn't open for jump-ins (it needs a locked time first).";
  if (/round_full/.test(m)) return 'Card is full: 2 jump-ins max.';
  if (/already_in/.test(m)) return "You're already on that round.";
  if (/not_in/.test(m)) return "You're not on that round.";
  if (/invalid_days/.test(m)) return 'Pick days of the week.';
  if (/too_many_courses/.test(m)) return 'Three favorite courses max.';
  if (/unknown_course/.test(m)) return "That course isn't in the library anymore. Pick another.";
  if (/invalid_reaction/.test(m)) return "That reaction isn't on the menu.";
  return null;
}
