/**
 * Player pack bags (locked 2026-10-07, Mike: pre-package the amateur packs, a shirt and a disc, for speed and fairness).
 * Source of truth: players (name, division, shirt_size) + divisions (wave_default). Nothing new is stored.
 * Rules:
 *   - Who gets a bag: the divisions the TD picks; amateur divisions (second letter A: MA1, FA2, MA40…) by default.
 *   - Labels sort by last name, so the pack table finds a bag the way people say their name.
 *   - The bag's size is the normalized shirt size; no size = "NO SHIRT" (disc only), still gets a bag.
 */
import { SIZES, normalizeSize, type Size } from './prep';

export const isAmateur = (div: string) => /^[A-Z]A/.test(div.trim().toUpperCase());

/** "Danny Walden" -> { last: 'Walden', first: 'Danny' }; one word = last name only. */
export function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: '', last: parts[0] ?? '' };
  // keep suffixes with the last name: "Axl Anhyzer Jr" -> last "Anhyzer Jr"
  const suffix = /^(jr|sr|ii|iii|iv)\.?$/i.test(parts[parts.length - 1]);
  const lastLen = suffix && parts.length > 2 ? 2 : 1;
  return { first: parts.slice(0, parts.length - lastLen).join(' '), last: parts.slice(parts.length - lastLen).join(' ') };
}

export interface PackRow { id: string; name: string; first: string; last: string; div: string; size: Size | null; raw: string | null; wave: 'AM' | 'PM' | null }

export function packRows(
  players: Array<{ id: string; name: string; div_code: string; shirt_size?: string | null }>,
  divs: string[], waveOf: (div: string) => 'AM' | 'PM' | null,
): PackRow[] {
  const take = new Set(divs);
  return players.filter((p) => take.has(p.div_code)).map((p) => {
    const { first, last } = splitName(p.name);
    return { id: p.id, name: p.name, first, last, div: p.div_code, size: normalizeSize(p.shirt_size), raw: p.shirt_size?.trim() || null, wave: waveOf(p.div_code) };
  }).sort((a, b) => a.last.localeCompare(b.last, undefined, { sensitivity: 'base' }) || a.first.localeCompare(b.first, undefined, { sensitivity: 'base' }));
}

/** How many bags of each size to pack (sizes in the standard order), plus disc-only bags. */
export function packCount(rows: PackRow[]): { sizes: Array<{ size: Size; n: number }>; noShirt: number; total: number } {
  const by = new Map<Size, number>();
  for (const r of rows) if (r.size) by.set(r.size, (by.get(r.size) ?? 0) + 1);
  return { sizes: SIZES.filter((s) => by.has(s)).map((s) => ({ size: s, n: by.get(s)! })), noShirt: rows.filter((r) => !r.size).length, total: rows.length };
}

/** What the check-in screen says once someone is in: "Bag: L" / "Bag: disc only". */
export const bagLine = (size: string | null | undefined) => {
  const s = normalizeSize(size);
  return s ? `Bag: ${s} shirt` : size?.trim() ? `Bag: "${size.trim()}" shirt` : 'Bag: disc only (no shirt size)';
};
