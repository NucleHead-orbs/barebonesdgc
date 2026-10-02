import { describe, expect, it } from 'vitest';
import { cleanOpts, knobAngle, optsLabel, PALETTES, sameOpts, signs } from './proofs';

describe('cleanOpts', () => {
  it('fills defaults and drops junk', () => {
    expect(cleanOpts('disc', null)).toEqual({ foil: 'Electric', plastic: 'Black' });
    expect(cleanOpts('disc', { foil: 'Gold', plastic: 'Plaid', evil: 'x' })).toEqual({ foil: 'Gold', plastic: 'Black' });
    expect(cleanOpts('screen_print', { inks: 'Toxic', shirt: 'Navy' })).toEqual({ inks: 'Toxic', shirt: 'Navy' });
    expect(cleanOpts('tee_signs', { palette: 'toString' })).toEqual({ palette: 'Electric', bg: 'Navy' });
  });
  it('labels and compares picks', () => {
    expect(optsLabel('disc', { foil: 'Sunset', plastic: 'Navy' })).toBe('Sunset foil on Navy');
    expect(sameOpts({ a: '1' }, { a: '1' })).toBe(true);
    expect(sameOpts({ a: '1' }, { a: '2' })).toBe(false);
  });
});

describe('tee signs', () => {
  it('has all 20 holes in order with a map and a quote', () => {
    const s = signs(PALETTES.Electric);
    expect(s.map((x) => x.n)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(s.every((x) => x.quote.length > 0 && x.line.len > 0)).toBe(true);
  });
  it('knob 11 is the last notch', () => {
    expect(knobAngle(0)).toBe(-150);
    expect(knobAngle(11)).toBe(150);
  });
});

describe('tee sign bubble quotes', () => {
  it('keeps the TD\'s per-hole text, cleaned and capped', () => {
    const o = cleanOpts('tee_signs', { palette: 'Electric', q3: '  Stay off\n the green  ', q7: 'x'.repeat(300), q21: 'nope', q5: 42, q9: '   ' });
    expect(o.q3).toBe('Stay off the green');
    expect(o.q7).toHaveLength(140);
    expect(o.q21).toBeUndefined(); expect(o.q5).toBeUndefined(); expect(o.q9).toBeUndefined();
    expect(cleanOpts('disc', { q3: 'hi' }).q3).toBeUndefined();
  });
  it('uses the edit on the sign and the default everywhere else', () => {
    const s = signs(PALETTES.Electric, { q2: 'Hit the gap, hero.' });
    expect(s[1].quote).toBe('Hit the gap, hero.');
    expect(s[0].quote).toBe('The Green, parking lot & sidewalk are all OB!');
  });
});
