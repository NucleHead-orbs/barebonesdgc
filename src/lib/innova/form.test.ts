/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fillForm, linesInForm, openBook, parseCatalog, readSheet, remapLines, setCells, step, summarize, detailIssues, type Catalog, type Lines } from './form';
import { moldKey } from './molds';

const FIXTURE = readFileSync(new URL('./__fixtures__/innova-order-form-2026-09-23.xlsx', import.meta.url));
const bytes = () => new Uint8Array(FIXTURE);
const load = async () => { const b = await openBook(bytes()); return { b, cat: parseCatalog(b) }; };
const find = (cat: Catalog, name: string) => { const m = cat.molds.find((x) => x.name === name); if (!m) throw new Error(`no ${name}`); return m; };
const details = { name: 'Jason', email: 'j@example.test', phone: '480-555-0100', artwork: 'Jewel XI', die: 'Golf Disc', ship: ['1 Main St', 'Mesa AZ 85201'] };

describe('reads Innova\'s form', () => {
  it('finds the version, sections and molds', async () => {
    const { cat } = await load();
    expect(cat.label).toBe('Updated: 09/23/2026');
    expect(cat.molds.length).toBeGreaterThan(350);
    expect(cat.warnings).toEqual([]);
    const alien = find(cat, 'DX Alien');
    expect(alien).toMatchObject({ row: 26, price: 7, minMold: 10, minCell: 5, group: 'custom' });
    expect(alien.slots.map((s) => s.label)).toEqual(['140-150', '151-159', '160-164', '165-169', '170-174', '175-177', '178-180']);
    expect(find(cat, 'DX Cobra').slots.filter((s) => s.out).map((s) => s.col)).toEqual(['M', 'N', 'O']);
    expect(cat.molds.some((m) => m.row === 34)).toBe(false); // hidden (discontinued) rows are skipped
  });
  it('reads black cells as unavailable and yellow cells as low stock', async () => {
    const { cat } = await load();
    const makani = cat.molds.find((m) => /^DX Makani/.test(m.name))!;
    expect(makani.slots.filter((s) => !s.out).map((s) => s.col)).toEqual(['O']);
    expect(makani.setup).toBe(30);
    expect(cat.molds.some((m) => m.slots.some((s) => s.low))).toBe(true);
  });
  it('knows groups, section minimums, setup and flat-top/custom-stock flags', async () => {
    const { cat } = await load();
    const pulsar = cat.sections.find((s) => /Pulsar/.test(s.title))!;
    expect(pulsar).toMatchObject({ min: 50, setup: 30, single: true, group: 'custom' });
    const minis = cat.sections.find((s) => s.group === 'minis')!;
    expect(minis).toMatchObject({ min: 100, perModel: 50, single: true });
    expect(cat.sections.find((s) => /^DX SPECIALTY/.test(s.title))!.min).toBe(50);
    expect(find(cat, 'Champion XG Rhyno').group).toBe('tfr');
    const flat = find(cat, 'Flat Top DX Roc**');
    expect(flat).toMatchObject({ flatTop: true, customStock: true, price: 8 });
  });
  it('reads the pricing tab and where each header box is', async () => {
    const { cat } = await load();
    expect(cat.orderMin).toBe(50);
    expect(cat.fees).toEqual({ dieNew: { golf: 80, mini: 60 }, dieReorder: { golf: 30, mini: 20 }, flatTop: 1 });
    expect(cat.fields).toMatchObject({ order_date: 'K11', event_date: 'K12', name: 'K14', phone: 'K15', email: 'K16', artwork: 'Q11', die: 'Q12', misprints: 'Q14', new_stamp: 'Q15', rep: 'Q16' });
    expect(cat.ship).toEqual(['I6', 'I7', 'I8', 'I9']);
    expect(cat.bill).toEqual(['N6', 'N7', 'N8', 'N9']);
    expect(cat.notesCell).toBe('I18');
  });
  it('rejects something that is not the form', async () => {
    await expect(openBook(new Uint8Array([1, 2, 3]))).rejects.toThrow(/xlsx/);
  });
});

