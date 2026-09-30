/**
 * Innova custom-order form engine. SOURCE OF TRUTH = Innova's own .xlsx (uploaded by the TD).
 * Everything here is read from that file: molds, plastics, weight classes, what's "out", low stock (yellow),
 * made-for-customs stock (orange), price per disc (the row's T formula), minimums (data validation, the row
 * "Error" formula, section/notes text, the Custom Pricing tab) and where the header fields live.
 * Export writes quantities + header into the SAME file (cells only, styles kept) and asks Excel to recalc on open.
 * Pure string/zip logic: no DOM, so it runs the same in the browser and in tests.
 */
import JSZip from 'jszip';

export const WEIGHT_COLS = ['M', 'N', 'O', 'P', 'Q', 'R', 'S'] as const;
export type Col = (typeof WEIGHT_COLS)[number];
export type Group = 'custom' | 'minis' | 'tfr';
export const GROUP_LABEL: Record<Group, string> = { custom: 'Custom discs', minis: 'Minis', tfr: 'TFR (fundraiser) discs' };

export interface Slot { col: Col; label: string; out: boolean; low: boolean }
export interface Section { row: number; title: string; group: Group; note: string; min: number; perModel: number; setup: number; single: boolean }
export interface Mold {
  row: number; name: string; group: Group; section: number; price: number;
  slots: Slot[]; minMold: number; minCell: number; customStock: boolean; flatTop: boolean; setup: number;
}
export interface Fees { dieNew: { golf: number; mini: number }; dieReorder: { golf: number; mini: number }; flatTop: number }
export interface Catalog {
  label: string; sheet: string; sections: Section[]; molds: Mold[]; byRow: Map<number, Mold>;
  orderMin: number; fees: Fees; fields: Partial<Record<FieldKey, string>>; ship: string[]; bill: string[]; notesCell: string | null;
  warnings: string[];
}

export type FieldKey = 'order_date' | 'event_date' | 'name' | 'phone' | 'email' | 'artwork' | 'die' | 'misprints' | 'new_stamp' | 'rep';
export const FIELD_LABELS: Array<[FieldKey, RegExp, string]> = [
  ['order_date', /^order date/i, 'Order date'], ['event_date', /^event date/i, 'Event date'],
  ['name', /^customer name/i, 'Customer name'], ['phone', /^phone/i, 'Phone'], ['email', /^email/i, 'Email'],
  ['artwork', /^artwork name/i, 'Artwork name'], ['die', /^die size/i, 'Die size'],
  ['misprints', /^include misprints/i, 'Include misprints'], ['new_stamp', /^new stamp/i, 'New stamp'],
  ['rep', /^order representative/i, 'Innova rep'],
];
/** Header labels we never fill (payment). The TD types these into the file themselves. */
export const NEVER_FILL = [/^credit card/i, /^exp\. date/i];

export interface Details extends Partial<Record<FieldKey, string>> { ship?: string[]; bill?: string[]; notes?: string }
export type Qty = Partial<Record<Col, number>>;
export type Lines = Record<string, { mold: string; q: Qty }>;

// ---------- tiny OOXML readers ----------
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const unxml = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m);
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join('');
export const colNum = (c: string) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
export const colName = (n: number) => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const splitRef = (ref: string) => { const m = /^([A-Z]+)(\d+)$/.exec(ref); if (!m) throw new Error(`bad cell ${ref}`); return { col: m[1], row: +m[2] }; };

interface Cell { ref: string; col: string; row: number; s: number; value: string | number | null; formula: string | null }
interface SheetData { cells: Map<string, Cell>; hidden: Set<number>; merges: Array<{ c1: number; r1: number; c2: number; r2: number }>; dv: Array<{ min: number; ranges: string[] }> }

