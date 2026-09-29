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
      '**SHARE LINK** copies a link anyone can open for 7 days (good for a printer). **EXPORT ZIP** downloads the latest version of every design shown, sorted into folders.',
      'Only this event\'s TDs can see any of it. **DUPLICATE** carries the checklist over (unticked, with dates moved to the new event). Designs, shirt orders and sizes start fresh.',
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
