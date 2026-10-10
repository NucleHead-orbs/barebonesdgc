/** Public reads for /jewel. Anon key + RLS: everything here is public-read by design. */
import { supabase } from '../supabase';
import type { LbRow, TeamRow } from './leaderboard';

export const EVENT_SLUG = 'jewel-xi-2026';

export interface Hole { n: number; par: number; dist_ft: number | null; ob: string | null; quote: string | null; rules: string[] }
export interface PublicSponsor { id: string; name: string; tier: string | null; hole: number | null; logo_url: string | null; sort: number }
export interface JewelData { eventId: string; holes: Hole[]; sponsors: PublicSponsor[]; board: LbRow[] }

const need = <T>(r: { data: T | null; error: unknown }, what: string): T => {
  if (r.error) throw new Error(`Couldn't load ${what}. Check your signal and reload.`);
  return (r.data ?? ([] as unknown)) as T;
};

export interface Division { code: string; sort: number; wave_default: 'AM' | 'PM' }

// Reference data barely changes during a visit: fetch once per page load, shared by every page.
const once = new Map<string, Promise<unknown>>();
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (!once.has(key)) once.set(key, fn().catch((e) => { once.delete(key); throw e; }));
  return once.get(key) as Promise<T>;
}
export const loadEventId = () => cached('event', async () => {
  const ev = need(await supabase.from('events').select('id').eq('slug', EVENT_SLUG).maybeSingle(), 'the event') as { id: string } | null;
  if (!ev) throw new Error('Event not found.');
  return ev.id;
});
export const loadHoles = () => cached('holes', async () =>
  need(await supabase.from('holes').select('n, par, dist_ft, ob, quote, rules').eq('event_id', await loadEventId()).order('n'), 'the course') as Hole[]);
export const loadDivisions = () => cached('divisions', async () =>
  need(await supabase.from('divisions').select('code, sort, wave_default').eq('event_id', await loadEventId()).order('sort'), 'divisions') as Division[]);
/** Approved sponsors only. hidden=false explicitly: a signed-in TD must see what the public sees. */
export const loadPublicSponsors = () => cached('sponsors', async () =>
  need(await supabase.from('sponsors').select('id, name, tier, hole, logo_url, sort').eq('event_id', await loadEventId()).eq('hidden', false).order('sort'), 'sponsors') as PublicSponsor[]);

export async function loadJewel(): Promise<JewelData> {
  const eventId = await loadEventId();
  const [holes, sponsors, board] = await Promise.all([loadHoles(), loadPublicSponsors(), loadBoard(eventId)]);
  return { eventId, holes, sponsors, board };
}

export async function loadBoard(eventId: string): Promise<LbRow[]> {
  const r = await supabase.from('leaderboard')
    .select('player_id, name, div_code, div_sort, r1_holes, r1_to_par, r1_official, r2_holes, r2_to_par, r2_official, hole_count')
    .eq('event_id', eventId);
  return need(r, 'the leaderboard') as LbRow[];
}

/** Doubles rounds: one row per team (team_rounds view, public). */
export async function loadTeamBoard(eventId: string): Promise<TeamRow[]> {
  const r = await supabase.from('team_rounds')
    .select('team_id, round, team_no, player_a, a_name, b_name, holes_played, hole_count, to_par, official, card_label')
    .eq('event_id', eventId);
  return need(r, 'the doubles board') as TeamRow[];
}
