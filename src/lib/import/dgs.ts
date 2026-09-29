/**
 * Disc Golf Scene registration export -> player import rows.
 * Verified against the real Jewel X export (2025-11-01).
 *
 * Privacy rule: only Division, Name (or First+Last), PDGA#, Registration date,
 * the "Jewel hole sponsor" flag, T-shirt size, and an optional Rating column are ever read.
 * Sponsor dollar amounts and Notes stay in the file. Email, phone, address, and
 * payment columns never leave the file. The players table is public-read.
 */
import Papa from 'papaparse';
import { normalizeSize } from '../prep/prep';

export type Field = 'division' | 'name' | 'first' | 'last' | 'pdga' | 'regDate' | 'rating' | 'sponsor' | 'shirt';
export type Mapping = Partial<Record<Field, string>>; // field -> exact header text

export interface ImportRow {
  name: string;
  div_code: string;
  pdga: string | null;
  rating: number | null;
  reg_order: number;
  /** Standard size when recognizable ("Large" -> "L"); odd values kept as typed so the TD sees them. */
  shirt_size?: string | null;
}

export interface SkippedRow {
  line: number; // 1-based line in the file (header = 1)
  name: string;
  reason: 'footer' | 'no_name' | 'sponsor_only' | 'unknown_division';
  detail?: string;
}

/** A registrant flagged as a Jewel hole sponsor (players and SPON-only entries alike). */
export interface SponsorRow {
  name: string; // registrant name as listed; the TD sets the public display name in /td
  line: number;
}

export interface DgsParseResult {
  headers: string[];
  mapping: Mapping;
  rows: ImportRow[];
  sponsors: SponsorRow[];
  skipped: SkippedRow[];
  blocking: string[]; // import must not proceed while non-empty
}

// Exact DGS headers first; loose matches only as a fallback for other exports.
const RULES: Record<Field, { exact: string[]; loose: (h: string) => boolean }> = {
  division: { exact: ['division'], loose: (h) => /\b(div|division|class)\b/.test(h) },
  name: { exact: ['name'], loose: (h) => h === 'player' || h === 'player name' || h === 'full name' },
  first: { exact: ['first name'], loose: (h) => h.includes('first') },
  last: { exact: ['last name'], loose: (h) => h.includes('last') },
  pdga: { exact: ['pdga#'], loose: (h) => h.includes('pdga') },
  regDate: { exact: ['registration date mdt'], loose: (h) => h.startsWith('registration date') || h === 'registered' },
  rating: { exact: ['rating'], loose: (h) => h.includes('rating') },
  sponsor: { exact: ['jewel hole sponsor'], loose: (h) => h.includes('sponsor') && !h.includes('$') },
  shirt: { exact: ['t-shirt size', 'shirt size'], loose: (h) => h.includes('shirt') && !h.includes('$') },
};

/** DGS size cell -> stored size. Numbers / yes-flags are not sizes. */
export function shirtCell(v: unknown): string | null {
  const raw = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const n = normalizeSize(raw);
  if (n) return n;
  return /[a-z]/i.test(raw) && !/^(y|yes|no|n|x|true|false|n\/a|none)$/i.test(raw) ? raw.slice(0, 12) : null;
}

export function detectMapping(headers: string[]): Mapping {
  const norm = headers.map((h) => h.replace(/^\uFEFF/, '').trim().toLowerCase());
  const taken = new Set<number>();
  const m: Mapping = {};
  for (const pass of ['exact', 'loose'] as const) {
    for (const f of Object.keys(RULES) as Field[]) {
      if (m[f]) continue;
      const i = norm.findIndex((h, idx) =>
        !taken.has(idx) && (pass === 'exact' ? RULES[f].exact.includes(h) : RULES[f].loose(h)));
      if (i >= 0) { m[f] = headers[i]; taken.add(i); }
    }
  }
  return m;
}

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
export const nameKey = (n: string) => clean(n).toLowerCase();
/** DGS writes 1 for a purchased add-on; accept the obvious spellings too. */
const isYes = (v: unknown) => /^(y|yes|x|true)$/i.test(clean(v)) || parseInt(clean(v), 10) > 0;