describe('Innova\'s rules', () => {
  it('passes a valid order and totals it', async () => {
    const { cat } = await load();
    const lines: Lines = { 26: { mold: 'DX Alien', q: { M: 20, N: 10 } }, [find(cat, 'Flat Top DX Roc**').row]: { mold: 'Flat Top DX Roc**', q: { M: 10, N: 10 } } };
    const s = summarize(cat, lines, { new_stamp: 'Y' });
    expect(s.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(s.ok).toBe(true);
    expect(s.golf).toBe(50);
    expect(s.subtotal).toBe(30 * 7 + 20 * 8);
    expect(s.fees).toEqual([{ label: 'New golf disc die', amount: 80 }, { label: 'Flat-top fee (20 × $1)', amount: 20 }]);
    expect(s.total).toBe(370 + 100);
    expect(summarize(cat, lines, { new_stamp: 'N' }).fees[0]).toEqual({ label: 'Reorder golf disc die', amount: 30 });
  });
  it('enforces 5 per weight, 10 per mold, 50 per order, out of stock', async () => {
    const { cat } = await load();
    const t = (l: Lines) => summarize(cat, l).issues.filter((i) => i.level === 'error').map((i) => i.text).join(' | ');
    expect(t({ 26: { mold: 'DX Alien', q: { M: 3, N: 47 } } })).toMatch(/minimum is 5 per weight/);
    expect(t({ 26: { mold: 'DX Alien', q: { M: 5 } }, 27: { mold: 'DX Cobra', q: { P: 45 } } })).toMatch(/DX Alien: 5 discs. Innova's minimum is 10 per mold/);
    expect(t({ 26: { mold: 'DX Alien', q: { M: 20 } } })).toMatch(/order minimum is 50/);
    expect(t({ 27: { mold: 'DX Cobra', q: { M: 50 } } })).toMatch(/140-150 is out of stock/);
    expect(t({})).toMatch(/No discs/);
  });
  it('keeps minis on their own order with their own minimums', async () => {
    const { cat } = await load();
    const std = cat.molds.find((m) => /^Standard/.test(m.name))!;
    const drv = cat.molds.find((m) => /^Mini Driver/.test(m.name))!;
    const t = (l: Lines) => summarize(cat, l).issues.filter((i) => i.level === 'error').map((i) => i.text).join(' | ');
    expect(t({ [std.row]: { mold: std.name, q: { M: 60 } } })).toMatch(/needs 100 in total/);
    expect(t({ [std.row]: { mold: std.name, q: { M: 70 } }, [drv.row]: { mold: drv.name, q: { M: 30 } } })).toMatch(/Needs 50 per model/);
    const ok = summarize(cat, { [std.row]: { mold: std.name, q: { M: 100 } } }, { new_stamp: 'Y' });
    expect(ok.ok).toBe(true);
    expect(ok.fees[0]).toEqual({ label: 'New mini die', amount: 60 });
    expect(t({ [std.row]: { mold: std.name, q: { M: 100 } }, 26: { mold: 'DX Alien', q: { M: 50 } } })).toMatch(/own order/);
  });
  it('charges setup per specialty mold and once for Pulsar/Kahuna', async () => {
    const { cat } = await load();
    const condor = cat.molds.find((m) => /^DX Condor/.test(m.name))!;
    const pul = find(cat, 'Pulsar'), kah = find(cat, 'Kahuna');
    const s = summarize(cat, { [condor.row]: { mold: condor.name, q: { N: 50 } }, [pul.row]: { mold: pul.name, q: { M: 30 } }, [kah.row]: { mold: kah.name, q: { M: 20 } } });
    expect(s.fees.map((f) => f.amount)).toEqual([80, 30, 30]);
    expect(s.issues.filter((i) => i.level === 'error')).toEqual([]);
  });
  it('requires the header details Innova needs', async () => {
    const { cat } = await load();
    expect(detailIssues(cat, {}).length).toBe(6);
    expect(detailIssues(cat, details)).toEqual([]);
  });
  it('stepper jumps to the weight minimum', () => {
    expect([step(0, 1, 5), step(5, 1, 5), step(6, -1, 5), step(5, -1, 5), step(0, 1, 0)]).toEqual([5, 6, 5, 0, 1]);
  });
});

describe('newer forms and saved lines', () => {
  it('follows a mold to its new row by name and drops what is gone', async () => {
    const { cat } = await load();
    const r = remapLines(cat, { 999: { mold: 'DX Alien', q: { M: 10 } }, 26: { mold: 'DX Alien', q: { N: 10 } }, 27: { mold: 'Unobtainium', q: { M: 10 } } });
    expect(r.lines).toEqual({ 26: { mold: 'DX Alien', q: { M: 10, N: 10 } } });
    expect(r.moved).toEqual(['DX Alien']);
    expect(r.dropped).toEqual(['Unobtainium']);
  });
});

describe('export fills Innova\'s own file', () => {
  it('round-trips quantities and header, never touches card boxes, recalcs on open', async () => {
    const { b, cat } = await load();
    const lines: Lines = { 26: { mold: 'DX Alien', q: { M: 20, N: 10 } }, 28: { mold: 'DX Jay', q: { P: 25 } } };
    const out = await fillForm(b, cat, lines, { ...details, notes: 'Mix of colors <please> & thanks', misprints: 'No', new_stamp: 'Y' });
    const b2 = await openBook(out); const cat2 = parseCatalog(b2);
    expect(linesInForm(b2, cat2)).toEqual(lines);
    const { cells } = readSheet(b2.xml, b2.shared);
    expect(cells.get('K14')?.value).toBe('Jason');
    expect(cells.get('Q11')?.value).toBe('Jewel XI');
    expect(cells.get('I18')?.value).toBe('Mix of colors <please> & thanks');
    expect(cells.get('I6')?.value).toBe('1 Main St');
    expect(cells.get('K13')?.value ?? null).toBeNull(); // credit card
    expect(cells.get('Q13')?.value ?? null).toBeNull(); // exp + CVC
    expect(cells.get('M26')?.s).toBe(readSheet(b.xml, b.shared).cells.get('M26')?.s); // style kept
    expect(cells.get('T26')?.formula).toContain('I26*7'); // formulas intact
    const wb = await b2.zip.file('xl/workbook.xml')!.async('string');
    expect(wb).toContain('<calcPr fullCalcOnLoad="1"/>');
    expect(cat2.molds.length).toBe(cat.molds.length);
  });
  it('clears quantities that were removed', async () => {
    const { b, cat } = await load();
    const once = await openBook(await fillForm(b, cat, { 26: { mold: 'DX Alien', q: { M: 20 } } }, details));
    const twice = await openBook(await fillForm(once, parseCatalog(once), { 28: { mold: 'DX Jay', q: { N: 10 } } }, details));
    expect(linesInForm(twice, parseCatalog(twice))).toEqual({ 28: { mold: 'DX Jay', q: { N: 10 } } });
  });
  it('setCells inserts missing cells in column order', () => {
    const x = '<sheetData><row r="2"><c r="A2"/><c r="D2" s="3"/></row></sheetData>';
    expect(setCells(x, { C2: 5, D2: 'hi', B5: 1 })).toBe('<sheetData><row r="2"><c r="A2"/><c r="C2"><v>5</v></c><c r="D2" s="3" t="inlineStr"><is><t xml:space="preserve">hi</t></is></c></row><row r="5"><c r="B5"><v>1</v></c></row></sheetData>');
  });
});

describe('mold info', () => {
  it('finds the base mold inside plastic names', () => {
    expect([
      'PROTO Glow Champion Halo Destroyer', 'DX Roc3', 'Glow Champion RocX3', 'HALO Champion IT', 'HALO Champion Womabt3',
      'DX Aviar Putt & Approach ', 'Glow KC Pro Pig', 'Classic Glow Metal Flake CH Hawkeye', 'Metal Flake CH Leopard3', 'DX Roc ', 'Star Rancho Roc',
    ].map(moldKey)).toEqual(['Destroyer', 'Roc3', 'RocX3', 'IT', 'Wombat3', 'Aviar', 'Pig', 'Hawkeye', 'Leopard3', 'Roc', 'Rancho Roc']);
  });
  it('covers every golf-disc mold on the form', async () => {
    const { cat } = await load();
    const missing = cat.molds.filter((m) => m.group !== 'minis' && !moldKey(m.name)).map((m) => m.name);
    expect(missing).toEqual([]);
  });
});
