/**
 * Crew view: pure helpers + the role briefings (the ONE source for what each crew role does).
 * Source of truth: crew / announcements / announcement_reads / raffle_sales / contacts (see migration crew).
 * Crew act only through token RPCs (crew_*); these helpers never decide permissions, they mirror them for display.
 */
import { voteMessage } from '../votes/votes';


export const ROLES = ['checkin', 'raffle', 'requests', 'contacts'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  checkin: 'Check-in', raffle: 'Raffle', requests: 'Card requests', contacts: 'Contacts & sponsors',
};

/** Plain-language how-to per role, shown on the crew Briefing so people learn it before the weekend. */
export const ROLE_GUIDE: Record<Role | 'general', { title: string; steps: string[] }> = {
  general: {
    title: 'Everyone',
    steps: [
      'Read every announcement and tap **Got it**, so the TD knows you saw it.',
      '**Stations** shows where you\'re working each shift (AM and PM, every day). See an open spot you can cover? Tap **CLAIM**. You can **DROP** a spot you claimed; spots the TD gave you, ask the TD to change.',
      '**Tasks** shows the whole checklist. Tick the ones with your name on them when they\'re done.',
      'Anything to report on a task (a problem, a pickup time, a receipt)? Tap it and post an update.',
      'This link is yours. Don\'t forward it. If you lose it, the TD can send you a new one.',
    ],
  },
  checkin: {
    title: 'Check-in',
    steps: [
      'Search the player\'s name and tap **CHECK IN**. Tap again to undo a mistake.',
      'Not on the list? Use **Walk-up**: type the name, pick the division, tap **ADD + CHECK IN**.',
      'Only checked-in players get put on cards, so check in everyone who is actually here.',
    ],
  },
  raffle: {
    title: 'Raffle',
    steps: [
      'Every sale: tickets, dollars, cash or card, and the buyer\'s name if you have it. Tap **LOG SALE**.',
      'Made a mistake? **VOID** your own sale. It stays on the record, crossed out.',
      'The running total at the top is everyone\'s sales. The TD adds it to the prize pool.',
    ],
  },
  requests: {
    title: 'Card requests',
    steps: [
      'Players who want to play together: pick 2–5 names and tap **SEND REQUEST**.',
      'Add a short note if it helps ("carpool", "dad + son").',
      'The TD approves or declines. You\'ll see the status next to each request.',
    ],
  },
  contacts: {
    title: 'Contacts & sponsors',
    steps: [
      'Know a possible sponsor or vendor? **Add a lead** with their name, business and how to reach them.',
      'The TD reviews new leads. Once it\'s approved and yours, update the status as you go: asked, yes, no, paid.',
      'Put what they said in the notes so nobody asks them twice.',
    ],
  },
};

export interface Announcement { id: string; title: string; body: string; roles: Role[]; pinned: boolean; created_at: string; updated_at: string }
export interface CrewMember { id: string; name: string; roles: Role[]; token?: string; last_seen_at?: string | null; revoked_at?: string | null }

/** Who an announcement is for: roles = [] means everyone. */
export const forCrew = (a: Pick<Announcement, 'roles'>, c: Pick<CrewMember, 'roles'>) =>
  a.roles.length === 0 || a.roles.some((r) => c.roles.includes(r));

/** Read receipts for one announcement: who it's for, who tapped Got it, who hasn't. */
export function receipts(a: Pick<Announcement, 'id' | 'roles'>, crew: CrewMember[], reads: Array<{ announcement_id: string; crew_id: string }>) {
  const audience = crew.filter((c) => !c.revoked_at && forCrew(a, c));
  const got = new Set(reads.filter((r) => r.announcement_id === a.id).map((r) => r.crew_id));
  return {
    audience: audience.length,
    read: audience.filter((c) => got.has(c.id)).map((c) => c.name),
    missing: audience.filter((c) => !got.has(c.id)).map((c) => c.name),
  };
}

/** Crew member readiness: how many of the announcements meant for them they've acknowledged. */
export function readiness(c: CrewMember, anns: Announcement[], reads: Array<{ announcement_id: string; crew_id: string }>) {
  const mine = anns.filter((a) => forCrew(a, c));
  const got = new Set(reads.filter((r) => r.crew_id === c.id).map((r) => r.announcement_id));
  return { total: mine.length, read: mine.filter((a) => got.has(a.id)).length };
}

export const crewLink = (origin: string, token: string) => `${origin.replace(/\/+$/, '')}/crew/${token}`;

export function audienceLabel(roles: Role[]): string {
  return roles.length ? roles.map((r) => ROLE_LABEL[r]).join(' + ') : 'Everyone';
}

