/**
 * Event prep: checklist, shirt order, design board. Pure logic only (no Supabase).
 * Source of truth: prep_tasks / shirt_order / design_assets / design_files + players.shirt_size.
 * Rules:
 *   * A task's due date = event start + due_offset_days. Dates stay relative, so a duplicated
 *     event's checklist lines up with its new date automatically.
 *   * Shirt sizes are normalized for counting only; whatever the TD typed is kept as-is.
 *   * Files live at event-assets/<event_id>/<category>/<asset_id>/v<n>-<name> (TD-only by folder).
 */

// ---------- dates ----------
/** 'YYYY-MM-DD' + n days, calendar math in UTC so DST never shifts a day. */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string): number {
  const t = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(to) - t(from)) / 86_400_000);
}
/** Today in the device's own timezone (what the TD sees on the wall calendar). */
export function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
export function fmtDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
/** "3 days before", "day of", "1 day after" */
export function offsetLabel(n: number | null): string {
  if (n == null) return 'no date';
  if (n === 0) return 'day of';
  const a = Math.abs(n);
  return `${a} day${a === 1 ? '' : 's'} ${n < 0 ? 'before' : 'after'}`;
}

// ---------- tasks ----------
export const TASK_CATEGORIES = ['course', 'registration', 'sponsors', 'shirts', 'designs', 'printing', 'prizes', 'day_of', 'general'] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];
export const TASK_CATEGORY_LABEL: Record<TaskCategory, string> = {
  course: 'Course', registration: 'Registration', sponsors: 'Sponsors', shirts: 'Shirts', designs: 'Designs',
  printing: 'Printing', prizes: 'Prizes', day_of: 'Day of', general: 'General',
};
export const taskCategoryLabel = (c: string) => TASK_CATEGORY_LABEL[c as TaskCategory] ?? c;

export interface PrepTask {
  id: string; title: string; category: string; due_offset_days: number | null;
  assignee: string | null; notes: string | null; done_at: string | null; done_by: string | null; sort: number;
  crew_id?: string | null; // assigned crew member (crew view)
}
export type NewTask = Pick<PrepTask, 'title' | 'category' | 'due_offset_days'> & { sort: number };

/** The starter checklist. Offsets are days from the first event day. */
export const STARTER: Array<Omit<NewTask, 'sort'>> = [
  { title: 'Reserve the course / get the permit', category: 'course', due_offset_days: -60 },
  { title: 'Open registration on Disc Golf Scene', category: 'registration', due_offset_days: -56 },
  { title: 'Flyer designed and posted', category: 'designs', due_offset_days: -45 },
  { title: 'Sponsor outreach (hole sponsors, raffle donations)', category: 'sponsors', due_offset_days: -45 },
  { title: 'Shirt design approved', category: 'shirts', due_offset_days: -30 },
  { title: 'Order shirts (use the Shirts count + CSV)', category: 'shirts', due_offset_days: -21 },
  { title: 'Order player packs / stamped discs', category: 'prizes', due_offset_days: -21 },
  { title: 'Tee sign designs done', category: 'designs', due_offset_days: -14 },
  { title: 'Collect sponsor logos', category: 'sponsors', due_offset_days: -14 },
  { title: 'Print tee signs + event signage', category: 'printing', due_offset_days: -10 },
  { title: 'Print prize bucks', category: 'printing', due_offset_days: -7 },
  { title: 'Payout tables set (Winners tab)', category: 'prizes', due_offset_days: -7 },
  { title: 'Final player import from Disc Golf Scene', category: 'registration', due_offset_days: -3 },
  { title: 'Course walk: tee signs, OB, drop zones', category: 'course', due_offset_days: -2 },
  { title: 'Print card QR sheets', category: 'printing', due_offset_days: -1 },
  { title: 'Pack prize table, raffle, cash box', category: 'prizes', due_offset_days: -1 },
  { title: 'Check-in table set up', category: 'day_of', due_offset_days: 0 },
  { title: 'Post results (Winners tab)', category: 'day_of', due_offset_days: 1 },
];

/** Starter rows to add, skipping any title the event already has. */
export function starterToAdd(existing: Pick<PrepTask, 'title' | 'sort'>[]): NewTask[] {
  const have = new Set(existing.map((t) => t.title.trim().toLowerCase()));
  let sort = Math.max(0, ...existing.map((t) => t.sort)) + (existing.length ? 1 : 0);
  return STARTER.filter((t) => !have.has(t.title.toLowerCase())).map((t) => ({ ...t, sort: sort++ }));
}

export const dueDate = (startsOn: string, t: Pick<PrepTask, 'due_offset_days'>) =>
  t.due_offset_days == null ? null : addDays(startsOn, t.due_offset_days);

