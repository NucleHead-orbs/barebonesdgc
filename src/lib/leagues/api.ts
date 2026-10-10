import { supabase } from '../supabase';
import { shrink } from '../gallery/api';
import { LEAGUE_COLS, type League, type LeagueMvp, type LeagueWeek, type PublicEvent, type TrophyRoom, type TrophyRoomData, type TrophyWeek, type VestPageData } from './leagues';

/** Every live event (public read). The page picks league scores and the next Pop Up from these. */
export async function loadPublicEvents(): Promise<PublicEvent[]> {
  const { data, error } = await supabase.from('events').select('slug, name, starts_on, ends_on, archived, league_id').eq('archived', false);
  if (error) throw error;
  return (data ?? []) as PublicEvent[];
}

/** Leagues on the public site (not hidden), in their order. */
export async function loadPublicLeagues(): Promise<League[]> {
  const { data, error } = await supabase.from('leagues').select(LEAGUE_COLS).eq('hidden', false).order('sort').order('name');
  if (error) throw error;
  return (data ?? []) as League[];
}

/** Group photos + league banners/logos: public bucket. <event_id>/... = a week's photo, <league_id>/... = league art. */
export const LEAGUE_PHOTOS = 'league-photos';
export const photoUrl = (path: string) => supabase.storage.from(LEAGUE_PHOTOS).getPublicUrl(path).data.publicUrl;
/** A league image: built-in '/assets/...' as is, otherwise an upload in league-photos. */
export const imageSrc = (path: string) => (path.startsWith('/') ? path : photoUrl(path));

/** The vest wall for one league, newest first. */
export async function loadWeeks(leagueSlug: string): Promise<LeagueWeek[]> {
  const { data, error } = await supabase.rpc('league_weeks', { p_pool_slug: leagueSlug });
  if (error) throw error;
  return (data ?? []) as LeagueWeek[];
}

/** The walls of these leagues, keyed by league id. A league that fails to load just shows no wall. */
export async function loadAllWeeks(leagues: League[]): Promise<Record<string, LeagueWeek[]>> {
  const all = await Promise.all(leagues.map((l) => loadWeeks(l.slug).catch(() => [] as LeagueWeek[])));
  return Object.fromEntries(leagues.map((l, i) => [l.id, all[i]]));
}

/** The vest page for one league (null = no such league, or hidden). */
export async function loadVestPage(slug: string): Promise<VestPageData | null> {
  const { data, error } = await supabase.rpc('league_vest_page', { p_slug: slug });
  if (error) throw error;
  return (data ?? null) as VestPageData | null;
}

/** A league's trophy room: its type, every week's podium, the MVP board. null = no such league (or hidden). */
export async function loadTrophyRoom(slug: string): Promise<TrophyRoomData | null> {
  const { data, error } = await supabase.rpc('league_trophy_room', { p_slug: slug });
  if (error) throw error;
  return (data ?? null) as TrophyRoomData | null;
}

/** A doubles league's MVP board (most wins). */
export async function loadMvp(slug: string): Promise<LeagueMvp> {
  const { data, error } = await supabase.rpc('league_mvp', { p_slug: slug });
  if (error) throw error;
  return (data ?? { weeks: 0, players: [] }) as LeagueMvp;
}

/** The public page in one load: leagues + their walls + MVP boards (a board that fails to load is just left off). */
export async function loadLeaguesPage(): Promise<{ leagues: League[]; weeks: Record<string, LeagueWeek[]>; mvp: Record<string, LeagueMvp>; podium: Record<string, TrophyWeek> }> {
  const leagues = await loadPublicLeagues();
  const podiums = leagues.filter((l) => l.trophy_room === 'podium');
  const [weeks, boards, rooms] = await Promise.all([
    loadAllWeeks(leagues.filter((l) => l.trophy_room === 'single' && l.award)),
    Promise.all(leagues.map((l) => loadMvp(l.slug).catch(() => null))),
    Promise.all(podiums.map((l) => loadTrophyRoom(l.slug).catch(() => null))),
  ]);
  return {
    leagues, weeks,
    mvp: Object.fromEntries(leagues.flatMap((l, i) => (boards[i]?.players.length ? [[l.id, boards[i]!]] : []))),
    podium: Object.fromEntries(podiums.flatMap((l, i) => (rooms[i]?.weeks[0] ? [[l.id, rooms[i]!.weeks[0]]] : []))),
  };
}

// ---------- TD side: leagues ----------
export type MyLeague = League & { pool_slug: string };

export async function myLeagues(): Promise<MyLeague[]> {
  const { data, error } = await supabase.rpc('td_my_leagues');
  if (error) throw error;
  return (data ?? []) as MyLeague[];
}

/** Super admin: a new league + its own tag set. Returns the league id. */
export async function createLeague(name: string, slug: string, tags = true): Promise<string> {
  const { data, error } = await supabase.rpc('td_create_league', { p_name: name, p_slug: slug, p_tags: tags });
  if (error) throw error;
  return data as string;
}

export type LeaguePatch = Partial<Pick<League, 'name' | 'subtitle' | 'title' | 'scrawl' | 'run_by' | 'started_by' | 'when_text' | 'where_text'
  | 'where_note' | 'buy_in' | 'award' | 'banner' | 'logo' | 'award_image' | 'hidden' | 'sort' | 'tags' | 'week_format' | 'week_layout_id' | 'trophy_room'>>;
