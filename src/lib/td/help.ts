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
      '**Event:** name, club, dates, colors, rounds (1 or 2), waves (single or AM/PM), check-in on/off. Tap **SAVE EVENT**.',
      '**Course:** pick your course from the **library** list and tap **LOAD**: par, feet, OB and mandos fill in. Not listed? Type the holes, tap **SAVE COURSE**, then **SAVE TO LIBRARY** so every TD can use it next time.',
      'Loading copies the holes into your event. Fixing the library later never changes an event you already ran.',
      'Some layouts carry the course\'s own hole names and feet (Buffalo Ridge Outside Ring plays 1–5, A–H, 7, 14–18). The club scorecard shows them. Have a UDisc scorecard export (CSV) or a screenshot of a layout? Send it to Mike and it goes in the library, marked unverified until an admin taps **Verify**.',
      '**Extra tee pads:** holes with a second pad (Rec / Ladies, AM) get one row each. Enter its feet, and par if it differs. Each pad is its own tee sign a sponsor can take. Scoring is still by hole.',
      '**Divisions:** tap the ones you use. Tap **SAVE DIVISIONS**.',
      '**Round format:** each round is **SINGLES** or **RANDOM DRAW DUBS**, plus the dubs style (best shot, best disc, alternate shot). A Pop Up is usually Round 1 dubs, Round 2 singles. Locked once that round has cards.',
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
      'Tap **PUBLISH**, then **QR SHEET** → **PRINT**. One code per card.',
      'Late player after publishing? Check them in, **REGENERATE**, **PUBLISH** again. Printed codes still work.',
      '**Dubs round:** tap **DRAW PARTNERS** first (pure random; an odd player out plays **Cali**, solo). Tap two names to swap them. Then pick **TEAMS PER CARD** (2 or 3), **GENERATE**, **PUBLISH**. Partners always share a card; **MOVE HERE** moves the whole team.',
      'Late player in a dubs round? Check them in, tap **UPDATE DRAW** (pairs them with the Cali or makes them the new Cali), then regenerate and publish. Once that round has scores the draw is locked.',
    ],
  },
  {
    id: 'scoring', title: 'Scoring on phones',
    steps: [
      'Players point the camera at their card\'s QR code and tap the link.',
      'Tap a gray number to give par, use minus / plus to change it, tap **NEXT HOLE**.',
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
    ],
  },
  {
    id: 'week2', title: 'Next week (leagues)',
    steps: [
      'Go back to your events, tap **DUPLICATE** on last week, pick the new date.',
      'Leave **"Copy the player list"** on. Everyone starts not checked in.',
      'Course, divisions, card rules, private tags, keep-apart, payout tables and the prep checklist carry over. Requests, cards, scores, results, designs and shirt orders don\'t.',
    ],
  },
  {
    id: 'leagues', title: 'Leagues and Pop Ups on the website',
    steps: [
      'The Leagues page finds your events by **name**. Start a Lazy Boners night with **Lazy Boners** and an RBFL night with **RBFL** or **Root Beer Float**. Its **This week\'s scores** button opens the newest one that has started.',
      'Put **Pop Up** anywhere in a Pop Up\'s name and it shows as **Next Pop Up** (date and a link) until it\'s over.',
      'Archive an event to take it off the page.',
    ],
  },
  {
    id: 'tags', title: 'Bag tags (league admins)',
    steps: [
      'From your events list tap **BAG TAGS**. You see the leagues you run; the super admin adds league admins at the bottom.',
      '**Issue a tag:** take the buy-in, type the player\'s name, tap **ISSUE TAG**. They get the next number at the bottom. Type a number only to hand back a freed tag or load someone\'s existing physical tag.',
      'Right after issuing, have them scan the **My Tag** QR and save the page. That page is how they log casual rounds and confirm the ones they\'re on.',
      '**League night:** after cards are signed and submitted, go to **Record a round → From the scorecard**, pick the event, check the name matches, tap **RECORD**. Tag holders trade tags by total. Each event counts once.',
      'Other tag sets on the card (like **Golden Boners**) show under **OTHER TAG SETS ON THIS CARD**. Check one to put it on the line from the same scores: it goes up pending, every holder confirms from their **My Tag** link, and it swaps on the last confirmation. Your own league\'s tags still move right away.',
      'Pop Up with a dubs round? Tags only record from a **singles** round: pick it under **Round**. Dubs rounds never move tags.',
      '**Golden Boners** is the invite-only set: admins and core members only. It works like a league (issue, My Tag, rounds, undo) but only the super admin, or someone they add as its admin, can issue one.',
      '**Rounds waiting:** a disputed or stuck round shows here. **APPLY** swaps the tags they hold now; **VOID** drops it.',
      'Waiting swaps (league proposals and scorecard rounds) show on the public tag board re-ranked and marked **pending**, with who still has to confirm. Nothing moves until the last confirmation. Unconfirmed swaps expire after 7 days.',
      'Made a mistake? **UNDO LAST ROUND** puts the latest round back, as long as none of those tags moved since.',
      'Player quit? **TAKE BACK** frees the number (or retires it). Lost phone or shared link? **People → NEW LINK**; the old link dies.',
    ],
  },
  {
    id: 'rounds', title: 'Club scorecard, Boner Rounds and tag swaps (members)',
    steps: [
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
      'Stuck? Take a screenshot and send it to your organizer.',
    ],
  },
];

/** "**X**" -> segments for rendering bold without HTML injection. */
export function boldParts(text: string): Array<{ text: string; bold: boolean }> {
  return text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((t) =>
    t.startsWith('**') && t.endsWith('**') ? { text: t.slice(2, -2), bold: true } : { text: t, bold: false });
}
