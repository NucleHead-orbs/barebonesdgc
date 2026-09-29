/**
 * Leagues & Pop Ups (/leagues). Source of truth:
 *   - League facts (who runs it, when, where): LEAGUES below (Mike, 2026-09-28/29). Retired leagues stay off the site.
 *   - Scores / next Pop Up: the `events` table. A league's "This week's scores" = its newest non-archived event that
 *     has started; the next Pop Up = the soonest non-archived event with "Pop Up" in its name that hasn't ended.
 *     Nothing to show -> the button/card falls back (never a dead link).
 */
export interface League {
  id: string; name: string; tag: string; title: string; scrawl: string;
  runBy: string; startedBy?: string; when: string; where: string; whereNote?: string;
  buyIn: string | null; // null = hidden until the TD supplies it
  eventPrefixes: string[]; // lowercase; an event whose name starts with one of these belongs to this league
  banner?: string; logos?: Array<{ src: string; alt: string }>;
}

export const LEAGUES: League[] = [
  {
    id: 'lazy', name: 'Lazy Boners', tag: 'Club league', title: 'Lazy Boners', scrawl: 'Minimum effort. Maximum Boner.',
    runBy: 'T-Bone', startedBy: 'T-Bone & Fixer', when: 'Sundays · 7:30 AM',
    where: 'Traveling league', whereNote: 'Course rotates. The group posts where.',
    buyIn: null, eventPrefixes: ['lazy boners'], banner: '/assets/leagues/lazy-boners-banner.webp',
  },
  {
    id: 'rbfl', name: 'RBFL', tag: 'Root Beer Float League', title: 'Root Beer Float League', scrawl: 'Float on, Boners.',
    runBy: 'George', when: 'Thursdays · 4:30 PM', where: 'Emerald Park',
    buyIn: null, eventPrefixes: ['rbfl', 'root beer float'],
    logos: [
      { src: '/assets/leagues/rbfl-logo.webp', alt: 'RBFL logo' },
      { src: '/assets/leagues/root-beer-float-league-logo.webp', alt: 'Root Beer Float League logo' },
    ],
  },
];

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

export interface PublicEvent { slug: string; name: string; starts_on: string; ends_on: string | null; archived: boolean }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Local calendar date as YYYY-MM-DD (Mesa has no DST, but this uses whatever the viewer's clock says). */
export function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Newest non-archived event of this league that has started (by starts_on, then name). null = hide the button. */
export function leagueEvent(league: Pick<League, 'eventPrefixes'>, events: PublicEvent[], today: string): PublicEvent | null {
  const prefixes = league.eventPrefixes.map(norm);
  const mine = events.filter((e) => !e.archived && e.starts_on <= today && prefixes.some((p) => norm(e.name).startsWith(p)));
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