export function readSheet(xml: string, shared: string[]): SheetData {
  const cells = new Map<string, Cell>(); const hidden = new Set<number>();
  for (const r of xml.matchAll(/<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g)) {
    const rn = +(/\br="(\d+)"/.exec(r[1])?.[1] ?? 0);
    if (/\bhidden="(1|true)"/.test(r[1])) hidden.add(rn);
    for (const c of (r[3] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+\d+)"/.exec(c[1])?.[1]; if (!ref) continue;
      const t = /\bt="(\w+)"/.exec(c[1])?.[1]; const s = +(/\bs="(\d+)"/.exec(c[1])?.[1] ?? 0);
      const inner = c[2] ?? ''; const f = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(inner)?.[1]; const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value: string | number | null = null;
      if (t === 's' && v != null) value = shared[+v] ?? null;
      else if (t === 'inlineStr') value = textOf(inner);
      else if (t === 'str' || t === 'e' || t === 'b') value = v != null ? unxml(v) : null;
      else if (v != null && v !== '') value = Number(v);
      const { col, row } = splitRef(ref);
      cells.set(ref, { ref, col, row, s, value, formula: f != null ? unxml(f) : null });
    }
  }
  const merges = [...xml.matchAll(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g)].map((m) => ({ c1: colNum(m[1]), r1: +m[2], c2: colNum(m[3]), r2: +m[4] }));
  const dv = [...xml.matchAll(/<dataValidation\b([^>]*)>([\s\S]*?)<\/dataValidation>/g)].flatMap((m) => {
    const op = /operator="(\w+)"/.exec(m[1])?.[1]; const f1 = Number(/<formula1>([\d.]+)<\/formula1>/.exec(m[2])?.[1]);
    const sq = /sqref="([^"]+)"/.exec(m[1])?.[1] ?? '';
    if (!Number.isFinite(f1) || !(op === 'greaterThan' || op === 'greaterThanOrEqual')) return [];
    return [{ min: op === 'greaterThan' ? Math.floor(f1) + 1 : Math.ceil(f1), ranges: sq.split(/\s+/).filter(Boolean) }];
  });
  // Shared formulas: only the anchor carries text. Rebuild each follower by shifting row numbers.
  const anchors = new Map<string, { row: number; f: string }>();
  for (const r of xml.matchAll(/<c\b[^>]*\br="([A-Z]+)(\d+)"[^>]*>\s*<f\b([^>]*?)(?<!\/)>([^<]*)<\/f>/g)) {
    const si = /\bsi="(\d+)"/.exec(r[3])?.[1]; if (si && /\bref="/.test(r[3])) anchors.set(si, { row: +r[2], f: unxml(r[4]) });
  }
  for (const r of xml.matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"[^>]*>\s*<f\b([^>]*?)\/>/g)) {
    const si = /\bsi="(\d+)"/.exec(r[2])?.[1]; const a = si ? anchors.get(si) : undefined; const cell = cells.get(r[1]);
    if (!a || !cell) continue;
    const d = cell.row - a.row;
    cell.formula = a.f.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g, (m, d1: string, c: string, d2: string, n: string) => (d2 ? m : `${d1}${c}${d2}${+n + d}`));
  }
  return { cells, hidden, merges, dv };
}
const inRange = (ref: string, range: string) => {
  const { col, row } = splitRef(ref); const [a, b = a] = range.split(':'); const A = splitRef(a); const B = splitRef(b);
  const c = colNum(col); return c >= colNum(A.col) && c <= colNum(B.col) && row >= A.row && row <= B.row;
};

function styleFills(stylesXml: string): string[] {
  const fills = [...(/<fills[^>]*>([\s\S]*?)<\/fills>/.exec(stylesXml)?.[1] ?? '').matchAll(/<fill>([\s\S]*?)<\/fill>/g)]
    .map((m) => /fgColor rgb="(\w+)"/.exec(m[1])?.[1]?.toUpperCase() ?? '');
  const xfs = [...(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? '').matchAll(/<xf\b([^>]*)/g)];
  return xfs.map((m) => fills[+(/fillId="(\d+)"/.exec(m[1])?.[1] ?? 0)] ?? '');
}
const LOW = 'FFFFFF00', BLACK = 'FF000000', ORANGE = 'FFFCE5CD';

export interface Book { zip: JSZip; formPath: string; pricingPath: string | null; shared: string[]; fills: string[]; xml: string; pricingXml: string | null }

