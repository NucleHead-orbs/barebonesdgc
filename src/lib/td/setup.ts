/**
 * Build menu rules (pure). The database enforces the same rules in td_create_event / td_update_event /
 * td_set_holes / td_set_divisions; this file keeps the UI from ever sending something it will refuse,
 * and turns the server's refusal codes into sentences.
 */
import type { BuilderSettings } from '../cards/generate';

export type Palette = 'cosmic' | 'sunset' | 'toxic' | 'blood' | 'bone';
export type Skin = 'event' | 'jewel-xi';
export type RoundFormat = 'singles' | 'doubles';
export type DubsStyle = 'Best shot' | 'Best disc' | 'Alternate shot';
export const DUBS_STYLES: DubsStyle[] = ['Best shot', 'Best disc', 'Alternate shot'];

/** One events row: the saved build-menu selections. */
export interface EventConfig {
  id: string;
  slug: string;
  name: string;
  club_name: string | null;
  starts_on: string; // YYYY-MM-DD
  ends_on: string;
  skin: Skin;
  palette: Palette;
  rounds: 1 | 2;
  waves: 1 | 2;
  use_checkin: boolean;
  use_sponsors: boolean;
  archived: boolean;
  course_layout_id?: string | null; // library layout the course was loaded from (reference only)
  r1_format: RoundFormat;
  r2_format: RoundFormat;
  dubs_style: DubsStyle;
  /** 'league' = weekly night: no Prep/Crew/Early Access, one round, one day, a TAGS tab for its tag set. */
  kind?: EventKind;
  tag_pool_id?: string | null;
  league_id?: string | null; // the league this week belongs to (leagues table); kind + tag set follow it
}
export type EventKind = 'event' | 'league';

export const roundFormat = (ev: Pick<EventConfig, 'r1_format' | 'r2_format'>, round: number): RoundFormat =>
  (round === 2 ? ev.r2_format : ev.r1_format) ?? 'singles';
/** Any doubles round = results are shown per round (never summed across formats). */
export const hasDoubles = (ev: Pick<EventConfig, 'r1_format' | 'r2_format' | 'rounds'>) =>
  ev.r1_format === 'doubles' || (ev.rounds === 2 && ev.r2_format === 'doubles');

export interface HoleRow { n: number; par: number; dist_ft: number | null; ob: string | null; ctp_prize?: string | null }
export interface DivisionRow { code: string; wave: 'AM' | 'PM' }

export const PALETTES: Array<{ id: Palette; label: string; swatch: [string, string, string] }> = [
  { id: 'cosmic', label: 'Cosmic', swatch: ['#29e1ff', '#7b5cff', '#ff3ad1'] },
  { id: 'sunset', label: 'Sunset', swatch: ['#ff2e88', '#ff7a1a', '#ffd23f'] },
  { id: 'toxic', label: 'Toxic', swatch: ['#c6ff3d', '#29d69a', '#1b8fd9'] },
  { id: 'blood', label: 'Blood', swatch: ['#ff4b3e', '#b0102d', '#ff8a7a'] },
  { id: 'bone', label: 'Bone', swatch: ['#a6d93b', '#9a63a6', '#efe8cf'] },
];

/** PDGA codes, grouped for the picker. Anything else can be typed as a custom code. */
export const DIVISION_PRESETS: Array<{ group: string; codes: string[] }> = [
  { group: 'Pro', codes: ['MPO', 'FPO', 'MP40', 'FP40', 'MP50', 'FP50', 'MP55', 'MP60'] },
  { group: 'Am', codes: ['MA1', 'FA1', 'MA40', 'FA40', 'MA50', 'FA50', 'MA60', 'MA2', 'FA2', 'MA3', 'FA3', 'MA4', 'FA4'] },
  { group: 'Junior', codes: ['MJ18', 'FJ18', 'MJ15', 'FJ15', 'MJ12', 'FJ12', 'MJ10', 'FJ10'] },
  { group: 'League', codes: ['OPEN', 'REC', 'AM', 'WOMEN', 'NOVICE'] },
];

export const MAX_HOLES = 40;

