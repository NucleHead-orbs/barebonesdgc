/**
 * Karaoke lyrics: pure logic. Source of truth is public/music/<slug>.lyrics.json, generated from the
 * song's own (Suno) lyrics force-aligned to the isolated vocal. A track opts in with `lyrics: true`
 * in MUSIC (content.ts), so the page never probes for files that don't exist.
 */
export interface LyricWord { t: number; e: number; w: string }
export interface LyricLine { t: number; e: number; text: string; w: LyricWord[] }
export interface Lyrics { lines: LyricLine[] }

/** A gap this long between sung lines shows the instrumental marker instead of a stale line. */
export const GAP_S = 4;
/** Light the next line this early so singers can read ahead. */
export const LEAD_S = 0.15;

/** Index of the line being sung at `now` (last line started), or -1 before the first line. */
export function lineAt(lines: LyricLine[], now: number): number {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t - LEAD_S <= now) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** True when nothing is being sung: before the first line, or a long break after a line ended. */
export function inBreak(lines: LyricLine[], i: number, now: number): boolean {
  if (i < 0) return true;
  const next = lines[i + 1];
  return now > lines[i].e + 1 && (!next || next.t - now > GAP_S);
}

/** 0..1 how far through a word the singer is. */
export const wordProgress = (w: LyricWord, now: number) =>
  now <= w.t ? 0 : now >= w.e ? 1 : (now - w.t) / Math.max(0.01, w.e - w.t);

/** Validate a fetched file: drops malformed lines rather than trusting the network. */
export function parseLyrics(raw: unknown): Lyrics | null {
  const lines = (raw as { lines?: unknown })?.lines;
  if (!Array.isArray(lines)) return null;
  const ok = lines.filter((l): l is LyricLine => !!l && typeof l.t === 'number' && typeof l.e === 'number' && typeof l.text === 'string' && Array.isArray(l.w))
    .map((l) => ({ ...l, w: l.w.filter((w) => w && typeof w.t === 'number' && typeof w.e === 'number' && typeof w.w === 'string') }))
    .sort((a, b) => a.t - b.t);
  return ok.length ? { lines: ok } : null;
}

/** The line being sung right now, for the pinned bar ('' between lines). */
export function currentLine(lyrics: Lyrics | null, now: number): string {
  if (!lyrics) return '';
  const i = lineAt(lyrics.lines, now);
  return i < 0 || inBreak(lyrics.lines, i, now) ? '' : lyrics.lines[i].text;
}
