import { describe, it, expect } from 'vitest';
import { parseDgsCsv, detectMapping } from './dgs';

const DIVS = ['MPO','FPO','MP40','FP40','MP50','MP55','MA1','FA1','MA40','MA50','MA60','MA2','FA2','MA3','FA3'];
// Synthetic fixture with the real DGS header set (no real people).
const H = 'Division,Name,First name,Last name,PDGA#,Email,Phone,Entry fee $,Ace Pool,Ace Pool $,Bare Bones members,Bare Bones members $,Jewel hole sponsor,Jewel hole sponsor $,T-shirt size,T-shirt size $,Address,City,State,ZIP,Country,Registration date MDT,Notes';
const row = (div: string, first: string, last: string, pdga: string, date: string, email = 'x@example.com') =>
  `${div},"${first} ${last}",${first},${last},${pdga},${email},,100,1,5,,,,,Large,,,,,,US,${date},`;
const csv = '\uFEFF' + [H,
  row('MA1', 'Axl', 'Anhyzer', '111', '2025-10-02 10:00:00'),
  row('MA1', 'Lita', 'Ford', '', '2025-09-13 02:49:55'),
  row('MPO', 'Rusty', 'Hyzer', '222', ''),
  'MA2,"Doe, Jane",Jane,Doe,,,,,,,,,,,,,,,,,,2025-09-20 12:00:00,"note, with comma"',
  row('SPON', 'Sponsor', 'Only', '333', '2025-09-01 00:00:00'),
  row('ZZ9', 'Wrong', 'Div', '', '2025-09-02 00:00:00'),
  'Totals,,,,,,,15500,122,580,,,,,,,,,,,,,',
].join('\r\n');

