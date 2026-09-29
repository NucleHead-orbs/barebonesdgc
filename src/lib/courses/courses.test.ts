import { describe, it, expect } from 'vitest';
import {
  findLayout, hasCustomHoles, layoutFacts, layoutNameProblem, newCourseProblem, sortLibrary, summarize, toLayoutPayload,
  type LibCourse, type LibLayout,
} from './courses';

const lay = (p: Partial<LibLayout>): LibLayout => ({
  id: 'l', course_id: 'c', name: 'Main', source: null, verified_at: null, verified_by: null, updated_at: '', updated_by: null,
  holes: 18, par: 54, ft: null, ...p,
});
const lib: LibCourse[] = [
  { id: 'c2', name: 'Red Mountain - South', city: 'Mesa', pdga_url: null, pdga_holes: 18, notes: null, layouts: [] },
  { id: 'c1', name: 'Emerald Park', city: 'Mesa', pdga_url: null, pdga_holes: 9, notes: null, layouts: [
    lay({ id: 'b', name: 'B pins' }), lay({ id: 'a', name: 'A pins' }), lay({ id: 'v', name: 'Zed', verified_at: '2026-09-29' }),
  ] },
];

describe('course library', () => {
  it('summarizes par and feet (feet only when every hole has one)', () => {
    expect(summarize([{ par: 3, dist_ft: 200 }, { par: 4, dist_ft: 400 }])).toEqual({ holes: 2, par: 7, ft: 600 });
    expect(summarize([{ par: 3, dist_ft: 200 }, { par: 3, dist_ft: null }])).toEqual({ holes: 2, par: 6, ft: null });
    expect(summarize([])).toEqual({ holes: 0, par: 0, ft: null });
  });
  it('sorts courses A–Z and verified layouts first', () => {
    const s = sortLibrary(lib);
    expect(s.map((c) => c.name)).toEqual(['Emerald Park', 'Red Mountain - South']);
    expect(s[0].layouts.map((l) => l.name)).toEqual(['Zed', 'A pins', 'B pins']);
  });
  it('describes a layout in one line', () => {
    expect(layoutFacts(lay({ ft: 4967, verified_at: 'x' }))).toBe('18 holes · par 54 · 4,967 ft · ✓ verified');
    expect(layoutFacts(lay({}))).toBe('18 holes · par 54');
  });
  it('finds a layout and its course by id', () => {
    expect(findLayout(lib, 'a')?.course.name).toBe('Emerald Park');
    expect(findLayout(lib, 'nope')).toBeNull();
    expect(findLayout(lib, null)).toBeNull();
  });
  it('refuses a course name already in the library (case/space-insensitive)', () => {
    expect(newCourseProblem('  emerald   PARK ', lib)).toMatch(/already in the library/);
    expect(newCourseProblem('Papago', lib)).toBeNull();
    expect(newCourseProblem('   ', lib)).toMatch(/name/);
  });
  it('refuses a duplicate layout name, except the one being updated', () => {
    const c = lib[1];
    expect(layoutNameProblem('a PINS', c, null)).toMatch(/already has a layout/);
    expect(layoutNameProblem('a pins', c, 'a')).toBeNull();
    expect(layoutNameProblem('Long tees', c, null)).toBeNull();
    expect(layoutNameProblem('', c, null)).toMatch(/name/);
  });
  it('builds the save payload in hole order, keeping rules', () => {
    expect(toLayoutPayload([{ n: 2, par: 4, dist_ft: null, ob: null }, { n: 1, par: 3, dist_ft: 250, ob: 'Road', rules: ['Mando left'] }]))
      .toEqual([{ n: 1, par: 3, dist_ft: 250, ob: 'Road', rules: ['Mando left'] }, { n: 2, par: 4, dist_ft: null, ob: null, rules: [] }]);
  });
  it('only asks before replacing holes someone actually filled in', () => {
    expect(hasCustomHoles([{ par: 3, dist_ft: null, ob: null }])).toBe(false);
    expect(hasCustomHoles([{ par: 3, dist_ft: 250, ob: null }])).toBe(true);
    expect(hasCustomHoles([{ par: 4, dist_ft: null, ob: null }])).toBe(true);
  });
});
