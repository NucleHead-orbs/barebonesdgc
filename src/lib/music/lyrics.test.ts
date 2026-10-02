import { describe, expect, it } from 'vitest';
import { inBreak, lineAt, parseLyrics, wordProgress, type LyricLine } from './lyrics';

const L = (t: number, e: number, text = 'x'): LyricLine => ({ t, e, text, w: [{ t, e, w: text }] });
const lines = [L(10, 12), L(12.5, 15), L(30, 33)];

describe('karaoke lyrics', () => {
  it('finds the line being sung (with a small lead-in)', () => {
    expect(lineAt(lines, 5)).toBe(-1);
    expect(lineAt(lines, 9.9)).toBe(0);
    expect(lineAt(lines, 13)).toBe(1);
    expect(lineAt(lines, 40)).toBe(2);
  });
  it('shows a break during long instrumentals only', () => {
    expect(inBreak(lines, -1, 5)).toBe(true);
    expect(inBreak(lines, 0, 12.2)).toBe(false);
    expect(inBreak(lines, 1, 20)).toBe(true);
    expect(inBreak(lines, 1, 27)).toBe(false); // next line is close: keep it up
    expect(inBreak(lines, 2, 35)).toBe(true);
  });
  it('sweeps through a word', () => {
    const w = { t: 1, e: 2, w: 'yo' };
    expect(wordProgress(w, 0.5)).toBe(0); expect(wordProgress(w, 1.5)).toBe(0.5); expect(wordProgress(w, 3)).toBe(1);
  });
  it('rejects junk files and sorts lines', () => {
    expect(parseLyrics(null)).toBeNull();
    expect(parseLyrics({ lines: [{ t: 'a' }] })).toBeNull();
    expect(parseLyrics({ lines: [L(5, 6, 'b'), L(1, 2, 'a')] })!.lines.map((l) => l.text)).toEqual(['a', 'b']);
  });
});
