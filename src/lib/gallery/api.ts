/**
 * Gallery data access. Reads go through RLS (public sees approved rows; super admin sees all).
 * Writes are super admin only (is_td()). Every call returns { data } or { error }; nothing throws into the UI.
 * Images: shrunk in the browser to <= 1600px WebP (GIFs pass through so they keep moving), uploaded, then the row.
 * If the row fails, the upload is removed, so storage never holds orphans.
 */
import { supabase } from '../supabase';
import { youtubeId, type GalleryCategory, type GalleryItem } from './gallery';

export const GALLERY_BUCKET = 'gallery';
const COLS = 'id, kind, category, title, caption, year, jewel_no, event_label, storage_path, youtube_id, source_path, hidden, sort, created_at';
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_EDGE = 1600;

type Result<T> = { data: T; error?: undefined } | { data?: undefined; error: unknown };
const wrap = async <T>(fn: () => Promise<T>): Promise<Result<T>> => {
  try { return { data: await fn() }; } catch (error) { return { error }; }
};
const must = <T>(r: { data: T; error: unknown }): T => { if (r.error) throw r.error; return r.data; };

export const imageUrl = (path: string) => supabase.storage.from(GALLERY_BUCKET).getPublicUrl(path).data.publicUrl;

/** Public page: approved rows only (the policy enforces it too; the filter keeps an admin's view honest). */
export const loadPublic = () => wrap(async (): Promise<GalleryItem[]> =>
  (must(await supabase.from('gallery_items').select(COLS).eq('hidden', false).order('sort').order('created_at')) ?? []) as GalleryItem[]);

/** Admin: everything, waiting rows first. */
export const loadAll = () => wrap(async (): Promise<GalleryItem[]> =>
  (must(await supabase.from('gallery_items').select(COLS).order('hidden', { ascending: false }).order('created_at', { ascending: false })) ?? []) as GalleryItem[]);

async function shrink(file: File): Promise<Blob> {
  if (file.type === 'image/gif') return file;
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch { return file; }
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) { bmp.close(); return file; }
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.85));
  return out && out.type === 'image/webp' && out.size < file.size ? out : file;
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const isDup = (e: unknown) => (e as { code?: string } | null)?.code === '23505';

export interface NewImage {
  file: File; title: string; category: GalleryCategory; year: number | null; jewel_no: number | null;
  event_label: string | null; source_path: string | null;
}

/** 'added' | 'exists' (same source_path already imported: nothing uploaded). Lands hidden. */
export const addImage = (n: NewImage) => wrap(async (): Promise<'added' | 'exists'> => {
  if (!EXT[n.file.type]) throw new Error(`${n.file.name}: only PNG, JPG, WebP or GIF.`);
  if (n.source_path) {
    const seen = must(await supabase.from('gallery_items').select('id').eq('source_path', n.source_path).maybeSingle());
    if (seen) return 'exists';
  }
  const blob = await shrink(n.file);
  if (blob.size > MAX_BYTES) throw new Error(`${n.file.name}: over 8 MB even after shrinking.`);
  const path = `${n.category}/${n.year ?? 'undated'}/${crypto.randomUUID()}.${EXT[blob.type] ?? 'webp'}`;
  must(await supabase.storage.from(GALLERY_BUCKET).upload(path, blob, { contentType: blob.type, upsert: false }));
  const row = await supabase.from('gallery_items').insert({
    kind: 'image', category: n.category, title: n.title, year: n.year,
    jewel_no: n.category === 'jewel' ? n.jewel_no : null, event_label: n.event_label,
    storage_path: path, source_path: n.source_path,
  });
  if (row.error) {
    await supabase.storage.from(GALLERY_BUCKET).remove([path]);
    if (isDup(row.error)) return 'exists';
    throw row.error;
  }
  return 'added';
});

/** A YouTube link or id. Lands hidden. */
export const addVideo = (url: string, title: string, category: GalleryCategory, year: number | null) => wrap(async (): Promise<void> => {
  const id = youtubeId(url);
  if (!id) throw new Error("That isn't a YouTube link.");
  must(await supabase.from('gallery_items').insert({ kind: 'video', category, title, year, youtube_id: id }));
});

export type GalleryPatch = Partial<Pick<GalleryItem, 'title' | 'caption' | 'category' | 'year' | 'jewel_no' | 'event_label' | 'hidden' | 'sort'>>;
export const update = (id: string, patch: GalleryPatch) => wrap(async (): Promise<GalleryItem> => {
  const p = { ...patch };
  if (p.category && p.category !== 'jewel') p.jewel_no = null;
  const rows = must(await supabase.from('gallery_items').update(p).eq('id', id).select(COLS)) as GalleryItem[] | null;
  if (!rows?.length) throw new Error('Not saved: only the super admin can edit the gallery.');
  return rows[0];
});

/** Row first (so the page never points at a missing file), then the file. */
export const remove = (item: GalleryItem) => wrap(async (): Promise<void> => {
  must(await supabase.from('gallery_items').delete().eq('id', item.id));
  if (item.storage_path) must(await supabase.storage.from(GALLERY_BUCKET).remove([item.storage_path]));
});

/** Approve (or pull) a batch in one statement. Returns how many rows actually changed. */
export const setHidden = (ids: string[], hidden: boolean) => wrap(async (): Promise<number> => {
  if (!ids.length) return 0;
  const rows = must(await supabase.from('gallery_items').update({ hidden }).in('id', ids).select('id')) as Array<{ id: string }> | null;
  return rows?.length ?? 0;
});
