import { createClient } from '@supabase/supabase-js';
import type { QueuedScore, SyncFn, SyncResult } from './offline/queue';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
if (!url || !anon) throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local.');

export const supabase = createClient(url, anon);

/** Offline-queue adapter for the score_sync RPC. Throws on network failure so the queue keeps everything. */
export const syncScores: SyncFn = async (token, items: QueuedScore[]) => {
  const { data, error } = await supabase.rpc('score_sync', {
    p_token: token,
    p_items: items.map((i) => ({ player_id: i.playerId, hole: i.hole, strokes: i.strokes, client_ts: i.clientTs, device_id: i.deviceId })),
  });
  if (error) throw error;
  return (data as Array<{ player_id: string; hole: number; client_ts: string; result: SyncResult }>).map((r) => ({
    playerId: r.player_id,
    hole: r.hole,
    clientTs: r.client_ts,
    result: r.result,
  }));
};