/** Division code as the server stores it: 1–8 letters/digits, uppercase. Null = not valid. */
export function normalizeDivCode(raw: string): string | null {
  const v = raw.trim().toUpperCase();
  return /^[A-Z0-9]{1,8}$/.test(v) ? v : null;
}

/** Holes 1..n. Keeps what's there, adds par-3 blanks, drops the tail. */
export function resizeHoles(holes: HoleRow[], n: number): HoleRow[] {
  const count = Math.min(MAX_HOLES, Math.max(1, Math.trunc(n) || 1));
  const byN = new Map(holes.map((h) => [h.n, h]));
  return Array.from({ length: count }, (_, i) => byN.get(i + 1) ?? { n: i + 1, par: 3, dist_ft: null, ob: null });
}

/** First problem with a course, or null. Mirrors td_set_holes. */
export function holesProblem(holes: HoleRow[]): string | null {
  if (holes.length < 1 || holes.length > MAX_HOLES) return `A course needs 1 to ${MAX_HOLES} holes.`;
  for (const [i, h] of holes.entries()) {
    if (h.n !== i + 1) return 'Holes must be numbered 1, 2, 3… with no gaps.';
    if (!Number.isInteger(h.par) || h.par < 2 || h.par > 6) return `Hole ${h.n}: par must be 2 to 6.`;
    if (h.dist_ft != null && (!Number.isInteger(h.dist_ft) || h.dist_ft < 1 || h.dist_ft > 5000)) return `Hole ${h.n}: distance must be 1 to 5000 ft.`;
  }
  return null;
}

/** First problem with a division list, or null. Mirrors _write_divisions. */
export function divisionsProblem(divs: DivisionRow[]): string | null {
  if (!divs.length) return 'Pick at least one division.';
  const seen = new Set<string>();
  for (const d of divs) {
    if (!normalizeDivCode(d.code)) return `"${d.code}" is not a valid division code (1–8 letters or numbers).`;
    if (seen.has(d.code)) return `${d.code} is listed twice.`;
    seen.add(d.code);
  }
  return null;
}

/** A single-wave event stores everyone as AM. */
export const withWaves = (divs: DivisionRow[], waves: 1 | 2): DivisionRow[] =>
  waves === 1 ? divs.map((d) => ({ ...d, wave: 'AM' })) : divs;

export const coursePar = (holes: Pick<HoleRow, 'par'>[]) => holes.reduce((a, h) => a + h.par, 0);

export function formatSummary(ev: Pick<EventConfig, 'rounds' | 'waves'> & Partial<Pick<EventConfig, 'r1_format' | 'r2_format'>>, holeCount: number): string {
  const f = (r: number) => (roundFormat({ r1_format: ev.r1_format ?? 'singles', r2_format: ev.r2_format ?? 'singles' }, r) === 'doubles' ? 'doubles' : 'singles');
  const dubs = ev.r1_format === 'doubles' || (ev.rounds === 2 && ev.r2_format === 'doubles');
  return [
    `${holeCount} hole${holeCount === 1 ? '' : 's'}`,
    ev.rounds === 2 ? (dubs ? `R1 ${f(1)} + R2 ${f(2)}` : '2 rounds') : dubs ? '1 round of doubles' : '1 round',
    ev.waves === 2 ? 'AM/PM shotgun' : 'single shotgun',
  ].join(' · ');
}

export type Tab = 'setup' | 'prep' | 'crew' | 'early' | 'tags' | 'players' | 'requests' | 'cards' | 'winners' | 'sponsors';
/** Tabs by kind: a tournament gets Prep, Crew and Early Access; a league gets its tag set (TAGS) instead. */
export const eventTabs = (ev: Pick<EventConfig, 'use_sponsors'> & { kind?: EventKind }): Tab[] => {
  const base: Tab[] = ev.kind === 'league'
    ? ['setup', 'players', 'requests', 'cards', 'winners', 'tags']
    : ['setup', 'prep', 'crew', 'early', 'players', 'requests', 'cards', 'winners'];
  return ev.use_sponsors ? [...base, 'sponsors'] : base;
};
/** CTP holes in hole order: [{n, prize}]. */
export const ctpHoles = (holes: Array<{ n: number; ctp_prize?: string | null }>) =>
  holes.filter((h) => h.ctp_prize).map((h) => ({ n: h.n, prize: h.ctp_prize! })).sort((a, b) => a.n - b.n);

