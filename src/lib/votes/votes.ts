/**
 * Design votes: pure helpers (no Supabase).
 * Source of truth: design_polls (closes_at, closed_at, winner) + design_poll_options (designs on the ballot)
 * + design_poll_votes (one per crew member or TD, changeable while open).
 * Crew get a Ballot from crew_polls (totals only after they vote, or once closed). TDs read the raw rows (with names).
 */

export interface BallotOption {
  id: string; asset_id: string; title: string; notes: string | null;
  /** null until the viewer has voted (or the poll closed). */
  votes: number | null;
  file: { id: string; version: number; file_name: string; mime: string | null } | null;
}
export interface Ballot {
  id: string; title: string; question: string | null; closes_at: string | null; open: boolean;
  winner_option_id: string | null;
  mine: { option_id: string; comment: string | null; updated_at: string } | null;
  total: number | null;
  options: BallotOption[];
}

export interface PollOption { id: string; poll_id: string; asset_id: string; sort: number }
export interface PollVote { id: string; poll_id: string; option_id: string; crew_id: string | null; td_email: string | null; comment: string | null; updated_at: string }
export interface Poll {
  id: string; event_id: string; title: string; question: string | null;
  closes_at: string | null; closed_at: string | null; winner_option_id: string | null;
  created_by: string | null; created_at: string;
  options: PollOption[]; votes: PollVote[];
}

export const MAX_COMMENT = 280;

/** Open = not closed by the TD and the deadline (if any) hasn't passed. Same rule as the database. */
export const isOpen = (p: Pick<Poll, 'closed_at' | 'closes_at'>, now = new Date()) =>
  !p.closed_at && (!p.closes_at || new Date(p.closes_at).getTime() > now.getTime());

const fmtWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function statusLabel(p: Pick<Poll, 'closed_at' | 'closes_at'>, now = new Date()): string {
  if (isOpen(p, now)) return p.closes_at ? `Open · closes ${fmtWhen(p.closes_at)}` : 'Open · no deadline';
  if (p.closed_at) return `Closed ${fmtWhen(p.closed_at)}`;
  return `Closed ${fmtWhen(p.closes_at!)} (deadline)`;
}

export interface Voter { name: string; td: boolean; comment: string | null; at: string }
export interface Row { option: PollOption; count: number; pct: number; voters: Voter[] }

/** TD tally: one row per option (ballot order), with who voted for it. */
export function tally(p: Poll, crewName: (id: string) => string | undefined): { rows: Row[]; total: number; leaders: string[] } {
  const total = p.votes.length;
  const rows = p.options.slice().sort((a, b) => a.sort - b.sort).map((option) => {
    const vs = p.votes.filter((v) => v.option_id === option.id);
    const voters = vs.map((v) => ({
      name: v.crew_id ? (crewName(v.crew_id) ?? 'Removed crew member') : (v.td_email ?? '?'),
      td: !v.crew_id, comment: v.comment, at: v.updated_at,
    })).sort((a, b) => a.name.localeCompare(b.name));
    return { option, count: vs.length, pct: total ? Math.round((vs.length / total) * 100) : 0, voters };
  });
  const top = Math.max(0, ...rows.map((r) => r.count));
  return { rows, total, leaders: top ? rows.filter((r) => r.count === top).map((r) => r.option.id) : [] };
}

/** Crew who haven't voted yet (live links only), alphabetical. */
export function notVoted<T extends { id: string; name: string; revoked_at?: string | null }>(p: Pick<Poll, 'votes'>, crew: T[]): T[] {
  const voted = new Set(p.votes.map((v) => v.crew_id).filter(Boolean));
  return crew.filter((c) => !c.revoked_at && !voted.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));
}

/** Crew results bars: percent per option + who's leading. Empty when totals are hidden. */
export function ballotBars(b: Ballot): { pct: Record<string, number>; leaders: string[] } {
  if (b.total == null) return { pct: {}, leaders: [] };
  const pct = Object.fromEntries(b.options.map((o) => [o.id, b.total ? Math.round(((o.votes ?? 0) / b.total) * 100) : 0]));
  const top = Math.max(0, ...b.options.map((o) => o.votes ?? 0));
  return { pct, leaders: top ? b.options.filter((o) => o.votes === top).map((o) => o.id) : [] };
}

/** Open ballots the crew member hasn't voted on yet (the tab badge). */
export const waiting = (bs: Ballot[]) => bs.filter((b) => b.open && !b.mine).length;

export const isImageFile = (f: { mime: string | null; file_name: string } | null) =>
  !!f && (/^image\//.test(f.mime ?? '') || /\.(png|jpe?g|webp|gif)$/i.test(f.file_name));

/** datetime-local <-> ISO, in the browser's time zone. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** A datetime-local value that is already in the past (re-checked on every render of the form). */
export const isPastLocal = (v: string, now = new Date()) => !!v && new Date(v).getTime() <= now.getTime();
export const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

/** The crew announcement for a new poll. */
export function announcement(p: Pick<Poll, 'title' | 'question' | 'closes_at'>): { title: string; body: string } {
  return {
    title: `Vote: ${p.title}`.slice(0, 120),
    body: [p.question, 'Open the VOTE tab on your crew link, pick one, and add a comment if you want. You can change your vote until it closes.',
      p.closes_at ? `Voting closes ${fmtWhen(p.closes_at)}.` : null].filter(Boolean).join('\n\n'),
  };
}

/** Friendly text for vote errors (crew + TD). */
export function voteMessage(m: string): string | null {
  if (/poll_closed/.test(m)) return 'Voting on this one is closed.';
  if (/not_an_option/.test(m)) return 'That design isn\'t on the ballot anymore. Refresh and pick again.';
  if (/comment_too_long/.test(m)) return `Comments max out at ${MAX_COMMENT} characters.`;
  if (/winner_not_an_option/.test(m)) return 'The winner has to be one of the designs on this ballot.';
  if (/design_poll_votes_option_id_poll_id_fkey|has_votes/.test(m)) return 'That design already has votes on a ballot. Delete the poll first if you really want it gone.';
  return null;
}
