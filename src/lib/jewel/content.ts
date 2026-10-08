/**
 * Static event copy. Source: design/README.md (handoff "Content / Data"). Holes, divisions and
 * sponsors are NOT here: they come from the database. Change copy here, in one place.
 * House rules are intentionally absent until the TD supplies them (the handoff points at a
 * prototype file that isn't in this repo); the Info tab hides the section while this is empty.
 */
import type { NewsPost } from './news';
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
  /** Open registration goes live (Arizona is UTC-7 all year). The banner flips by itself at this moment. */
  regOpensAt: '2026-10-02T17:00:00-07:00',
  regBannerBefore: 'Sponsor sign-ups opened Sep 26, 3:00 PM. Open registration opens Oct 2 at 5:00 PM Arizona time. Registration and payment happen on Disc Golf Scene.',
  regBannerOpen: 'Registration is open. Sign up and pay on Disc Golf Scene. Sponsor sign-ups are open there too.',
};

/**
 * Updates on the Jewel XI page (newest shows first). One entry per announcement, same words that went out.
 * Artwork: public/assets/jewel-xi/news/<id>.webp + <id>-thumb.webp (360px square).
 */
export const JEWEL_NEWS: NewsPost[] = [
  {
    id: 'jewel-xi-registration-opens',
    date: '2026-10-02',
    title: 'Registration opens today at 5 PM',
    art: { alt: 'The Jewel XI poster: registration opens today at 5:00 PM, Nov 21–22, 2026, Stripe Show GC, Mesa AZ. New single Lazy Boners out now.' },
    body: [
      'JEWEL XI REGISTRATION OPENS TODAY AT 5 PM.',
      'Nov 21–22. Stripe Show GC, Mesa, AZ.\nTwo days // Good people // Great golf.',
      'Eleven years of Boners. One extremely questionable rock-and-roll history. If you\'re coming, be ready when registration goes live at 5.',
      'And while you get mentally prepared for whatever the hell we\'ve turned this event into, we\'ve got something else for you.',
      'NEW SINGLE: "LAZY BONERS"',
      'The official anthem of Safety Sunday. Weaponized leisure, long rounds, good green, better people, and the sacred Bare Bones philosophy:',
      'HAVE FUN. HELP OUT. GROW THE SHORTS.',
      'Give it a spin: barebonesdiscgolf.club/music',
      'YT the Boneheaded Boy has apparently been sitting on this lost classic for decades. Nobody knows how, and nobody\'s asking.',
      'All the classics. Some for the first time.',
      'Registration opens at 5 PM today. Don\'t be late.',
      'There ain\'t no late card on a Sunday when the whole damn league is lazy.',
    ],
  },
];

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
/** `lyrics: true` = public/music/<slug>.lyrics.json exists (timed karaoke lyrics). */
export interface MusicTrack { slug: string; title: string; note?: string; length?: string; cover?: string; lyrics?: boolean }
export interface MusicRelease { title: string; kicker: string; tracks: MusicTrack[] }
export const MUSIC = {
  artist: 'YT the Boneheaded Boy',
  youtubeMusic: 'https://music.youtube.com/channel/UCiqbewAUHg4A_S3wVQMiAkg',
  logo: '/music/bhb-logo.webp',
  releases: [
    {
      // The full album, built in public: tracks land here as they're finished (newer mixes than the released EP).
      title: "Jewel XI: Freedom Don't Wear Stripes Show", kicker: 'LP · in progress',
      tracks: [
        { slug: 'throw-it-like-andy-p', title: 'Throw It Like Andy P', length: '5:46', lyrics: true },
        { slug: 'whoa-shit', title: 'Whoa Shit!', length: '5:06', lyrics: true },
        { slug: 'corn-nuts', title: 'Corn Nuts!', length: '5:23', lyrics: true },
        { slug: 'no-peace-here-man', title: 'No Peace Here Man', length: '5:09', lyrics: true },
        { slug: 'gator-gangbang', title: 'Gator Gangbang', length: '4:40' },
        { slug: 'lumen-limit-city', title: 'Lumen Limit City', length: '5:07', lyrics: true },
        { slug: 'get-rolley', title: 'Get Rolley', length: '5:29', lyrics: true },
        { slug: 'lazy-boners', title: 'Lazy Boners', length: '4:56', lyrics: true },
        { slug: 'boner-nation-jewel-xi', title: 'Boner Nation', length: '4:41' },
        { slug: 'legends-of-root-beer', title: 'Legends of Root Beer', cover: '/music/bhb-logo.webp' },
        { slug: 'gone-but-still-hard', title: 'Gone But Still Hard', cover: '/music/bhb-logo.webp' },
      ],
    },
    {
      title: 'Singles', kicker: 'More from the Boners',
      tracks: [
        { slug: 'the-jewel-x', title: 'The Jewel X', length: '3:10' },
      ],
    },
  ] as MusicRelease[],
};
