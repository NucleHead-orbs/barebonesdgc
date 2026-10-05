/**
 * Tour shirt back (locked 2026-10-05, Mike): a rock tour merch back where every "city" is a sponsor.
 * One line per visible sponsor: the "date" slot is the hole ("HOLE 07", a pad adds its short name: "HOLE 13 AM"),
 * sponsors without a hole yet close the list as "STOP nn" (nn = their line number). Order: by hole, main tee
 * before pads, then the sponsor's sort; unassigned last by sort, then name.
 */
export interface TourSponsor { hole: number | null; tee_id: string | null; name: string; sort: number | null }
export interface TourPad { id: string; label: string; sort: number }
export interface TourLine { when: string; name: string }

const two = (n: number) => String(n).padStart(2, '0');
/** "Rec / Ladies pad" → "REC", "AM pad" → "AM". */
export const padShort = (label: string) => label.replace(/\bpad\b/i, '').split('/')[0].trim().toUpperCase().slice(0, 6);

export function tourLines(sponsors: TourSponsor[], pads: TourPad[]): TourLine[] {
  const pad = new Map(pads.map((p) => [p.id, p]));
  const named = sponsors.filter((s) => s.name.trim());
  const placed = named.filter((s) => s.hole !== null).sort((a, b) =>
    (a.hole! - b.hole!)
    || ((a.tee_id && pad.has(a.tee_id) ? pad.get(a.tee_id)!.sort : 0) - (b.tee_id && pad.has(b.tee_id) ? pad.get(b.tee_id)!.sort : 0))
    || ((a.sort ?? 0) - (b.sort ?? 0)) || a.name.localeCompare(b.name));
  const loose = named.filter((s) => s.hole === null).sort((a, b) => ((a.sort ?? 0) - (b.sort ?? 0)) || a.name.localeCompare(b.name));
  const out: TourLine[] = placed.map((s) => {
    const p = s.tee_id ? pad.get(s.tee_id) : undefined;
    return { when: `HOLE ${two(s.hole!)}${p ? ` ${padShort(p.label)}` : ''}`, name: s.name.trim() };
  });
  loose.forEach((s) => out.push({ when: `STOP ${two(out.length + 1)}`, name: s.name.trim() }));
  return out;
}

/**
 * Starting fit for the list box (px on the 1200-wide print): one column up to 18 lines, else two; rows grow to
 * fill the box (up to 72px). The proof then shrinks the font until the longest name fits its column: names are
 * never cut off.
 */
export const TOUR_AREA_H = 620;
export const TOUR_MIN_FONT = 12;
export function tourFit(n: number): { cols: 1 | 2; rowH: number; font: number } {
  const cols = n > 18 ? 2 : 1;
  const rows = Math.max(1, Math.ceil(n / cols));
  const rowH = Math.min(72, Math.floor(TOUR_AREA_H / rows));
  return { cols, rowH, font: Math.max(TOUR_MIN_FONT, Math.min(34, Math.round(rowH * 0.5))) };
}
