import { describe, expect, it } from 'vitest';
import { bagLine, isAmateur, packCount, packRows, splitName } from './packs';

const players = [
  { id: '1', name: 'Danny Walden', div_code: 'MA40', shirt_size: 'large' },
  { id: '2', name: 'Axl Anhyzer Jr', div_code: 'MA1', shirt_size: 'XL' },
  { id: '3', name: 'Rusty Hyzer', div_code: 'MPO', shirt_size: 'M' },
  { id: '4', name: 'Bullockey', div_code: 'FA2', shirt_size: null },
  { id: '5', name: 'ann walden', div_code: 'FA2', shirt_size: 'S' },
];

describe('player pack bags', () => {
  it('amateurs by division code', () => {
    expect(['MA1', 'FA2', 'MA40', 'ma3'].every(isAmateur)).toBe(true);
    expect(['MPO', 'FPO', 'MP40', 'FP40'].some(isAmateur)).toBe(false);
  });
  it('splits names for last-name sorting, suffixes stay with the last name', () => {
    expect(splitName('Danny Walden')).toEqual({ first: 'Danny', last: 'Walden' });
    expect(splitName('Axl Anhyzer Jr')).toEqual({ first: 'Axl', last: 'Anhyzer Jr' });
    expect(splitName('Bullockey')).toEqual({ first: '', last: 'Bullockey' });
  });
  it('only the chosen divisions, A to Z by last name, sizes normalized', () => {
    const rows = packRows(players, ['MA40', 'MA1', 'FA2'], (d) => (d === 'MA1' ? 'PM' : 'AM'));
    expect(rows.map((r) => r.id)).toEqual(['2', '4', '5', '1']);
    expect(rows.find((r) => r.id === '1')?.size).toBe('L');
    expect(rows.find((r) => r.id === '2')?.wave).toBe('PM');
  });
  it('counts bags per size, disc-only separately', () => {
    const c = packCount(packRows(players, ['MA40', 'MA1', 'FA2'], () => null));
    expect(c).toEqual({ sizes: [{ size: 'S', n: 1 }, { size: 'L', n: 1 }, { size: 'XL', n: 1 }], noShirt: 1, total: 4 });
  });
  it('tells the check-in desk which bag', () => {
    expect(bagLine('lg')).toBe('Bag: L shirt');
    expect(bagLine(null)).toBe('Bag: disc only (no shirt size)');
  });
});