/** Open the .xlsx and locate its parts by name (Order_Form / Custom Pricing), not by position. */
export async function openBook(data: ArrayBuffer | Uint8Array): Promise<Book> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(data); } catch { throw new Error('That file isn\'t an .xlsx workbook. Upload the Excel order form Innova sent you.'); }
  const read = async (p: string) => { const f = zip.file(p); return f ? f.async('string') : null; };
  const wb = await read('xl/workbook.xml'); const rels = await read('xl/_rels/workbook.xml.rels');
  if (!wb || !rels) throw new Error('That workbook is missing its sheet list. Re-save it from Excel or Google Sheets and try again.');
  const target = (name: RegExp) => {
    const sh = [...wb.matchAll(/<sheet\b([^>]*)\/>/g)].find((m) => name.test(unxml(/name="([^"]*)"/.exec(m[1])?.[1] ?? '').trim()));
    const rid = sh && /r:id="([^"]+)"/.exec(sh[1])?.[1];
    const t = rid && new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1]
      || rid && new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1];
    return t ? (t.startsWith('/') ? t.slice(1) : `xl/${t}`) : null;
  };
  const formPath = target(/^order[_ ]form$/i);
  if (!formPath) throw new Error('Couldn\'t find the "Order_Form" tab. Is this Innova\'s CFR/TFR order form?');
  const pricingPath = target(/^custom pricing$/i);
  const xml = await read(formPath); if (!xml) throw new Error('The Order_Form tab is empty.');
  const sst = await read('xl/sharedStrings.xml');
  const shared = sst ? [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];
  const fills = styleFills((await read('xl/styles.xml')) ?? '');
  return { zip, formPath, pricingPath, shared, fills, xml, pricingXml: pricingPath ? await read(pricingPath) : null };
}

const DEFAULT_FEES: Fees = { dieNew: { golf: 80, mini: 60 }, dieReorder: { golf: 30, mini: 20 }, flatTop: 1 };
const txt = (c: Cell | undefined) => (typeof c?.value === 'string' ? c.value.trim() : '');

