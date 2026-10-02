import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { HEARTBEAT_S, newClock, parseStats, tick, type MusicStats } from '../../lib/music/listens';
import type { Player } from './usePlayer';

const rid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16)));
let memId = '';
/** This browser's anonymous listener id (kept in localStorage; a fresh one per visit if storage is blocked). */
function listenerId(): string {
  try {
    const k = 'bb-listener'; const v = localStorage.getItem(k);
    if (v) return v;
    const id = rid(); localStorage.setItem(k, id); return id;
  } catch { return (memId ||= rid()); }
}

/**
 * Live listeners + play counts for the Music page. Stats are fun-only: every call is fire-and-forget,
 * so a network blip never touches playback.
 */
export function useListens(p: Player): MusicStats {
  const [stats, setStats] = useState<MusicStats>({ live: 0, plays: {} });
  const me = useRef('');
  const clock = useRef(newClock('', rid()));
  const slug = p.cur?.slug ?? '';

  const refresh = () => { void supabase.rpc('music_stats').then(({ data, error }) => { if (!error) setStats(parseStats(data)); }); };

  useEffect(() => {
    me.current = listenerId();
    refresh();
    const t = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, HEARTBEAT_S * 1000);
    return () => clearInterval(t);
  }, []);

  // "I'm listening to <slug>" now and every 30 s while playing; "paused" once when it stops.
  const wasPlaying = useRef(false);
  useEffect(() => {
    if (!me.current) return;
    const beat = (s: string | null) => void supabase.rpc('music_heartbeat', { p_listener: me.current, p_slug: s }).then(({ error }) => { if (!error) refresh(); });
    if (p.playing && slug) {
      wasPlaying.current = true; beat(slug);
      const t = setInterval(() => beat(slug), HEARTBEAT_S * 1000);
      return () => clearInterval(t);
    }
    if (wasPlaying.current) { wasPlaying.current = false; beat(null); }
  }, [p.playing, slug]);

  // Count a play after 30 s of real listening.
  useEffect(() => {
    if (!slug || !me.current) return;
    const r = tick(clock.current, slug, p.time, p.playing, rid);
    clock.current = r.clock;
    if (r.log) {
      setStats((s) => ({ ...s, plays: { ...s.plays, [slug]: (s.plays[slug] ?? 0) + 1 } }));
      void supabase.rpc('music_log_play', { p_play: r.clock.playId, p_listener: me.current, p_slug: slug }).then(() => refresh());
    }
  }, [p.time, p.playing, slug]);

  return stats;
}