export function parseDgsCsv(text: string, divisionCodes: string[], override?: Mapping): DgsParseResult {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: 'greedy' });
  const headers = parsed.meta.fields ?? [];
  const mapping = { ...detectMapping(headers), ...override };
  const blocking: string[] = [];
  if (!mapping.division) blocking.push('No division column found. Pick it in the column mapping.');
  if (!mapping.name && !(mapping.first && mapping.last)) blocking.push('No name column found. Pick Name, or First name + Last name.');
  if (blocking.length) return { headers, mapping, rows: [], sponsors: [], skipped: [], blocking };

  const known = new Set(divisionCodes);
  const kept: Array<{ row: Omit<ImportRow, 'reg_order'>; date: string; line: number }> = [];
  const skipped: SkippedRow[] = [];
  const sponsors: SponsorRow[] = [];
  const sponsorSeen = new Set<string>();

  parsed.data.forEach((r, i) => {
    const line = i + 2;
    const rawDiv = clean(r[mapping.division!]);
    const name = mapping.name ? clean(r[mapping.name]) : clean(`${r[mapping.first!] ?? ''} ${r[mapping.last!] ?? ''}`);
    if (/^totals?$/i.test(rawDiv)) return void skipped.push({ line, name, reason: 'footer' });
    if (!name) return void skipped.push({ line, name, reason: 'no_name' });
    // Sponsor flag is read before any division filter: SPON-only registrants are sponsors too.
    if (mapping.sponsor && isYes(r[mapping.sponsor]) && !sponsorSeen.has(nameKey(name))) {
      sponsorSeen.add(nameKey(name));
      sponsors.push({ name, line });
    }
    const div = (rawDiv.toUpperCase().match(/[A-Z]{2,4}\d{0,2}/) ?? [''])[0];
    if (div === 'SPON') return void skipped.push({ line, name, reason: 'sponsor_only' });
    if (!known.has(div)) return void skipped.push({ line, name, reason: 'unknown_division', detail: rawDiv });
    const pdga = mapping.pdga ? clean(r[mapping.pdga]).replace(/\D/g, '') || null : null;
    const ratingRaw = mapping.rating ? parseInt(clean(r[mapping.rating]), 10) : NaN;
    kept.push({
      row: { name, div_code: div, pdga, rating: Number.isFinite(ratingRaw) && ratingRaw > 0 ? ratingRaw : null,
             shirt_size: mapping.shirt ? shirtCell(r[mapping.shirt]) : null },
      date: mapping.regDate ? clean(r[mapping.regDate]) : '',
      line,
    });
  });

  // Registration order comes from the date, never file order (DGS groups by division).
  // Undated rows go last, in file order.
  const ordered = kept.slice().sort((a, b) =>
    (a.date ? 0 : 1) - (b.date ? 0 : 1) || a.date.localeCompare(b.date) || a.line - b.line);
  const rows = ordered.map((k, i) => ({ ...k.row, reg_order: i + 1 }));

  // Two different people with one name would merge on re-import. Stop and make the TD disambiguate.
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(nameKey(r.name), (seen.get(nameKey(r.name)) ?? 0) + 1);
  const dupes = [...seen].filter(([, n]) => n > 1).map(([k]) => rows.find((r) => nameKey(r.name) === k)!.name);
  if (dupes.length) blocking.push(`Same name appears more than once: ${dupes.join(', ')}. Add a suffix (e.g. "Jr") in Disc Golf Scene or the file, then re-import.`);

  const pdgaSeen = new Map<string, string>();
  for (const r of rows) if (r.pdga) {
    const other = pdgaSeen.get(r.pdga);
    if (other && other !== r.name) blocking.push(`PDGA# ${r.pdga} is on both ${other} and ${r.name}.`);
    pdgaSeen.set(r.pdga, r.name);
  }

  return { headers, mapping, rows, sponsors, skipped, blocking };
}
