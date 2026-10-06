import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './api';
import type { LiveReaction } from './live';

/**
 * Polls a live round's reactions. Ones sent before this screen opened are not replayed (only `feed` shows them).
 * `queue` = new ones to play, `shift()` drops the one just played.
 */
export function useLiveReactions(liveId: string | null, on: boolean, everyMs = 6000) {
  const [queue, setQueue] = useState<LiveReaction[]>([]);
  const [feed, setFeed] = useState<LiveReaction[]>([]);
  const [muted, setMuted] = useState(false);
  const after = useRef<number | null>(null);
  useEffect(() => {
    if (!liveId || !on) return;
    let live = true;
    const pull = async () => {
      const first = after.current === null;
      const r = await api.liveReactions(liveId, after.current ?? 0);
      if (!live || !r.data) return;
      setMuted(!!r.data.muted);
      const got = r.data.list;
      if (got.length) {
        after.current = got[got.length - 1].id;
        setFeed((f) => [...got.slice().reverse(), ...f].slice(0, 12));
        if (!first) setQueue((q) => [...q, ...got].slice(-6));
      } else if (first) after.current = r.data.last ?? 0;
    };
    void pull();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void pull(); }, everyMs);
    return () => { live = false; window.clearInterval(t); };
  }, [liveId, on, everyMs]);
  const shift = useCallback(() => setQueue((q) => q.slice(1)), []);
  const push = useCallback((r: LiveReaction) => { setQueue((q) => [...q, r]); setFeed((f) => [r, ...f].slice(0, 12)); after.current = Math.max(after.current ?? 0, r.id); }, []);
  return { queue, shift, feed, muted, setMuted, push };
}
