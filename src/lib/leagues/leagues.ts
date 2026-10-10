/**
 * Leagues & Pop Ups (/leagues). Source of truth:
 *   - Leagues: the `leagues` table (migration 20261024). The league's TDs edit name, tagline, who runs it, when, where, cost,
 *     award and banner/logo in the TD Builder (LEAGUES), and /leagues shows them live. Hidden leagues stay off the site.
 *   - Weeks: events with league_id = the league. "This week's scores" = its newest non-archived week that has started.
 *   - Next Pop Up = the soonest non-archived event with "Pop Up" in its name that hasn't ended.
 *     Nothing to show -> the button/card falls back (never a dead link).
 */
export interface League {
  id: string; slug: string; name: string;
  subtitle: string | null; title: string | null; scrawl: string | null;
  run_by: string | null; started_by: string | null; when_text: string | null; where_text: string | null; where_note: string | null;
  buy_in: string | null; award: string | null;
  banner: string | null; logo: string | null; // '/assets/...' (built in) or '<league_id>/...' in the league-photos bucket
  award_image?: string | null; // the award's art (e.g. the Safety Vest), same rules as banner/logo
  tag_pool_id: string; hidden: boolean; sort: number;
  /** Runs its own tag set (false = no tags; the set stays hidden as the league's TD list). Migration 20261126. */
  tags: boolean;
  /** Every NEW WEEK starts with these (null = copy the week before). */
  week_format: 'singles' | 'doubles' | null; week_layout_id: string | null;
}
/** The MVP board of a doubles league: most wins (a tie for first = a win for each), then podiums. */
export interface LeagueMvp { weeks: number; players: Array<{ name: string; weeks: number; wins: number; podiums: number; best: number | null }> }
export const LEAGUE_COLS = 'id, slug, name, subtitle, title, scrawl, run_by, started_by, when_text, where_text, where_note, buy_in, award, banner, logo, award_image, tag_pool_id, hidden, sort, tags, week_format, week_layout_id';

/** Text fields a league TD edits (League setup), in screen order. */
export const LEAGUE_FIELDS: Array<{ key: keyof League; label: string; max: number; hint?: string }> = [
  { key: 'name', label: 'NAME', max: 40, hint: 'Short: the chip + card header (and the tag set\'s name)' },
  { key: 'subtitle', label: 'TAGLINE', max: 60, hint: 'e.g. Club league' },
  { key: 'title', label: 'BIG TITLE', max: 80 },
  { key: 'scrawl', label: 'SCRAWL', max: 80, hint: 'The handwritten line' },
  { key: 'run_by', label: 'RUNS IT', max: 60 },
  { key: 'started_by', label: 'STARTED BY', max: 60 },
  { key: 'when_text', label: 'WHEN', max: 60, hint: 'e.g. Sundays · 7:30 AM' },
  { key: 'where_text', label: 'WHERE', max: 80 },
  { key: 'where_note', label: 'WHERE NOTE', max: 120 },
  { key: 'buy_in', label: 'COST', max: 60, hint: 'Blank hides it' },
  { key: 'award', label: 'WEEKLY AWARD', max: 60, hint: 'e.g. Lazy Boner Safety Vest. Blank = no award or vest wall' },
];

/** "Thursday Thumpers!" -> "thursday-thumpers" (the league + tag set slug; fixed once created). */
export function leagueSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}
export const validSlug = (s: string) => /^[a-z0-9][a-z0-9-]{1,39}$/.test(s);

