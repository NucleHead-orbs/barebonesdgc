/**
 * Club gallery rules (pure). Source of truth: the gallery_items table (supabase/migrations/20261003000000_gallery.sql).
 * Images live in the public `gallery` bucket; videos live on YouTube and are stored as their 11-char id.
 */
export type GalleryCategory = 'jewel' | 'meme' | 'photo' | 'event';
export type GalleryKind = 'image' | 'video';

export interface GalleryItem {
  id: string;
  kind: GalleryKind;
  category: GalleryCategory;
  title: string;
  caption: string | null;
  year: number | null;
  jewel_no: number | null;
  event_label: string | null;
  storage_path: string | null;
  youtube_id: string | null;
  source_path: string | null;
  hidden: boolean;
  sort: number;
  created_at: string;
}

export const CATEGORIES: Array<{ id: GalleryCategory; label: string }> = [
  { id: 'jewel', label: 'The Jewel' },
  { id: 'meme', label: 'Memes' },
  { id: 'photo', label: 'Photos' },
  { id: 'event', label: 'Events' },
];

export const YOUTUBE_CHANNEL = 'https://www.youtube.com/@barebonesdiscgolfclub';

/** The first Jewel was 2016 (2018 = III, 2022 = VII, 2025 = X, per the logos). */
export const FIRST_JEWEL_YEAR = 2016;
export const jewelNoForYear = (year: number): number | null => (year >= FIRST_JEWEL_YEAR ? year - FIRST_JEWEL_YEAR + 1 : null);

const ROMAN: Array<[number, string]> = [[90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
export function roman(n: number): string {
  let out = '';
  let v = Math.floor(n);
  for (const [k, s] of ROMAN) while (v >= k) { out += s; v -= k; }
  return out;
}

/** Accepts a bare id or any common YouTube URL (watch, youtu.be, shorts, embed, live). null if it isn't one. */
export function youtubeId(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.split('/')[1] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = u.searchParams.get('v');
    if (!id) {
      const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
      id = m ? m[1] : null;
    }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

export const youtubeThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
export const youtubeEmbed = (id: string) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
export const youtubeWatch = (id: string) => `https://www.youtube.com/watch?v=${id}`;

/** "funny-pics/Bigly_Drives-2.png" -> "Bigly Drives 2" */
export function titleFromFilename(path: string): string {
  const base = path.split('/').pop() ?? path;
  const t = base.replace(/\.[a-z0-9]+$/i, '').replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 120) || 'Untitled';
}

export interface Guess { category: GalleryCategory; year: number | null; jewel_no: number | null; event_label: string | null }

/**
 * First-pass tags from where a file sits in the Drive archive ("Bare Bones/..."). Deterministic; the admin
 * fixes anything wrong before approving. Paths are matched case-insensitively on folder names.
 *   Funny Pics/*                       -> meme
 *   Events/The Jewel/<year>/*          -> jewel, that year, jewel_no from the year
 *   Events/<Name>/*                    -> event, event_label = <Name>
 *   anything else                      -> photo
 * A 20xx in the path (folder or file name) fills year when the rule didn't.
 */
export function guessFromPath(path: string): Guess {
  const parts = path.split('/').filter(Boolean);
  const lower = parts.map((p) => p.toLowerCase());
  const yearIn = (s: string) => { const m = s.match(/(?:^|[^0-9])(20[0-4][0-9])(?:[^0-9]|$)/); return m ? Number(m[1]) : null; };
  const anyYear = (): number | null => { for (const p of parts) { const y = yearIn(p); if (y) return y; } return null; };
  const ev = lower.indexOf('events');
  if (lower.includes('funny pics') || lower.includes('memes')) return { category: 'meme', year: anyYear(), jewel_no: null, event_label: null };
  if (ev >= 0 && lower[ev + 1] === 'the jewel') {
    const y = parts[ev + 2] && /^20\d\d$/.test(parts[ev + 2]) ? Number(parts[ev + 2]) : anyYear();
    return { category: 'jewel', year: y, jewel_no: y ? jewelNoForYear(y) : null, event_label: null };
  }
  if (ev >= 0 && parts[ev + 1] && ev + 2 < parts.length) return { category: 'event', year: anyYear(), jewel_no: null, event_label: parts[ev + 1].slice(0, 80) };
  return { category: 'photo', year: anyYear(), jewel_no: null, event_label: null };
}

/** Files the bulk import takes: raster images only (the bucket refuses anything else anyway). */
export const IMPORTABLE = /\.(png|jpe?g|webp|gif)$/i;

export interface GalleryPage {
  jewels: GalleryItem[];
  memes: GalleryItem[];
  photos: GalleryItem[];
  events: GalleryItem[];
  videos: GalleryItem[];
}

const bySort = (a: GalleryItem, b: GalleryItem) => a.sort - b.sort || a.created_at.localeCompare(b.created_at);

/** Public page sections. Hidden rows never appear here, whoever is looking. Videos are their own section. */
export function groupForPage(items: GalleryItem[]): GalleryPage {
  const shown = items.filter((i) => !i.hidden);
  const images = shown.filter((i) => i.kind === 'image');
  return {
    jewels: images.filter((i) => i.category === 'jewel')
      .sort((a, b) => (a.jewel_no ?? 999) - (b.jewel_no ?? 999) || (a.year ?? 0) - (b.year ?? 0) || bySort(a, b)),
    memes: images.filter((i) => i.category === 'meme').sort(bySort),
    photos: images.filter((i) => i.category === 'photo').sort(bySort),
    events: images.filter((i) => i.category === 'event').sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || bySort(a, b)),
    videos: shown.filter((i) => i.kind === 'video').sort(bySort),
  };
}

export type Filter = 'all' | GalleryCategory | 'video';
export const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' }, { id: 'jewel', label: 'The Jewel' }, { id: 'meme', label: 'Memes' },
  { id: 'photo', label: 'Photos' }, { id: 'video', label: 'Videos' }, { id: 'event', label: 'Events' },
];

/** The Jewel the site is promoting right now. The rail always shows I..this, with an empty slot for any missing art. */
export const CURRENT_JEWEL_NO = 11;

export interface JewelSlot { no: number; roman: string; year: number; cover: GalleryItem | null; items: GalleryItem[] }

/** One slot per Jewel, oldest first. Cover = first approved image for that number (by sort). */
export function jewelRail(jewels: GalleryItem[], upTo = CURRENT_JEWEL_NO): JewelSlot[] {
  return Array.from({ length: upTo }, (_, i) => {
    const no = i + 1;
    const items = jewels.filter((j) => !j.hidden && j.jewel_no === no).sort(bySort);
    return { no, roman: roman(no), year: FIRST_JEWEL_YEAR + i, cover: items[0] ?? null, items };
  });
}
