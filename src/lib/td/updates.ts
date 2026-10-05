/**
 * "What's new" on the TD home: the ONE list of release notes for TDs. Newest first.
 * Each entry points at the help section that explains it (help.ts ids). Add an entry in the same commit as the change.
 * **double stars** = bold, like help.ts.
 */
export interface Update { id: string; date: string; title: string; body: string; help?: string; who?: 'all' | 'tags' | 'admin' }

export const UPDATES: Update[] = [
  {
    id: 'tag-heat', date: '2026-10-04', help: 'tags', who: 'tags',
    title: 'Heat: time bombs, challenges, group chat',
    body: '**BAG TAGS → Heat** has three switches per tag set. **Time bombs** blow up idle top-5 tags after 7 days. **Challenges** let players call out anyone up to 5 spots above them (the 4th decline costs 5 spots). **Group chat** lives on My Tag. All three are on for Jewel XI Early Access.',
  },
  {
    id: 'ea-spots', date: '2026-10-04', help: 'early', who: 'all',
    title: 'Early access: first 50 registrants',
    body: '**EARLY ACCESS → Rules → SPOTS** limits early access to the first N registrants by registration order (Jewel XI: 50). The public page shows how many spots are left. Re-import the DGS CSV so the newest registrants appear.',
  },
  {
    id: 'vest-page', date: '2026-10-04', help: 'winners', who: 'all',
    title: 'The Safety Vest page + dubs vests',
    body: 'Each league award has its own page (Lazy Boners: **/leagues/lazy-boners/vest**): this week\'s holders, the group photo, **Most vests** and every week. On a dubs week, **LEAGUE WEEK** awards the winning team, so both partners wear it. Upload the award\'s picture in **LEAGUES → SETUP → AWARD ART**.',
  },
  {
    id: 'leagues', date: '2026-10-04', help: 'week2', who: 'tags',
    title: 'Leagues have a home: LEAGUES',
    body: 'Tap **LEAGUES** on your events list. Each league has **WEEKS** (**+ NEW WEEK** copies last week), **SETUP** (everything the Leagues page shows, live), **TAGS** and **TDS**. League TDs run every week of their league automatically.',
  },
  {
    id: 'publish-start', date: '2026-10-04', help: 'cards', who: 'all',
    title: 'PUBLISH is now PUBLISH & START',
    body: 'On **CARDS & QR**, the button that opens the round is now **PUBLISH & START**. Until you tap it the cards are a draft: no scoring, no QR codes. After that it reads **REPUBLISH** for late changes.',
  },
  {
    id: 'league-week', date: '2026-10-04', help: 'winners', who: 'all',
    title: 'Safety Vest + group photo',
    body: 'On a league night, **WINNERS → LEAGUE WEEK**: award the **Lazy Boner Safety Vest** and load the group photo. Every week lands on the **Vest Wall** on the Leagues page, and the current holder shows on the Lazy Boners card.',
  },
  {
    id: 'league-mode', date: '2026-10-04', help: 'setup', who: 'all',
    title: 'League mode + CTP holes',
    body: '**SETUP → Event or league**: a league drops PREP, CREW and EARLY ACCESS, runs one day and one round, and gets a **TAGS** tab for its tag set that opens on tonight\'s round. **CTP holes**: pick the hole and the prize; players get a gold **CTP HOLE** flash on their scorecard when they reach it.',
  },
  {
    id: 'tags-declared', date: '2026-10-03', help: 'rounds', who: 'all',
    title: 'Tags go on the line before you tee off',
    body: 'On the club scorecard, pick **Tags on the line?** on the New Round screen. It locks once the first score is in, and the round saves with the swap. Nobody can put tags on the line after seeing the scores.',
  },
  {
    id: 'league-other-sets', date: '2026-10-03', help: 'tags', who: 'tags',
    title: 'League nights can put Golden Boners on the line',
    body: 'Recording a league night now lists **OTHER TAG SETS ON THIS CARD**. Check Golden Boners (or any other set) to put it on the line from the same scores. It goes up pending, each holder confirms from **My Tag**, and it swaps on the last confirmation. Your own league\'s tags still move right away.',
  },
  {
    id: 'pending-boards', date: '2026-10-03', help: 'rounds', who: 'all',
    title: 'Tag boards show pending swaps',
    body: 'A swap waiting on confirmations shows on its board, re-ranked and marked **pending**, with a "Waiting on confirmation" list of who still has to confirm. Nothing moves for real until the last confirmation.',
  },
  {
    id: 'boner-rounds', date: '2026-10-03', help: 'rounds', who: 'all',
    title: 'Club scorecard + Boner Rounds',
    body: 'Anyone can keep a casual round at **barebonesdiscgolf.club/scorecard**. Members save it with their My Tag link, and it shows on **Boner Rounds** (Rounds in the site menu) with each member\'s confirmation.',
  },
  {
    id: 'course-names', date: '2026-10-03', help: 'setup', who: 'all',
    title: 'More courses, real hole names',
    body: 'The course library picked up Buffalo Ridge (Outside Ring), Skunk Creek, Red Mountain North 2.0, Paseo Vista and Los Olivos from UDisc exports. Layouts can carry the course\'s own hole names (Buffalo Ridge plays 1–5, **A–H**, 7, 14–18) and feet, and the scorecard shows them.',
  },
  {
    id: 'band', date: '2026-10-02', help: 'band', who: 'admin',
    title: 'Meet the Band',
    body: 'Character cards for the event admins on the Jewel XI site. Manage them from **THE BAND** on your events list.',
  },
  {
    id: 'votes', date: '2026-10-02', help: 'prep', who: 'all',
    title: 'Design votes for the crew',
    body: '**PREP → VOTES**: put 2+ designs on a ballot, crew vote from their link, you see who picked what. The Jewel XI trophy vote is live.',
  },
  {
    id: 'stations', date: '2026-10-01', help: 'crew', who: 'all',
    title: 'Volunteer stations',
    body: '**CREW → STATIONS**: a grid of stations by day and AM/PM with headcounts. Place people, or let crew claim open spots from their link. Double-booking is flagged ⚠.',
  },
  {
    id: 'crew', date: '2026-09-29', help: 'crew', who: 'all',
    title: 'Crew links',
    body: 'Private links for helpers: announcements with "Got it" receipts, tasks, check-in, raffle sales, card requests and sponsor leads.',
  },
  {
    id: 'dubs', date: '2026-09-29', help: 'cards', who: 'all',
    title: 'Random draw doubles',
    body: 'Each round can be singles or random draw dubs: **DRAW PARTNERS**, team cards, team leaderboard and dubs payouts.',
  },
];

/** Updates this TD should see (league-admin and super-admin notes only for them). */
export function updatesFor(u: Update[], opts: { admin: boolean; tagAdmin: boolean }): Update[] {
  return u.filter((x) => !x.who || x.who === 'all' || (x.who === 'tags' && (opts.tagAdmin || opts.admin)) || (x.who === 'admin' && opts.admin));
}

/** How many are newer than the last one this TD has seen (by position: the list is newest first). */
export function unseenCount(list: Update[], lastSeenId: string | null): number {
  if (!lastSeenId) return list.length;
  const i = list.findIndex((x) => x.id === lastSeenId);
  return i < 0 ? list.length : i;
}
