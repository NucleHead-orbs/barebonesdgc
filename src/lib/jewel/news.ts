/**
 * Jewel news: pure helpers for the event page's Updates section.
 * Source of truth: JEWEL_NEWS + JEWEL_OVERVIEW.regOpensAt in content.ts (posts are copy, shipped with the site).
 */

export interface NewsPost {
  /** Stable id (also the artwork file name under /assets/jewel-xi/news). */
  id: string;
  /** YYYY-MM-DD, Arizona date it went out. */
  date: string;
  title: string;
  /** Artwork: /assets/jewel-xi/news/<id>.webp + <id>-thumb.webp (360px square). */
  art?: { alt: string };
  /** Paragraphs; a "\n" inside one is a line break. */
  body: string[];
}

/** Newest first; ties keep their written order. */
export const sortNews = (posts: NewsPost[]) => posts.map((p, i) => ({ p, i }))
  .sort((a, b) => b.p.date.localeCompare(a.p.date) || a.i - b.i).map((x) => x.p);

/** "Oct 2, 2026" without time-zone drift (dates are calendar dates, not instants). */
export function fmtNewsDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export type Part = { text: string } | { text: string; to: string };
/** Split a line so our own site links (barebonesdiscgolf.club/...) become in-app links. */
export function linkParts(line: string): Part[] {
  const out: Part[] = [];
  const re = /(?:https?:\/\/)?(?:www\.)?barebonesdiscgolf\.club(\/[\w\-/]*)?/g;
  let at = 0;
  for (const m of line.matchAll(re)) {
    if (m.index! > at) out.push({ text: line.slice(at, m.index) });
    out.push({ text: m[0].replace(/^https?:\/\//, ''), to: (m[1] ?? '/').replace(/\/+$/, '') || '/' });
    at = m.index! + m[0].length;
  }
  if (at < line.length) out.push({ text: line.slice(at) });
  return out;
}

/** Registration banner flips by itself at regOpensAt, so it never goes stale. */
export function registrationBanner(o: { regOpensAt: string; regBannerBefore: string; regBannerOpen: string }, now = new Date()): string {
  return now.getTime() >= new Date(o.regOpensAt).getTime() ? o.regBannerOpen : o.regBannerBefore;
}
