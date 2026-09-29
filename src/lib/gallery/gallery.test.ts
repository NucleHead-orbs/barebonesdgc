import { describe, expect, it } from 'vitest';
import { CURRENT_JEWEL_NO, groupForPage, guessFromPath, jewelNoForYear, jewelRail, roman, titleFromFilename, youtubeId, type GalleryItem } from './gallery';

describe('youtubeId', () => {
  it('takes every common URL shape and a bare id', () => {
    for (const s of ['dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      ' https://www.youtube.com/live/dQw4w9WgXcQ?si=x ']) expect(youtubeId(s)).toBe('dQw4w9WgXcQ');
  });
  it('refuses channels, other sites and junk', () => {
    for (const s of ['https://www.youtube.com/@barebonesdiscgolfclub', 'https://vimeo.com/123', 'hello', 'https://youtu.be/short', ''])
      expect(youtubeId(s)).toBeNull();
  });
});

describe('jewel numbering', () => {
  it('matches the logos: 2016 = I, 2018 = III, 2022 = VII, 2025 = X, 2026 = XI', () => {
    expect([2016, 2018, 2022, 2025, 2026].map((y) => roman(jewelNoForYear(y)!))).toEqual(['I', 'III', 'VII', 'X', 'XI']);
    expect(jewelNoForYear(2015)).toBeNull();
  });
});

describe('guessFromPath (Drive archive first pass)', () => {
  it('Funny Pics are memes', () => expect(guessFromPath('Bare Bones/Funny Pics/biglydrives.png').category).toBe('meme'));
  it('Jewel year folders set year and number', () =>
    expect(guessFromPath('Bare Bones/Events/The Jewel/2019/Flier/barebones-thejewel-flier_2019.jpg')).toEqual({ category: 'jewel', year: 2019, jewel_no: 4, event_label: null }));
  it('the 2015 folder is pre-Jewel: no number', () => expect(guessFromPath('Events/The Jewel/2015/cooler.png').jewel_no).toBeNull());
  it('other event folders become the event label', () =>
    expect(guessFromPath('Bare Bones/Events/Lady Boner BYOB/LadyBoner_BYOB_2017_flyer.png')).toEqual({ category: 'event', year: 2017, jewel_no: null, event_label: 'Lady Boner BYOB' }));
  it('anything else is a photo', () => expect(guessFromPath('Bare Bones/Members/x.jpg').category).toBe('photo'));
});

it('titleFromFilename cleans file names', () => {
  expect(titleFromFilename('Funny Pics/bigly_drives-2.png')).toBe('Bigly drives 2');
  expect(titleFromFilename('.png')).toBe('Untitled');
});

const item = (p: Partial<GalleryItem>): GalleryItem => ({ id: Math.random().toString(36), kind: 'image', category: 'meme', title: 't', caption: null, year: null,
  jewel_no: null, event_label: null, storage_path: 'x', youtube_id: null, source_path: null, hidden: false, sort: 0, created_at: '2026-09-29', ...p });

describe('groupForPage', () => {
  it('never shows hidden rows, even to an admin', () => {
    const g = groupForPage([item({ hidden: true }), item({})]);
    expect(g.memes).toHaveLength(1);
  });
  it('orders the Jewel rail by number and splits videos out', () => {
    const g = groupForPage([item({ category: 'jewel', jewel_no: 10 }), item({ category: 'jewel', jewel_no: 2 }),
      item({ kind: 'video', category: 'event', storage_path: null, youtube_id: 'dQw4w9WgXcQ' })]);
    expect(g.jewels.map((j) => j.jewel_no)).toEqual([2, 10]);
    expect(g.videos).toHaveLength(1);
    expect(g.events).toHaveLength(0);
  });
});

describe('jewelRail', () => {
  const it2 = (id: string, jewel_no: number | null, sort = 0, hidden = false) => ({
    id, kind: 'image' as const, category: 'jewel' as const, title: id, caption: null, year: null, jewel_no,
    event_label: null, storage_path: `jewel/${id}.webp`, youtube_id: null, source_path: null, hidden, sort, created_at: '2026-01-01',
  });
  it('always has one slot per Jewel, empty where art is missing', () => {
    const rail = jewelRail([it2('b', 3, 2), it2('a', 3, 1), it2('h', 5, 0, true)]);
    expect(rail).toHaveLength(CURRENT_JEWEL_NO);
    expect(rail[2]).toMatchObject({ no: 3, roman: 'III', year: 2018 });
    expect(rail[2].cover?.id).toBe('a');
    expect(rail[2].items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(rail[4].cover).toBeNull(); // hidden never shows
    expect(rail[10]).toMatchObject({ roman: 'XI', year: 2026 });
  });
});
