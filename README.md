# barebones.club

One app, one Cloudflare Pages deploy: the Bare Bones club site and the Jewel XI scoring system.

| Route | What | Who |
|---|---|---|
| `/` | Club home (master brand) | Public |
| `/sponsors` | Sponsors & Fan Club (master) | Public |
| `/jewel-xi` `/jewel-xi/course` `/jewel-xi/sponsors` | Jewel XI event site (`data-theme="jewel-xi"`); `/jewel-xi/live` → `/jewel` | Public |
| `/jewel` | Leaderboard, course guide, schedule, sponsors (tabs: `#leaders` `#score` `#course` `#info`) | Public |
| `/c/:token` | Scorecard for one card (the QR code) | Anyone holding the card's QR |
| `/td` | Card Builder, paper totals, unlocks | TD login only |

## Sources of truth
- **Data:** Supabase project `jjywfkonerwbhpesyyxa` (West US). `supabase/migrations/` is the only schema definition. Never edit tables in the dashboard.
- **Holes/divisions:** migration `20260926000100_jewel_seed.sql` (from the design handoff's `HOLES` array). Reference data is versioned, not hand-entered.
- **Sponsors:** Disc Golf Scene's "Jewel hole sponsor" column → `td_import_sponsors` (adds only, never overwrites, lands hidden) → TD sets public name / hole / tier / logo and flips Visible in `/td` → Sponsors. Logos in the public `sponsor-logos` storage bucket (TD-only writes). Public sees approved sponsors only (RLS).
- **Event copy (schedule, register link, tagline):** `src/lib/jewel/content.ts`. House rules are empty until the TD supplies them; the section stays hidden meanwhile.
- **Card labels (`7`, `7A`):** computed by `td_publish_round` in the database. The client never builds a label; unpublished cards show "Hole 7 · group 2".
- **Card Builder glue:** `src/lib/td/builder.ts` (moves, locks, publish payload, import preview, error messages). A hand move locks the card the player lands on, so it survives Regenerate.
- **Card assignment:** `src/lib/cards/generate.ts` (pure, deterministic, seeded).
- **Offline writes:** `src/lib/offline/queue.ts`. Every tap lands in IndexedDB before it touches the network.
- **Design tokens:** `src/index.css`. Master brand on `:root`, Jewel XI skin on `[data-theme="jewel-xi"]` (+ `data-palette`, `data-bg`). Components read semantic tokens only. Sources: `design/club-website/README.md` (club site) and `design/README.md` (Jewel XI).
- **Components:** `src/components/ui.tsx` (primitives), `event.tsx` (the ONE course guide + sponsor panel/grid, shared by `/jewel-xi/*` and the scoring app), `site.tsx` (headers, footer, layouts).
- **Missing from the club design bundle** (only its README arrived): logo lockups, Boner Nation art + copy, Facebook URL, venue a.k.a. names. Fields exist in `src/lib/jewel/content.ts` (`CLUB`, `JEWEL_OVERVIEW`); blank = element hidden, never faked.

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
cp .env.example .env.local   # optional: dev overrides; .env.production already has the public config
npm run dev
npm test                     # generator + offline queue
npm run build
```

### Database
Apply `supabase/migrations/*.sql` in filename order. All four are live on the project as of 2026-09-27.
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

### Deploy (Cloudflare Workers, static assets)
Workers Builds on `main`: build `npm run build`, deploy `npx wrangler deploy` (config in `wrangler.jsonc`, output `dist`).
SPA routes (`/td`, `/jewel`, `/c/<token>`) are handled by `assets.not_found_handling = "single-page-application"`. Do not add `public/_redirects`: that's a Pages feature and Workers rejects it as an infinite loop.
**Client config:** `.env.production` (committed) holds the public Supabase URL, anon key and `VITE_PUBLIC_ORIGIN`; Vite bakes them in at build time, so Cloudflare needs no build variables. `.env.local` (gitignored) overrides it for dev. Only public values go in either file, never the service_role key.
Domain: `barebonesdiscgolf.club` (nameservers on Cloudflare since 2026-09-26). Attach it under the Worker's Domains & Routes.

## Build order
1. ✅ Schema, RLS, RPCs, seed, acceptance tests — live on Supabase, security advisor clean except the 8 intended public RPCs
2. ✅ Card Builder (`/td`): DGS CSV import → generate → review → publish → QR sheet (code + unit tests done; live TD walkthrough pending)
3. Scorecard (`/c/:token`): offline queue, sign-off, submit
4. ✅ Public `/jewel`: Leaderboard (loads on open; Realtime still to do), Course, Info, sponsors. ✅ Sponsors pipeline.
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
