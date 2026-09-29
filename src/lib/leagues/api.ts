import { supabase } from '../supabase';
import type { PublicEvent } from './leagues';

/** Every live event (public read). The page picks league scores and the next Pop Up from these. */
export async function loadPublicEvents(): Promise<PublicEvent[]> {
  const { data, error } = await supabase.from('events').select('slug, name, starts_on, ends_on, archived').eq('archived', false);
  if (error) throw error;
  return (data ?? []) as PublicEvent[];
}
