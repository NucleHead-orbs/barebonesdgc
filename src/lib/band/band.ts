/**
 * Meet the Band: the admin team / event managers as character cards. Source of truth: band_members
 * (supabase/migrations/20261013000000_band.sql). A card is a site asset (/assets/band/…) or an upload in the
 * public gallery bucket under band/. Reads go through RLS (public: visible members); writes are super admin only.
 */
import { supabase } from '../supabase';
import { GALLERY_BUCKET, shrink } from '../gallery/api';

export interface BandMember { id: string; name: string; role: string; card: string | null; sort: number; hidden: boolean }
const COLS = 'id, name, role, card, sort, hidden';
export const CARD_EDGE = 1200;
export const CARD_MAX_BYTES = 8 * 1024 * 1024;

type Result<T> = { data: T; error?: undefined } | { data?: undefined; error: unknown };
const wrap = async <T>(fn: () => Promise<T>): Promise<Result<T>> => { try { return { data: await fn() }; } catch (error) { return { error }; } };
const must = <T>(r: { data: T; error: unknown }): T => { if (r.error) throw r.error; return r.data; };

export const isUpload = (card: string | null) => !!card && card.startsWith('band/');
export const cardUrl = (card: string | null) =>
  !card ? null : isUpload(card) ? supabase.storage.from(GALLERY_BUCKET).getPublicUrl(card).data.publicUrl : card;

/** Next sort slot after the current members. */
export const nextSort = (ms: Pick<BandMember, 'sort'>[]) => ms.reduce((m, x) => Math.max(m, x.sort), 0) + 1;

/** Swap a member with its neighbour; returns the two updates to make (or none at the ends). */
export function moveSorts(ms: BandMember[], id: string, dir: -1 | 1): Array<{ id: string; sort: number }> {
  const list = [...ms].sort((a, b) => a.sort - b.sort);
  const i = list.findIndex((m) => m.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return [];
  const a = list[i], b = list[j];
  const [sa, sb] = a.sort === b.sort ? [b.sort + dir, a.sort] : [b.sort, a.sort];
  return [{ id: a.id, sort: sa }, { id: b.id, sort: sb }];
}

export const loadBand = () => wrap(async (): Promise<BandMember[]> =>
  (must(await supabase.from('band_members').select(COLS).eq('hidden', false).order('sort').order('created_at')) ?? []) as BandMember[]);
export const loadAllBand = () => wrap(async (): Promise<BandMember[]> =>
  (must(await supabase.from('band_members').select(COLS).order('sort').order('created_at')) ?? []) as BandMember[]);

export const addMember = (name: string, role: string, sort: number) => wrap(async (): Promise<BandMember> =>
  must(await supabase.from('band_members').insert({ name: name.trim(), role: role.trim(), sort, hidden: true }).select(COLS).single()) as BandMember);

export const updateMember = (id: string, patch: Partial<Pick<BandMember, 'name' | 'role' | 'sort' | 'hidden'>>) => wrap(async (): Promise<void> => {
  must(await supabase.from('band_members').update(patch).eq('id', id));
});

/** Upload a new card (shrunk to 1200 px WebP), point the member at it, then drop the old upload. */
export const uploadCard = (m: BandMember, file: File) => wrap(async (): Promise<string> => {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Cards must be PNG, JPG, WebP or GIF.');
  const blob = await shrink(file, CARD_EDGE);
  if (blob.size > CARD_MAX_BYTES) throw new Error('That image is over 8 MB even after shrinking.');
  const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : blob.type === 'image/gif' ? 'gif' : 'jpg';
  const path = `band/${crypto.randomUUID()}.${ext}`;
  must(await supabase.storage.from(GALLERY_BUCKET).upload(path, blob, { contentType: blob.type, upsert: false }));
  const r = await supabase.from('band_members').update({ card: path }).eq('id', m.id);
  if (r.error) { await supabase.storage.from(GALLERY_BUCKET).remove([path]); throw r.error; }
  if (isUpload(m.card)) await supabase.storage.from(GALLERY_BUCKET).remove([m.card!]);
  return path;
});

export const removeMember = (m: BandMember) => wrap(async (): Promise<void> => {
  must(await supabase.from('band_members').delete().eq('id', m.id));
  if (isUpload(m.card)) await supabase.storage.from(GALLERY_BUCKET).remove([m.card!]);
});
