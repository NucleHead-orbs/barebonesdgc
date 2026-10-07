/**
 * "What's new" on the TD home: the ONE list of release notes for TDs. Newest first.
 * Each entry points at the help section that explains it (help.ts ids). Add an entry in the same commit as the change.
 * **double stars** = bold, like help.ts.
 */
export interface Update { id: string; date: string; title: string; body: string; help?: string; who?: 'all' | 'tags' | 'admin' }

export const UPDATES: Update[] = [
  {
    id: 'cards-of-10', date: '2026-10-07', help: 'tags', who: 'all',
    title: 'Supergroups: cards of 10',
    body: 'Casual cards go up to **10**: the Scorecard (and its live view), manual tag round submissions, casual round invites (invite up to 9) and challenge rounds (8 jump-ins). Tournament cards from the card builder stay 3 to 5.',
  },
  {
    id: 'casual-rounds', date: '2026-10-07', help: 'tags', who: 'tags',
    title: 'Casual round invites + cards of 6',
    body: 'My Tag → MATCHUPS has **INVITE A ROUND**: pick a time, a course and up to 5 players in the set, any spot on the board. Invited players get an @ ping; anyone in the set can grab an open seat, up to 6. No tags on the line unless the scorer puts them on at tee-off. Challenge rounds now take **4 jump-ins** (a card of 6).',
  },
  {
    id: 'r2-confirm', date: '2026-10-07', help: 'players', who: 'all',
    title: 'Round 2 confirm',
    body: 'Two-round events now confirm Round 2 separately, so bailers don\'t leave holes in cards. Right after a Round 1 card is submitted, it asks every player **Playing Round 2? IN / OUT**. The check-in table (Players or crew phones) has a **ROUND 2 CONFIRM** switch to set or change anyone. Round 2 cards only take players marked IN, and the Cards tab lists who hasn\'t answered.',
  },
  {
    id: 'event-day-flow', date: '2026-10-07', help: 'cards', who: 'all',
    title: 'Event day: waves, DVD inserts, pack bags',
    body: 'Two-wave events now generate and publish **one wave at a time**: the PM wave gets its cards after it checks in, and the AM wave (already scoring) is never touched. **QR SHEET** prints **DVD CASE INSERTS**: one card per case sleeve, two per page. **Prep → PACK BAGS** counts pre-packed bags by shirt size and prints A-to-Z bag labels; check-in (TD or crew phone) says which bag the moment someone is in.',
  },
  {
    id: 'card-handoff', date: '2026-10-07', help: 'scoring', who: 'all',
    title: 'Hand the card off',
    body: 'Event scorecards have a **HAND THE CARD OFF** button for passing scoring to a cardmate. It saves every score on the phone first, then shows a big QR (or a link) for the next scorer. The old phone goes watch-only until it taps **Take the card back**. Optional: scanning the paper card\'s QR still works like always.',
  },
  {
    id: 'roasts-mentions', date: '2026-10-07', help: 'tags', who: 'all',
    title: 'Round roasts + @mentions on the Board',
    body: 'Every applied tag round now posts to its set\'s Board with a roast written from the real numbers: **RESULTS** for regular rounds, the **SETTLED** post for challenges. Margins, aces, birdie runs, blow-up holes, bogey-free winners, last place, tag moves. Players can **@mention** each other on the Board (type **@**, pick a name). The name lights up and they get an **@** ping in their My Tag bell.',
  },
  {
    id: 'scorecard-app', date: '2026-10-06', help: 'rounds', who: 'all',
    title: 'Scorecard and My Tag as home-screen apps',
    body: 'The scorecard can live on your home screen now: a glowing-skull **Scorecard** icon that opens straight to a new card, full screen, no browser bars. The setup screen walks players through it (iPhone: Share → **Add to Home Screen**; Android: **Install the scorecard**). On a phone, My Tag has **ADD SCORECARD TO HOME SCREEN** and **ADD MY TAG TO HOME SCREEN** (a glowing-tag icon that opens the player\'s own My Tag). **Log a tag round** is now **Manual tag round submission** and no longer the big button: the Scorecard is the way in. iPhone apps keep their own memory, so players paste their My Tag link once inside (**Copy my link** → **Paste my link**).',
  },
  {
    id: 'courses-page', date: '2026-10-06', help: 'rounds', who: 'all',
    title: 'Courses page + write-ups',
    body: 'New **Courses** page on the club site: every course with its layouts (holes, par, feet), the hole-by-hole and Mike\'s write-up. The write-up also shows on the scorecard under the course picker (**About this course**). Added **DiscO at Eastmark** (Main par 63, Lower Pars par 55), **Freestone** and **Sun Ray Park DGC**.',
  },
  {
    id: 'live-reactions', date: '2026-10-05', help: 'rounds', who: 'all',
    title: 'Live rounds: razz and congrats',
    body: 'Anyone watching a live round can send a **razz** (skull rain, choke, trash, waaah) or a **congrats** (golf clap, on fire, GOAT, cheers) at one player or everyone. It plays over the scorer\'s card with who sent it. Viewers need their My Tag link on the phone; one every 15 seconds. The scorer can tap **Reactions on/off**.',
  },
  {
    id: 'live-vouch', date: '2026-10-05', help: 'rounds', who: 'all',
    title: 'Live rounds + league admins can vouch',
    body: 'Scorecard rounds now show **live** on the club home and Boner Rounds as scores go in (the scorer can switch **Share live** off on the setup screen). Tap a live round for the full card. **Vouch:** signed in as a league admin, open a saved round on Boner Rounds and tap **VOUCH: TAGS ON THE LINE** to put that set\'s tags on it, even a 2-player Early Access round or one that skipped the tags at tee-off. Everyone on it confirms on My Tag.',
  },
  {
    id: 'ea-invites', date: '2026-10-05', help: 'early', who: 'all',
    title: 'Early Access invites + a welcome tour',
    body: '**EARLY ACCESS → Invites**: give early access to people who aren\'t registered. Type the name, tap **INVITE**, then **TEXT IT** (opens your messages with the note and link written), **COPY LINK** or **PRINT CARD** (a big QR they scan with their camera). Invites get tickets, count as Jewel players, and don\'t use registrant spots. New players also get a 3-step welcome on My Tag (**HOW IT WORKS** brings it back).',
  },
  {
    id: 'challenge-rounds', date: '2026-10-05', help: 'tags', who: 'tags',
    title: 'Challenge rounds: time, course, jump-ins',
    body: 'An accepted challenge now gets a **time and course**: the challenged player picks, the challenger OKs (or counters). Once locked it posts to the Board and anyone with a tag in the set can **JUMP IN** from MATCHUPS (2 max, their tags on the line). Jump-ins close 2 hours before tee time.',
  },
  {
    id: 'ea-challenge-rounds', date: '2026-10-05', help: 'early', who: 'all',
    title: 'Early Access: 3 players, or an accepted challenge',
    body: 'Early Access rounds still need **3 Jewel players** to move tags or earn tickets. New: **2 players count when it\'s an accepted challenge** between them. Any other 2-player round can\'t put Early Access tags on the line. Other tag sets are unchanged.',
  },
  {
    id: 'tag-board', date: '2026-10-05', help: 'tags', who: 'tags',
    title: 'My Tag: BOARD and MATCHUPS tabs',
    body: 'My Tag now has three tabs. **BOARD**: one message board per tag set (pick the set up top), reactions (tap a count to see who), and the house posts challenges, results, explosions and penalties on its own. **MATCHUPS**: players share their days and favorite courses; the Matchmaker suggests their best opponents with one-tap **CHALLENGE**, and posts the week\'s hottest matchups every Monday.',
  },
  {
    id: 'skull', date: '2026-10-05', help: 'trouble', who: 'all',
    title: 'The skull: report bugs and ideas from any page',
    body: 'Every page has a little **skull** (bottom left; top right on phone scorecards and My Tag). Tap it to send a **bug**, an **idea** or **feedback**, with a screenshot if you like. Your name, the page and the device go with it. Fixes show up under **Dev reports** below and on the club home.',
  },
  {
    id: 'heat-bell', date: '2026-10-05', help: 'tags', who: 'tags',
    title: 'My Tag: chat + challenge icons',
    body: 'Top right of My Tag: a **chat** icon with the number of new messages and a **challenge** icon (red, pulsing) when someone has called you out. Tap either to jump straight there.',
  },
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