/**
 * Who goes into card generation: with check-in on, only checked-in players.
 * Round 2 of a 2-round event with check-in: only players confirmed for Round 2 (r2_in, migration 20261111).
 */
export function cardPool<P extends { checked_in?: boolean; r2_in?: boolean | null }>(players: P[], useCheckin: boolean, round: 1 | 2 = 1, rounds = 1): P[] {
  if (!useCheckin) return players;
  if (round === 2 && rounds === 2) return players.filter((p) => p.r2_in === true);
  return players.filter((p) => p.checked_in === true);
}

/** Round 2 answers among Round 1 checked-in players (the builder's "chase these" list). */
export function r2Summary<P extends { checked_in?: boolean; r2_in?: boolean | null }>(players: P[]) {
  const r1 = players.filter((p) => p.checked_in === true);
  return { r1: r1.length, in: players.filter((p) => p.r2_in === true), out: players.filter((p) => p.r2_in === false), waiting: r1.filter((p) => p.r2_in == null) };
}

/** Card rules as the event's format allows: single wave => nobody is PM. */
export function settingsForFormat(s: BuilderSettings, waves: 1 | 2): BuilderSettings {
  return waves === 1 && s.pmDivisions.length ? { ...s, pmDivisions: [] } : s;
}

export const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
export const normEmail = (e: string) => e.trim().toLowerCase();

export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Noon local time: date math never slips a day across DST or time zones. */
export const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return isoDate(d); };
export const daysBetween = (a: string, b: string) => Math.round((+new Date(`${b}T12:00:00`) - +new Date(`${a}T12:00:00`)) / 86_400_000);

export const dateRange = (e: { starts_on: string; ends_on: string }) => {
  const f = (s: string) => new Date(`${s}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return e.starts_on === e.ends_on ? f(e.starts_on) : `${f(e.starts_on)} – ${f(e.ends_on)}`;
};

/** Server refusal code -> what the TD should do. Null when the code isn't one of the build-menu rules. */
export function setupMessage(raw: string): string | null {
  const m = raw.match(/(division_in_use|holes_have_cards|holes_have_scores|no_divisions|invalid_division|duplicate_division|invalid_round|invalid_wave|round2_has_cards|round_has_cards|pm_cards_exist|invalid_name|invalid_dates|invalid_holes|protected_event|unknown_layout|courses_name_key|course_layouts_name_key)\s*([A-Z0-9]*)/);
  if (!m) return null;
  switch (m[1]) {
    case 'division_in_use': return `${m[2] ? `Division ${m[2]}` : 'A division you removed'} still has players. Move or remove them first.`;
    case 'holes_have_cards': return 'A published card starts on a hole you removed. Republish cards on fewer holes first.';
    case 'holes_have_scores': return 'Scores exist on a hole you removed, so the course can\'t shrink.';
    case 'no_divisions': return 'Pick at least one division.';
    case 'invalid_division': return 'Division codes are 1–8 letters or numbers.';
    case 'duplicate_division': return 'A division is listed twice.';
    case 'invalid_round': return 'This event isn\'t set up for that round. Change Rounds in Setup.';
    case 'invalid_wave': return 'This is a single-wave event, so PM cards can\'t publish. Regenerate the cards.';
    case 'round2_has_cards': return 'Round 2 already has cards. Clear them before switching to 1 round.';
    case 'round_has_cards': return 'That round already has cards. A round\'s format (singles/doubles) can only change before its cards are made.';
    case 'pm_cards_exist': return 'PM cards are published. Republish as one wave before switching to a single wave.';
    case 'invalid_name': return 'The event needs a name.';
    case 'invalid_dates': return 'The end date can\'t be before the start date.';
    case 'invalid_holes': return 'Check the course: 1–40 holes, par 2–6, distance 1–5000 ft.';
    case 'protected_event': return 'Jewel XI can\'t be deleted from here.';
    case 'unknown_layout': return 'That course layout isn\'t in the library anymore. Reload and pick again.';
    case 'courses_name_key': return 'A course with that name is already in the library. Pick it from the list.';
    case 'course_layouts_name_key': return 'That course already has a layout with this name.';
  }
  return null;
}
