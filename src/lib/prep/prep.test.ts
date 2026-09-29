import { describe, it, expect } from 'vitest';
import {
  addDays, daysBetween, offsetLabel, STARTER, starterToAdd, taskState, sortTasks, normalizeSize, shirtTally, orderCsv,
  safeFileName, nextVersion, filePath, zipEntries, rollup, designCategoryLabel, type PrepTask, type DesignAsset,
} from './prep';

const task = (p: Partial<PrepTask>): PrepTask => ({ id: p.title ?? 'x', title: 'x', category: 'general', due_offset_days: null, assignee: null, notes: null, done_at: null, done_by: null, sort: 0, ...p });

describe('dates', () => {
  it('adds days across months, years and DST', () => {
    expect(addDays('2026-11-21', -21)).toBe('2026-10-31');
    expect(addDays('2027-01-02', -5)).toBe('2026-12-28');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(daysBetween('2026-09-29', '2026-11-21')).toBe(53);
  });
  it('labels offsets in plain words', () => {
    expect([offsetLabel(-1), offsetLabel(-21), offsetLabel(0), offsetLabel(1), offsetLabel(null)])
      .toEqual(['1 day before', '21 days before', 'day of', '1 day after', 'no date']);
  });
});

describe('checklist', () => {
  it('starter list is ordered by due date and fits the database limits', () => {
    const offs = STARTER.map((t) => t.due_offset_days!);
    expect(offs).toEqual(offs.slice().sort((a, b) => a - b));
    for (const t of STARTER) { expect(t.title.length).toBeLessThanOrEqual(140); expect(t.due_offset_days).toBeGreaterThanOrEqual(-730); }
  });
  it('loading the starter twice adds nothing new', () => {
    const first = starterToAdd([]);
    expect(first).toHaveLength(STARTER.length);
    expect(first[0].sort).toBe(0);
    expect(starterToAdd(first.map((t, i) => ({ title: t.title.toUpperCase(), sort: i })))).toEqual([]);
    const withMine = starterToAdd([{ title: 'My own task', sort: 4 }]);
    expect(withMine[0].sort).toBe(5);
  });
  it('states: overdue, soon (≤7 days), later, done, no date', () => {
    const s = '2026-11-21';
    expect(taskState(task({ due_offset_days: -60 }), s, '2026-10-01')).toBe('overdue');
    expect(taskState(task({ due_offset_days: -21 }), s, '2026-10-31')).toBe('soon');
    expect(taskState(task({ due_offset_days: -21 }), s, '2026-10-24')).toBe('soon');
    expect(taskState(task({ due_offset_days: -21 }), s, '2026-10-23')).toBe('later');
    expect(taskState(task({ due_offset_days: -60, done_at: '2026-10-01T00:00:00Z' }), s, '2026-11-01')).toBe('done');
    expect(taskState(task({}), s, '2026-11-01')).toBe('nodate');
  });
  it('sorts open by due date (undated last), done at the bottom', () => {
    const ts = [task({ title: 'nodate' }), task({ title: 'done', due_offset_days: -90, done_at: '2026-01-01' }), task({ title: 'late', due_offset_days: -1 }), task({ title: 'early', due_offset_days: -30 })];
    expect(sortTasks(ts).map((t) => t.title)).toEqual(['early', 'late', 'nodate', 'done']);
  });
});

describe('shirt sizes', () => {
  it('normalizes the usual spellings', () => {
    const cases: Array<[string, string | null]> = [
      ['Large', 'L'], ['l', 'L'], ['XL', 'XL'], ['X-Large', 'XL'], ['XXL', '2XL'], ['2X', '2XL'], ['xx-large', '2XL'],
      ['3XL', '3XL'], ['XXXL', '3XL'], ['Medium', 'M'], ['Adult S', 'S'], ['Youth Medium', 'YM'], ['YL', 'YL'],
      ['XLT', 'XLT'], ['Large Tall', 'LT'], ['xs', 'XS'], ['1', null], ['n/a', null], ['', null], [' ', null], ['6XL', null],
    ];
    for (const [raw, want] of cases) expect([raw, normalizeSize(raw)]).toEqual([raw, want]);
  });
  it('tallies registered + extras in size order; flags blanks and unknowns', () => {
    const t = shirtTally(
      [{ name: 'A', shirt_size: 'Large' }, { name: 'B', shirt_size: 'L' }, { name: 'C', shirt_size: 'XXL' }, { name: 'D', shirt_size: null }, { name: 'E', shirt_size: 'huge' }],
      { M: 3, L: 2, XL: -4, '2XL': 1.7 },
    );
    expect(t.rows).toEqual([
      { size: 'M', registered: 0, extra: 3, total: 3 },
      { size: 'L', registered: 2, extra: 2, total: 4 },
      { size: '2XL', registered: 1, extra: 1, total: 2 },
    ]);
    expect([t.total, t.missing, t.unknown]).toEqual([9, 1, [{ name: 'E', raw: 'huge' }]]);
  });
  it('order CSV has a row per size and a total', () => {
    const csv = orderCsv(shirtTally([{ name: 'A', shirt_size: 'S' }], { S: 1, XL: 2 }));
    expect(csv).toBe('Size,Registered,Extras,Order qty\r\nS,1,1,2\r\nXL,0,2,2\r\nTOTAL,,,4\r\n');
  });
});

