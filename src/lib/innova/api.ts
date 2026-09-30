/** Innova orders: rows in disc_orders (TD-only), the uploaded form in event-assets/<event_id>/innova/<order_id>/. */
import { supabase } from '../supabase';
import type { Details, Lines } from './form';

export interface DiscOrder {
  id: string; event_id: string; title: string; form_path: string | null; form_name: string | null; form_label: string | null;
  lines: Lines; details: Details; status: 'draft' | 'sent'; sent_at: string | null; created_by: string | null; updated_at: string;
}
type Result<T> = { data: T; error?: undefined } | { data?: undefined; error: unknown };
const wrap = async <T>(fn: () => Promise<T>): Promise<Result<T>> => { try { return { data: await fn() }; } catch (error) { return { error }; } };
const must = <T>(r: { data: T; error: unknown }): T => { if (r.error) throw r.error; return r.data; };
const BUCKET = 'event-assets';
const COLS = 'id, event_id, title, form_path, form_name, form_label, lines, details, status, sent_at, created_by, updated_at';

export const listOrders = (eventId: string) => wrap(async (): Promise<DiscOrder[]> =>
  must(await supabase.from('disc_orders').select(COLS).eq('event_id', eventId).order('created_at')) ?? []);
export const createOrder = (eventId: string, title: string, email: string, details: Details) => wrap(async (): Promise<DiscOrder> =>
  must(await supabase.from('disc_orders').insert({ event_id: eventId, title, created_by: email, details }).select(COLS).single()) as DiscOrder);
export type OrderPatch = Partial<Pick<DiscOrder, 'title' | 'lines' | 'details' | 'status' | 'form_path' | 'form_name' | 'form_label'>>;
export const updateOrder = (id: string, patch: OrderPatch) => wrap(async (): Promise<DiscOrder> =>
  must(await supabase.from('disc_orders').update(patch).eq('id', id).select(COLS).single()) as DiscOrder);
/** File first, then the row, so nothing is orphaned in storage. */
export const deleteOrder = (o: DiscOrder) => wrap(async () => {
  if (o.form_path) must(await supabase.storage.from(BUCKET).remove([o.form_path]));
  must(await supabase.from('disc_orders').delete().eq('id', o.id));
});
/** Store a new form for this order; the previous file is removed only after the row points at the new one. */
export const replaceForm = (o: DiscOrder, file: File, patch: OrderPatch) => wrap(async (): Promise<DiscOrder> => {
  const safe = file.name.replace(/[^\w.-]+/g, '-').slice(-80) || 'form.xlsx';
  const path = `${o.event_id}/innova/${o.id}/${Date.now()}-${safe}`;
  must(await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', upsert: false }));
  const r = await supabase.from('disc_orders').update({ ...patch, form_path: path, form_name: file.name.slice(0, 200) }).eq('id', o.id).select(COLS).single();
  if (r.error) { await supabase.storage.from(BUCKET).remove([path]); throw r.error; }
  if (o.form_path && o.form_path !== path) await supabase.storage.from(BUCKET).remove([o.form_path]);
  return r.data as DiscOrder;
});
export const downloadForm = (path: string) => wrap(async (): Promise<ArrayBuffer> =>
  (must(await supabase.storage.from(BUCKET).download(path)) as Blob).arrayBuffer());
