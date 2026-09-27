# Handoff: Bare Bones Club Website (master brand + Jewel XI skin)

## Overview
Public website for Bare Bones Disc Golf Club (Mesa, AZ) plus the Jewel XI event section. Two visual layers: the **master brand** (evergreen club) and an **event skin** (`data-theme="jewel-xi"`) that re-themes the event pages. It goes into the existing repo **NucleHead-orbs/barebonesdgc** (Vite + React + TS, Supabase, Cloudflare Pages) next to the scoring app, which is already built.

Pages in scope: **Home** (`/`), **Jewel XI Overview** (`/jewel-xi`), **Course guide** (`/jewel-xi/course`), **Sponsors** (`/sponsors`, and a skinned `/jewel-xi/sponsors`).
Out of scope (link only, do not rebuild): Live Scores / scorecard (existing `/jewel` + `/c/:token` routes; to be exposed at `/jewel-xi/live`), and the TD Card Builder (`/td`). Registration and payment always link out to Disc Golf Scene.

## About the Design Files
The files in this bundle are **design references created in HTML**: prototypes that show the intended look and behavior. They are not production code to copy directly. The task is to **recreate them in the barebonesdgc codebase** using its existing patterns (React + TS, the CSS-variable approach already in `src/index.css`). `_ds_bundle.js` and the `.jsx` files exist only to make the prototypes run in a browser.

## Fidelity
**High-fidelity.** Colors, type, spacing, radii and copy are final. Recreate them exactly. Jewel XI tokens match `design/README.md` and `src/index.css` in the repo.

## Theming architecture (implement first)
- `tokens/colors.css`, `typography.css`, `spacing.css` → `:root` (master).
- `tokens/themes/jewel-xi.css` → `[data-theme="jewel-xi"]`, which overrides the **semantic** tokens only.
  - Sub-modifiers: `data-palette="electric|sunset|toxic|blood"` and `data-bg="navy|black|charcoal"`.
- Components read only semantic tokens: `--bg-page/app/surface/raised`, `--border`, `--fg-1/2/3`, `--accent-a/b/c`, `--accent-gold`, `--on-accent`, `--cta-bg/fg`, `--header-bg/rule`, `--score-*`, `--sponsor-*`, `--font-display/label/body/hand`, `--label-weight`, `--display-case`, `--btn-shadow`.
- Put `data-theme="jewel-xi"` on the layout wrapper for every `/jewel-xi/*` route. The scoring app already uses these values, so it can adopt the same attribute.
- Fonts come from Google Fonts: Luckiest Guy, Rubik 400–900, Metal Mania, Archivo Black, Archivo 500/700, and Permanent Marker.

## Design Tokens
**Master**
- Night `#0f1512`, surface `#161f1a`, raised `#212c26`, line `#33423a`, subtle `#26322b`
- Ink `#17201c`, bone `#efe8cf` / `#d9d0b2`, muted `#9aa89f`, placeholder `#6d7b72`
- Lime `#a6d93b` (CTA, links, active nav), lime deep `#7fae22`
- Purple `#9a63a6` (brand display color), frosting `#b98bd0`
- Art-only colors: teal `#3f9e86`, beer `#8a5a24`, fire `#f0662a`
- Gold `#f2c230`
- Type:
  - Display: Luckiest Guy, uppercase.
  - Labels: Rubik 800, uppercase, 1–2px tracking.
  - Body: Rubik 400/500.
  - Narrator: Permanent Marker.
- Button shadow: `0 3px 0 #000`.

**Jewel XI**
- Navy `#141c2e` (app), page `#0b1020`, surface `#101728`, raised `#1d2746`, border `#2a3558`
- Black `#0d0d0d`, charcoal `#2e2e30`
- Palettes (a/b/c):
  - Electric `#29e1ff / #7b5cff / #ff3ad1` (default)
  - Sunset `#ff2e88 / #ff7a1a / #ffd23f`
  - Toxic `#c6ff3d / #29d69a / #1b8fd9`
  - Blood `#ff4b3e / #b0102d / #ff8a7a`