// ---------- raffle ----------
export interface RaffleSale { id: string; buyer: string | null; tickets: number; amount: number; method: 'cash' | 'card' | 'other'; created_at: string; voided_at: string | null; logged_by?: string }
export function raffleTotals(sales: RaffleSale[]) {
  const live = sales.filter((s) => !s.voided_at);
  const by = (m: RaffleSale['method']) => round2(live.filter((s) => s.method === m).reduce((a, s) => a + Number(s.amount), 0));
  return {
    total: round2(live.reduce((a, s) => a + Number(s.amount), 0)),
    tickets: live.reduce((a, s) => a + s.tickets, 0),
    cash: by('cash'), card: by('card'), other: by('other'),
    sales: live.length, voided: sales.length - live.length,
  };
}
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Sale form -> RPC args, or a message the volunteer can act on. */
export function saleProblem(tickets: string, amount: string): string | null {
  const t = Number(tickets), a = Number(amount);
  if (!Number.isInteger(t) || t < 1 || t > 1000) return 'Tickets: a whole number from 1 to 1000.';
  if (!amount.trim() || !Number.isFinite(a) || a < 0 || a > 10000) return 'Amount: dollars, 0 to 10,000.';
  return null;
}

// ---------- contacts ----------
export const CONTACT_STATUSES = ['lead', 'to_ask', 'asked', 'yes', 'no', 'paid'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];
export const STATUS_LABEL: Record<ContactStatus, string> = {
  lead: 'New lead', to_ask: 'To ask', asked: 'Asked', yes: 'Yes', no: 'No', paid: 'Paid',
};
export const CONTACT_KINDS = ['sponsor', 'vendor', 'other'] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];
export const KIND_LABEL: Record<ContactKind, string> = { sponsor: 'Sponsor', vendor: 'Vendor', other: 'Other' };

/** Statuses an owner (crew) can move a contact to. A lead waits for the TD. */
export const crewNextStatuses = (s: ContactStatus): ContactStatus[] =>
  s === 'lead' ? [] : (['to_ask', 'asked', 'yes', 'no', 'paid'] as ContactStatus[]);

export interface Contact {
  id: string; kind: ContactKind; name: string; org: string | null; phone: string | null; email: string | null;
  status: ContactStatus; amount: number | null; notes: string | null; crew_id?: string | null; sponsor_id?: string | null;
  created_by?: string | null; updated_at: string;
}
export function contactRollup(cs: Array<Pick<Contact, 'kind' | 'status' | 'amount'>>) {
  const sp = cs.filter((c) => c.kind === 'sponsor');
  const sum = (xs: typeof sp) => round2(xs.reduce((a, c) => a + Number(c.amount ?? 0), 0));
  return {
    leads: cs.filter((c) => c.status === 'lead').length,
    sponsorsYes: sp.filter((c) => c.status === 'yes' || c.status === 'paid').length,
    pledged: sum(sp.filter((c) => c.status === 'yes' || c.status === 'paid')),
    paid: sum(sp.filter((c) => c.status === 'paid')),
    open: cs.filter((c) => c.status === 'to_ask' || c.status === 'asked').length,
  };
}

/** Crew-side RPC errors -> something a volunteer can act on. */
export function crewMessage(err: unknown): string {
  const e = (err && typeof err === 'object' ? err : {}) as { message?: string };
  const m = e.message ?? String(err);
  if (/invalid_link/.test(m)) return 'This link doesn\'t work anymore. Ask the TD for a new one.';
  if (/event_closed/.test(m)) return 'This event is closed. Thanks for helping!';
  if (/not_your_role/.test(m)) return 'That isn\'t one of your jobs for this event. Ask the TD if it should be.';
  if (/not_your_task/.test(m)) return 'Only the person a task is assigned to can tick it. Post an update instead.';
  if (/not_your_sale/.test(m)) return 'You can only void your own sales, once.';
  if (/lead_needs_td/.test(m)) return 'New leads wait for the TD to review them first.';
  if (/invalid_division/.test(m)) return 'Pick a division.';
  if (/invalid_request/.test(m)) return 'Pick 2 to 5 players (note: 140 characters max).';
  if (/unknown_player/.test(m)) return 'That player isn\'t in this event. Refresh and try again.';
  if (/station_full/.test(m)) return 'That spot just filled up. Pick another open one.';
  if (/already_there/.test(m)) return 'You\'re already on that station for that shift.';
  if (/not_your_claim/.test(m)) return 'You can only drop spots you claimed. Ask the TD to move a spot they assigned.';
  const vm = voteMessage(m);
  if (vm) return vm;
  if (/invalid_note/.test(m)) return 'Write something first (1,000 characters max).';
  if (/check constraint|invalid input/.test(m)) return 'Something in that form isn\'t valid. Check the numbers and try again.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'No signal. Nothing was saved. Try again in a moment.';
  return `Something went wrong: ${m}`;
}
