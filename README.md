# barebones.club

One app, one Cloudflare Workers deploy: the Bare Bones club site, the Jewel XI event, and the **TD Builder**: a multi-event tool any club can run events with (Jewel XI is one saved configuration of it).

| Route | What | Who |
|---|---|---|
| `/` | Club home (master brand) | Public |
| `/sponsors` | Sponsors & Fan Club (master) | Public |
| `/leagues` | Leagues & Pop Ups: Lazy Boners, RBFL, next Pop Up, Pop Ups past | Public |
| `/gallery` | Club archive: every Jewel, the meme wall, crew photos, videos (YouTube embeds), events & fliers | Public (approved items only) |
| `/music` | Songs by The Boneheaded Boy (tracks in `MUSIC`, `src/lib/jewel/content.ts`; files in `public/music/`) | Public |
| `/jewel-xi` `/jewel-xi/course` `/jewel-xi/sponsors` | Jewel XI event site (`data-theme="jewel-xi"`); `/jewel-xi/live` → `/jewel` | Public |
| `/jewel` | Leaderboard, course guide, schedule, sponsors (tabs: `#leaders` `#score` `#course` `#info`) | Public |
| `/e/:slug/winners` | Winners Circle: exactly what the TD last posted (places + prizes) | Public |
| `/e/:slug/request` | Table QR: a player picks themselves + who they want on their card → TD's Requests tab | Public (server-validated, max 3 pending) |
| `/crew/:token` | One crew member's page: briefing + Got it, tasks, and the tools their jobs unlock (check-in, raffle, card requests, contacts) | Private link |
| `/e/:slug` | Live leaderboard + course for any event built in `/td` (event skin + palette) | Public |
| `/c/:token` | Scorecard for one card (the QR code); takes the event's name + palette | Anyone holding the card's QR |
| `/td` | TD Builder: event list → Setup (build menu) · Players (import, walk-ups, check-in) · Cards & QR · Sponsors · `?view=gallery` Club Gallery (super admin) | Signed-in TDs; each sees only their events |

