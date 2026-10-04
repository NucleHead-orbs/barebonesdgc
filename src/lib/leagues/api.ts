import { supabase } from '../supabase';
import { shrink } from '../gallery/api';
import { LEAGUES, type LeagueWeek, type PublicEvent } from './leagues';

/** Every live event (public read). The page picks league scores and the next Pop Up from these. */
export async function loadPublicEvents(): Promise<PublicEvent[]> {
  const { data, error } = await supabase.from('events').select('slug, name, starts_on, ends_on, archived').eq('archived', false);
  if (error) throw error;
  return (data ?? []) as PublicEvent[];
}

/** Group photos: public bucket, <event_id>/<file>; only that event's TDs write. */
export const LEAGUE_PHOTOS = 'league-photos';
export const photoUrl = (path: string) => supabase.storage.from(LEAGUE_PHOTOS).getPublicUrl(path).data.publicUrl;

/** The vest wall for one league tag set, newest first. */
export async function loadWeeks(poolSlug: string): Promise<LeagueWeek[]> {
  const { data, error } = await supabase.rpc('league_weeks', { p_pool_slug: poolSlug });
  if (error) throw error;
  return (data ?? []) as LeagueWeek[];
}

/** Every league's wall, keyed by league id. A league that fails to load just shows no wall. */
export async function loadAllWeeks(): Promise<Record<string, LeagueWeek[]>> {
  const all = await Promise.all(LEAGUES.map((l) => loadWeeks(l.tagPool).catch(() => [] as LeagueWeek[])));
  return Object.fromEntries(LEAGUES.map((l, i) => [l.id, all[i]]));
}

// ---------- TD side (WINNERS tab of a league week) ----------
export interface WeekState { vest_player_id: string | null; vest_note: string | null; group_photo: string | null; pool_slug: string | null }

export async function loadWeekState(eventId: string): Promise<WeekState> {
  const { data, error } = await supabase.from('events').select('vest_player_id, vest_note, group_photo, tag_pool_id').eq('id', eventId).single();
  if (error) throw error;
  let pool_slug: string | null = null;
  if (data.tag_pool_id) {
    const p = await supabase.from('tag_pools').select('slug').eq('id', data.tag_pool_id).maybeSingle();
    pool_slug = (p.data?.slug as string | undefined) ?? null;
  }
  return { vest_player_id: data.vest_player_id, vest_note: data.vest_note, group_photo: data.group_photo, pool_slug };
}

export async function setVest(eventId: string, playerId: string | null, note: string): Promise<void> {
  const { error } = await supabase.rpc('td_set_vest', { p_event: eventId, p_player: playerId, p_note: note });
  if (error) throw error;
}

const PHOTO_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = 8 * 1024 * 1024;

/** Shrink, upload to <event>/group-<time>.<ext>, point the week at it. If that fails, the upload is removed. Returns the path. */
export async function uploadGroupPhoto(eventId: string, file: File): Promise<string> {
  const blob = await shrink(file, 2000);
  const ext = PHOTO_TYPES[blob.type];
  if (!ext) throw new Error('That file type won\'t load here. Use a JPG or PNG photo.');
  if (blob.size > MAX_BYTES) throw new Error('That photo is over 8 MB even after shrinking.');
  const path = `${eventId}/group-${Date.now()}.${ext}`;
  const up = await supabase.storage.from(LEAGUE_PHOTOS).upload(path, blob, { contentType: blob.type, upsert: false });
  if (up.error) throw up.error;
  const { error } = await supabase.rpc('td_set_group_photo', { p_event: eventId, p_path: path });
  if (error) { await supabase.storage.from(LEAGUE_PHOTOS).remove([path]); throw error; }
  return path;
}

/** Take the photo off the week (the file stays in storage). */
export async function clearGroupPhoto(eventId: string): Promise<void> {
  const { error } = await supabase.rpc('td_set_group_photo', { p_event: eventId, p_path: null });
  if (error) throw error;
}