describe('DGS import', () => {
  const r = parseDgsCsv(csv, DIVS);

  it('maps the real DGS headers exactly', () => {
    expect(r.mapping).toMatchObject({ division: 'Division', name: 'Name', pdga: 'PDGA#', regDate: 'Registration date MDT' });
    expect(r.mapping.rating).toBeUndefined();
  });

  it('never carries email, phone, address or payment data', () => {
    const json = JSON.stringify(r.rows);
    expect(json).not.toMatch(/example\.com|15500|100/);
    for (const row of r.rows) expect(Object.keys(row).sort()).toEqual(['div_code', 'name', 'pdga', 'rating', 'reg_order', 'shirt_size']);
  });

  it('reads the T-shirt size (never the T-shirt $ column), normalized', () => {
    expect(r.mapping.shirt).toBe('T-shirt size');
    expect(r.rows.find((x) => x.name === 'Axl Anhyzer')!.shirt_size).toBe('L');
    expect(r.rows.find((x) => x.name === 'Doe, Jane')!.shirt_size).toBeNull();
  });

  it('skips the Totals footer, SPON and unknown divisions, with reasons', () => {
    expect(r.skipped.map((s) => s.reason).sort()).toEqual(['footer', 'sponsor_only', 'unknown_division']);
    expect(r.rows).toHaveLength(4);
  });

  it('orders registration by date, not file order; undated last', () => {
    expect(r.rows.map((x) => x.name)).toEqual(['Lita Ford', 'Doe, Jane', 'Axl Anhyzer', 'Rusty Hyzer']);
    expect(r.rows.map((x) => x.reg_order)).toEqual([1, 2, 3, 4]);
  });

  it('handles quoted commas, BOM, CRLF, and empty PDGA#', () => {
    expect(r.rows.find((x) => x.name === 'Doe, Jane')).toMatchObject({ div_code: 'MA2', pdga: null });
    expect(r.blocking).toEqual([]);
  });

  it('blocks on duplicate names and shared PDGA numbers', () => {
    const dup = [H, row('MA1', 'Sam', 'Smith', '', 'a'), row('MA2', 'sam', ' smith', '', 'b'),
                 row('MA3', 'A', 'B', '9', 'c'), row('MA3', 'C', 'D', '9', 'd')].join('\n');
    const b = parseDgsCsv(dup, DIVS).blocking.join(' ');
    expect(b).toMatch(/Same name/);
    expect(b).toMatch(/PDGA# 9/);
  });

  it('falls back to First + Last and loose headers for other exports', () => {
    expect(detectMapping(['Class', 'First', 'Last', 'PDGA Number', 'Player Rating']))
      .toMatchObject({ division: 'Class', first: 'First', last: 'Last', pdga: 'PDGA Number', rating: 'Player Rating' });
  });

  it('blocks when it cannot find required columns', () => {
    expect(parseDgsCsv('foo,bar\n1,2', DIVS).blocking.length).toBe(2);
  });
});

describe('DGS import: 2026 export layout + hole sponsors', () => {
  // Header set of the real 2026-09-27 export (note "Registration date MST", no "T-shirt size $"). Synthetic people.
  const H26 = 'Division,Name,"First name","Last name",PDGA#,Email,Phone,"Entry fee $","Ace Pool","Ace Pool $","Bare Bones members","Bare Bones members $","Jewel hole sponsor","Jewel hole sponsor $","T-shirt size",Address,City,State,ZIP,Country,"Registration date MST",Notes';
  const csv26 = [H26,
    'FA2,"Dee Driver",Dee,Driver,100001,d@example.com,,100,1,5,,,1,50,XXL,,,,,,"2026-09-27 00:02:18",',
    'MA40,"Pat Putter",Pat,Putter,,p@example.com,,100,,,1,-5,,,XL,,,,,,"2026-09-26 21:04:45","private note"',
    'MA40,Mononym,,Mononym,,,,,1,,1,,1,,Large,,,,,US,"2026-09-26 22:52:08",',
    'SPON,"Acme Discs",Acme,Discs,,,,,,,,,1,50,XL,,,,,US,"2026-09-26 22:51:13","Full Hole - $100"',
    'SPON,"Acme  discs",Acme,discs,,,,,,,,,1,50,XL,,,,,US,"2026-09-26 22:55:13",',
    'Totals,,,,,,,300,3,10,2,-5,7,250,,,,,,,,',
  ].join('\n');
  const r = parseDgsCsv(csv26, DIVS);

  it('maps the 2026 headers, including MST date and the sponsor flag', () => {
    expect(r.mapping).toMatchObject({ division: 'Division', name: 'Name', pdga: 'PDGA#', regDate: 'Registration date MST', sponsor: 'Jewel hole sponsor' });
    expect(r.blocking).toEqual([]);
  });

  it('imports players (a one-word name is fine) and skips SPON + footer', () => {
    expect(r.rows.map((x) => x.name)).toEqual(['Pat Putter', 'Mononym', 'Dee Driver']);
    expect(r.skipped.map((s) => s.reason).sort()).toEqual(['footer', 'sponsor_only', 'sponsor_only']);
  });

  it('collects hole sponsors from players AND SPON-only rows, once per name', () => {
    expect(r.sponsors.map((s) => s.name)).toEqual(['Dee Driver', 'Mononym', 'Acme Discs']);
  });

  it('never carries sponsor dollars, notes, email or phone', () => {
    const json = JSON.stringify({ rows: r.rows, sponsors: r.sponsors });
    expect(json).not.toMatch(/example\.com|private note|Full Hole|\$/);
    for (const s of r.sponsors) expect(Object.keys(s).sort()).toEqual(['line', 'name']);
  });

  it('2026 sizes: XXL -> 2XL, XL stays', () => {
    expect(r.rows.map((x) => x.shirt_size)).toEqual(['XL', 'L', '2XL']);
  });

  it('no sponsor column means no sponsors (last year\'s export still works)', () => {
    expect(parseDgsCsv('Division,Name\nMA1,Solo Sam', DIVS).sponsors).toEqual([]);
  });
});

describe('shirtCell', () => {
  it('keeps odd sizes as typed, drops flags and numbers', async () => {
    const { shirtCell } = await import('./dgs');
    expect([shirtCell('Large'), shirtCell('6XL'), shirtCell('1'), shirtCell('yes'), shirtCell(''), shirtCell('Youth XL')])
      .toEqual(['L', '6XL', null, null, null, 'Youth XL']);
  });
});