- Gold `#ffd23f`
- Gradients:
  - CTA: `linear-gradient(90deg,a,b,c)`
  - Header: `linear-gradient(180deg,#1b2440,#141c2e)`
  - Sponsor panel: `linear-gradient(180deg,#e6c46a,#a47d2c)`
  - Chrome silver: `linear-gradient(180deg,#f2f2f5,#9ea1ab)`
- Type:
  - Display: Metal Mania, mixed case.
  - Labels: Archivo Black, uppercase, 1–3px tracking.
  - Body: Archivo 500/700.
- Button shadow: none.

**Shared**
- Score colors: under par `#c6ff3d` (master uses lime), even `#fff`, over par `#ff8a7a`, error `#ff4b3e`.
- Spacing: 4, 6, 8, 10, 12, 14, 16, 24, 32, 48, 64.
- Radii: 6 dots · 8 inputs/buttons · 10 banners · 12 cards/large buttons · 14 hole header · 999 pills.
- Borders: 2px structural, 3px emphasis.
- No drop shadows other than the master button shadow.
- Hit targets: 44 minimum, 48–56 for scoring.
- Content max width 1120px.
- Focus ring: 3px `--accent-gold`, offset 2px.
- Motion: 150ms `cubic-bezier(.2,.8,.2,1)`. Respect `prefers-reduced-motion`.

## Components (`components/`)
Each has `.jsx` (reference implementation), `.d.ts` (props contract) and `.prompt.md` (usage).
- **Button**: variants `cta | accent | outline | outline-accent | gold | danger | ghost`; sizes sm 32 / md 44 / lg 52px high, padding 0 10 / 0 16 / 0 22.
  - Radius 8, or 12 for lg.
  - Label font, uppercase, 1px tracking, font size 11 / 13 / 15.
  - Hover: brightness(1.1). Press: translateY(2px). Disabled: opacity .45.
  - `href` renders an `<a>`.
- **Chip**: pill, 40px high (sm 28), 2px border.
  - Active: filled `--accent-c` with dark text.
- **SegmentedControl**: 2px accent border, 40px segments.
  - Tone a (accent-a, dark text) or tone b (accent-b, white text); optional pill shape.
- **Toggle**: 40×22 track, 16px knob, slides 18px.
- **HoleRing**: 40px circle, black fill, 3px ring.
  - Ring color: par 3 = accent-a, par 4 = accent-c, mixed = gold.
- **ToPar**: label is E / +n / −n, color-coded by score. `tile` = 56px filled tile.
- **NarratorQuote**: Permanent Marker 17px with an optional "The narrator, hole N" caption.
- **TourList**: rows of date / title / note on a `minmax(88px,120px) 1fr` grid.
  - 12px row padding, 1px top border.
  - Dates in accent-a, label font.
  - Optional "Tour Stop NN / NN" kicker in accent-c.
- **SectionHeading**: kicker (11px label font, 2px tracking, accent-c) + display heading (xl 72 / l 48 / m 34 / s 24) + right-hand aside in accent-a.
- **Card**: 2px border, radius 12, surface background.
  - Header row on `--bg-raised`, padding 10 12, title in label font 16px accent-c.
  - `tone`: locked (lime border), bad (red), hit (gold).
- **Banner**: padding 10 14, radius 10, 13px bold.
  - Tones: info (raised fill), warn (gold border on a 10% gold tint), error (red), success.
- **InsetFrame**: absolutely positioned 3px `--accent-b` border inset 14px, drawn above the content.
- **SponsorPanel**: `--sponsor-bg` (bone in master, amp gold in Jewel XI), 3px border, radius 12.
  - Title in display font, 30px.
  - Logos 56px high on white chips.
  - A sponsor without a final logo shows a **dashed name slot**. Never fake a logo.

## Screens / Views
All pages share a sticky header, the page body, and a footer.