export type TaskState = 'done' | 'overdue' | 'soon' | 'later' | 'nodate';
/** soon = due within the next 7 days (including today). */
export function taskState(t: Pick<PrepTask, 'due_offset_days' | 'done_at'>, startsOn: string, today: string): TaskState {
  if (t.done_at) return 'done';
  const due = dueDate(startsOn, t);
  if (!due) return 'nodate';
  const d = daysBetween(today, due);
  return d < 0 ? 'overdue' : d <= 7 ? 'soon' : 'later';
}

/** Open tasks first by due date (undated last), then done ones (most recent first). */
export function sortTasks<T extends PrepTask>(ts: T[]): T[] {
  const key = (t: T) => t.due_offset_days ?? 10_000;
  return ts.slice().sort((a, b) =>
    (a.done_at ? 1 : 0) - (b.done_at ? 1 : 0)
    || (a.done_at && b.done_at ? b.done_at.localeCompare(a.done_at) : key(a) - key(b) || a.sort - b.sort));
}

// ---------- shirts ----------
export const SIZES = ['YS', 'YM', 'YL', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'LT', 'XLT', '2XLT', '3XLT'] as const;
export type Size = (typeof SIZES)[number];
const WORDS: Record<string, Size> = {
  'EXTRA SMALL': 'XS', SMALL: 'S', MEDIUM: 'M', MED: 'M', LARGE: 'L', LRG: 'L', LG: 'L', SM: 'S', MD: 'M',
  'EXTRA LARGE': 'XL', 'X LARGE': 'XL', 'XLARGE': 'XL',
  'YOUTH SMALL': 'YS', 'YOUTH MEDIUM': 'YM', 'YOUTH LARGE': 'YL', 'YOUTH S': 'YS', 'YOUTH M': 'YM', 'YOUTH L': 'YL',
  'LARGE TALL': 'LT', 'XL TALL': 'XLT', '2XL TALL': '2XLT', '3XL TALL': '3XLT',
};
/** Any common spelling -> a standard size, or null if it isn't one (so "1" or "n/a" never counts as a shirt). */
export function normalizeSize(raw: string | null | undefined): Size | null {
  let s = String(raw ?? '').toUpperCase().replace(/[-_.]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(ADULT|MENS|MEN'S|UNISEX|WOMENS|WOMEN'S)\s+/, '');
  if (!s) return null;
  if (WORDS[s]) return WORDS[s];
  s = s.replace(/\s/g, '').replace(/^(X*)LARGE(TALL)?$/, (_, x, t) => `${x}L${t ? 'T' : ''}`).replace(/^(X*)SMALL$/, '$1S');
  const xs = s.match(/^(X+)L(T?)$/);                // XXL, XXXLT
  if (xs) s = (xs[1].length === 1 ? 'XL' : `${xs[1].length}XL`) + xs[2];
  const nx = s.match(/^([2-5])X(L?)(T?)$/);         // 2X, 3XL, 2XT
  if (nx) s = `${nx[1]}XL${nx[3]}`;
  if (s === '1XL' || s === '1X') s = 'XL';
  return (SIZES as readonly string[]).includes(s) ? (s as Size) : null;
}

export interface TallyRow { size: Size; registered: number; extra: number; total: number }
export interface Tally { rows: TallyRow[]; total: number; missing: number; unknown: Array<{ name: string; raw: string }> }

/** Count registered sizes + extras. Only sizes with a count show up, in size order. */
export function shirtTally(players: Array<{ name: string; shirt_size: string | null }>, extras: Record<string, number>): Tally {
  const reg = new Map<Size, number>();
  const unknown: Tally['unknown'] = [];
  let missing = 0;
  for (const p of players) {
    if (!p.shirt_size?.trim()) { missing++; continue; }
    const s = normalizeSize(p.shirt_size);
    if (s) reg.set(s, (reg.get(s) ?? 0) + 1); else unknown.push({ name: p.name, raw: p.shirt_size });
  }
  const rows = SIZES.map((size) => {
    const registered = reg.get(size) ?? 0;
    const extra = Math.max(0, Math.floor(Number(extras[size] ?? 0)) || 0);
    return { size, registered, extra, total: registered + extra };
  }).filter((r) => r.total > 0);
  return { rows, total: rows.reduce((a, r) => a + r.total, 0), missing, unknown };
}

