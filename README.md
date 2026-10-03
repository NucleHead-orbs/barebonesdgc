# barebones.club

One app, one Cloudflare Workers deploy: the Bare Bones club site, the Jewel XI event, and the **TD Builder**: a multi-event tool any club can run events with (Jewel XI is one saved configuration of it).

| Route | What | Who |
|---|---|---|
| `/` | Club home (master brand) | Public |
| `/sponsors` | Sponsors & Fan Club (master) | Public |
| `/leagues` | Leagues & Pop Ups: Lazy Boners, RBFL, next Pop Up, Pop Ups past | Public |
| `/tags` `/tags/:pool` | Bag tag boards, one per league (#1 on top), recent rounds | Public |
| `/tags/:pool/:n` | One tag: holder + where it's been (the QR on a physical tag lands here) | Public |
| `/tag/:token` | My Tag: a player's tags, log a casual tag round, confirm/dispute rounds they're on | Private link |
| `/gallery` | Club archive: every Jewel, the meme wall, crew photos, videos (YouTube embeds), events & fliers | Public (approved items only) |
| `/music` | Songs by The Boneheaded Boy (tracks in `MUSIC`, `src/lib/jewel/content.ts`; files in `public/music/`) | Public |
| `/jewel-xi` `/jewel-xi/course` `/jewel-xi/sponsors` | Jewel XI event site (`data-theme="jewel-xi"`); `/jewel-xi/live` → `/jewel` | Public |
| `/jewel` | Leaderboard, course guide, schedule, sponsors (tabs: `#leaders` `#score` `#course` `#info`) | Public |
| `/e/:slug/winners` | Winners Circle: exactly what the TD last posted (places + prizes) | Public |
| `/e/:slug/request` | Table QR: a player picks themselves + who they want on their card → TD's Requests tab | Public (server-validated, max 3 pending) |
| `/crew/:token` | One crew member's page: briefing + Got it, tasks, and the tools their jobs unlock (check-in, raffle, card requests, contacts), plus DESIGNS when the TD shares any | Private link |
| `/e/:slug` | Live leaderboard + course for any event built in `/td` (event skin + palette) | Public |
| `/c/:token` | Scorecard for one card (the QR code); takes the event's name + palette | Anyone holding the card's QR |
| `/td` | TD Builder: event list → Setup (build menu) · Players (import, walk-ups, check-in) · Cards & QR · Sponsors · `?view=gallery` Club Gallery (super admin) · `?view=tags` Bag Tags (league admins) | Signed-in TDs; each sees only their events |

## Sources of truth
- **Data:** Supabase project `jjywfkonerwbhpesyyxa` (West US). `supabase/migrations/` is the only schema definition. Never edit tables in the dashboard.
- **An event's configuration (the build menu):** the `events` row (club, dates, skin, palette, rounds 1–2, waves 1 or AM/PM, check-in, sponsors), its `holes`, its `divisions` (order + default wave) and `builder_settings` (card rules per round). Edited only through `td_update_event` / `td_set_holes` / `td_set_divisions` (they enforce the rules below). Jewel XI's holes/divisions were seeded by `20260926000100_jewel_seed.sql`, with the course (distances, OB, rules) replaced by `20260928000300_jewel_xi_holes_from_guide.sql`; its double-up order lives in its saved card rules (`20260928000100_jewel_card_rules.sql`).
- **Who can run an event:** super admin = `app_metadata.role = 'td'` (all events; the only one who creates events from scratch or deletes them). Event TD = a **confirmed** email listed in `event_tds` for that event. `can_td(event_id)` is the single check behind every TD RLS policy and RPC. Signing up grants nothing by itself.
- **Sponsors:** Disc Golf Scene's "Jewel hole sponsor" column → `td_import_sponsors` (adds only, never overwrites, lands hidden) → TD sets public name / hole / tier / logo and flips Visible in `/td` → Sponsors. Logos in the public `sponsor-logos` storage bucket (TD-only writes). Public sees approved sponsors only (RLS).
- **Gallery:** `gallery_items` (kind image|video, category jewel|meme|photo|event, year, jewel_no, event_label, caption, sort, hidden). Events & Fliers show one tile per `event_label` (`groupEvents`) that opens into that event's pictures. Images in the public `gallery` bucket (8 MB cap, PNG/JPG/WebP/GIF, super-admin-only writes), shrunk in the browser to 1600px WebP (GIFs untouched). Videos live on YouTube (@barebonesdiscgolfclub) and are stored as the 11-char id; the page shows the thumbnail and loads the youtube-nocookie player only on tap. Google Drive "Disc Golf/Bare Bones" is the raw archive; the Club Gallery import tags from folder names (`guessFromPath`) and dedupes on `source_path`. Pure logic: `src/lib/gallery/gallery.ts`. Everything lands hidden; the public sees approved rows only (RLS).
- **Leagues & Pop Ups:** league facts (who runs it, when, where, buy-in) in `LEAGUES`, `src/lib/leagues/leagues.ts`; a missing buy-in stays hidden. Live parts come from `events` by name: "This week's scores" = the league's newest started, non-archived event (name starts with Lazy Boners / RBFL / Root Beer Float); "Next Pop Up" = soonest non-archived event with "Pop Up" in its name that hasn't ended. No match → the button hides / the card says watch the group.
- **Bag tags:** `tag_pools` (one numbered set per league: lazy-boners, rbfl; plus golden-boners, `invite_only` = carried only by admins + core members, issued by the super admin or its pool admins) → `tags` (pool, number → holder; held/available/retired) held by `tag_members` (club-level people, unique name, private My Tag token). Rounds in `tag_matches` + `tag_match_players`; every change in the append-only `tag_history`. League admins in `tag_pool_admins` (super admin runs all). The swap rule lives once in SQL (`_tag_apply`), mirrored for previews by `swap()` in `src/lib/tags/tags.ts`: best score takes the lowest number on the round, ties keep their order, players without a tag in that league are ignored. Casual rounds: logged from My Tag, applied when everyone confirms (dispute → admin; 7-day expiry). League nights: an admin who is also the event's TD records the official finishers from the scorecard (names matched to the tag roster), once per event. Undo = latest round only, if its tags haven't moved since.
- **Event copy (schedule, register link, tagline):** `src/lib/jewel/content.ts`. House rules are empty until the TD supplies them; the section stays hidden meanwhile.
- **Card labels (`7`, `7A`):** computed by `td_publish_round` in the database. The client never builds a label; unpublished cards show "Hole 7 · group 2".
- **TD instructions:** `src/lib/td/help.ts` is the ONE source; the HELP button in /td renders it. Change a screen → change its help section in the same commit.
- **Winners Circle:** inputs in `event_prize` (added/raffle total, credit rounding, am prize name) and `division_payouts` (cash/credit, entry, payback %, fixed added, paid places, % table), `players.finish_status` (DNF/DQ/NS) and `playoffs`. Both prize tables are TD-only. All math is pure in `src/lib/prizes/payout.ts` + `winners.ts`. The public page reads only `winners_posts` (the snapshot the TD posts).
- **Volunteer stations:** `stations` (name, usual headcount), `station_needs` (one shift's override), `station_slots` (who, `claimed` = took it from their link). Shift = (day 0..n-1 from `starts_on`, AM|PM): every event day gets both, independent of scoring waves. TD edits in CREW → STATIONS; crew read the grid via `crew_home` and act only through `crew_claim_slot` / `crew_drop_slot`. Pure helpers: `src/lib/crew/stations.ts` (starter set, shifts, cell math, double-booking, CSV).
- **TD home + help:** `/td` opens on a home header (`src/routes/td/TdHome.tsx`): run-an-event steps, **What's new** from `src/lib/td/updates.ts` (newest first, each linked to a help section; NEW = newer than the last one this browser saw), and every help topic from `src/lib/td/help.ts`. Ship a TD-facing change with its help section edit and an `updates.ts` entry in the same commit.
- **Boner Rounds + scorecard:** `/scorecard` keeps a casual round on the phone (course + pars from the library, members or guests). A member saves it with their My Tag link (`round_save`; the phone remembers the link, and opening My Tag sets it). `club_rounds` / `club_round_players` (strokes + to-par computed in SQL) show on `/rounds` right away; other members confirm (`round_confirm`). A member on the round who holds a tag can put that set on the line (`round_tag_exchange` → a casual `tag_matches` row with `round_id`, every member holder on the round, score = strokes); confirming the round confirms its waiting exchange and vice versa (trigger). The saver can void (`round_void`) until tags move. Tags are declared at tee-off (locked once a score is in; `round_tag_exchange` is internal). The scorecard can save + put tag sets on the line in one call (`round_save_swap`, all or nothing); boards show waiting swaps from `tag_pending(pool)` projected with the swap rule (`projectPending`) and marked pending until the last confirmation. Helpers: `src/lib/rounds/`. Hole names: `course_holes.label` (e.g. Buffalo Ridge Outside Ring 1–5, A–H, 7, 14–18) show on the scorecard and round card; `n` stays the play order.
- **Design votes:** `design_polls` (title, question, optional `closes_at`, `closed_at`, `winner_option_id`), `design_poll_options` (this event's `design_assets` on the ballot), `design_poll_votes` (one per crew member or TD email, + comment, changeable while open). TDs build and read in PREP → VOTES (RLS select shows who picked what) and vote via `td_vote`. Crew vote on the VOTE tab via `crew_polls(token)` / `crew_vote(...)`; totals only after they vote or once it closes, never names. A ballot design's files open for crew through `crew_design_file` even when not `crew_visible`. Pure helpers: `src/lib/votes/votes.ts`.
- **Crew view:** `crew` (name, roles checkin/raffle/requests/contacts, private link token, revoked), `announcements` + `announcement_reads`, `prep_tasks.crew_id` + `prep_task_notes`, `raffle_sales`, `contacts`, `card_requests.source='crew'`. Crew open `/crew/<token>` with no login; every crew action is a token RPC (`crew_*`) checked for link, role and event. Role briefings: `src/lib/crew/crew.ts` (`ROLE_GUIDE`, the one source). Designs reach crew only when the TD flips `design_assets.crew_visible`; `crew_designs(token)` lists them (no storage paths) and the `crew-design-url` edge function signs a 1-hour URL after `crew_design_file(token, file)` checks the link, the event and the flag. No public storage policy.
- **Course library:** `courses` → `course_layouts` (source note, verified by super admin) → `course_holes` (par, feet, OB, rules). Public read; any TD saves through `td_save_layout`; `td_apply_layout` copies a layout into an event and sets `events.course_layout_id`. Pure helpers: `src/lib/courses/courses.ts`. Seeded 2026-09-29: the 10 courses Bare Bones plays; Emerald Park A/B/long-tee layouts from the club's tee sign artwork; Freedom Park's verified Jewel XI 2026 layout. Hole data never comes from UDisc (their terms forbid scraping/storing).
- **Event prep (PREP tab):** `prep_tasks` (checklist; due = event start + `due_offset_days`), `shirt_order` (extras per size, vendor, ordered), `players.shirt_size`, `design_assets` + `design_files` (every version), files in the private `event-assets` bucket at `<event_id>/<category>/<asset_id>/v<n>-<name>`. All TD-only (RLS `can_td`, storage by folder). Pure logic: `src/lib/prep/prep.ts` (starter checklist, dates, size normalizer, tally/CSV, zip layout, dashboard rollup).
- **Design proofs (Jewel XI disc, shirt, screen print, tee signs):** the proof kind lives on `design_assets.proof` (disc | shirt | screen_print | tee_signs) and the TD's saved pick in `proof_opts` (cleaned by `cleanOpts`). Palettes, foils, plastics, inks, knobs and the 20 tee-sign maps/quotes/rules: `src/lib/proofs/proofs.ts` (the one source). Renderers: `src/components/proofs/Proofs.tsx` (`ProofView`), art in `public/assets/jewel-xi/proofs/`. Tee sign par/feet come from the event's `holes`, hole sponsors from visible `sponsors`: never typed into the proof. Tee signs are narrated by Baron Von Goose, the Rule Rocker (`baron-von-goose.webp`); each hole's bubble defaults to the quote in `signs()` and the TD can rewrite it per hole in the proof (saved as `q1`..`q20` in `proof_opts`, cleaned by `cleanQuote`). The design canvas "Jewel XI Designs" on claude.ai is a scratch copy; this code is the source of truth.
- **Random draw doubles:** a round's format is `events.r1_format` / `r2_format` (singles | doubles) + `dubs_style`, set in Setup and locked once the round has cards. The draw is `teams` (round, team_no, `player_a` = captain, `player_b` null = Cali), written only by `td_set_teams` (refused once the round has scores; clears its unscored cards). `td_publish_round` refuses a card that splits a team. The team score lives on the captain's `scores`; `score_upsert` / `sign_card` route a partner to the captain, and `player_rounds` mirrors the captain's round onto the partner. The public team board reads the `team_rounds` view. Results never sum across formats: each round is its own board, divisions pay from the singles round, each doubles round pays from `round_payouts` (TD-only; entry per player, split between partners), and bag tags record from singles rounds only (`tagSources`). Draw/cards logic: `src/lib/cards/doubles.ts`. Approving a card request after Round 1 is published seats it right away (`seatRequest`, `src/lib/td/requests.ts`) and republishes.
- **Music page:** tracks, releases and covers in `MUSIC` (`src/lib/jewel/content.ts`); files in `public/music/` (`<slug>.mp3`, `<slug>.webp`, and `<slug>.lyrics.json` when `lyrics: true`). Karaoke timings are generated from each song's Suno lyrics aligned to the isolated vocal (tooling kept out of git in `Claude outputs/karaoke`). Listening stats are anonymous: a random per-browser id, `music_heartbeat` (live = seen in the last 75 s), `music_log_play` (after 30 s of real listening, once per play), public totals only via `music_stats()`; the tables themselves are private.
- **Extra tee pads + sponsor signs:** `hole_tees` (event, hole n, label, feet, par null = hole's par) are an event's extra pads; the main tee is the `holes` row, so scoring is untouched. `sponsors.tee_id` says which sign a sponsor is on (null = main tee); a trigger refuses another hole's pad and clears it when the sponsor's hole changes. TDs edit pads in Setup → Extra tee pads and pick the sign in Sponsors. Sign list, who's on which sign and the tier label (full / ½ / pad): `src/lib/proofs/teeSigns.ts`. On the proof the sponsor pic replaces the caricature and the name sits on the plate; two sponsors split the sign. Jewel XI's 7 pads (9, 10, 13, 18, 20 Rec / Ladies; 13, 20 AM) are from YT & Beard's course guide.
- **Meet the Band (`/jewel-xi/band`):** `band_members` (name, role, card, sort, hidden). Cards are site assets in `public/assets/band/` (the seeded three) or uploads in the public `gallery` bucket under `band/` (shrunk to 1200 px WebP in the browser). Super admin manages it in `/td` → THE BAND; new members start hidden. Logic: `src/lib/band/band.ts`.
- **Innova custom disc orders (PREP → INNOVA ORDER):** the source of truth is Innova's own CFR/TFR order form (.xlsx) that the TD uploads, stored untouched in `event-assets/<event_id>/innova/<order_id>/`. `src/lib/innova/form.ts` reads everything from it: sections, molds, weight classes, "out" / black cells (unavailable), yellow cells (low stock), orange names (made for customs), price per disc (the row's T formula), minimums (the data validation = per weight, the row's "Error" formula = per mold, section/notes text = section and minis rules, the Custom Pricing tab = order minimum and die/flat-top fees) and where each header box sits (label text + merged cells). EXPORT writes quantities + header into that same file (cells only, styles and formulas kept, `fullCalcOnLoad`), never the credit card / exp / CVC boxes. `disc_orders` holds only the picks (`lines`, keyed by sheet row + guarded by mold name, re-matched by name when a newer form is uploaded) and header `details` (a CHECK refuses card keys). Flight numbers: `src/lib/innova/molds.ts` (from innovadiscs.com, checked 2026-09-29), decoration only. One order per stamp die (minis need their own).
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
- **Votes:** open = no `closed_at` and `closes_at` not passed (same rule in SQL and `votes.ts`). Votes are written only by `crew_vote` / `td_vote`. An option with votes can't be removed (composite FK), and a design with votes can't be deleted; deleting the poll removes its votes and keeps the designs. Polls aren't copied when an event is duplicated.
- **Stations:** a slot must be on an event day, with this event's station and crew member. One person can't be in the same station + shift twice; two stations in one shift saves but is flagged ⚠. Crew claim only while a cell is short and drop only their own claims (TD placements stay the TD's). Duplicating carries stations + per-shift headcounts, never placements.
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
Apply `supabase/migrations/*.sql` in filename order. All twenty-nine are live on the project as of 2026-10-03 (newest: `20261018000000_tee_pads.sql`). The latest, `20260928000300_jewel_xi_holes_from_guide.sql`, sets Jewel XI distances/OB/rules from YT & Beard's course guide (par 62, 6,499 ft) and refuses to run if any par differs.
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
psql -d jewel -f supabase/tests/90_bag_tags.sql         # 47 checks: who issues, token privacy, swap/tie rules, confirm/dispute/expiry, league night once, undo
psql -d jewel -f supabase/tests/95_design_proofs.sql     # 14 checks: proof kinds/picks, crew see shared designs only, no paths leak, file check per event
psql -d jewel -f supabase/tests/97_disc_orders.sql      # 12 checks: TD-only, card data can't be stored, sent_at follows status, deletes with the event
psql -d jewel -f supabase/tests/98_golden_boners.sql     # 5 checks: pool exists + invite only, public can read it, league admins can't issue it, super admin issues 1, 2
psql -d jewel -f supabase/tests/99_doubles.sql           # 24 checks: draw rules, publish refuses split teams, partner entry/sign routes to the captain, one signature per team, team board + mirrored rounds, locks, payouts private
psql -d jewel -f supabase/tests/99s_stations.sql        # 23 checks: shifts on event days only, one person per station+shift, privacy, claim only when short, drop only own claims, duplicate carries stations not placements
psql -d jewel -f supabase/tests/99v_design_votes.sql    # 40 checks: ballot = this event's designs, one changeable vote each, totals hidden until you vote, names TD-only, close/deadline/reopen, winner on ballot, voted options locked
psql -d jewel -f supabase/tests/99w_music.sql            # 13 checks: live listeners + pause, a play counts once, no faster-than-listening plays, junk slugs refused, raw tables private
psql -d jewel -f supabase/tests/99x_proof_quotes.sql     # 3 checks: 20 full-length tee-sign bubble quotes fit in proof_opts, still capped, still an object
psql -d jewel -f supabase/tests/99y_band.sql             # 8 checks: seeded lineup in order, only the super admin adds/edits/removes, cards only from /assets/band or the band/ upload folder, hidden members private
psql -d jewel -f supabase/tests/99z_club_rounds.sql      # 32 checks: save rules (saver on it, every hole, pars, 14 days), guests, computed totals, tag exchange from a round (holders only, once per set), confirm syncs both ways, dispute, void
psql -d jewel -f supabase/tests/99zz_hole_labels.sql     # 6 checks: layouts keep hole names (1-4 letters/digits), rounds keep the names they were played with, plain 1..n stored as none
psql -d jewel -f supabase/tests/99zzz_tag_pending.sql    # 11 checks: save + swap all-or-nothing, pending list (places, confirmations, no scores), applied swaps drop off
psql -d jewel -f supabase/tests/99zzzz_tag_declare.sql   # 13 checks: no tags on the line after a saved round, event TD proposes another set (pending, holders confirm), once per set per event
psql -d jewel -f supabase/tests/99zzzzz_tee_pads.sql     # tee pads: public read, TD-only writes, sponsor tee must be that hole's pad, moving a sponsor's hole clears the pad, duplicate copies pads
```
Make a user **super admin** (event TDs need nothing here: add their email in `/td` → Setup → TDs):
```sql
update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"td"}' where email = '...';
```
**Auth URLs** (Supabase → Authentication → URL Configuration). Confirmation and reset emails link to the Site URL, so a leftover `localhost` default breaks every new TD's email confirm:
- Site URL: `https://barebonesdiscgolf.club`
- Redirect URLs: `https://barebonesdiscgolf.club/**`, `https://barebonesdgc.*.workers.dev/**`, `http://localhost:5173/**`

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
