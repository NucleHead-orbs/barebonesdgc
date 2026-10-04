/**
 * Tag rooms: one shared link per tag set; invited people tap their tile and their tag activates (first come, first
 * numbered). Rules live in 20261020000000_tag_rooms.sql; this file is the RPC layer + labels.
 */
import { supabase } from '../supabase';

export interface RoomTile { member_id: string; name: string; nickname: string | null; active: boolean; number: number | null }
export interface Room { pool: { id: string; slug: string; name: string }; open: boolean; opens_at: string | null; now: string; tiles: RoomTile[] }
export interface RoomInvite { member_id: string; name: string; nickname: string | null; activated_at: string | null; number: number | null }
export interface RoomAdmin { on: boolean; token?: string; open?: boolean; opens_at?: string | null; invites?: RoomInvite[] }

type Result<T> = { data: T; error?: undefined } | { data?: undefined; error: unknown };
const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<Result<T>> => {
  try {
    const r = await supabase.rpc(fn, args);
    if (r.error) return { error: r.error };
    return { data: r.data as T };
  } catch (error) { return { error }; }
};

export const roomUrl = (origin: string, token: string) => `${origin.replace(/\/$/, '')}/room/${encodeURIComponent(token)}`;
/** "12:04" / "1:02:09" until the unlock, from milliseconds left (0 or less = ""). */
export function countdown(ms: number): string {
  if (!(ms > 0)) return '';
  const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`;
}

/** Tiles show the nickname big when there is one. */
export const tileTitle = (t: Pick<RoomTile, 'name' | 'nickname'>) => t.nickname?.trim() || t.name;

// ---------- room page (shared link) ----------
export const getRoom = (token: string) => rpc<Room>('room_get', { p_token: token });
export const activate = (token: string, memberId: string) =>
  rpc<{ number: number; token: string; name: string }>('room_activate', { p_token: token, p_member: memberId });

// ---------- admin ----------
export const adminRoom = (poolId: string) => rpc<RoomAdmin>('td_room_get', { p_pool: poolId });
export const startRoom = (poolId: string) => rpc<null>('td_room_start', { p_pool: poolId });
export const setOpen = (poolId: string, open: boolean) => rpc<null>('td_room_set_open', { p_pool: poolId, p_open: open });
export const newLink = (poolId: string) => rpc<string>('td_room_new_link', { p_pool: poolId });
export const invite = (poolId: string, who: { member: string } | { name: string; nickname: string }) =>
  rpc<string>('td_room_invite', 'member' in who
    ? { p_pool: poolId, p_member: who.member, p_name: null, p_nickname: null }
    : { p_pool: poolId, p_member: null, p_name: who.name.trim(), p_nickname: who.nickname.trim() || null });
export const uninvite = (poolId: string, memberId: string) => rpc<null>('td_room_uninvite', { p_pool: poolId, p_member: memberId });
export const setUnlock = (poolId: string, at: string | null) => rpc<null>('td_room_set_unlock', { p_pool: poolId, p_at: at });
export const reset = (poolId: string, memberId: string) => rpc<null>('td_room_reset', { p_pool: poolId, p_member: memberId });

export function roomMessage(err: unknown): string {
  const e = (err && typeof err === 'object' ? err : {}) as { message?: string; code?: string };
  const m = e.message ?? String(err);
  if (/invalid_room/.test(m)) return "This room link doesn't work anymore. Ask an admin for the new one.";
  if (/room_closed/.test(m)) return 'The room is closed right now. Ask an admin to open it.';
  if (/room_not_yet/.test(m)) return "Not yet! The room hasn't unlocked. Hang tight.";
  if (/not_invited/.test(m)) return "That name isn't on the list anymore. Reload.";
  if (/already_active/.test(m)) return 'Someone already tapped that one. Not you? Tell an admin.';
  if (/already_has_tag/.test(m)) return 'They already hold a tag in this set.';
  if (/reset_first/.test(m)) return 'They already tapped in. RESET their tile first.';
  if (/not_active/.test(m)) return "That tile hasn't been tapped yet.";
  if (/name_required/.test(m)) return 'Type a name.';
  if (/no_room/.test(m)) return 'Open a room for this set first.';
  if (/forbidden|permission denied/i.test(m) || e.code === '42501') return "This account doesn't run this tag set.";
  return 'Something went wrong. Try again.';
}
