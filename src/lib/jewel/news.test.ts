import { describe, it, expect } from 'vitest';
import { fmtNewsDate, linkParts, registrationBanner, sortNews } from './news';
import { JEWEL_NEWS, JEWEL_OVERVIEW } from './content';

describe('news', () => {
  it('newest first, stable on ties', () => {
    const p = (id: string, date: string) => ({ id, date, title: id, body: [] });
    expect(sortNews([p('a', '2026-10-01'), p('b', '2026-10-02'), p('c', '2026-10-02')]).map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });
  it('formats calendar dates without drifting a day', () => {
    expect(fmtNewsDate('2026-10-02')).toBe('Oct 2, 2026');
  });
  it('turns our own links into in-app links', () => {
    expect(linkParts('Give it a spin: barebonesdiscgolf.club/music')).toEqual([{ text: 'Give it a spin: ' }, { text: 'barebonesdiscgolf.club/music', to: '/music' }]);
    expect(linkParts('https://barebonesdiscgolf.club/jewel-xi/ now')).toEqual([{ text: 'barebonesdiscgolf.club/jewel-xi/', to: '/jewel-xi' }, { text: ' now' }]);
    expect(linkParts('no links here')).toEqual([{ text: 'no links here' }]);
  });
  it('registration banner flips at 5 PM Arizona time on Oct 2', () => {
    expect(registrationBanner(JEWEL_OVERVIEW, new Date('2026-10-02T23:59:00Z'))).toBe(JEWEL_OVERVIEW.regBannerBefore);
    expect(registrationBanner(JEWEL_OVERVIEW, new Date('2026-10-03T00:00:00Z'))).toBe(JEWEL_OVERVIEW.regBannerOpen);
  });
  it('every post has an id, a date and a body; ids are unique', () => {
    expect(JEWEL_NEWS.length).toBeGreaterThan(0);
    for (const p of JEWEL_NEWS) {
      expect(p.id).toMatch(/^[a-z0-9-]+$/);
      expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.body.length).toBeGreaterThan(0);
    }
    expect(new Set(JEWEL_NEWS.map((p) => p.id)).size).toBe(JEWEL_NEWS.length);
  });
});
