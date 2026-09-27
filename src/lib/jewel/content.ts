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
