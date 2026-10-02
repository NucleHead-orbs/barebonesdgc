import { useEffect, useState } from 'react';
import { parseLyrics, type Lyrics } from '../../lib/music/lyrics';

const cache = new Map<string, Lyrics | null>();

/** Timed lyrics for the current track (null while loading, when the track has none, or on a bad file). */
export function useLyrics(url: string | undefined): Lyrics | null {
  const [state, setState] = useState<{ url?: string; data: Lyrics | null }>({ data: null });
  useEffect(() => {
    if (!url || cache.has(url)) return;
    let live = true;
    fetch(url).then((r) => (r.ok ? r.json() : null)).then(parseLyrics, () => null)
      .then((d) => { cache.set(url, d); if (live) setState({ url, data: d }); });
    return () => { live = false; };
  }, [url]);
  if (!url) return null;
  return cache.get(url) ?? (state.url === url ? state.data : null);
}