## Sources of truth
- **Data:** Supabase project `jjywfkonerwbhpesyyxa` (West US). `supabase/migrations/` is the only schema definition. Never edit tables in the dashboard.
- **An event's configuration (the build menu):** the `events` row (club, dates, skin, palette, rounds 1–2, waves 1 or AM/PM, check-in, sponsors), its `holes`, its `divisions` (order + default wave) and `builder_settings` (card rules per round). Edited only through `td_update_event` / `td_set_holes` / `td_set_divisions` (they enforce the rules below). Jewel XI's holes/divisions were seeded by `20260926000100_jewel_seed.sql`, with the course (distances, OB, rules) replaced by `20260928000300_jewel_xi_holes_from_guide.sql`; its double-up order lives in its saved card rules (`20260928000100_jewel_card_rules.sql`).
- **Who can run an event:** super admin = `app_metadata.role = 'td'` (all events; the only one who creates events from scratch or deletes them). Event TD = a **confirmed** email listed in `event_tds` for that event. `can_td(event_id)` is the single check behind every TD RLS policy and RPC. Signing up grants nothing by itself.
- **Sponsors:** Disc Golf Scene's "Jewel hole sponsor" column → `td_import_sponsors` (adds only, never overwrites, lands hidden) → TD sets public name / hole / tier / logo and flips Visible in `/td` → Sponsors. Logos in the public `sponsor-logos` storage bucket (TD-only writes). Public sees approved sponsors only (RLS).
- **Gallery:** `gallery_items` (kind image|video, category jewel|meme|photo|event, year, jewel_no, event_label, caption, sort, hidden). Events & Fliers show one tile per `event_label` (`groupEvents`) that opens into that event's pictures. Images in the public `gallery` bucket (8 MB cap, PNG/JPG/WebP/GIF, super-admin-only writes), shrunk in the browser to 1600px WebP (GIFs untouched). Videos live on YouTube (@barebonesdiscgolfclub) and are stored as the 11-char id; the page shows the thumbnail and loads the youtube-nocookie player only on tap. Google Drive "Disc Golf/Bare Bones" is the raw archive; the Club Gallery import tags from folder names (`guessFromPath`) and dedupes on `source_path`. Pure logic: `src/lib/gallery/gallery.ts`. Everything lands hidden; the public sees approved rows only (RLS).
- **Leagues & Pop Ups:** league facts (who runs it, when, where, buy-in) in `LEAGUES`, `src/lib/leagues/leagues.ts`; a missing buy-in stays hidden. Live parts come from `events` by name: "This week's scores" = the league's newest started, non-archived event (name starts with Lazy Boners / RBFL / Root Beer Float); "Next Pop Up" = soonest non-archived event with "Pop Up" in its name that hasn't ended. No match → the button hides / the card says watch the group.
- **Event copy (schedule, register link, tagline):** `src/lib/jewel/content.ts`. House rules are empty until the TD supplies them; the section stays hidden meanwhile.
- **Card labels (`7`, `7A`):** computed by `td_publish_round` in the database. The client never builds a label; unpublished cards show "Hole 7 · group 2".
- **TD instructions:** `src/lib/td/help.ts` is the ONE source; the HELP button in /td renders it. Change a screen → change its help section in the same commit.
- **Winners Circle:** inputs in `event_prize` (added/raffle total, credit rounding, am prize name) and `division_payouts` (cash/credit, entry, payback %, fixed added, paid places, % table), `players.finish_status` (DNF/DQ/NS) and `playoffs`. Both prize tables are TD-only. All math is pure in `src/lib/prizes/payout.ts` + `winners.ts`. The public page reads only `winners_posts` (the snapshot the TD posts).
- **Crew view:** `crew` (name, roles checkin/raffle/requests/contacts, private link token, revoked), `announcements` + `announcement_reads`, `prep_tasks.crew_id` + `prep_task_notes`, `raffle_sales`, `contacts`, `card_requests.source='crew'`. Crew open `/crew/<token>` with no login; every crew action is a token RPC (`crew_*`) checked for link, role and event. Role briefings: `src/lib/crew/crew.ts` (`ROLE_GUIDE`, the one source).
- **Course library:** `courses` → `course_layouts` (source note, verified by super admin) → `course_holes` (par, feet, OB, rules). Public read; any TD saves through `td_save_layout`; `td_apply_layout` copies a layout into an event and sets `events.course_layout_id`. Pure helpers: `src/lib/courses/courses.ts`. Seeded 2026-09-29: the 10 courses Bare Bones plays; Emerald Park A/B/long-tee layouts from the club's tee sign artwork; Freedom Park's verified Jewel XI 2026 layout. Hole data never comes from UDisc (their terms forbid scraping/storing).
- **Event prep (PREP tab):** `prep_tasks` (checklist; due = event start + `due_offset_days`), `shirt_order` (extras per size, vendor, ordered), `players.shirt_size`, `design_assets` + `design_files` (every version), files in the private `event-assets` bucket at `<event_id>/<category>/<asset_id>/v<n>-<name>`. All TD-only (RLS `can_td`, storage by folder). Pure logic: `src/lib/prep/prep.ts` (starter checklist, dates, size normalizer, tally/CSV, zip layout, dashboard rollup).
- **Build-menu rules (client mirror + messages):** `src/lib/td/setup.ts`.
- **Card requests / ⭐☺ tags / keep-apart:** tables `card_requests` (+ `card_request_players`), `player_private`, `keep_apart`: TD-only (RLS `can_td`), never public. Seating logic: `src/lib/cards/pairing.ts` (pure); `cardIssues()` is the one source for warnings after generate and after hand moves. Glue: `src/lib/td/requests.ts`.
- **Card Builder glue:** `src/lib/td/builder.ts` (moves, locks, publish payload, import preview, error messages). A hand move locks the card the player lands on, so it survives Regenerate.
- **Card assignment:** `src/lib/cards/generate.ts` (pure, deterministic, seeded).
- **Offline writes:** `src/lib/offline/queue.ts`. Every tap lands in IndexedDB before it touches the network.
- **Design tokens:** `src/index.css`. Master brand on `:root`, Jewel XI skin on `[data-theme="jewel-xi"]` (+ `data-palette`, `data-bg`). Components read semantic tokens only. Sources: `design/club-website/README.md` (club site) and `design/README.md` (Jewel XI).
- **Components:** `src/components/ui.tsx` (primitives), `event.tsx` (the ONE course guide + sponsor panel/grid, shared by `/jewel-xi/*` and the scoring app), `site.tsx` (headers, footer, layouts).
- **Missing from the club design bundle** (only its README arrived): Boner Nation copy, venue a.k.a. names. Fields exist in `src/lib/jewel/content.ts` (`CLUB`, `JEWEL_OVERVIEW`); blank = element hidden, never faked.