/** Default name for a new week: "Lazy Boners · Oct 11" (matches the database default). */
export function weekName(league: Pick<League, 'name'>, iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${league.name} · ${new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

/** How a Pop Up runs (the club's standing format). */
export const POPUP_FORMAT: Array<{ date: string; title: string }> = [
  { date: '8:30', title: 'Check in' },
  { date: '9:00', title: 'Players meeting, tee off' },
  { date: 'Round 1', title: 'Doubles' },
  { date: 'Break', title: 'Lunch' },
  { date: 'Round 2', title: 'Singles tag round' },
];

export const POPUPS_PAST: Array<{ src: string; date: string; title: string; alt: string }> = [
  { src: '/assets/leagues/popup-2016-03-greenfield.webp', date: 'Mar 26, 2016', title: 'Boner Pop Up · Greenfield Park', alt: '2016 March Boner Pop Up flier, Greenfield Park' },
  { src: '/assets/leagues/popup-2017-09-baby-bonehead.webp', date: 'Sep 16, 2017', title: 'Baby Bonehead Pop Out · Carriage Lane Park', alt: 'Baby Bonehead Pop Out Pop Up flier' },
  { src: '/assets/leagues/popup-2017-12-final-boner.webp', date: 'Dec 16, 2017', title: 'Final Boner Pop Up · Carriage Lane Park', alt: 'Final Boner Pop Up of the Year 2017 flier' },
  { src: '/assets/leagues/popup-2018-01-tag-release.webp', date: 'Jan 13, 2018', title: 'Tag Release Party · Greenfield Park', alt: '2018 Boner Tag Release Party flier, Greenfield Park' },
  { src: '/assets/leagues/popup-2018-12-tag-battle-finale.webp', date: 'Dec 15, 2018', title: 'Tag Battle Finale · Fiesta Lakes', alt: '2018 Tag Battle Finale flier' },
];

export interface PublicEvent { slug: string; name: string; starts_on: string; ends_on: string | null; archived: boolean; league_id?: string | null }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Local calendar date as YYYY-MM-DD (Mesa has no DST, but this uses whatever the viewer's clock says). */
export function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Newest non-archived week of this league that has started (by starts_on, then name). null = hide the button. */
export function leagueEvent(leagueId: string, events: PublicEvent[], today: string): PublicEvent | null {
  const mine = events.filter((e) => !e.archived && e.starts_on <= today && e.league_id === leagueId);
  mine.sort((a, b) => b.starts_on.localeCompare(a.starts_on) || a.name.localeCompare(b.name));
  return mine[0] ?? null;
}

/** Soonest non-archived "Pop Up" event that hasn't ended (today counts). null = "Watch the Facebook group". */
export function nextPopUp(events: PublicEvent[], today: string): PublicEvent | null {
  const ups = events.filter((e) => !e.archived && /\bpop ?up\b/.test(norm(e.name)) && (e.ends_on ?? e.starts_on) >= today);
  ups.sort((a, b) => a.starts_on.localeCompare(b.starts_on) || a.name.localeCompare(b.name));
  return ups[0] ?? null;
}

/** "2026-11-07" -> "Sat, Nov 7" (date only, no timezone shift). */
export function niceDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** One league week on the wall (league_weeks RPC): who got the award, the shout-out, the group photo (storage path). */
export interface LeagueWeek { slug: string; name: string; starts_on: string; vest: string | null; vest_note: string | null; photo: string | null }

/** This week's award holder: the newest week that has one. */
export const currentHolder = (weeks: LeagueWeek[]): LeagueWeek | null => weeks.find((w) => w.vest) ?? null;

/** The vest page (league_vest_page): every week with a vest or a photo, newest first, and the most-vests board. */
export interface VestWeek { slug: string; name: string; starts_on: string; course: string | null; holders: string[]; note: string | null; photo: string | null }
export interface VestPageData {
  league: Pick<League, 'id' | 'slug' | 'name' | 'award' | 'banner' | 'logo'> & { award_image: string | null };
  weeks: VestWeek[]; board: Array<{ name: string; weeks: number; last_on: string }>;
}
/** This week's holders: the newest week that has any. */
export const currentVest = (weeks: VestWeek[]): VestWeek | null => weeks.find((w) => w.holders.length > 0) ?? null;
/** "Alex", "Alex & Bo" */
export const holderNames = (names: string[]) => names.join(' & ');
/** Rank labels for the board: ties share a place ("T2"). */
export function boardPlaces(rows: Array<{ weeks: number }>): string[] {
  return rows.map((r) => {
    const first = rows.findIndex((x) => x.weeks === r.weeks);
    const tied = rows.filter((x) => x.weeks === r.weeks).length > 1;
    return `${tied ? 'T' : ''}${first + 1}`;
  });
}

/** Dubs week: the low team (lowest to-par with holes in). null = nobody's in yet, or 1st is tied. */
export function teamLeader(rows: Array<{ team_id: string; to_par: number | null; holes_played: number }>): string | null {
  const scored = rows.filter((r) => r.to_par !== null && r.holes_played > 0);
  if (!scored.length) return null;
  const best = Math.min(...scored.map((r) => r.to_par as number));
  const top = scored.filter((r) => r.to_par === best);
  return top.length === 1 ? top[0].team_id : null;
}

/** Who's winning the week (lowest to-par with holes in). null = nobody's in yet, or 1st is tied (the TD picks). */
export function weekLeader(rows: Array<{ player_id: string; r1_to_par: number | null; hole_count: number }>): string | null {
  const scored = rows.filter((r) => r.r1_to_par !== null && r.hole_count > 0);
  if (!scored.length) return null;
  const best = Math.min(...scored.map((r) => r.r1_to_par as number));
  const top = scored.filter((r) => r.r1_to_par === best);
  return top.length === 1 ? top[0].player_id : null;
}
