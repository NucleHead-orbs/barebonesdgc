import { useEffect, useRef, useState } from 'react';
import { fmtTime } from '../../lib/music/queue';
import { currentLine, type Lyrics } from '../../lib/music/lyrics';
import { Karaoke } from './Karaoke';
import type { Player } from './usePlayer';
import './player.css';

const I = {
  play: 'M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  next: 'M5 6.2v11.6a.8.8 0 0 0 1.2.7l8.3-5.8a.8.8 0 0 0 0-1.4L6.2 5.5a.8.8 0 0 0-1.2.7ZM16.5 5H19v14h-2.5z',
  prev: 'M19 6.2v11.6a.8.8 0 0 1-1.2.7l-8.3-5.8a.8.8 0 0 1 0-1.4l8.3-5.8a.8.8 0 0 1 1.2.7ZM5 5h2.5v14H5z',
  shuffle: 'M16 4h4v4M20 4l-6.5 6.5M4 20l6-6M16 20h4v-4M20 20 4 4',
  repeat: 'M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4',
};
const Icon = ({ d, stroke }: { d: string; stroke?: boolean }) => (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"
    {...(stroke ? { fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' } : { fill: 'currentColor' })}>
    <path d={d} />
  </svg>
);

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Bars from the analyser (desktop) or a synthetic dance (phones). Falls to a resting line when paused. */
function Viz({ p }: { p: Player }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef(p.playing);
  const getAn = useRef(p.analyser);
  useEffect(() => { live.current = p.playing; getAn.current = p.analyser; });
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const g = c.getContext('2d'); if (!g) return;
    const N = 40, lv = new Array<number>(N).fill(0.06);
    const buf = new Uint8Array(64);
    let raf = 0;
    const draw = (t: number) => {
      const w = (c.width = c.clientWidth * devicePixelRatio), h = (c.height = c.clientHeight * devicePixelRatio);
      const an = getAn.current();
      if (an && live.current) an.getByteFrequencyData(buf);
      for (let i = 0; i < N; i++) {
        let target = 0.06;
        if (live.current && !reduced()) {
          target = an ? Math.max(0.06, buf[Math.floor((i / N) * 44)] / 255)
            : 0.18 + 0.5 * Math.abs(Math.sin(t / 260 + i * 0.55) * Math.sin(t / 410 + i * 1.3)) + 0.2 * Math.abs(Math.sin(t / 150 + i));
        } else if (live.current) target = 0.3;
        lv[i] += (target - lv[i]) * 0.25;
      }
      g.clearRect(0, 0, w, h);
      const bw = w / N;
      const grad = g.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, '#a6d93b'); grad.addColorStop(0.55, '#f2c230'); grad.addColorStop(1, '#ff3ad1');
      g.fillStyle = grad;
      for (let i = 0; i < N; i++) {
        const bh = Math.max(2 * devicePixelRatio, lv[i] * h);
        g.beginPath(); g.roundRect(i * bw + bw * 0.18, h - bh, bw * 0.64, bh, bw * 0.3); g.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="mp-viz" aria-hidden="true" />;
}

function Controls({ p, big }: { p: Player; big?: boolean }) {
  return (
    <div className={`mp-ctrls${big ? ' is-big' : ''}`}>
      {big && <button type="button" className="mp-ic" aria-pressed={p.q.shuffle} aria-label="Shuffle" title="Shuffle" onClick={p.shuffle}><Icon d={I.shuffle} stroke /></button>}
      <button type="button" className="mp-ic" aria-label="Previous track" onClick={p.prev}><Icon d={I.prev} /></button>
      <button type="button" className="mp-play" aria-label={p.playing ? 'Pause' : 'Play'} onClick={p.toggle}><Icon d={p.playing ? I.pause : I.play} /></button>
      <button type="button" className="mp-ic" aria-label="Next track" onClick={p.next}><Icon d={I.next} /></button>
      {big && (
        <button type="button" className="mp-ic" aria-pressed={p.q.repeat !== 'off'} title={`Repeat: ${p.q.repeat}`}
          aria-label={`Repeat ${p.q.repeat === 'off' ? 'off' : p.q.repeat === 'all' ? 'all' : 'this track'}`} onClick={p.repeat}>
          <Icon d={I.repeat} stroke />{p.q.repeat === 'one' && <span className="mp-one">1</span>}
        </button>
      )}
    </div>
  );
}

/** The hero deck: cover art hot-stamped on a spinning disc, visualizer, scrubber, controls. */
export function Deck({ p, artist, total, lyrics, showLyrics, onLyrics }: {
  p: Player; artist: string; total: number; lyrics: Lyrics | null; showLyrics: boolean; onLyrics: () => void;
}) {
  const cur = p.cur;
  const pct = p.dur ? (p.time / p.dur) * 100 : 0;
  if (!cur) return null;
  return (
    <section className={`mp-deck${p.playing ? ' is-playing' : ''}`} aria-label="Music player">
      <div className="mp-bg" style={{ backgroundImage: `url(${cur.cover})` }} aria-hidden="true" />
      <div className="mp-disc-wrap">
        <div className="mp-disc" aria-hidden="true">
          <img className="mp-stamp" src={cur.cover} alt="" width={600} height={600} />
        </div>
      </div>
      <div className="mp-info">
        <div className="mp-top">
          <div className="mp-kicker">{p.playing ? 'Now playing' : p.started ? 'Paused' : 'Hit play'} · {cur.release}</div>
          {cur.lyrics && <button type="button" className="mp-lyr" aria-pressed={showLyrics} onClick={onLyrics}>Lyrics</button>}
        </div>
        <h2 className="mp-title">{cur.title}</h2>
        <div className="mp-artist">{artist}</div>
        {showLyrics && lyrics ? <Karaoke lyrics={lyrics} audio={p.audioEl} onSeek={p.seek} /> : <Viz p={p} />}
        <div className="mp-seek">
          <span>{fmtTime(p.time)}</span>
          <input type="range" min={0} max={p.dur || 0} step={0.1} value={Math.min(p.time, p.dur || 0)} aria-label="Seek"
            style={{ '--p': `${pct}%` } as React.CSSProperties} onChange={(e) => p.seek(Number(e.target.value))} disabled={!p.dur} />
          <span>{fmtTime(p.dur)}</span>
        </div>
        <Controls p={p} big />
        <div className="mp-count">Track {p.q.pos + 1} of {total}{p.q.shuffle ? ' · shuffled' : ''}{p.q.repeat !== 'off' ? ` · repeat ${p.q.repeat}` : ''}</div>
        {p.error && <div className="mp-err" role="alert">{p.error}</div>}
      </div>
      <audio {...p.audioProps} />
    </section>
  );
}

/** Slim now-playing bar pinned to the bottom once the deck scrolls out of view. */
export function MiniBar({ p, artist, deck, lyrics }: { p: Player; artist: string; deck: React.RefObject<HTMLDivElement | null>; lyrics: Lyrics | null }) {
  const [away, setAway] = useState(false);
  useEffect(() => {
    const el = deck.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => setAway(!e.isIntersecting), { threshold: 0.15 });
    io.observe(el); return () => io.disconnect();
  }, [deck]);
  const show = away && p.started && !!p.cur;
  useEffect(() => { document.body.classList.toggle('has-minibar', show); return () => document.body.classList.remove('has-minibar'); }, [show]);
  if (!show || !p.cur) return null;
  const line = currentLine(lyrics, p.time);
  return (
    <div className="mp-mini" role="region" aria-label="Now playing">
      <div className="mp-mini-bar" style={{ transform: `scaleX(${p.dur ? p.time / p.dur : 0})` }} />
      <button type="button" className="mp-mini-art" aria-label="Back to the player" onClick={() => deck.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
        <img src={p.cur.cover} alt="" width={48} height={48} className={p.playing ? 'is-spin' : ''} />
      </button>
      <div className="mp-mini-txt"><b>{p.cur.title}</b><span className={line ? 'is-lyric' : ''}>{line || artist}</span></div>
      <Controls p={p} />
    </div>
  );
}
