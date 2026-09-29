/**
 * Course library: pure helpers (no Supabase).
 * Source of truth: courses → course_layouts → course_holes. An event COPIES a layout's holes
 * (td_apply_layout) and remembers events.course_layout_id; later library edits never change an event.
 */

export interface LibLayout {
  id: string; course_id: string; name: string; source: string | null;
  verified_at: string | null; verified_by: string | null; updated_at: string; updated_by: string | null;
  holes: number; par: number; ft: number | null; // ft null = not every hole has a distance
}
export interface LibCourse {
  id: string; name: string; city: string | null; pdga_url: string | null; pdga_holes: number | null; notes: string | null;
  layouts: LibLayout[];
}
export interface LayoutHole { n: number; par: number; dist_ft: number | null; ob: string | null; rules?: string[] }

export const courseKey = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** Totals for a set of holes. Feet only when every hole has a distance (never a misleading partial sum). */
export function summarize(holes: Array<{ par: number; dist_ft: number | null }>): { holes: number; par: number; ft: number | null } {
  const ft = holes.every((h) => h.dist_ft != null) && holes.length ? holes.reduce((a, h) => a + (h.dist_ft ?? 0), 0) : null;
  return { holes: holes.length, par: holes.reduce((a, h) => a + h.par, 0), ft };
}

/** Courses A–Z; inside a course, verified layouts first, then by name. */
export function sortLibrary(cs: LibCourse[]): LibCourse[] {
  return cs.slice().sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({
    ...c,
    layouts: c.layouts.slice().sort((a, b) => (a.verified_at ? 0 : 1) - (b.verified_at ? 0 : 1) || a.name.localeCompare(b.name)),
  }));
}

export function layoutFacts(l: Pick<LibLayout, 'holes' | 'par' | 'ft' | 'verified_at'>): string {
  return [`${l.holes} holes`, `par ${l.par}`, l.ft != null ? `${l.ft.toLocaleString()} ft` : null, l.verified_at ? '✓ verified' : null]
    .filter(Boolean).join(' · ');
}

export function findLayout(cs: LibCourse[], id: string | null | undefined): { course: LibCourse; layout: LibLayout } | null {
  if (!id) return null;
  for (const course of cs) for (const layout of course.layouts) if (layout.id === id) return { course, layout };
  return null;
}

/** A new course name must not already be in the library (same rule as the database's unique index). */
export function newCourseProblem(name: string, cs: Pick<LibCourse, 'name'>[]): string | null {
  const k = courseKey(name);
  if (!k) return 'Give the course a name.';
  if (k.length > 80) return 'Course names are 80 characters max.';
  const hit = cs.find((c) => courseKey(c.name) === k);
  return hit ? `"${hit.name}" is already in the library. Pick it from the list.` : null;
}

export function layoutNameProblem(name: string, course: Pick<LibCourse, 'layouts'> | null, replacingId: string | null): string | null {
  const k = courseKey(name);
  if (!k) return 'Give the layout a name (e.g. "A pins", "Long tees").';
  if (k.length > 60) return 'Layout names are 60 characters max.';
  const hit = course?.layouts.find((l) => courseKey(l.name) === k && l.id !== replacingId);
  return hit ? `This course already has a layout called "${hit.name}". Update that one or pick another name.` : null;
}

/** Event holes (server truth, including rules) -> td_save_layout payload. */
export const toLayoutPayload = (hs: LayoutHole[]) =>
  hs.slice().sort((a, b) => a.n - b.n).map((h) => ({ n: h.n, par: h.par, dist_ft: h.dist_ft, ob: h.ob, rules: h.rules ?? [] }));

/** Would applying this layout replace holes the TD has actually filled in? (blank par-3 holes don't count) */
export function hasCustomHoles(hs: Array<{ par: number; dist_ft: number | null; ob: string | null }>): boolean {
  return hs.some((h) => h.par !== 3 || h.dist_ft != null || !!h.ob);
}
