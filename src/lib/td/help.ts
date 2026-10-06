/**
 * In-app TD help: the ONE source for TD instructions (the /td HELP button renders this).
 * Written for someone who has never used the tool. **double stars** = bold button names.
 * When a screen changes, change its section here in the same commit.
 */
export interface HelpSection { id: string; title: string; steps: string[] }

export const HELP: HelpSection[] = [
  {
    id: 'start', title: 'Getting in',
    steps: [
      'Your organizer adds your email to your event. You only ever see your own events.',
      'First time: on this page tap **"New TD? Create an account"**, use that same email, make a password (8+ characters).',
      'Open the confirmation email (check spam) and tap **Confirm your email**, then come back and **SIGN IN**.',
      'Tap **OPEN** on your event.',
    ],
  },
  {
    id: 'setup', title: 'Set up your event (SETUP tab)',
    steps: [
      '**Event or league week:** a tournament keeps **PREP**, **CREW** and **EARLY ACCESS**. A **LEAGUE WEEK** drops those, is one day and one round, and gets a **TAGS** tab for its league\'s tag set. Weeks made from **LEAGUES → + NEW WEEK** are set already; to attach an older event, pick **LEAGUE WEEK** and the league, tap **SAVE**.',
      '**Event:** name, club, dates, colors, rounds (1 or 2), waves (single or AM/PM), check-in on/off. Tap **SAVE EVENT**.',
      '**Course:** pick your course from the **library** list and tap **LOAD**: par, feet, OB and mandos fill in. Not listed? Type the holes, tap **SAVE COURSE**, then **SAVE TO LIBRARY** so every TD can use it next time.',
      'Loading copies the holes into your event. Fixing the library later never changes an event you already ran.',
      'Some layouts carry the course\'s own hole names and feet (Buffalo Ridge Outside Ring plays 1–5, A–H, 7, 14–18). The club scorecard shows them. Have a UDisc scorecard export (CSV) or a screenshot of a layout? Send it to Mike and it goes in the library, marked unverified until an admin taps **Verify**.',
      '**Extra tee pads:** holes with a second pad (Rec / Ladies, AM) get one row each. Enter its feet, and par if it differs. Each pad is its own tee sign a sponsor can take. Scoring is still by hole.',
      '**Divisions:** tap the ones you use. Tap **SAVE DIVISIONS**.',
      '**Round format:** each round is **SINGLES** or **RANDOM DRAW DUBS**, plus the dubs style (best shot, best disc, alternate shot). A Pop Up is usually Round 1 dubs, Round 2 singles. Locked once that round has cards.',
      '**CTP holes:** pick a hole, type what it pays ("$20 + a disc"), tap **ADD CTP**. Players get a gold **CTP HOLE** flash when they reach it on their scorecard, and the hole stays tagged. Change or remove it any time; **DUPLICATE** keeps it for next week.',
      'Not sure what something does? Leave it. The defaults work.',
    ],
  },
  {
    id: 'prep', title: 'Get ready for the event (PREP tab)',
    steps: [
      '**DASHBOARD** shows days to go, how much of the checklist is done, what\'s overdue, the shirt count and design approvals.',
      '**TASKS:** tap **LOAD STARTER CHECKLIST** once. Due dates count back from your event date. Tick a box when it\'s done. **Edit** a task to change it, give it to another TD or add notes.',
      '**SHIRTS:** sizes come in from the Disc Golf Scene import. Add **extras** per size, then **DOWNLOAD CSV** for the printer and tap **MARK ORDERED**. Anyone missing a size is listed under **Player sizes**. Pick it there.',
      '**CONTACTS:** vendors and sponsor prospects with status (to ask → asked → yes → paid). Crew leads show as **New lead**: approve or say no. A sponsor at yes can go straight into the Sponsors list.',
      '**DESIGNS:** tap **ADD DESIGN** (shirt front, flyer, tee sign…), then **UPLOAD FILE**. A new upload becomes v2, v3… and old versions are kept. Set it to **Approved** or **Sent to print**.',
      '**VOTES:** let the crew pick between designs. Tap **NEW VOTE**, tap 2 or more designs (tap order = ballot order), add a question and an optional closing time, then **START VOTE**. Leave **Post a pinned announcement** on so everyone knows.',
      'Crew vote on the **VOTE** tab of their link: one pick plus an optional comment, and they can change it until it closes. They only see totals after they vote, never who picked what. You see every vote with names and comments, plus who hasn\'t voted yet. TDs vote with **VOTE THIS** on the card.',
      '**CLOSE VOTING** locks it and makes the leader the winner (on a tie, tap **MAKE WINNER**). **REOPEN** if you closed too soon. A design with votes can\'t come off the ballot or be deleted; delete the vote first if you really mean it.',
      '**INNOVA ORDER:** tap **NEW ORDER**, then upload the CFR/TFR order form (.xlsx) from your Innova rep. Every mold, weight, price and "out" comes from that file. Search or filter by putter/mid/fairway/distance, tap a mold, and use + (it starts at Innova\'s 5-per-weight minimum). The bar shows how close you are to the 50-disc minimum.',
      '**DETAILS** fills the form\'s header (name, contact, artwork, die, addresses, notes). **REVIEW + EXPORT** lists anything Innova would reject, then downloads their own form filled in. Card number and exp/CVC are never stored: type them into the file, email it to your rep with the art, and flip the order to **SENT**. Minis need their own order (their own die).',
      '**SHARE LINK** copies a link anyone can open for 7 days (good for a printer). **EXPORT ZIP** downloads the latest version of every design shown, sorted into folders.',
      '**ADD TOUR PROOFS** (Jewel XI) adds live proofs for the disc, shirt, screen print and tee signs. **OPEN PROOF**, tap colors, then **SAVE AS SELECTED** to lock your pick. Tee signs pull par, distance and hole sponsors from the course: the sponsor pic fills the big frame and the name goes on the plate. Two sponsors on one sign make a ½ sign. In **SPONSORS**, pick **Which tee sign** when the hole has extra pads.',
      'Designs are TD-only. Flip **Show crew** on a design and your crew see it in a **DESIGNS** tab on their link: proofs with your pick marked, and the latest file. They can\'t change anything.',
      'Only this event\'s TDs can see the rest of it. **DUPLICATE** carries the checklist over (unticked, with dates moved to the new event). Designs, shirt orders and sizes start fresh.',
    ],
  },
  {
    id: 'crew', title: 'Your crew (CREW tab)',
    steps: [
      '**ROSTER:** add each helper by name and tap their jobs (Check-in, Raffle, Card requests, Contacts & sponsors). Everyone gets announcements and tasks.',
      'Tap **COPY LINK** or **TEXT IT** and send each person their own link. No password. **Cut off link** stops it instantly, and **New link** replaces a lost one.',
      '**ANNOUNCEMENTS:** post directives to everyone or just some jobs. Each helper taps **Got it**, and you see who hasn\'t yet ("Waiting on…").',
      '**STATIONS:** the volunteer grid. Tap **LOAD STARTER STATIONS** (Spotters, Check In, Player Packs, Tee Signs, Water & Ice) or add your own. Every event day gets an AM and a PM shift. Use **+** in a cell to place someone; **EDIT HEADCOUNTS** to change how many each station needs, for all shifts or just one.',
      'Crew see their shifts on their link and can **CLAIM** open spots (✋). ⚠ marks someone booked in two stations the same shift. **CSV** / **PRINT** for the clipboard at the tent.',
      'Assign prep tasks to crew in **PREP → TASKS → Edit**. They tick them off and post updates you both see.',
      '**RAFFLE:** crew log sales on their phones. The total shows here and in **WINNERS**, where you tap **USE** to put it in the prize pool.',
      'Designs you mark **Show crew** in **PREP → DESIGNS** show up on their links under **DESIGNS**.',
      'Votes you start in **PREP → VOTES** show up as a **VOTE** tab on their links, with a badge until they vote.',
      'Crew card requests land in **REQUESTS** as new. Crew sponsor and vendor leads land in **PREP → CONTACTS** for you to approve.',
      'Send links a week out so everyone reads their briefing before the event.',
    ],
  },
  {
    id: 'early', title: 'Early access tag league (EARLY ACCESS tab)',
    steps: [
      'Registrants get an early bag tag set to test the Scorecard and tags before the event, and earn raffle tickets for playing. Not on yet for this event? Tap **START EARLY ACCESS**.',
      'Share the **PUBLIC PAGE** link (Jewel XI: barebonesdiscgolf.club/jewel-xi/early-access). A player finds their name and taps **That\'s me**. No email or phone needed.',
      '**SPOTS:** limit it to the first N registrants (Jewel XI: 50) by registration order from the Disc Golf Scene import. Re-import the latest DGS CSV so new registrants show up. Anyone past the limit can\'t claim; if someone ahead drops out, the next one moves in.',
      '**REQUESTS:** tap **APPROVE** if it\'s really them, else **DECLINE**. Approving gives them the next tag at the bottom of the set (first in gets #1) and turns their phone into their My Tag. A yellow note means the name matches an existing club member: approving hands that phone the member\'s existing link, so only approve if you know them.',
      'Tickets count themselves: a round saved on the Scorecard with at least 3 joined players, everyone confirmed = 1 ticket (max 2 a week), plus 1 per new partner. Voided or disputed rounds drop off.',
      '**Two players:** only an accepted challenge counts. With fewer than 3 joined players, Early Access tags can only go on the line when the two of them have a challenge accepted between them (My Tag → MATCHUPS or TAGS). That round moves tags, settles the challenge and earns the ticket. Any other 2-player round is refused for that set; the rest of the round still saves once they untick it.',
      '**INVITES:** early access for someone who isn\'t registered (a supporter, a helper). Type their name (and nickname), tap **INVITE**: they get the next tag right away, no claim to approve. Then **SEND LINK**: **TEXT IT** opens your phone\'s messages with a ready-written note and their link, **COPY LINK**, or **PRINT CARD** for a one-page card with a big QR code and 3 steps. Invites earn tickets, count as Jewel players and don\'t use registrant spots. **REMOVE** under Joined works the same. The first time anyone opens My Tag they get a 3-step welcome; **HOW IT WORKS** at the bottom brings it back.',
      '**BONUS TICKETS:** bug bounty. Pick the player, 1 to 5 tickets, and what they found. **VOID** takes it back.',
      '**SECRET AWARDS** (most rounds, most partners, biggest tag climb) are for you only. Reveal them on stage. Best bug find is your pick from the bonus list.',
      '**RAFFLE DRAW** opens the day after the window closes. Each tap draws one winner by ticket weight; nobody wins twice. Winner not there? **VOID** and draw again.',
      'Wrong person linked? **REMOVE** under Joined: their tag goes back as available and their tickets stop counting.',
    ],
  },
  {
    id: 'players', title: 'Check people in (PLAYERS tab)',
    steps: [
      'New player: type their name, pick a division, tap **ADD + CHECK IN**.',
      'Already on the list: tap the gray **CHECK IN** button. It turns green.',
      'Pre-registered on Disc Golf Scene? Tap **IMPORT DGS CSV** and pick the export file.',
      'With check-in on, only checked-in players go on cards.',
    ],
  },
  {
    id: 'requests', title: 'Card requests (REQUESTS tab)',
    steps: [
      'Tap **PRINT TABLE QR** and put it on the check-in table.',
      'Players scan it, pick their name and who they want to play with. No need to stop the line.',
      'New ones pop up here with a number on the tab. Tap **APPROVE** or **DECLINE**.',
      'Approved people go on the same card when you generate Round 1.',
      'Round 1 already published? **APPROVE** seats them together right away (swapping others off that card) and republishes Round 1. Printed codes still work. In a dubs round their whole teams move.',
      'Want to play with someone? Tell people: **use the request form**. Asking at the desk doesn\'t get you moved.',
    ],
  },
  {
    id: 'private', title: 'Private notes (only TDs see these)',
    steps: [
      'On PLAYERS, tap the small dot by a name: once = ⭐ needs a good card, twice = ☺ plays with anyone, three times = off.',
      'Tap a player\'s name to set **Keep apart from**. Cards will never put those two together.',
      'Move someone by hand and break one of these? The Cards tab shows a red warning.',
    ],
  },
  {
    id: 'cards', title: 'Make the cards (CARDS & QR tab)',
    steps: [
      'Pick card size, then tap **GENERATE CARDS**.',
      '"Keep divisions together" OFF mixes divisions so people meet each other.',
      'Swap someone: tap their name, then **MOVE HERE** on another card. That card locks.',
      'Tap **PUBLISH & START**. That starts the round: scoring opens and the QR codes are made. Then **QR SHEET** → **PRINT**. One code per card.',
      'Late player after starting? Check them in, **REGENERATE**, then **REPUBLISH**. Printed codes still work.',
      '**Dubs round:** tap **DRAW PARTNERS** first (pure random; an odd player out plays **Cali**, solo). Tap two names to swap them. Then pick **TEAMS PER CARD** (2 or 3), **GENERATE**, **PUBLISH & START**. Partners always share a card; **MOVE HERE** moves the whole team.',
      'Late player in a dubs round? Check them in, tap **UPDATE DRAW** (pairs them with the Cali or makes them the new Cali), then regenerate and publish. Once that round has scores the draw is locked.',
    ],
  },
  {
    id: 'scoring', title: 'Scoring on phones',
    steps: [
      'Players point the camera at their card\'s QR code and tap the link.',
      'Tap a gray number to give par, use minus / plus to change it, tap **NEXT HOLE**.',
      'A **CTP** hole flashes a gold target with the prize when it comes up, and shows **CTP · prize** under the hole number.',
      'No signal is fine: it saves on the phone and catches up later.',
      'After the last hole everyone types initials and taps **Sign**, then one person taps **SUBMIT CARD**.',
      'Dubs round: one score line per team. Either partner can enter it and sign for the team.',
      'Card submitted by mistake? Open that card\'s QR while signed in as TD and tap **TD: unlock card**.',
      '**LEADERBOARD** (top of your event) is the public live scores link.',
    ],
  },
  {
    id: 'winners', title: 'Winners and payouts (WINNERS tab)',
    steps: [
      'For each division set the **entry fee** and **payback %** once (they carry to next week).',
      'Type the **added cash / raffle total** whenever it changes. Every payout updates instantly.',
      'Ties split the money of the spots they cover. A tie for 1st: pick the **playoff winner**.',
      'Someone left early or was disqualified? Mark **DNF / DQ / no-show** and they drop out.',
      'Pros are paid cash. Ams get prize credit, rounded to $1 or $5.',
      'Events with a dubs round show each round on its own. Divisions are paid from the singles round; each dubs round gets its own **DUBS** card (entry fee per player, payback %, places). Team payouts split between the two partners; a Cali takes the whole spot.',
      'Happy with it? Tap **POST RESULTS**. The public Winners page shows exactly what you posted. Post again after any change.',
      'League weeks: **LEAGUE WEEK** sits at the top. Pick who gets the **Lazy Boner Safety Vest** (tap **LEADER · PICK** for the low score, or choose on a tie), add an optional shout-out, tap **AWARD IT**. **Dubs week:** you pick the winning **team** and both partners wear it (a Cali alone).',
      'Then **LOAD PHOTO**: snap the group photo on your phone and pick it. It shrinks itself and goes up with the week. Both show on the league\'s **vest page** (**VEST PAGE ↗**): this week\'s holders, the group photo, **Most vests** and every week. The holders also show on the league\'s card on the Leagues page.',
    ],
  },
  {
    id: 'week2', title: 'Run a league (LEAGUES)',
    steps: [
      'From your events list tap **LEAGUES**, then **OPEN** your league. Mike creates leagues and adds their TDs; a league TD runs every week of it without being added to each one.',
      '**WEEKS → + NEW WEEK**: pick the date (the name fills itself in), leave **Copy the player list** on, tap **CREATE WEEK**. It copies the newest week: course, CTP holes, divisions, payouts and players (nobody checked in). Never cards, scores, the vest or the photo.',
      'The very first week asks for the course and divisions instead. Every week after copies the one before.',
      'The week opens like any event: **PLAYERS**, **CARDS & QR** (PUBLISH & START), **WINNERS** (vest + photo), **TAGS**. **‹ BACK** returns to the league.',
      '**SETUP** is what the Leagues page shows: name, tagline, who runs it, when, where, cost, the weekly award, and a banner or logo. **AWARD ART** is the picture on the award\'s page (e.g. the Safety Vest). Saves go live right away. **Show on the site** hides or shows the whole league.',
      '**TAGS** is the league\'s own tag set. **TDS** lists who runs it (Mike adds or removes them).',
    ],
  },
  {
    id: 'leagues', title: 'Leagues and Pop Ups on the website',
    steps: [
      'Each league on the Leagues page comes from its **LEAGUES → SETUP**. Its **This week\'s scores** button opens the newest week that has started.',
      'Put **Pop Up** anywhere in a Pop Up\'s name and it shows as **Next Pop Up** (date and a link) until it\'s over.',
      'Archive a week or event to take it off the page.',
    ],
  },
  {
    id: 'tags', title: 'Bag tags (league admins)',
    steps: [
      '**HEAT** (per tag set): **Time bombs** — a top-5 tag with no tag round in 7 days explodes: that holder goes to the bottom and everyone below moves up. Playing or confirming a tag round resets the fuse; moving into the top 5 starts a fresh one. **Challenges** — players challenge up to 5 spots above them from My Tag; 3 declines are free, the 4th drops them 5 spots (48 hours of silence counts as a decline). **Group chat** — the set\'s **Board** on My Tag (its own **BOARD** tab, one board per tag set, with reactions). Challenges, results, explosions and penalties post there on their own; **MODERATE CHAT** lets you hide a message.',
      '**Challenge rounds:** once a challenge is accepted, the challenged player picks a **time and course** on My Tag (MY TAGS tab). The challenger taps **OK, LOCK IT IN** or proposes another; it\'s locked when both agree (it must be at least 2 hours out and before the 7-day play-by). Locked rounds post to the Board and show under **MATCHUPS → Jump in**: anyone with a tag in the set can **JUMP IN**, 2 max, their tags on the line too. Jump-ins close 2 hours before tee time; a jump-in can drop out until then, nobody can kick them. Play and save it on the Scorecard as usual: the challenge settles when the two of them are on the applied tag round.',
      '**MATCHUPS** (My Tag tab): players set the days they can play (AM/PM) and up to 3 favorite courses, once for every set. The Matchmaker suggests their 3 best opponents per set (shared days and courses, how close, how long the other tag has sat) with one-tap **CHALLENGE**. Every Monday at 9am it posts each set\'s 3 hottest matchups to the Board (sets with Board + challenges on).',
      'From your events list tap **BAG TAGS**. You see the leagues you run; the super admin adds league admins at the bottom.',
      '**Issue a tag:** take the buy-in, type the player\'s name, tap **ISSUE TAG**. They get the next number at the bottom. Type a number only to hand back a freed tag or load someone\'s existing physical tag.',
      'Right after issuing, have them scan the **My Tag** QR and save the page. That page is how they log casual rounds and confirm the ones they\'re on.',
      '**League night:** after cards are signed and submitted, open the league\'s **TAGS** tab (or **BAG TAGS** from your events list). **Record a round → From the scorecard** opens on tonight\'s event: check the name matches, tap **RECORD**. Tag holders trade tags by total. Each event counts once.',
      'Other tag sets on the card (like **Golden Boners**) show under **OTHER TAG SETS ON THIS CARD**. Check one to put it on the line from the same scores: it goes up pending, every holder confirms from their **My Tag** link, and it swaps on the last confirmation. Your own league\'s tags still move right away.',
      'Pop Up with a dubs round? Tags only record from a **singles** round: pick it under **Round**. Dubs rounds never move tags.',
      '**Golden Boners** is the invite-only set: admins and core members only. It works like a league (issue, My Tag, rounds, undo) but only the super admin, or someone they add as its admin, can issue one.',
      '**Tag room** (Golden Boners has one): one shared link for the whole group instead of a link per person. **+ ADD TILE** for each person. They open the room, tap their name, and their tag activates with the next number (first come, first numbered); their phone becomes their My Tag. **CLOSE ROOM** stops taps; **NEW LINK** kills the old link. **UNLOCKS** sets a start time: tiles stay locked with a countdown until then (**UNLOCK NOW** skips it).',
      'Someone tapped the wrong tile? **RESET** it: the tag goes back in the pot and that person gets a new My Tag link, so the wrong phone loses access. Untapped tiles can be **REMOVE**d.',
      '**Rounds waiting:** a disputed or stuck round shows here. **APPLY** swaps the tags they hold now; **VOID** drops it.',
      'Waiting swaps (league proposals and scorecard rounds) show on the public tag board re-ranked and marked **pending**, with who still has to confirm. Nothing moves until the last confirmation. Unconfirmed swaps expire after 7 days.',
      'Made a mistake? **UNDO LAST ROUND** puts the latest round back, as long as none of those tags moved since.',
      'Player quit? **TAKE BACK** frees the number (or retires it). Lost phone or shared link? **People → NEW LINK**; the old link dies.',
    ],
  },
  {
    id: 'rounds', title: 'Club scorecard, Boner Rounds and tag swaps (members)',
    steps: [
      '**Live:** while a scorecard round is played it shows on the club home and Boner Rounds ("Live now"), updating as scores go in. The scorer can turn **Share live** off on the setup screen, and the card has a **Share link**. It drops off 30 minutes after the last score or when it\'s saved; it\'s official only once saved and confirmed.',
      '**Reactions:** on a live round\'s page, members (My Tag link on that phone) send a razz or a congrats at one player or everyone. It plays over the scorer\'s card and every viewer\'s screen, with who sent it. One every 15 seconds each. The scorer taps **Reactions on/off** on the card to mute.',
      '**Vouch (league admins):** signed in, open a saved round on Boner Rounds. **VOUCH: TAGS ON THE LINE** puts a tag set on it past the rules (2-player Early Access, or tags skipped at tee-off). Everyone with a tag on it confirms on My Tag, then the tags swap. Raffle tickets still need 3 Jewel players or a settled challenge.',
      'Anyone can keep a casual round at **barebonesdiscgolf.club/scorecard**: pick the course and layout (pars, hole names and feet fill in), add members or guests, **Tee off**. It saves on the phone as you go.',
      'To save a round to **Boner Rounds**, a member connects their **My Tag** link once (opening their My Tag link on that phone does it). The phone remembers them.',
      '**Tags on the line?** is on the New Round screen. It shows the tag sets where you and another member on the card both hold a tag. Decide before you tee off: it locks once the first score is in.',
      'At the end tap **Save round** (or **Save round + tag swap**). The round shows on Boner Rounds right away, marked waiting until the other members confirm.',
      'Everyone else on the card confirms from the round page or their My Tag link. Confirming the round also confirms its tag swap. The swap happens on the last confirmation; a **Dispute** stops it for the league admin.',
      'While it waits, the tag board shows the swap as **pending**. Guests just get a score and never touch tags.',
      'Wrong card? Whoever saved it can **Void this round** until tags have moved.',
    ],
  },
  {
    id: 'band', title: 'Meet the Band (super admin)',
    steps: [
      'From your events list tap **THE BAND**. These are the admins and managers on the Jewel XI site\'s **The Band** page.',
      '**+ ADD MEMBER** with a name and role. New members start hidden.',
      'Tap **UPLOAD CARD** and pick their character card (tall art like the Jewel XI cards). **REPLACE CARD** swaps it any time.',
      'Flip **Visible** when they\'re ready. ◀ ▶ change the order. **REMOVE** takes them off (and deletes their uploaded card).',
    ],
  },
  {
    id: 'gallery', title: 'Club gallery (super admin)',
    steps: [
      'From your events list tap **CLUB GALLERY**. Only the super admin sees it.',
      '**IMPORT A FOLDER** and pick a folder from the Drive archive (download it first). Funny Pics become memes, Events/The Jewel/<year> become that Jewel, Events/<name> become events, the rest are photos. Big pictures are shrunk before upload.',
      'Everything lands **Hidden**. Fix the title, category, year, Jewel # or event name, then switch on **Visible**. **MAKE THESE VISIBLE** approves the whole page you are looking at.',
      'Importing the same folder again skips files that are already in, so it\'s safe to re-run.',
      'Videos: upload to the club YouTube channel, paste the link under **ADD VIDEO**, then switch it on.',
      'Nothing is ever public until you switch it on. **DELETE** asks twice and removes the file too.',
    ],
  },
  {
    id: 'trouble', title: 'Something went wrong',
    steps: [
      'A red message tells you what to do. It never loses your work silently.',
      'Stuck? Tap the **skull** (bottom left of every page, top right on phone scorecards and My Tag). Pick **Bug**, say what happened, add a screenshot, tap **SEND TO THE SKULL**. It lands straight in Mike\'s Bug Squasher with the page and your device attached.',
      'When it\'s fixed it shows up in **Dev reports** on the TD home and the club home, with the new version number.',
    ],
  },
];

export { boldParts } from '../text';
