/**
 * Static event copy. Source: design/README.md (handoff "Content / Data"). Holes, divisions and
 * sponsors are NOT here: they come from the database. Change copy here, in one place.
 * House rules are intentionally absent until the TD supplies them (the handoff points at a
 * prototype file that isn't in this repo); the Info tab hides the section while this is empty.
 */
export const EVENT = {
  title: 'Jewel XI World Tour',
  subtitle: 'NOV 21–22 · STRIPE SHOW GC · MESA',
  fullName: 'The Bare Bones Jewel XI World Tour',
  presentedBy: 'Innova',
  venue: 'Stripe Show Golf Course / Freedom DGC at Fiesta Lakes, Mesa AZ',
  registerUrl: 'https://www.discgolfscene.com/tournament/The_Bare_Bones_Jewel_XI_Presented_by_Innova_at_Stripe_Show_Golf_Course_2026',
  tagline: "Don't be a Dick, Be a Boner",
};

export interface ScheduleDay { day: string; rows: Array<{ time: string; what: string }> }

export const SCHEDULE: ScheduleDay[] = [
  { day: 'Sun Nov 15 · Warm-up Dubs', rows: [
    { time: '12:30', what: 'Sign up ($15 + $1 ace pool)' },
    { time: '1:00', what: 'Start' },
  ] },
  { day: 'Sat Nov 21 · Round 1', rows: [
    { time: '8:00', what: 'Ams (except MA1 & MA40): check-in + players meeting' },
    { time: '9:00', what: 'Ams tee off' },
    { time: '12:30', what: 'Pros + MA1 & MA40: players meeting' },
    { time: '1:00', what: 'Pros + MA1 & MA40 tee off' },
  ] },
  { day: 'Sun Nov 22 · Round 2', rows: [
    { time: '9:00', what: 'Ams tee off' },
    { time: '12:30', what: 'Pros + MA1 & MA40: players meeting' },
    { time: '1:00', what: 'Pros + MA1 & MA40 tee off' },
    { time: '5:00', what: 'Raffle (everyone)' },
    { time: '6:30', what: 'Awards' },
  ] },
];

export const HOUSE_RULES: string[] = [];

// ---------------------------------------------------------------------------------------------
// Club website (design/club-website/README.md). Empty strings / arrays = not supplied yet:
// the element that needs them is hidden, never faked. Fill these in, nothing else changes.
// ---------------------------------------------------------------------------------------------
export const CLUB = {
  name: 'Bare Bones Disc Golf Club',
  place: 'Mesa, AZ',
  heroKicker: 'Disc golf club · Mesa, AZ',
  heroLines: ["Don't be a Dick,", 'Be a Boner.'] as const,
  heroBody: 'We throw plastic, drink beer and talk trash. Leagues all year, one stupid-big tournament every November. Come bend like the boner.',
  facebookUrl: '', // TODO(TD): Facebook group URL. Hero button + footer link stay hidden until set.
  art: {
    skeleton: '',     // TODO: /assets/brand/logo-skeleton.png (52×52 header lockup)
    skeletonMoon: '', // TODO: /assets/brand/logo-skeleton-moon.png (home hero, right column)
    bonerNation: '',  // TODO: /assets/art/boner-nation-crew.png
  },
  bonerNationCopy: '', // TODO: mascot-origin copy from the design bundle. Section hidden until set.
};

export const JEWEL_TEASER = {
  kicker: "Next event · Freedom's Final Jewel",
  title: 'The Jewel XI World Tour',
  hand: 'Crank up your Boners!',
  body: '20 holes, par 62, two rounds at Stripe Show Golf Course in Mesa.',
};

export const JEWEL_OVERVIEW = {
  kicker: "Freedom's Final Jewel · Presented by Innova",
  titleLines: ['The Jewel XI', 'World Tour'] as const,
  when: 'Nov 21–22, 2026 · Mesa, AZ',
  venueAka: [] as string[], // TODO: the four venue names (middle ones struck through). Line hidden until set.
  regBanner: 'Sponsor sign-ups opened Sep 26, 3:00 PM MDT. Open registration opens Oct 2. Registration and payment happen on Disc Golf Scene.',
};

export const TOUR = [
  { date: 'Oct 2', title: 'Open registration' },
  { date: 'Nov 15', title: 'Warm-up doubles' },
  { date: 'Nov 21', title: 'Round 1' },
  { date: 'Nov 22', title: 'Round 2', note: 'Raffle + awards' },
];
