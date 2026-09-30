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
      '**Divisions:** tap the ones you use. Tap **SAVE DIVISIONS**.',
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
      '**INNOVA ORDER:** tap **NEW ORDER**, then upload the CFR/TFR order form (.xlsx) from your Innova rep. Every mold, weight, price and "out" comes from that file. Search or filter by putter/mid/fairway/distance, tap a mold, and use + (it starts at Innova\'s 5-per-weight minimum). The bar shows how close you are to the 50-disc minimum.',
      '**DETAILS** fills the form\'s header (name, contact, artwork, die, addresses, notes). **REVIEW + EXPORT** lists anything Innova would reject, then downloads their own form filled in. Card number and exp/CVC are never stored: type them into the file, email it to your rep with the art, and flip the order to **SENT**. Minis need their own order (their own die).',
      '**SHARE LINK** copies a link anyone can open for 7 days (good for a printer). **EXPORT ZIP** downloads the latest version of every design shown, sorted into folders.',
      '**ADD TOUR PROOFS** (Jewel XI) adds live proofs for the disc, shirt, screen print and tee signs. **OPEN PROOF**, tap colors, then **SAVE AS SELECTED** to lock your pick. Tee signs pull par, distance and hole sponsors from the course.',
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
      'Assign prep tasks to crew in **PREP → TASKS → Edit**. They tick them off and post updates you both see.',
      '**RAFFLE:** crew log sales on their phones. The total shows here and in **WINNERS**, where you tap **USE** to put it in the prize pool.',
      'Designs you mark **Show crew** in **PREP → DESIGNS** show up on their links under **DESIGNS**.',
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
    ],
  },
  {
    id: 'scoring', title: 'Scoring on phones',
    steps: [
      'Players point the camera at their card\'s QR code and tap the link.',
      'Tap a gray number to give par, use minus / plus to change it, tap **NEXT HOLE**.',
      'No signal is fine: it saves on the phone and catches up later.',
      'After the last hole everyone types initials and taps **Sign**, then one person taps **SUBMIT CARD**.',
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
      '**Golden Boners** is the invite-only set: admins and core members only. It works like a league (issue, My Tag, rounds, undo) but only the super admin, or someone they add as its admin, can issue one.',
      '**Rounds waiting:** a disputed or stuck round shows here. **APPLY** swaps the tags they hold now; **VOID** drops it.',
      'Made a mistake? **UNDO LAST ROUND** puts the latest round back, as long as none of those tags moved since.',
      'Player quit? **TAKE BACK** frees the number (or retires it). Lost phone or shared link? **People → NEW LINK**; the old link dies.',
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