describe('design files', () => {
  it('makes storage-safe names and paths', () => {
    expect(safeFileName('Jewel XI – Front (FINAL).PNG')).toBe('Jewel-XI-Front-FINAL.png');
    expect(safeFileName('???.pdf')).toBe('file.pdf');
    expect(filePath('ev', 'shirts', 'a1', 2, 'my shirt.ai')).toBe('ev/shirts/a1/v2-my-shirt.ai');
    expect(nextVersion([])).toBe(1);
    expect(nextVersion([{ version: 1 }, { version: 3 }])).toBe(4);
  });
  it('zip holds the latest of each design, grouped by category, no name clashes', () => {
    const f = (asset_id: string, version: number, file_name: string) => ({ id: `${asset_id}${version}`, asset_id, version, path: `p/${asset_id}/v${version}`, file_name, mime: null, bytes: null, uploaded_by: null, uploaded_at: '' });
    const assets: DesignAsset[] = [
      { id: 'a', category: 'shirts', title: 'Front', status: 'approved', notes: null, updated_at: '', files: [f('a', 1, 'x.png'), f('a', 2, 'y.PNG')] },
      { id: 'b', category: 'shirts', title: 'Front', status: 'draft', notes: null, updated_at: '', files: [f('b', 2, 'z.png')] },
      { id: 'c', category: 'prize_bucks', title: '$5 note', status: 'draft', notes: null, updated_at: '', files: [f('c', 1, 'b.pdf')] },
      { id: 'd', category: 'flyer', title: 'Empty', status: 'draft', notes: null, updated_at: '', files: [] },
    ];
    expect(zipEntries(assets, false, 'Boner Bucks')).toEqual([
      { path: 'p/a/v2', zipName: 'Shirts/Front-v2.png' },
      { path: 'p/b/v2', zipName: 'Shirts/Front-v2-2.png' },
      { path: 'p/c/v1', zipName: 'Boner Bucks/5-note-v1.pdf' },
    ]);
    expect(zipEntries(assets, true)).toHaveLength(4);
  });
  it('prize bucks take the event credit label', () => {
    expect(designCategoryLabel('prize_bucks', 'Boner Bucks')).toBe('Boner Bucks');
    expect(designCategoryLabel('prize_bucks', 'prize credit')).toBe('Prize bucks');
    expect(designCategoryLabel('tee_signs')).toBe('Tee signs');
  });
});

describe('dashboard rollup', () => {
  it('counts progress, overdue, next up, shirts and designs', () => {
    const tasks = [
      task({ title: 'a', due_offset_days: -60, done_at: '2026-09-01' }), task({ title: 'b', due_offset_days: -56 }),
      task({ title: 'c', due_offset_days: -50 }), task({ title: 'd', due_offset_days: -10 }),
    ];
    const r = rollup({
      startsOn: '2026-11-21', today: '2026-09-29', tasks, ordered: false,
      tally: shirtTally([{ name: 'A', shirt_size: 'L' }, { name: 'B', shirt_size: null }], {}),
      assets: [{ category: 'shirts', status: 'approved' }, { category: 'shirts', status: 'draft' }, { category: 'flyer', status: 'sent' }],
    });
    expect(r.tasks).toEqual({ done: 1, total: 4, overdue: 1, soon: 1, pct: 25 });
    expect(r.next.map((t) => [t.title, t.state, t.due])).toEqual([['b', 'overdue', '2026-09-26'], ['c', 'soon', '2026-10-02'], ['d', 'later', '2026-11-11']]);
    expect(r.shirts).toEqual({ total: 1, missing: 1, unknown: 0, ordered: false });
    expect(r.designs.total).toBe(3);
    expect(r.designs.approved).toBe(2);
    expect(r.designs.byCategory.find((c) => c.category === 'shirts')).toEqual({ category: 'shirts', count: 2, approved: 1 });
    expect(r.daysOut).toBe(53);
  });
  it('empty event: 0%, nothing next', () => {
    const r = rollup({ startsOn: '2026-11-21', today: '2026-11-21', tasks: [], tally: shirtTally([], {}), ordered: true, assets: [] });
    expect([r.tasks.pct, r.next.length, r.daysOut]).toEqual([0, 0, 0]);
  });
});