const csvCell = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** Order sheet for the printer: one row per size + a total. */
export function orderCsv(t: Tally): string {
  const lines = [['Size', 'Registered', 'Extras', 'Order qty'], ...t.rows.map((r) => [r.size, r.registered, r.extra, r.total]), ['TOTAL', '', '', t.total]];
  return lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ---------- designs ----------
export const DESIGN_CATEGORIES = ['disc', 'shirts', 'tee_signs', 'flyer', 'logos', 'prize_bucks', 'signage', 'merch', 'other'] as const;
export type DesignCategory = (typeof DESIGN_CATEGORIES)[number];
export function designCategoryLabel(c: string, creditLabel?: string | null): string {
  const L: Record<DesignCategory, string> = {
    disc: 'Disc', shirts: 'Shirts', tee_signs: 'Tee signs', flyer: 'Flyer', logos: 'Logos',
    prize_bucks: creditLabel && creditLabel !== 'prize credit' ? creditLabel : 'Prize bucks',
    signage: 'Event signage', merch: 'Other merch', other: 'Other',
  };
  return L[c as DesignCategory] ?? c;
}
export type DesignStatus = 'draft' | 'approved' | 'sent';
export const STATUS_LABEL: Record<DesignStatus, string> = { draft: 'Draft', approved: 'Approved', sent: 'Sent to print' };

export interface DesignFile { id: string; asset_id: string; version: number; path: string; file_name: string; mime: string | null; bytes: number | null; uploaded_by: string | null; uploaded_at: string }
export interface DesignAsset {
  id: string; category: string; title: string; status: DesignStatus; notes: string | null; updated_at: string; files: DesignFile[];
  /** Built-in proof page this design renders as (disc | shirt | screen_print | tee_signs); null = plain uploaded files. */
  proof?: string | null; proof_opts?: Record<string, unknown>; crew_visible?: boolean;
}

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Storage-safe file name: keeps the extension, drops anything odd. */
export function safeFileName(name: string): string {
  const m = name.trim().match(/^(.*?)(\.[A-Za-z0-9]{1,8})?$/)!;
  const base = (m[1] || 'file').normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'file';
  return base + (m[2] ?? '').toLowerCase();
}
export const nextVersion = (files: Pick<DesignFile, 'version'>[]) => Math.max(0, ...files.map((f) => f.version)) + 1;
export const filePath = (eventId: string, category: string, assetId: string, version: number, name: string) =>
  `${eventId}/${category}/${assetId}/v${version}-${safeFileName(name)}`;
export const latest = (a: Pick<DesignAsset, 'files'>) => a.files.reduce<DesignFile | null>((b, f) => (!b || f.version > b.version ? f : b), null);
/** Zip layout: Category/Title-vN.ext (latest version of each design only, unless all = true). */
export function zipEntries(assets: DesignAsset[], all = false, creditLabel?: string | null): Array<{ path: string; zipName: string }> {
  const used = new Set<string>();
  const out: Array<{ path: string; zipName: string }> = [];
  for (const a of assets) {
    const files = all ? a.files : [latest(a)].filter((f): f is DesignFile => !!f);
    for (const f of files) {
      const ext = (f.file_name.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? '').toLowerCase();
      let name = `${designCategoryLabel(a.category, creditLabel)}/${safeFileName(a.title)}-v${f.version}${ext}`;
      for (let i = 2; used.has(name); i++) name = name.replace(/(\.[^.]+)?$/, `-${i}$1`);
      used.add(name);
      out.push({ path: f.path, zipName: name });
    }
  }
  return out;
}
export const isImage = (f: Pick<DesignFile, 'mime' | 'file_name'>) =>
  /^image\/(png|jpe?g|gif|webp|svg\+xml)$/.test(f.mime ?? '') || /\.(png|jpe?g|gif|webp|svg)$/i.test(f.file_name);
export const fmtBytes = (n: number | null) =>
  n == null ? '' : n < 1024 ? `${n} B` : n < 1_048_576 ? `${Math.round(n / 1024)} KB` : `${(n / 1_048_576).toFixed(1)} MB`;

// ---------- dashboard ----------
export interface Rollup {
  tasks: { done: number; total: number; overdue: number; soon: number; pct: number };
  next: Array<PrepTask & { due: string | null; state: TaskState }>;
  shirts: { total: number; missing: number; unknown: number; ordered: boolean };
  designs: { total: number; approved: number; byCategory: Array<{ category: string; count: number; approved: number }> };
  daysOut: number;
}
export function rollup(input: {
  startsOn: string; today: string; tasks: PrepTask[]; tally: Tally; ordered: boolean; assets: Pick<DesignAsset, 'category' | 'status'>[];
}): Rollup {
  const { startsOn, today, tasks, tally, ordered, assets } = input;
  const states = tasks.map((t) => taskState(t, startsOn, today));
  const done = states.filter((s) => s === 'done').length;
  const open = sortTasks(tasks.filter((t) => !t.done_at)).map((t) => ({ ...t, due: dueDate(startsOn, t), state: taskState(t, startsOn, today) }));
  const cats = DESIGN_CATEGORIES.map((c) => {
    const xs = assets.filter((a) => a.category === c);
    return { category: c as string, count: xs.length, approved: xs.filter((a) => a.status !== 'draft').length };
  });
  return {
    tasks: { done, total: tasks.length, overdue: states.filter((s) => s === 'overdue').length, soon: states.filter((s) => s === 'soon').length,
             pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0 },
    next: open.slice(0, 5),
    shirts: { total: tally.total, missing: tally.missing, unknown: tally.unknown.length, ordered },
    designs: { total: assets.length, approved: assets.filter((a) => a.status !== 'draft').length, byCategory: cats },
    daysOut: daysBetween(today, startsOn),
  };
}