## Rules the system enforces
- Players never write tables directly. All scoring goes through token-gated RPCs; tokens are not publicly readable.
- Changing a score clears that card's signatures. Re-saving the same value does not.
- A card can be submitted only when complete and signed by everyone. Submitted = frozen, TD included, until the TD unlocks it.
- Paper totals (TD) override app scores and count as official.
- Republishing a round with scores is refused unless forced. A forced republish keeps scores but drops signatures/submissions on rebuilt cards.
- QR tokens belong to the slot (e.g. AM 7B), so printed codes survive regenerating cards.
- An event TD can only touch their own events: every write is checked per event on the server. Only the super admin creates events from scratch, adds/removes TDs, or deletes events (Jewel XI can't be deleted).
- Any TD can **duplicate** their own event (league week 2): course, format, divisions, card rules and TDs copy; players optionally (all un-checked-in); cards and scores never.
- Publishing refuses a round beyond the event's rounds, and PM cards on a single-wave event. Switching 2→1 rounds or AM/PM→single is refused while those cards exist. Removing a hole a card starts on (or with scores), or a division with players, is refused.
- With check-in on, cards are built from checked-in players only.
- Only **approved** requests shape cards, and only Round 1 (Round 2 seeds by score). Requests chain (A+B, B+C → one group of up to 5). The generator never seats a keep-apart pair together (all rounds), and seats ⭐ players with their group or ☺ players first. It only swaps players between unlocked cards, so card sizes and the hole plan don't change.
- Keep divisions together OFF = social mix: divisions are dealt round-robin so every card mixes them. A lone 1–2 player division rides with its neighbor instead of making a card of 1.
- Duplicating an event carries ⭐/☺ tags and keep-apart pairs (matched by name); requests never carry.
- **Crew:** a link only reaches its own event and dies when revoked, reissued or the event is archived. Crew can tick only tasks assigned to them, void only their own sales, update only contacts they own, and never approve their own lead. Raffle sales are voided, never deleted; the total reaches payouts only when the TD taps USE in Winners. Duplicating carries the roster with new links, never announcements, sales or notes.
- **Courses:** applying a layout copies it (same card/score safety checks as editing holes); library edits never touch events. A non-admin save clears verification; only a super admin verifies. Save to library reads the event's saved holes (with mandos), never unsaved edits.
- **Prep:** starter checklist is added once (titles already there are skipped). Shirt sizes are normalized only for counting ("Large"→L, "XXL"→2XL); an unrecognized size is shown to the TD, never silently counted. Uploads never overwrite: each is a new version; deleting a design removes its files first. Share links are signed URLs good for 7 days. Duplicating carries the checklist (unticked, dates stay relative), never designs, shirt orders or sizes.
- **Payouts:** pool = players × entry × payback % + added share (added spread by field size over divisions without a fixed amount). Only players who finished every round (official = signed/paper; live = all holes) and aren't DNF/DQ/NS place. PDGA ties: tied players split the combined % of the spots they cover, including across the cash line; a tie for 1st uses the recorded playoff winner. Cash rounds down to $1, credit to $1/$5; the leftover is always shown. Default tables: pros ≈40% paid, ams ≈1/3, weights (n−i+1)^1.5. The public page changes only when the TD taps POST RESULTS. Duplicating carries fees/tables/rounding/label, never the added total, posts or statuses.

## Setup
```bash
npm install --include=dev      # --include=dev matters if your shell sets NODE_ENV=production
cp .env.example .env.local   # optional: dev overrides; .env.production already has the public config
npm run dev
npm test                     # generator + offline queue
npm run build
```

### Database
Apply `supabase/migrations/*.sql` in filename order. All fourteen are live on the project as of 2026-09-29 (newest: `20261003000000_gallery.sql`). The latest, `20260928000300_jewel_xi_holes_from_guide.sql`, sets Jewel XI distances/OB/rules from YT & Beard's course guide (par 62, 6,499 ft) and refuses to run if any par differs.
Local check against plain Postgres (no Supabase needed):
```bash
psql -d jewel -f supabase/tests/00_supabase_stub.sql   # test only, never on Supabase
psql -d jewel -f supabase/migrations/20260926000000_jewel_core.sql
psql -d jewel -f supabase/migrations/20260926000100_jewel_seed.sql
for f in supabase/migrations/2026092[789]*.sql supabase/migrations/2026093*.sql supabase/migrations/202610*.sql; do psql -d jewel -f "$f"; done
psql -d jewel -f supabase/tests/10_acceptance.sql       # 39 checks: scoring core
psql -d jewel -f supabase/tests/20_multi_event.sql      # 43 checks: event-scoped TDs + build-menu rules
psql -d jewel -f supabase/tests/30_card_requests.sql    # 23 checks: requests, private tags, keep-apart
psql -d jewel -f supabase/tests/40_winners.sql          # 19 checks: prize privacy, posting, week-2 carry
psql -d jewel -f supabase/tests/50_event_prep.sql       # 16 checks: prep privacy, storage folders, shirt import, next-year carry
psql -d jewel -f supabase/tests/60_courses.sql          # 32 checks: library seed, who can edit/verify, apply copies, duplicate link
psql -d jewel -f supabase/tests/70_crew.sql             # 49 checks: link isolation, role gates, revoke/reissue, raffle, requests, contacts
psql -d jewel -f supabase/tests/80_gallery.sql          # 24 checks: lands hidden, public sees approved only, super-admin-only writes + storage
```
Make a user **super admin** (event TDs need nothing here: add their email in `/td` → Setup → TDs):
```sql
update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"td"}' where email = '...';
```

### Deploy (Cloudflare Workers, static assets)
Workers Builds on `main`: build `npm run build`, deploy `npx wrangler deploy` (config in `wrangler.jsonc`, output `dist`).
SPA routes (`/td`, `/jewel`, `/e/<slug>`, `/c/<token>`) are handled by `assets.not_found_handling = "single-page-application"`. Do not add `public/_redirects`: that's a Pages feature and Workers rejects it as an infinite loop.
**Client config:** `.env.production` (committed) holds the public Supabase URL, anon key and `VITE_PUBLIC_ORIGIN`; Vite bakes them in at build time, so Cloudflare needs no build variables. `.env.local` (gitignored) overrides it for dev. Only public values go in either file, never the service_role key.
Domain: `barebonesdiscgolf.club` (nameservers on Cloudflare since 2026-09-26). Attach it under the Worker's Domains & Routes.

## Build order
1. ✅ Schema, RLS, RPCs, seed, acceptance tests — live on Supabase, security advisor clean except the 8 intended public RPCs
2. ✅ Card Builder (`/td`): DGS CSV import → generate → review → publish → QR sheet
3. ✅ Scorecard (`/c/:token`): offline queue, sign-off, submit, TD unlock
3b. ✅ TD Builder (multi-event): build menu, invite-only event TDs, walk-ups + check-in, duplicate for leagues, `/e/:slug` leaderboard
4. ✅ Public `/jewel`: Leaderboard (loads on open; Realtime still to do), Course, Info, sponsors. ✅ Sponsors pipeline.
5. PWA/service worker, TD dashboard (who hasn't submitted, paper entry)
6. Field test at league rounds → Nov 15 warm-up dubs → Jewel XI Nov 21–22

## Disc Golf Scene import (verified against the real Jewel X export, 2025-11-01)
- Reads only: Division, Name, PDGA#, Registration date, the hole-sponsor flag, T-shirt size (never the `T-shirt size $` column) and a Rating column if one ever exists. Email/phone/address/payment never leave the file.
- DGS has **no registration id and no ratings**. Re-import matches PDGA# first, then exact name (case/space-insensitive). Duplicate names in a file block the import until disambiguated.
- Registration order comes from the date column (the file itself is grouped by division).
- Skips: `Totals` footer, `SPON`, unknown divisions, each with a reason.
- Never commit a real DGS export to this repo: it contains personal data.

## Known open items
- Final sponsor logo files (Mohave is a low-res placeholder).
