import { useCallback, useEffect, useRef, useState } from 'react';
import { advance, currentIndex, initQueue, pick, PREV_RESTART_S, REPEAT_NEXT, toggleShuffle, type QueueState } from '../../lib/music/queue';

export interface PlayerTrack { slug: string; title: string; release: string; src: string; cover: string; lyrics?: string }

/**
 * Real frequency data only on desktop. On phones the audio is NOT routed through Web Audio:
 * iOS suspends an AudioContext when the screen locks, which would silence continuous play.
 * The visualizer falls back to a synthetic dance there.
 */
const canAnalyse = () => typeof window !== 'undefined' && 'AudioContext' in window
  && window.matchMedia('(pointer: fine)').matches && !/iPad|iPhone|iPod/.test(navigator.userAgent);

/** One <audio> for the whole page; the queue runs the EP straight into the singles. */
export function usePlayer(queue: PlayerTrack[], artist: string) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const ctx = useRef<{ ac: AudioContext; an: AnalyserNode } | null>(null);
  const want = useRef(false); // should the current track be playing once it loads
  const [q, setQ] = useState<QueueState>(() => initQueue(queue.length));
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [error, setError] = useState('');
  const index = currentIndex(q);
  const cur = queue[index];

  const wire = () => {
    const a = audio.current;
    if (!a || ctx.current || !canAnalyse()) return;
    try {
      const ac = new AudioContext();
      const an = ac.createAnalyser(); an.fftSize = 128; an.smoothingTimeConstant = 0.78;
      ac.createMediaElementSource(a).connect(an); an.connect(ac.destination);
      ctx.current = { ac, an };
    } catch { /* no analyser: synthetic visualizer */ }
  };

  const start = useCallback(() => {
    const a = audio.current; if (!a) return;
    want.current = true; setStarted(true); setError('');
    wire();
    void ctx.current?.ac.resume();
    a.play().catch(() => { want.current = false; setPlaying(false); });
  }, []);
  const pause = useCallback(() => { want.current = false; audio.current?.pause(); }, []);
  const toggle = useCallback(() => (audio.current && !audio.current.paused ? pause() : start()), [pause, start]);

  // Load the current track; keep playing if we were.
  useEffect(() => {
    const a = audio.current; if (!a || !cur) return;
    if (a.dataset.slug !== cur.slug) { a.src = cur.src; a.dataset.slug = cur.slug; setTime(0); setDur(0); }
    if (want.current) a.play().catch(() => { want.current = false; setPlaying(false); });
  }, [cur]);

  const qRef = useRef(q);
  useEffect(() => { qRef.current = q; }, [q]);
  const go = useCallback((how: 'auto' | 'next' | 'prev') => {
    const a = audio.current, s = qRef.current;
    if (how === 'prev' && a && a.currentTime > PREV_RESTART_S) { a.currentTime = 0; return; }
    const r = advance(s, how);
    // Buttons keep the current play/pause state (unless the set ran out); 'auto' follows the queue.
    want.current = how === 'auto' ? r.play : r.play && !!a && !a.paused;
    if (!want.current) a?.pause();
    if (currentIndex(r.state) === currentIndex(s) && a) { a.currentTime = 0; if (want.current) void a.play(); }
    setQ(r.state);
  }, []);

  const choose = useCallback((i: number) => {
    if (i === currentIndex(qRef.current)) return toggle();
    want.current = true; setStarted(true); wire(); void ctx.current?.ac.resume();
    setQ(pick(qRef.current, i));
  }, [toggle]);

  const seek = useCallback((t: number) => { if (audio.current) { audio.current.currentTime = t; setTime(t); } }, []);
  const shuffle = useCallback(() => setQ((s) => toggleShuffle(s)), []);
  const repeat = useCallback(() => setQ((s) => ({ ...s, repeat: REPEAT_NEXT[s.repeat] })), []);

  // Lock screen / headphone controls.
  useEffect(() => {
    if (!cur || !('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: cur.title, artist, album: cur.release, artwork: [{ src: cur.cover, sizes: '600x600', type: 'image/webp' }] });
    const h: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => start()], ['pause', () => pause()],
      ['previoustrack', () => go('prev')], ['nexttrack', () => go('next')],
      ['seekto', (d) => { if (d.seekTime != null) seek(d.seekTime); }],
    ];
    for (const [k, f] of h) { try { navigator.mediaSession.setActionHandler(k, f); } catch { /* unsupported action */ } }
  }, [cur, artist, start, pause, go, seek]);

  // Stop audio when leaving the page.
  useEffect(() => () => { audio.current?.pause(); void ctx.current?.ac.close(); }, []);

  const audioProps = {
    ref: audio, preload: 'metadata' as const,
    onPlay: () => { setPlaying(true); setError(''); },
    onPause: () => setPlaying(false),
    onTimeUpdate: (e: React.SyntheticEvent<HTMLAudioElement>) => setTime(e.currentTarget.currentTime),
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLAudioElement>) => setDur(e.currentTarget.duration),
    onEnded: () => go('auto'),
    onError: () => { if (audio.current?.getAttribute('src')) { want.current = false; setPlaying(false); setError('That track didn\'t load. Try again or skip ahead.'); } },
  };

  return { audioEl: () => audio.current, cur, index, q, playing, started, time, dur, error, analyser: () => ctx.current?.an ?? null,
    start, pause, toggle, next: () => go('next'), prev: () => go('prev'), choose, seek, shuffle, repeat, audioProps };
}
export type Player = ReturnType<typeof usePlayer>;
