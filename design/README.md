# Handoff: Bare Bones Jewel XI — Tournament Scoring App + TD Card Builder

## Overview
A self-hosted scoring and course-guide web app for **The Bare Bones Jewel XI World Tour**, an annual 2-round, 20-hole disc golf tournament (Nov 21–22, 2026, Stripe Show Golf Course / Freedom DGC at Fiesta Lakes, Mesa AZ). It replaces UDisc for this event. The goals are **total TD control**, a dumbed-down scorecard, and card and start-hole assignment that doesn't fall apart right before tee off.

The app has two parts:
1. **Player app**, mobile-first (`Jewel XI Scoring App.dc.html`): live leaderboard by division, optional scorecard with a mandatory sign-off from every player, hole-by-hole course guide, and schedule, rules and sponsors.
2. **TD Card Builder**, desktop (`Jewel XI Card Builder.dc.html`): imports the registration CSV from Disc Golf Scene (DGS), generates cards and shotgun start holes from rules the TD sets, supports hand edits and locked cards, and publishes the cards to the player app.

**Target stack (the TD's choice):** **Supabase** (Postgres, Realtime, Auth) for data, hosted on **Cloudflare** (Pages; Workers only if needed). Expect 100+ players. It must work "offline-ish" on phones: courses have spotty signal.

Registration and payments stay on Disc Golf Scene:
https://www.discgolfscene.com/tournament/The_Bare_Bones_Jewel_XI_Presented_by_Innova_at_Stripe_Show_Golf_Course_2026

## About the Design Files
The `.dc.html` files in this bundle are **design references built in HTML**. They are working prototypes of the intended look and behavior, not production code to ship. They persist to `localStorage` and run on a small in-house template runtime (`support.js`, included only so the files open in a browser). **Don't port that runtime.** Rebuild the designs in a real framework. Suggested: **Vite + React (or SvelteKit) + TypeScript**, deployed to Cloudflare Pages, using `@supabase/supabase-js`. All logic worth keeping sits in the `<script data-dc-script>` block of each file: scoring math, the sorting and assignment algorithm, and the CSV parsing. It's plain JS and easy to lift.

To view a prototype, open the `.dc.html` file straight in a browser, with `support.js` and `assets/` next to it. Click "Send to Scoring App" in the Card Builder, then open the Scoring App in the same browser to watch the two talk to each other. They share `localStorage`.

## Fidelity
**High-fidelity.** The colors, type, spacing and copy are final and follow the tournament's "hair-band world tour" brand. Match them closely. The layout is a single mobile column (max 480px) for players and a sidebar layout for the TD.

---

## Screens / Views

### A. Player App (mobile-first, `max-width: 480px`, centered)

**Shell**
- Page background `#0b1020`. App column background `#141c2e`, `min-height:100vh`.
- **Header:** 14/16/10px padding, `linear-gradient(180deg,#1b2440,#141c2e)`, 2px bottom border `#7b5cff`. Bare Bones chrome wordmark image at 132×56. Title "Jewel XI World Tour" in Metal Mania 24px. Subtitle "NOV 21–22 · STRIPE SHOW GC · MESA" in Archivo Black 11px, letter-spacing 2px, `#ff3ad1`.
- **Bottom tab bar:** fixed, 4 equal columns, background `#0b1020`, 2px top border `#7b5cff`, `padding-bottom: env(safe-area-inset-bottom)`. Each tab is at least 64px tall, icon (20px) above an Archivo Black 11px label. Active tab: `#29e1ff` text and a 3px `#29e1ff` top bar. Inactive: `#8a93b0`. Tabs: **Leaders ♛ · Score ✎ · Course ⛳ · Info ★**. (Swap the glyphs for real icons if you like.)
- Content padding is 16/14/96px, with a 14px gap between blocks.

**1. Leaderboard**
- "Leaderboard" in Metal Mania 34px. At right: "● LIVE · {n} ON COURSE" in Archivo Black 11px, `#29e1ff`.
- **Official / Live toggle:** a pill segmented control with a 2px `#29e1ff` border. The active segment is filled `#29e1ff` with black text. The note beside it:
  - Official: "Only signed & submitted rounds count."
  - Live: "Showing live, unsigned scores — unofficial until the card signs off."
- **Division chips:** a horizontal scroll row. "All" comes first, then only the divisions that have players, in canonical order. Chips are pill-shaped, at least 40px tall, Archivo Black 13px. Active chip: filled `#ff3ad1` with black text. Inactive: `#2a3558` border.
- **One card per division:** 2px `#2a3558` border, 12px radius, `#101728` background. The header row (`#1d2746`) shows the division code in `#ff3ad1` Archivo Black 16px and the player count.
  - Grid columns: `40px | 1fr | 54px | 54px | 62px` = **POS, PLAYER, R1, R2, TOT**.
  - Scores are relative to par: `E`, `+3`, `-2`. Colors: under par `#c6ff3d`, over par `#ff8a7a`, even `#fff`.
  - Position: ties show as `T3`. First place is `#ffd23f`. Players who haven't started show `–` and sort to the bottom.
  - Line under each name: "Not started", "R1 · thru 12 · unofficial", "R1 ✓ signed", "R2 · thru 5 · unofficial" or "R2 ✓ signed".

**2. Scorecard**
- "Scorecard" heading, plus an **R1 SAT / R2 SUN** segmented control (`#7b5cff`).
- Info banner (`#1d2746`, 10px radius): "App scoring is optional — anyone on the card can keep score here, or turn in a paper card at TD Central. Every player signs off before a card can be submitted."
- **Card picker:** a `<select>` at least 48px tall with options like "AM · Hole 7B · 4 players". Picking a card jumps to its **start hole**. A note follows: "▶ Start on hole 7 · play 20 in a row" (`#ffd23f`).
- **Hole header:** 2px `#29e1ff` border, 14px radius. ‹ and › are 48px circles on either side. In the middle: "Hole N" in Metal Mania 40px, "PAR 3 · 321 FT" in `#29e1ff`, and a short OB note in `#ff3ad1`. Navigation wraps from 20 to 1.
- **Hole dots:** 20 squares, 30×30. Current hole: `#29e1ff` fill. Holes where the whole card has entered a score: `#7b5cff` fill.
- **Player rows:** name, then "MA1 · R1 +2 thru 7". Controls are **− [score] +**, with 48px buttons and a 56px score tile.
  - The score tile defaults to par, greyed out (`#1a2238` background, `#6b7596` text) until entered. **Tapping the tile saves par.**
  - Once entered, the tile is colored by the result: birdie or better `#c6ff3d`, par `#fff`, bogey or worse `#ff8a7a`, with black text.
  - Scores range from 1 to 12.
- "NEXT HOLE ›" button: full width, 52px tall, gradient `#29e1ff → #7b5cff → #ff3ad1`, black text.
- **Sign Off panel** (appears once all 20 holes are entered for everyone on the card): 3px `#ffd23f` border.
  - Each player row shows "{strokes} strokes · {±par}" and a **SIGN** button. Signing asks the player to confirm and enter their initials.
  - Status line: "2 of 4 signed", then "Everyone signed. Submit it!", then "✓ Card submitted — scores are locked".
  - **SUBMIT CARD** is disabled until everyone has signed.
  - **Editing any score on the card clears all signatures** for that card and round.
  - Once submitted, the card is locked (rows dimmed to 0.35). Only the TD can unlock it, via "TD: unlock card" (confirm dialog; clears the signatures).
- **TD tools** (collapsible "TD: ADD PLAYER"; in production, show them only to the TD role):
  - Add a walk-up player (name, division, card).
  - **Enter a paper card total** (player, round, strokes). Saved as official.
  - Clear everything (demo only).

**3. Course ("The Setlist")**
- Course map image (full width, 10px radius), then 20 accordion rows.
- Each row: a 40px hole-number ring (par 4 = `#ff3ad1`, par 3 = `#29e1ff`), "Par 3 · 321 ft", and the OB summary in `#ff3ad1`.
- Opening a row shows the **narrator quote** in Permanent Marker 17px and the special rules (mando, DZ) in `#29e1ff`.

**4. Info ("Tour Info")**
- Schedule cards by day. Each day block has a group heading, then time/what rows in 56px/1fr columns, with times in `#ff3ad1`.
- House Rules list.
- Sponsors block: gold gradient `linear-gradient(180deg,#e6c46a,#a47d2c)` with a 3px `#111` border, title "Our Sponsors" in Metal Mania, logos, and the tagline "Don't be a Dick, Be a Boner" in Permanent Marker. Needs a real sponsor table (see the data model).

### B. TD Card Builder (desktop, sidebar layout)
- **Top bar:**
  - Left: wordmark 120×51, "Card Builder" in Metal Mania 28px, and "TD CONTROL · JEWEL XI · 20-HOLE SHOTGUN" in `#ff3ad1`.
  - Right: **IMPORT DGS CSV** (`#29e1ff` outline), **EXPORT CSV** (white outline), **SEND TO SCORING APP** (gradient fill; becomes "Publish" in production).
- Toast bar under the top bar (`#c6ff3d` text), auto-hides after 4 seconds.
- **Sidebar** (260–320px, `#101728`), top to bottom:
  - Round switch R1 · SAT / R2 · SUN. Switching to R2 changes the sort to R1 score.
  - **PM wave divisions:** tap a chip to toggle it. Pink fill = PM (1:00pm); outline = AM (9:00am). Default PM divisions: MPO, FPO, MP40, FP40, MP50, MP55, MA1, MA40.
  - **Card size:** 3, 4 or 5 (default 4).
  - **Sort within division:** Rating (high → low), R1 score (for R2), Registration order, or Random.
  - Toggles:
    - Keep divisions together
    - Merge tiny divisions (1–2 players) onto shared cards
    - Balance card sizes (4-4-3, not 4-4-4-1)
  - **Double-up holes first:** an ordered hole list (default `6, 15, 14, 19`, the longest holes) used for B groups once all 20 holes are taken.
  - **Skip as start holes:** e.g. `20`.
  - **GENERATE / REGENERATE** button.
- **Main area:**
  - AM / PM wave tabs, stats (Players, Cards, Doubled holes, Source: Sample/CSV), and a "Find player…" search.
  - Warnings (red): unassigned players, more than 40 cards in a wave (more than 2 per hole), any card over 5 players.
  - A grid of cards, `repeat(auto-fill,minmax(240px,1fr))`.
    - Card header: hole ring (yellow ring if the card mixes divisions), "Hole 7B · 4 players", division list, and a lock toggle.
    - Card border: `#c6ff3d` if locked, `#ff4b3e` if the card has fewer than 3 or more than 5 players, `#ffd23f` if it matches the search.
    - Player rows: name, division, and rating (or R1 score).
- **Manual move:** tap a player (the row turns yellow and a "Moving: …" bar appears), then tap **MOVE HERE** on any card.

---

## Interactions & Behavior (core rules)
- **Scoring is optional.** Players can use the app or hand in paper. A TD-entered paper total always overrides app hole scores for that player and round.
- **Official means:**
  - The player's card and round has been **submitted after every player signed**, **or**
  - A TD entered a paper total.
- The leaderboard defaults to **Live**. **Official** hides anything that isn't official.
- **Any score edit clears that card's signatures** for that round. Submitted cards reject edits. Only the TD can unlock a card.
- **Honor system:** no player auth is required to score. Anyone holding the card link can enter scores. Sign-off is initials plus a confirm. The TD role needs real auth.
- **Shotgun start:** each card starts on its assigned hole and plays 20 holes in a row, wrapping 20 → 1. The scorecard opens on the start hole.
- **Ties:** 1st place in each division goes to a sudden-death playoff; all other ties stand. The app shows `T#`, and the TD records playoff winners.
- **Offline-ish:**
  - Queue score writes locally (IndexedDB) and sync when back online. Use last-write-wins per `(player, round, hole)` with an `updated_at`.
  - Show a small "offline · n pending" indicator.
  - Cache the course guide and schedule with a service worker (PWA, installable).
- **Realtime:** the leaderboard subscribes to Supabase Realtime on `scores`, `signoffs`, `submissions` and `paper_totals`, and recomputes on the client (or through a SQL view).

## Card assignment algorithm (port from the `generate()` function in the Card Builder)
1. Split players into AM and PM by division, using the PM division set.
2. For each wave:
   1. Take out every player already on a **locked** card (locked cards are kept as they are).
   2. If *keepDivisions* is on, group players by division in canonical order. Otherwise, put everyone in one group.
   3. Sort each group by the chosen method. R1 score sorts ascending, with ties broken by rating descending. Random uses a seeded shuffle, and each regenerate bumps the seed.
   4. If *mergeSmall* is on, gather divisions with fewer than 3 players into a single group at the end.
   5. Split each group into `k = ceil(n / size)` cards. With *balance* on, spread the players as evenly as possible (e.g. 11 players → 4, 4, 3).
   6. **Assign holes:**
      - First pass: holes 1–20 in order, leaving out skipped holes.
      - Second and later passes: the double-up holes first, then the rest.
      - Hole slots held by locked cards count as taken.
      - A card's label is `hole + letter` (7, 7B, 7C). The letter only appears when a hole has more than one card in the wave.
3. Card key: `{wave}-{hole}-{group}`. Display label: "AM · Hole 7B".
4. Manual moves and locks persist per round. Regenerating keeps locked cards.

## DGS CSV import
- Find columns by matching header names, case-insensitive substrings:
  - `name` / `player`, or `first` + `last`
  - `division` / `div` / `class`
  - `rating`
  - `pdga`
- Pull the division code out with the regex `[A-Z]{2,3}\d{0,2}`, so a value like "MA1 - Advanced" becomes "MA1".
- Skip `SPON` entries and rows with no name.
- Handle quoted CSV fields. The prototype includes a small parser; Papa Parse is fine too.
- Re-importing should **upsert by DGS registration id or PDGA number**, not wipe everything, so hand edits survive. (The prototype wipes; don't copy that.)
- Get a real DGS export from the TD to confirm the column names.

## Suggested Supabase data model
```sql
events(id, name, starts_on, par_total int)
holes(event_id, n int, par int, dist_ft int, ob text, quote text, rules text[])      -- 20 rows
divisions(event_id, code text, sort int, wave_default text)                             -- MPO, FPO, …
players(id uuid, event_id, name, div_code, rating int, pdga text, dgs_id text, reg_order int, checked_in bool)
cards(id uuid, event_id, round int, wave text, start_hole int, group_letter text, locked bool, label text)
card_players(card_id, player_id, seat int)            -- unique(player_id, round) enforced via cards.round
scores(player_id, round int, hole int, strokes int, updated_at timestamptz, device_id text,
       primary key(player_id, round, hole))
signoffs(card_id, player_id, initials text, signed_at)
submissions(card_id primary key, submitted_at, unlocked_by text null)
paper_totals(player_id, round int, strokes int, entered_by, primary key(player_id, round))
builder_settings(event_id, round int, json jsonb)     -- pm divisions, size, sort, toggles, double/skip lists
sponsors(event_id, name, tier text, hole int null, logo_url, sort int)
```
- **Row-level security:**
  - Public read on everything.
  - Anyone can write `scores` and `signoffs` **only** while the card has no `submissions` row. Enforce this with a policy or a trigger.
  - A trigger on `scores` insert or update deletes that card's `signoffs`, so any edit clears the signatures.
  - `submissions` insert requires every card player to have signed off (RPC `submit_card(card_id)`).
  - Unlocking, `paper_totals`, `cards`, `players` and settings are TD-only (Supabase Auth, `role = 'td'` claim).
- **Leaderboard view:**
  - Per player: R1 and R2 strokes and to-par. A paper total overrides the app scores.
  - `holes_played`, plus an `official` flag per round.
  - The client ranks within each division.
- **Card links:** each card can get a short URL or QR code (e.g. `/c/AM-7B`) printed or texted to the group. Great for the "right before tee off" chaos.

## State (prototype → production)
- **Player app:**
  - Client-side UI state: `tab`, `division filter`, `official toggle`, `selected card`, `round`, `current hole`, `open guide row`.
  - All data comes from Supabase, plus the offline queue.
- **Builder:**
  - Settings live in `builder_settings`.
  - Generation runs on the client. The result is previewed, then **Published** in one transaction that replaces that round's non-locked cards.

## Design Tokens
- **Backgrounds:** page `#0b1020`, app `#141c2e`, surface `#101728`, raised `#1d2746`, border `#2a3558`, subtle border `#222c4a`, muted control `#3a4568`, empty tile `#1a2238`.
- **Brand ("Electric" palette):** cyan `#29e1ff`, violet `#7b5cff`, magenta `#ff3ad1`.
- **Accents:** gold `#ffd23f`, under-par green `#c6ff3d`, over-par salmon `#ff8a7a`, error `#ff4b3e`, muted text `#8a93b0`, placeholder text `#6b7596`.
- **Primary CTA gradient:** `linear-gradient(90deg,#29e1ff,#7b5cff,#ff3ad1)`.
- **Sponsor gold gradient:** `linear-gradient(180deg,#e6c46a,#a47d2c)` with a `#111` border.
- **Other palettes used across the tournament art**, available if you want a theme switcher:
  - Sunset `#ff2e88 / #ff7a1a / #ffd23f`
  - Toxic `#c6ff3d / #29d69a / #1b8fd9`
  - Blood `#ff4b3e / #b0102d / #ff8a7a`
- **Type (Google Fonts):**
  - **Metal Mania**: display headings, 24–40px.
  - **Archivo Black**: labels, numbers, buttons, 11–26px, often uppercase with letter-spacing of 1–2px.
  - **Archivo 500/700**: body, 12–16px.
  - **Permanent Marker**: narrator quotes and taglines.
- **Radii:** 6px (hole dots), 8px (inputs), 10px (inputs, banners), 12px (cards, buttons), 14px (hole header, sign-off), 999px (pills).
- **Hit targets:** at least 44px everywhere, and 48–56px for scoring controls. Players are outdoors, holding discs, and sometimes drunk.
- **Spacing:** gaps of 4, 6, 8, 10, 12, 14 and 16px.

## Content / Data
- **All 20 holes** (par, distance, OB summary, narrator quote, special rules) are in the `HOLES` array at the top of the Scoring App script. It's the source of truth. Total par is 62, with par 4s on holes 6 and 15.
- **Divisions, in canonical order:** MPO, FPO, MP40, FP40, MP50, MP55, MA1, FA1, MA40, MA50, MA60, MA2, FA2, MA3, FA3. No juniors. The final list depends on sign-ups.
- **Schedule:**
  - **Sun Nov 15:** warm-up doubles. Sign up 12:30 ($15 + $1 ace pool), start 1:00.
  - **Sat Nov 21 (R1):**
    - Ams (except MA1 & MA40): check-in and players meeting 8:00, tee off 9:00.
    - Pros + MA1 & MA40: players meeting 12:30, tee off 1:00.
  - **Sun Nov 22 (R2):**
    - Ams: tee off 9:00.
    - Pros + MA1 & MA40: players meeting 12:30, tee off 1:00.
    - Everyone: raffle 5:00, awards 6:30.
- **House rules:** copy them from `houseRules` in the Scoring App script.

## Assets
- `assets/wordmark-bare-bones-cut.png`: chrome "Bare Bones" wordmark (club art; transparent PNG).
- `assets/coursemap-thumb.png`: course map thumbnail. The full layout is in `Jewel XI Course Map.dc.html` (1700×1100).
- `assets/mohave-lowres.png`: sponsor logo (low-res placeholder; get finals from the TD).
- Icons are Unicode glyphs in the prototype. Swap them for an icon set (e.g. Lucide) if you want.

## Files
- `Jewel XI Scoring App.dc.html`: the player app prototype (all 4 tabs, scoring, sign-off, leaderboard logic, hole data).
- `Jewel XI Card Builder.dc.html`: the TD builder prototype (CSV import, assignment algorithm, locks, manual moves, export, publish).
- `Jewel XI Course Map.dc.html`: the course map layout, for reference on the Course tab.
- `support.js`: prototype runtime, only needed to open the files locally. **Don't port it.**

## Suggested build order
1. Supabase schema, RLS policies, and seed data (holes and divisions).
2. Card Builder with CSV import and publish, because card assignment is the biggest pain point.
3. Player scorecard with offline queue and sign-off/submit.
4. Leaderboard (Realtime), then the Course and Info tabs.
5. PWA, QR card links, and a TD dashboard (who hasn't submitted yet, and paper entry).
