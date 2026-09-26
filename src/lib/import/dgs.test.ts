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
    expect(json).not.toMatch(/example\.com|Large|15500|100/);
    for (const row of r.rows) expect(Object.keys(row).sort()).toEqual(['div_code', 'name', 'pdga', 'rating', 'reg_order']);
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