**MasterHeader** (Home, Sponsors)
- Background `--header-bg` (ink), 3px bottom rule `--header-rule` (lime). Row: max width 1120, padding 10 20.
- Logo: `assets/brand/logo-skeleton.png` at 52×52, plus a two-line wordmark:
  - "BARE BONES" in Luckiest Guy 26px, frosting `#b98bd0`.
  - "DISC GOLF CLUB" 13px, lime.
- Nav: Home / Jewel XI / Sponsors in the label font, 13px, 1.5px tracking, padding 12.
  - Active item: lime text with a 3px lime underline.
- CTA button "Register", linking to DGS.

**JewelHeader** (all `/jewel-xi/*`)
- Background: header gradient, 2px bottom rule in accent-b.
- Chrome wordmark `wordmark-bare-bones-cut.png` at 132×56, links to Home.
- Title "Jewel XI World Tour" in Metal Mania 24px.
- Subtitle "NOV 21–22 · STRIPE SHOW GC · MESA" in Archivo Black 11px, 2px tracking, accent-c.
- "‹ Club home" link on the right.
- Tabs: Overview / Course / Live Scores ↗ / Sponsors, 12px, padding 10 14.
  - Active tab: accent-a text with a 3px top border.
  - Live Scores opens the scoring app.

**Footer**
- 2px top border.
- "Don't be a Dick, Be a Boner." in Permanent Marker 20px.
- Links: Facebook group · Disc Golf Scene · TD login (muted).
- Small print (12px, `--fg-3`): "Bare Bones Disc Golf Club · Mesa, AZ". Jewel pages append "· Jewel XI presented by Innova".

**1. Home** (master)
- **Hero:** radial background `#1f2a24` → night. Two-column auto-fit grid (min 320px each), padding 48 20.
  - Kicker "DISC GOLF CLUB · MESA, AZ", 13px, lime.
  - H1 "Don't be a Dick, / Be a Boner." at clamp(44px, 7vw, 72px), line-height .95. Second line in lime.
  - Body copy (18px, `--fg-2`, max width 480): "We throw plastic, drink beer and talk trash. Leagues all year, one stupid-big tournament every November. Come bend like the boner."
  - CTAs: "Jewel XI · Nov 21–22" (cta lg) and "Join the Facebook group" (outline lg).
  - Right column: `logo-skeleton-moon.png`, max width 440.
- **Jewel teaser band:** `data-theme="jewel-xi"`, wrapped in InsetFrame, padding 56 44, two-column grid.
  - SectionHeading, kicker "Next event · Freedom's Final Jewel", title "The Jewel XI World Tour".
  - Hand-lettered line "Crank up your Boners!" in accent-a.
  - Body copy about 20 holes / par 62 and the venue a.k.a. joke.
  - CTAs: "Register on Disc Golf Scene" (cta) and "Tour info" (outline-accent).
  - TourList:
    - Oct 2 · open registration
    - Nov 15 · warm-up doubles
    - Nov 21 · Round 1
    - Nov 22 · Round 2 + raffle + awards
- **Boner Nation:** `boner-nation-crew.png` (radius 14, 4px ink border) next to a SectionHeading "Boner Nation" with the mascot-origin copy and a "Sponsors & Fan Club" outline button.
- **Sponsor strip:** SponsorPanel.

**2. Jewel XI Overview**
- **Hero:** InsetFrame on `--bg-app`, padding 64 44.
  - Kicker "Freedom's Final Jewel · Presented by Innova", 12px, 3px tracking, accent-c.
  - H1 "The Jewel XI / World Tour" in Metal Mania at clamp(52px, 9vw, 88px).
  - "Nov 21–22, 2026 · Mesa, AZ" in label font, 16px.
  - A.k.a. line with all four venue names; the middle names are struck through as a joke.
  - CTAs: "Register on Disc Golf Scene" and "The Setlist (course)".
