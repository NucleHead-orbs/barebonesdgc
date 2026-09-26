# barebones.club

One app, one Cloudflare Pages deploy: the Bare Bones club site and the Jewel XI scoring system.

| Route | What | Who |
|---|---|---|
| `/` | Club site | Public |
| `/jewel` | Leaderboard, course guide, schedule, sponsors | Public |
| `/c/:token` | Scorecard for one card (the QR code) | Anyone holding the card's QR |
| `/td` | Card Builder, paper totals, unlocks | TD login only |

## Sources of truth
- **Data:** Supabase project `jjywfkonerwbhpesyyxa` (West US). `supabase/migrations/` is the only schema definition. Never edit tables in the dashboard.
- **Holes/divisions:** migration `20260926000100_jewel_seed.sql` (from the design handoff's `HOLES` array). Reference data is versioned, not hand-entered.
- **Card labels (`7`, `7A`):** computed by `td_publish_round` in the database. The client never builds a label; unpublished cards show "Hole 7 · group 2".
- **Card Builder glue:** `src/lib/td/builder.ts` (moves, locks, publish payload, import preview, error messages). A hand move locks the card the player lands on, so it survives Regenerate.
- **Card assignment:** `src/lib/cards/generate.ts` (pure, deterministic, seeded).
- **Offline writes:** `src/lib/offline/queue.ts`. Every tap lands in IndexedDB before it touches the network.
- **Design tokens:** `src/index.css`, straight from the handoff. Match them.

## Rules the system enforces
- Players never write tables directly. All scoring goes through token-gated RPCs; tokens are not publicly readable.
- Changing a score clears that card's signatures. Re-saving the same value does not.
- A card can be submitted only when complete and signed by everyone. Submitted = frozen, TD included, until the TD unlocks it.
- Paper totals (TD) override app scores and count as official.
- Republishing a round with scores is refused unless forced. A forced republish keeps scores but drops signatures/submissions on rebuilt cards.
- QR tokens belong to the slot (e.g. AM 7B), so printed codes survive regenerating cards.

## Setup
```bash
npm install --include=dev      # --include=dev matters if your shell sets NODE_ENV=production
cp .env.example .env.local   # fill in project URL + anon key (never the service_role key)
npm run dev
npm test                     # generator + offline queue
npm run build
```

### Database
Apply `supabase/migrations/*.sql` in filename order. Both are live on the project as of 2026-09-26.
Local check against plain Postgres (no Supabase needed):
```bash
psql -d jewel -f supabase/tests/00_supabase_stub.sql   # test only, never on Supabase
psql -d jewel -f supabase/migrations/20260926000000_jewel_core.sql
psql -d jewel -f supabase/migrations/20260926000100_jewel_seed.sql
psql -d jewel -f supabase/tests/10_acceptance.sql       # 39 checks
```
Make a user the TD:
```sql
update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"td"}' where email = '...';
```

### Deploy (Cloudflare Pages)
Build `npm run build`, output `dist`. Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_PUBLIC_ORIGIN` (where printed QR codes point, e.g. `https://barebonesdiscgolf.club`; defaults to the current site).
`public/_redirects` handles SPA routes. Apex domain requires the zone's nameservers on Cloudflare.

## Build order
1. ✅ Schema, RLS, RPCs, seed, acceptance tests — live on Supabase, security advisor clean except the 8 intended public RPCs
2. ✅ Card Builder (`/td`): DGS CSV import → generate → review → publish → QR sheet (code + unit tests done; live TD walkthrough pending)
3. Scorecard (`/c/:token`): offline queue, sign-off, submit
4. Leaderboard (Realtime), Course, Info
5. PWA/service worker, TD dashboard (who hasn't submitted, paper entry)
6. Field test at league rounds → Nov 15 warm-up dubs → Jewel XI Nov 21–22

## Disc Golf Scene import (verified against the real Jewel X export, 2025-11-01)
- Reads only: Division, Name, PDGA#, Registration date MDT (and a Rating column if one ever exists). Email/phone/address/payment never leave the file.
- DGS has **no registration id and no ratings**. Re-import matches PDGA# first, then exact name (case/space-insensitive). Duplicate names in a file block the import until disambiguated.
- Registration order comes from the date column (the file itself is grouped by division).
- Skips: `Totals` footer, `SPON`, unknown divisions, each with a reason.
- Never commit a real DGS export to this repo: it contains personal data.

## Known open items
- Final sponsor logo files (Mohave is a low-res placeholder).