export async function saveLeague(id: string, patch: LeaguePatch): Promise<void> {
  const { error } = await supabase.rpc('td_save_league', { p_league: id, p: patch });
  if (error) throw error;
}

/** Next week: copies the newest week (or a blank week with these holes/divisions when it's the first). Returns the event id. */
export async function newWeek(leagueId: string, date: string, opts: { name?: string; copyPlayers?: boolean; holes?: number; divisions?: Array<{ code: string; wave?: string }> } = {}): Promise<string> {
  const { data, error } = await supabase.rpc('td_league_new_week', {
    p_league: leagueId, p_date: date, p_name: opts.name?.trim() || null, p_copy_players: opts.copyPlayers ?? true,
    p_hole_count: opts.holes ?? 18, p_divisions: (opts.divisions ?? []).map((d) => ({ code: d.code, wave: d.wave ?? 'AM' })),
  });
  if (error) throw error;
  return (data as { id: string }).id;
}

/** Attach an event to a league (null = plain event again). */
export async function setEventLeague(eventId: string, leagueId: string | null): Promise<void> {
  const { error } = await supabase.rpc('td_set_event_league', { p_event: eventId, p_league: leagueId });
  if (error) throw error;
}

const PHOTO_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = 8 * 1024 * 1024;

async function uploadTo(folder: string, name: string, file: File, maxEdge: number): Promise<string> {
  const blob = await shrink(file, maxEdge);
  const ext = PHOTO_TYPES[blob.type];
  if (!ext) throw new Error('That file type won\'t load here. Use a JPG, PNG or WebP image.');
  if (blob.size > MAX_BYTES) throw new Error('That image is over 8 MB even after shrinking.');
  const path = `${folder}/${name}-${Date.now()}.${ext}`;
  const up = await supabase.storage.from(LEAGUE_PHOTOS).upload(path, blob, { contentType: blob.type, upsert: false });
  if (up.error) throw up.error;
  return path;
}

/** Upload a league banner or logo and point the league at it. If saving fails, the upload is removed. */
export async function uploadLeagueImage(leagueId: string, which: 'banner' | 'logo' | 'award_image', file: File): Promise<string> {
  const path = await uploadTo(leagueId, which === 'award_image' ? 'award' : which, file, which === 'banner' ? 2000 : 1000);
  try { await saveLeague(leagueId, { [which]: path }); } catch (e) { await supabase.storage.from(LEAGUE_PHOTOS).remove([path]); throw e; }
  return path;
}

// ---------- TD side: a week (WINNERS → LEAGUE WEEK) ----------
export interface WeekTeam { id: string; player_a: string; player_b: string | null }
export interface WeekState { holders: string[]; vest_note: string | null; group_photo: string | null; award: string | null; league_slug: string | null; trophy_room: TrophyRoom | null; teams: WeekTeam[] }

export async function loadWeekState(eventId: string): Promise<WeekState> {
  const [ev, held, teams] = await Promise.all([
    supabase.from('events').select('vest_note, group_photo, league_id').eq('id', eventId).single(),
    supabase.from('league_vest').select('player_id').eq('event_id', eventId),
    supabase.from('teams').select('id, player_a, player_b').eq('event_id', eventId).eq('round', 1).order('team_no'),
  ]);
  if (ev.error) throw ev.error;
  if (held.error) throw held.error;
  let award: string | null = null; let league_slug: string | null = null; let trophy_room: TrophyRoom | null = null;
  if (ev.data.league_id) {
    const l = await supabase.from('leagues').select('award, slug, trophy_room').eq('id', ev.data.league_id).maybeSingle();
    award = (l.data?.award as string | null | undefined) ?? null; league_slug = (l.data?.slug as string | undefined) ?? null;
    trophy_room = (l.data?.trophy_room as TrophyRoom | null | undefined) ?? null;
  }
  return {
    holders: (held.data ?? []).map((r) => r.player_id as string), vest_note: ev.data.vest_note, group_photo: ev.data.group_photo, award, league_slug, trophy_room,
    teams: (teams.data ?? []) as WeekTeam[],
  };
}

/** Award the week's vest: 0–2 players (a dubs week: the winning team). Empty = taken back. */
export async function setVest(eventId: string, playerIds: string[], note: string): Promise<void> {
  const { error } = await supabase.rpc('td_set_vest_holders', { p_event: eventId, p_players: playerIds, p_note: note });
  if (error) throw error;
}

/** Shrink, upload to <event>/group-<time>.<ext>, point the week at it. If that fails, the upload is removed. Returns the path. */
export async function uploadGroupPhoto(eventId: string, file: File): Promise<string> {
  const path = await uploadTo(eventId, 'group', file, 2000);
  const { error } = await supabase.rpc('td_set_group_photo', { p_event: eventId, p_path: path });
  if (error) { await supabase.storage.from(LEAGUE_PHOTOS).remove([path]); throw error; }
  return path;
}

/** Take the photo off the week (the file stays in storage). */
export async function clearGroupPhoto(eventId: string): Promise<void> {
  const { error } = await supabase.rpc('td_set_group_photo', { p_event: eventId, p_path: null });
  if (error) throw error;
}
