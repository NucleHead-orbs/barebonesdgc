import { describe, expect, it } from 'vitest';
import { GMODE_KEY, parseGMode } from './gmode';

describe('G-Mode', () => {
  it('is off unless the phone saved it on', () => {
    expect(parseGMode('1')).toBe(true);
    expect(parseGMode('0')).toBe(false);
    expect(parseGMode(null)).toBe(false);
    expect(parseGMode(undefined)).toBe(false);
    expect(parseGMode('true')).toBe(false);
  });
  it('keeps its storage key (phones already have it saved)', () => {
    expect(GMODE_KEY).toBe('bb-gmode');
  });
});
