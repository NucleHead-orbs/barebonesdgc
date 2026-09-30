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
  facebookUrl: 'https://www.facebook.com/groups/453290991445526/', // hero button + footer link
  art: {
    skeleton: '/assets/brand/logo-skeleton.webp',          // 52×52 header lockup (keyed from Mike's art, 2026-09-27)
    skeletonMoon: '/assets/brand/logo-skeleton-moon.webp', // home hero, right column
    bonerNation: '/assets/art/boner-nation-crew.webp', // the crew, names on the discs
  },
  bonerNationCopy: '', // TODO: mascot-origin copy. Paragraph hidden until set (section shows with the art).
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

/** Boner Nation gallery (Home). Files in public/assets/art: <name>.webp (full) + <name>-thumb.webp (360px square). */
export const GALLERY: Array<{ name: string; alt: string }> = [
  { name: 'boner-nation-crew', alt: 'Boner Nation: the skeleton pouring one out for the crew, names on the discs' },
  { name: 'boner-nation-reggae', alt: 'Boner Nation: reggae skeleton with a guitar on the beach' },
  { name: 'grip-and-rip', alt: 'Bare Bones Disc Golf Club: skeleton rising from a grave, "Grip & Rip" headstone' },
  { name: 'bare-bones-pigtails', alt: 'Bare Bones Disc Golf Club: purple skeleton with pigtails' },
  { name: 'merry-christmas-boners', alt: 'Merry Christmas from the Boners: the skeleton on Santa\'s lap' },
];

/**
 * Music page. Files in public/music: <slug>.mp3 + <slug>.webp (600px square cover).
 * A track without `length` has no audio yet and shows as "coming soon". `cover` overrides <slug>.webp.
 */
export interface MusicTrack { slug: string; title: string; note?: string; length?: string; cover?: string }
export interface MusicRelease { title: string; kicker: string; tracks: MusicTrack[] }
export const MUSIC = {
  artist: 'The Boneheaded Boy',
  youtubeMusic: 'https://music.youtube.com/channel/UCiqbewAUHg4A_S3wVQMiAkg',
  logo: '/music/bhb-logo.webp',
  releases: [
    {
      title: "Jewel XI: Freedom Don't Wear Stripes", kicker: 'EP · 2026',
      tracks: [
        { slug: 'throw-it-like-andy-p', title: 'Throw It Like Andy P', length: '5:46' },
        { slug: 'whoa-shit', title: 'Whoa Shit!', length: '5:06' },
        { slug: 'corn-nuts', title: 'Corn Nuts!', length: '5:23' },
        { slug: 'no-peace-here-man', title: 'No Peace Here Man' },
        { slug: 'gator-gangbang', title: 'Gator Gangbang', length: '4:40' },
        { slug: 'lumen-limit-city', title: 'Lumen Limit City', length: '5:07' },
        { slug: 'get-rolley', title: 'Get Rolley' },
      ],
    },
    {
      title: 'Singles', kicker: 'More from the Boners',
      tracks: [
        { slug: 'wheres-dave', title: "Where's Dave?", length: '5:09', cover: '/music/bhb-logo.webp' },
        { slug: 'the-jewel-x', title: 'The Jewel X', length: '3:10' },
        { slug: 'boner-nation', title: 'Boner Nation', length: '2:14' },
        { slug: 'boners-rise', title: 'Boners Rise!', note: 'Cover', length: '2:40' },
      ],
    },
  ] as MusicRelease[],
};