export function parseCatalog(book: Book): Catalog {
  const { cells, hidden, merges, dv } = readSheet(book.xml, book.shared);
  const get = (ref: string) => cells.get(ref);
  const warnings: string[] = [];
  const maxRow = Math.max(0, ...[...cells.values()].map((c) => c.row));
  const label = [...cells.values()].map(txt).find((t) => /^updated:/i.test(t)) ?? 'Undated form';

  // header fields: label cell → the value cell right after the label's merged block
  const fields: Catalog['fields'] = {}; let ship: string[] = [], bill: string[] = [], notesCell: string | null = null;
  // value box = the next merged block to the right of the label on the same row (else the next cell)
  const afterMerge = (c: Cell) => {
    const own = merges.find((x) => x.r1 === c.row && x.c1 === colNum(c.col)); const end = own ? own.c2 : colNum(c.col);
    const next = merges.filter((x) => x.r1 === c.row && x.c1 > end).sort((a, b) => a.c1 - b.c1)[0];
    return colName(next ? next.c1 : end + 1) + c.row;
  };
  for (const c of cells.values()) {
    if (c.row > 23) continue; const t = txt(c); if (!t) continue;
    const f = FIELD_LABELS.find(([, re]) => re.test(t)); if (f) fields[f[0]] = afterMerge(c);
    if (/^shipping address/i.test(t)) ship = [1, 2, 3, 4].map((i) => `${c.col}${c.row + i}`);
    if (/^billing address/i.test(t)) bill = [1, 2, 3, 4].map((i) => `${c.col}${c.row + i}`);
    if (/^notes/i.test(t)) notesCell = `${c.col}${c.row + 1}`;
  }
  for (const [k, , l] of FIELD_LABELS) if (!fields[k]) warnings.push(`This form has no "${l}" box, so it won't be filled in.`);

  // pricing tab: order minimum, die fees, flat-top fee
  let orderMin = 50; const fees: Fees = structuredClone(DEFAULT_FEES);
  if (book.pricingXml) {
    const p = readSheet(book.pricingXml, book.shared).cells; const all = [...p.values()];
    const m = all.map(txt).join('\n'); const om = /(\d+)\s*disc minimum order/i.exec(m); if (om) orderMin = +om[1]; else warnings.push('Couldn\'t read the order minimum; using 50.');
    const row = (re: RegExp) => all.find((c) => re.test(txt(c)));
    const golf = row(/^golf disc$/i), mini = row(/^mini$/i);
    const num = (c: Cell | undefined, dc: number) => { const v = c && p.get(colName(colNum(c.col) + dc) + c.row)?.value; return typeof v === 'number' ? v : null; };
    if (golf && mini) {
      fees.dieNew = { golf: num(golf, 1) ?? 80, mini: num(mini, 1) ?? 60 }; fees.dieReorder = { golf: num(golf, 2) ?? 30, mini: num(mini, 2) ?? 20 };
    } else warnings.push('Couldn\'t read the die fees; using $80 new / $30 reorder.');
    const ft = all.map(txt).find((t) => /flat top fee/i.test(t)); const ftv = ft && /\$(\d+(?:\.\d+)?)/.exec(ft); if (ftv) fees.flatTop = +ftv[1];
  } else warnings.push('No "Custom Pricing" tab found; fees use the 2026 defaults.');

  // body: sections (rows whose I cell says "Ordered") and their molds
  const sections: Section[] = []; const molds: Mold[] = []; let group: Group = 'custom'; let sec: Section | null = null; let labels: Array<{ col: Col; label: string }> = [];
  const minCellOf = (ref: string) => Math.max(0, ...dv.filter((d) => d.ranges.some((r) => inRange(ref, r))).map((d) => d.min));
  for (let r = 1; r <= maxRow; r++) {
    const rowText = ['I', 'J', 'K', 'M'].map((c) => txt(get(`${c}${r}`))).join(' ');
    if (/tournament fundraiser|TFR DISCS/i.test(rowText)) group = 'tfr';
    if (txt(get(`I${r}`)) === 'Ordered') {
      const title = txt(get(`J${r}`)); const note = ['K', 'M'].map((c) => txt(get(`${c}${r}`))).find((t) => t.length > 20) ?? '';
      if (/^minis/i.test(title)) group = 'minis'; else if (group === 'minis') group = 'custom';
      labels = WEIGHT_COLS.flatMap((col) => { const t = txt(get(`${col}${r}`)); return /^\d+\s*-\s*\d+$/.test(t) ? [{ col, label: t.replace(/\s/g, '') }] : []; });
      const both = `${title} ${note}`;
      const min = +(/(\d+)\s*disc minimum(?! per)/i.exec(both)?.[1] ?? 0);
      const perModel = +(/(\d+)\s*disc minimum per/i.exec(both)?.[1] ?? 0);
      const setup = +(/\$(\d+)\s*set ?-?up/i.exec(note)?.[1] ?? 0);
      sec = { row: r, title: title || note.split(/\s+-\s+/)[0] || 'Section', group, note, min, perModel, setup, single: labels.length === 0 };
      if (sec.single) labels = [{ col: 'M', label: 'Qty' }];
      sections.push(sec); continue;
    }
    if (!sec || hidden.has(r)) continue;
    const name = txt(get(`J${r}`)); const tf = get(`T${r}`)?.formula ?? '';
    const pm = /I\d+\s*\*\s*([\d.]+)/.exec(tf); if (!name || !pm) continue;
    const ifm = get(`I${r}`)?.formula ?? ''; const em = />\s*(\d+)\s*,\s*SUM[^"]*"Error"/i.exec(ifm);
    const slots: Slot[] = labels.map(({ col, label: l }) => {
      const c = get(`${col}${r}`); const fill = c ? book.fills[c.s] ?? '' : '';
      return { col, label: l, out: /^out/i.test(txt(c)) || fill === BLACK, low: fill === LOW };
    });
    const jfill = book.fills[get(`J${r}`)?.s ?? 0] ?? '';
    molds.push({
      row: r, name: name.replace(/\s+/g, ' '), group: sec.group, section: sec.row, price: +pm[1], slots,
      minMold: em ? +em[1] + 1 : 0, minCell: sec.single ? 0 : Math.max(0, ...labels.map(({ col }) => minCellOf(`${col}${r}`))),
      customStock: jfill === ORANGE, flatTop: /\*\*|flat top/i.test(name), setup: +(/\$(\d+)\s*set ?-?up/i.exec(name)?.[1] ?? 0),
    });
  }
  if (!molds.length) throw new Error('Found no molds on this form. Is it Innova\'s CFR/TFR order form?');
  return { label, sheet: book.formPath, sections, molds, byRow: new Map(molds.map((m) => [m.row, m])), orderMin, fees, fields, ship, bill, notesCell, warnings };
}

/** Quantities already typed into an uploaded form (so a half-filled form isn't lost). */
export function linesInForm(book: Book, cat: Catalog): Lines {
  const { cells } = readSheet(book.xml, book.shared); const out: Lines = {};
  for (const m of cat.molds) for (const s of m.slots) {
    const v = cells.get(`${s.col}${m.row}`)?.value;
    if (typeof v === 'number' && v > 0) (out[m.row] ??= { mold: m.name, q: {} }).q[s.col] = Math.round(v);
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** Re-point saved lines at a (possibly newer) form: same row + same name stays; otherwise match by name; else dropped. */
export function remapLines(cat: Catalog, lines: Lines): { lines: Lines; moved: string[]; dropped: string[] } {
  const out: Lines = {}; const moved: string[] = []; const dropped: string[] = [];
  for (const [row, l] of Object.entries(lines)) {
    const at = cat.byRow.get(+row);
    const m = at && norm(at.name) === norm(l.mold) ? at : cat.molds.find((x) => norm(x.name) === norm(l.mold));
    if (!m) { dropped.push(l.mold); continue; }
    if (m.row !== +row) moved.push(l.mold);
    const q: Qty = {}; for (const [c, n] of Object.entries(l.q) as Array<[Col, number]>) if (n > 0 && m.slots.some((s) => s.col === c)) q[c] = n;
    const prev = out[m.row]?.q ?? {}; for (const c of Object.keys(q) as Col[]) q[c] = (q[c] ?? 0) + (prev[c] ?? 0);
    out[m.row] = { mold: m.name, q: { ...prev, ...q } };
  }
  return { lines: out, moved, dropped };
}

// ---------- rules + money (all numbers from the form) ----------
export interface Issue { level: 'error' | 'warn'; text: string; row?: number }
export interface Line { mold: Mold; discs: number; subtotal: number }
export interface Summary {
  lines: Line[]; discs: number; minis: number; golf: number; subtotal: number;
  fees: Array<{ label: string; amount: number }>; feeTotal: number; total: number; issues: Issue[]; ok: boolean;
}
const sum = (q: Qty) => Object.values(q).reduce<number>((a, n) => a + (n ?? 0), 0);
export const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

export function summarize(cat: Catalog, lines: Lines, d: Details = {}): Summary {
  const issues: Issue[] = []; const out: Line[] = [];
  for (const [row, l] of Object.entries(lines)) {
    const m = cat.byRow.get(+row); const discs = sum(l.q); if (!discs) continue;
    if (!m || norm(m.name) !== norm(l.mold)) { issues.push({ level: 'error', text: `${l.mold} isn't on this form any more. Remove it or pick another mold.` }); continue; }
    out.push({ mold: m, discs, subtotal: discs * m.price });
    for (const s of m.slots) {
      const n = l.q[s.col] ?? 0; if (!n) continue;
      if (s.out) issues.push({ level: 'error', row: m.row, text: `${m.name} ${s.label} is out of stock.` });
      else if (m.minCell && n < m.minCell) issues.push({ level: 'error', row: m.row, text: `${m.name} ${s.label}: ${n}. Innova's minimum is ${m.minCell} per weight.` });
      if (s.low) issues.push({ level: 'warn', row: m.row, text: `${m.name} ${s.label} is low stock (under 30). Innova may substitute.` });
    }
    if (m.minMold && discs < m.minMold) issues.push({ level: 'error', row: m.row, text: `${m.name}: ${discs} discs. Innova's minimum is ${m.minMold} per mold.` });
  }
  const bySec = new Map<number, number>(); for (const l of out) bySec.set(l.mold.section, (bySec.get(l.mold.section) ?? 0) + l.discs);
  const fees: Summary['fees'] = [];
  for (const s of cat.sections) {
    const n = bySec.get(s.row) ?? 0; if (!n) continue;
    if (s.min && n < s.min) issues.push({ level: 'error', text: `${s.title}: ${n} discs. This section needs ${s.min} in total.` });
    if (s.perModel) for (const l of out) if (l.mold.section === s.row && l.discs < s.perModel) issues.push({ level: 'error', row: l.mold.row, text: `${l.mold.name}: ${l.discs}. Needs ${s.perModel} per model.` });
    if (s.setup) fees.push({ label: `${s.title.slice(0, 40)} setup`, amount: s.setup });
  }
  const minis = out.filter((l) => l.mold.group === 'minis').reduce((a, l) => a + l.discs, 0);
  const golf = out.filter((l) => l.mold.group !== 'minis').reduce((a, l) => a + l.discs, 0);
  if (!out.length) issues.push({ level: 'error', text: 'No discs picked yet.' });
  if (golf && golf < cat.orderMin) issues.push({ level: 'error', text: `${golf} discs. Innova's order minimum is ${cat.orderMin}.` });
  if (golf && minis) issues.push({ level: 'error', text: 'Minis use their own stamping die, so they need their own order. Start a second order for the minis.' });
  for (const l of out) if (l.mold.setup) fees.push({ label: `${l.mold.name.replace(/\s*-\s*requires.*$/i, '')} setup`, amount: l.mold.setup });
  const flat = out.filter((l) => l.mold.flatTop).reduce((a, l) => a + l.discs, 0);
  if (flat) fees.push({ label: `Flat-top fee (${flat} × ${money(cat.fees.flatTop)})`, amount: flat * cat.fees.flatTop });
  const kind = minis && !golf ? 'mini' : 'golf';
  if (out.length) {
    const fresh = (d.new_stamp ?? 'Y').toUpperCase().startsWith('Y');
    fees.unshift({ label: `${fresh ? 'New' : 'Reorder'} ${kind === 'mini' ? 'mini' : 'golf disc'} die`, amount: fresh ? cat.fees.dieNew[kind] : cat.fees.dieReorder[kind] });
  }
  const subtotal = out.reduce((a, l) => a + l.subtotal, 0); const feeTotal = fees.reduce((a, f) => a + f.amount, 0);
  return { lines: out.sort((a, b) => a.mold.row - b.mold.row), discs: golf + minis, minis, golf, subtotal, fees, feeTotal, total: subtotal + feeTotal, issues, ok: !issues.some((i) => i.level === 'error') };
}

/** Header problems that block export (Innova needs these to process the order). */
export function detailIssues(cat: Catalog, d: Details): Issue[] {
  const need: Array<[FieldKey, string]> = [['name', 'your name'], ['email', 'an email'], ['phone', 'a phone number'], ['artwork', 'the artwork name'], ['die', 'the die size']];
  const out: Issue[] = need.filter(([k]) => cat.fields[k] && !(d[k] ?? '').trim()).map(([, l]) => ({ level: 'error' as const, text: `Order details: add ${l}.` }));
  if (cat.ship.length && !(d.ship ?? []).some((s) => s.trim())) out.push({ level: 'error', text: 'Order details: add the shipping address.' });
  return out;
}

// ---------- export: write cells into the original sheet ----------
type Val = string | number | null;
/** Set cells in a worksheet XML, keeping each cell's style. null clears a value. One pass; missing rows/cells are inserted in order. */
export function setCells(xml: string, values: Record<string, Val>): string {
  const byRow = new Map<number, Map<string, Val>>();
  for (const [ref, v] of Object.entries(values)) { const { row } = splitRef(ref); if (!byRow.has(row)) byRow.set(row, new Map()); byRow.get(row)!.set(ref, v); }
  const cellXml = (ref: string, s: string, v: Val) => v == null || v === '' ? `<c r="${ref}"${s}/>`
    : typeof v === 'number' ? `<c r="${ref}"${s}><v>${v}</v></c>`
    : `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  const patchRow = (inner: string, sets: Map<string, Val>) => {
    const left = new Map(sets);
    let out = inner.replace(/<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g, (m, attrs: string) => {
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1]; if (!ref || !left.has(ref)) return m;
      const v = left.get(ref)!; left.delete(ref); const st = /\bs="\d+"/.exec(attrs);
      return cellXml(ref, st ? ` ${st[0]}` : '', v);
    });
    for (const [ref, v] of [...left.entries()].sort((a, b) => colNum(splitRef(a[0]).col) - colNum(splitRef(b[0]).col))) {
      if (v == null || v === '') continue;
      const cn = colNum(splitRef(ref).col); let at = out.length;
      for (const c of out.matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"/g)) if (colNum(c[1]) > cn) { at = c.index!; break; }
      out = out.slice(0, at) + cellXml(ref, '', v) + out.slice(at);
    }
    return out;
  };
  const done = new Set<number>();
  let out = xml.replace(/<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g, (m, attrs: string, _t: string, inner: string | undefined) => {
    const row = +(/\br="(\d+)"/.exec(attrs)?.[1] ?? 0); const sets = byRow.get(row); if (!sets) return m;
    done.add(row); return `<row${attrs}>${patchRow(inner ?? '', sets)}</row>`;
  });
  for (const [row, sets] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
    if (done.has(row) || [...sets.values()].every((v) => v == null || v === '')) continue;
    let at = out.indexOf('</sheetData>'); for (const r of out.matchAll(/<row\b[^>]*\br="(\d+)"/g)) if (+r[1] > row) { at = r.index!; break; }
    if (at < 0) throw new Error('Worksheet has no sheetData');
    out = out.slice(0, at) + `<row r="${row}">${patchRow('', sets)}</row>` + out.slice(at);
  }
  return out;
}

/** Every cell the export writes: all quantity cells of every mold (set or cleared) + the header. Card boxes are never touched. */
export function exportValues(cat: Catalog, lines: Lines, d: Details): Record<string, Val> {
  const v: Record<string, Val> = {};
  for (const m of cat.molds) for (const s of m.slots) if (!s.out) v[`${s.col}${m.row}`] = null;
  for (const [row, l] of Object.entries(lines)) {
    const m = cat.byRow.get(+row); if (!m || norm(m.name) !== norm(l.mold)) continue;
    for (const s of m.slots) { const n = l.q[s.col]; if (n && n > 0 && !s.out) v[`${s.col}${m.row}`] = n; }
  }
  for (const [k] of FIELD_LABELS) { const ref = cat.fields[k]; if (ref) v[ref] = (d[k] ?? '').trim() || null; }
  cat.ship.forEach((ref, i) => { v[ref] = d.ship?.[i]?.trim() || null; });
  cat.bill.forEach((ref, i) => { v[ref] = d.bill?.[i]?.trim() || null; });
  if (cat.notesCell) v[cat.notesCell] = d.notes?.trim() || null;
  return v;
}

/** Fill the original workbook and return the new .xlsx bytes. */
export async function fillForm(book: Book, cat: Catalog, lines: Lines, d: Details): Promise<Uint8Array> {
  const zip = book.zip;
  zip.file(book.formPath, setCells(book.xml, exportValues(cat, lines, d)));
  // recalc everything on open (totals, Summary tab); drop any stale calc chain
  let wb = (await zip.file('xl/workbook.xml')!.async('string'));
  wb = /<calcPr\b/.test(wb) ? wb.replace(/<calcPr\b[^>]*?(\/>|>[\s\S]*?<\/calcPr>)/, '<calcPr fullCalcOnLoad="1"/>')
    : wb.replace(/(<extLst>|<\/workbook>)/, '<calcPr fullCalcOnLoad="1"/>$1');
  zip.file('xl/workbook.xml', wb);
  if (zip.file('xl/calcChain.xml')) {
    zip.remove('xl/calcChain.xml');
    const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
    zip.file('xl/_rels/workbook.xml.rels', rels.replace(/<Relationship\b[^>]*calcChain[^>]*\/>/g, ''));
    const ct = await zip.file('[Content_Types].xml')!.async('string');
    zip.file('[Content_Types].xml', ct.replace(/<Override\b[^>]*calcChain[^>]*\/>/g, ''));
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/** Qty stepper: 0 → the weight minimum → +1 each; minus from the minimum goes to 0. */
export function step(n: number, dir: 1 | -1, min: number): number {
  const m = Math.max(1, min);
  if (dir > 0) return n < m ? m : n + 1;
  return n <= m ? 0 : n - 1;
}
export const exportName = (d: Details, today: string) => `Innova order - ${(d.artwork || 'custom discs').replace(/[\\/:*?"<>|]+/g, ' ').trim()} - ${today}.xlsx`;