- **Warn banner:** "Sponsor sign-ups opened Sep 26, 3:00 PM MDT. Open registration opens Oct 2. Registration and payment happen on Disc Golf Scene."
- **Schedule:** auto-fit grid of Cards (min 280px). One Card per day, each holding a TourList. Data is in `data.js`.
- **Divisions:** 15 chips.
  - Tapping a chip shows its wave in the SectionHeading aside.
  - PM wave (1:00): MPO, FPO, MP40, FP40, MP50, MP55, MA1, MA40.
  - Every other division is the AM wave (9:00).
- **Course teaser:** course map image next to "The Setlist · 20 holes · par 62", with "Hole-by-hole guide" and "Live scores ↗" buttons.

**3. Course guide ("The Setlist")**
- Layout: max width 720, padding 24 16.
- SectionHeading: kicker "The Course Formally Known as Fiesta Lakes", aside "Par 62".
- Map image with radius 10.
- Accordion inside a 2px-bordered surface (radius 12), 20 rows.
  - Row: 60px minimum height, padding 10 12.
  - Contents: HoleRing, "Par N · D ft" in label font 14px, OB summary (12px bold accent-c), and a +/− indicator.
  - Expanded: raised background, then NarratorQuote plus special rules in accent-a (13px bold), padding 4 16 16 64.
  - One row open at a time; hole 1 opens by default.
- Data comes from the Supabase `holes` seed (`supabase/migrations/20260926000100_jewel_seed.sql`). **Read it from Supabase in production.**

**4. Sponsors** (master at `/sponsors`, skinned at `/jewel-xi/sponsors`)
- H1 "Sponsors" or "Sponsors & Fan Club".
- SponsorPanel.
- Auto-fit grid of per-sponsor Cards (header = tier). A sponsor without a logo shows a "logo pending" meta and a dashed placeholder.
- Fan Club block: copy plus "Sponsor on Disc Golf Scene" CTA. Tiers are TBD from the TD, so leave the info banner in place until they're supplied.

## Interactions & Behavior
- Navigation is client-side routing (the prototype uses local state and scrolls to the top on page change).
- Every "Register" or "Sponsor" CTA links to `https://www.discgolfscene.com/tournament/The_Bare_Bones_Jewel_XI_Presented_by_Innova_at_Stripe_Show_Golf_Course_2026` with `target="_blank"`.
- Live Scores links to the scoring app route. The prototype uses an alert as a stand-in.
- Division chips toggle, and only one can be selected.
- The course accordion has one open row at a time and sets `aria-expanded`.
- Responsive: two-column sections use `repeat(auto-fit,minmax(300–320px,1fr))`, so they stack below about 640px. Hero type uses `clamp()`. JewelHeader tabs scroll horizontally.
- No loading or error states in the static pages. The course guide should show a skeleton while it loads holes from Supabase, and a Banner (error tone) if the load fails.

## State
- Route.
- Selected division (Overview page).
- Open hole (Course page).
- Holes, divisions and sponsors should come from Supabase or config instead of `data.js`.

## Assets (`assets/`)
- `brand/logo-skeleton.png`, `logo-skeleton-moon.png`, `logo-skeleton-moon-wide.png`: club mascot lockups (user-supplied). Never redraw.
- `brand/wordmark-bare-bones-cut.png`: chrome wordmark, Jewel XI skin (from the repo `public/assets`).
- `art/*`: seasonal mascot art. `leagues/*`: RBFL marks.
- `events/jewel-xi/coursemap-thumb.png`: course map (repo).
- `sponsors/mohave-lowres.png`: **low-res, get the final file.** Innova logo: **missing.**
- Still missing from the original handoff: `skull-clean.png`, the Jewel XI skull knockouts, character art, flier and shirts.

## Files
- `ui_kits/website/index.html`: runnable prototype (open it locally; it loads `../../_ds_bundle.js`).
- `ui_kits/website/*.jsx`: SiteChrome, HomeScreen, JewelScreen, CourseScreen, SponsorsScreen. `data.js` holds the content.
- `components/**`: primitives with `.d.ts` contracts.
- `tokens/**` and `styles.css`: drop-in CSS variables.
- `DESIGN_SYSTEM.md`: full brand guide covering voice, visual foundations and iconography.
