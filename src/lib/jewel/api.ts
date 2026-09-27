/** Public reads for /jewel. Anon key + RLS: everything here is public-read by design. */
import { supabase } from '../supabase';
import type { LbRow } from './leaderboard';

export const EVENT_SLUG = 'jewel-xi-2026';

export interface Hole { n: number; par: number; dist_ft: number | null; ob: string | null; quote: string | null; rules: string[] }
export interface PublicSponsor { id: string; name: string; tier: string | null; hole: number | null; logo_url: string | null; sort: number }
export interface JewelData { eventId: string; holes: Hole[]; sponsors: PublicSponsor[]; board: LbRow[] }

const need = <T>(r: { data: T | null; error: unknown }, what: string): T => {
  if (r.error) throw new Error(`Couldn't load ${what}. Check your signal and reload.`);
  return (r.data ?? ([] as unknown)) as T;
};

export async function loadJewel(): Promise<JewelData> {
  const ev = need(await supabase.from('events').select('id').eq('slug', EVENT_SLUG).maybeSingle(), 'the event') as { id: string } | null;
  if (!ev) throw new Error('Event not found.');
  const [holes, sponsors, board] = await Promise.all([
    supabase.from('holes').select('n, par, dist_ft, ob, quote, rules').eq('event_id', ev.id).order('n'),
    // hidden = false explicitly: a signed-in TD viewing the public page must see what the public sees.
    supabase.from('sponsors').select('id, name, tier, hole, logo_url, sort').eq('event_id', ev.id).eq('hidden', false).order('sort'),
    loadBoard(ev.id),
  ]);
  return { eventId: ev.id, holes: need(holes, 'the course') as Hole[], sponsors: need(sponsors, 'sponsors') as PublicSponsor[], board };
}

export async function loadBoard(eventId: string): Promise<LbRow[]> {
  const r = await supabase.from('leaderboard')
    .select('player_id, name, div_code, div_sort, r1_holes, r1_to_par, r1_official, r2_holes, r2_to_par, r2_official, hole_count')
    .eq('event_id', eventId);
  return need(r, 'the leaderboard') as LbRow[];
}
