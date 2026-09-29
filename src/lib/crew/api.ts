/**
 * Crew link API. Every call is a token-gated RPC (crew_*); the server checks the link, the role and the event.
 * Nothing here throws into the UI: { data } | { error }.
 */
import { supabase } from '../supabase';
import type { Announcement, Contact, ContactKind, ContactStatus, RaffleSale, Role } from './crew';

type Result<T> = { data: T; error?: undefined } | { data?: undefined; error: unknown };
const call = async <T>(fn: string, args: Record<string, unknown>): Promise<Result<T>> => {
  try {
    const r = await supabase.rpc(fn, args);
    if (r.error) return { error: r.error };
    return { data: r.data as T };
  } catch (error) { return { error }; }
};

export interface CrewTask {
  id: string; title: string; category: string; due_offset_days: number | null; done_at: string | null; done_by: string | null;
  notes: string | null; crew_id: string | null; assignee: string | null; sort: number;
  updates: Array<{ author: string; body: string; created_at: string }>;
}
export interface CrewHome {
  me: { id: string; name: string; roles: Role[] };
  event: { id: string; name: string; slug: string; club_name: string | null; starts_on: string; ends_on: string; skin: string; palette: string | null; use_checkin: boolean };
  crew: Array<{ id: string; name: string; roles: Role[] }>;
  announcements: Array<Announcement & { read: boolean }>;
  tasks: CrewTask[];
  players?: Array<{ id: string; name: string; div_code: string; checked_in: boolean }>;
  divisions?: string[];
  my_requests?: Array<{ id: string; status: 'new' | 'approved' | 'declined'; note: string | null; created_at: string; players: string[] }>;
  raffle?: { total: number; tickets: number; mine: RaffleSale[] };
  contacts?: Array<Contact & { mine: boolean; owner: string | null }>;
}

export const home = (t: string) => call<CrewHome>('crew_home', { p_token: t });
export const ack = (t: string, id: string) => call<null>('crew_ack', { p_token: t, p_announcement: id });
export const taskDone = (t: string, id: string, done: boolean) => call<null>('crew_task_done', { p_token: t, p_task: id, p_done: done });
export const taskNote = (t: string, id: string, body: string) => call<null>('crew_task_note', { p_token: t, p_task: id, p_body: body });
export const checkin = (t: string, player: string, on: boolean) => call<null>('crew_checkin', { p_token: t, p_player: player, p_on: on });
export const walkup = (t: string, name: string, div: string) => call<string>('crew_walkup', { p_token: t, p_name: name, p_div: div });
export const raffleSale = (t: string, s: { buyer: string; tickets: number; amount: number; method: RaffleSale['method'] }) =>
  call<string>('crew_raffle_sale', { p_token: t, p_buyer: s.buyer, p_tickets: s.tickets, p_amount: s.amount, p_method: s.method });
export const raffleVoid = (t: string, id: string) => call<null>('crew_raffle_void', { p_token: t, p_sale: id });
export const cardRequest = (t: string, players: string[], note: string) => call<string>('crew_card_request', { p_token: t, p_players: players, p_note: note || null });
export const addContact = (t: string, c: { kind: ContactKind; name: string; org: string; phone: string; email: string; amount: string; notes: string }) =>
  call<string>('crew_add_contact', { p_token: t, p: c });
export const updateContact = (t: string, id: string, status: ContactStatus | null, notes: string) =>
  call<null>('crew_update_contact', { p_token: t, p_contact: id, p_status: status, p_notes: notes || null });

// ---------- designs the TD switched on for the crew ----------
export interface CrewDesign {
  id: string; category: string; title: string; status: 'draft' | 'approved' | 'sent'; notes: string | null;
  proof: string | null; proof_opts: Record<string, unknown>; updated_at: string;
  file: { id: string; version: number; file_name: string; mime: string | null; bytes: number | null } | null;
}
export const designs = (t: string) => call<CrewDesign[]>('crew_designs', { p_token: t });
/** Short-lived link to one file: the crew-design-url function re-checks the link, then signs. */
export async function designFileUrl(t: string, fileId: string): Promise<Result<string>> {
  try {
    const r = await supabase.functions.invoke('crew-design-url', { body: { token: t, file: fileId } });
    if (r.error) return { error: r.error };
    const d = r.data as { url?: string; error?: string };
    return d?.url ? { data: d.url } : { error: new Error(d?.error ?? 'not_found') };
  } catch (error) { return { error }; }
}
