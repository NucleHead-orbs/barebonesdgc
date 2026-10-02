import { useEffect, useState } from 'react';
import { inBreak, lineAt, wordProgress, type Lyrics } from '../../lib/music/lyrics';

/**
 * Karaoke panel: the sung line big with a word-by-word sweep, the last line fading out above,
 * the next two ghosted below. Reads the clock straight off the <audio> every frame (timeupdate
 * only fires ~4x a second, too choppy for a word sweep). Tap a line to jump there.
 */
export function Karaoke({ lyrics, audio, onSeek }: { lyrics: Lyrics; audio: () => HTMLAudioElement | null; onSeek: (t: number) => void }) {
  const [now, setNow] = useState(() => audio()?.currentTime ?? 0);
  useEffect(() => {
    let raf = 0;
    const tick = () => { setNow(audio()?.currentTime ?? 0); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [audio]);
  const { lines } = lyrics;
  const i = lineAt(lines, now);
  const brk = inBreak(lines, i, now);
  // In a break: the music notes and what's coming. Otherwise: last line, the sung line, the next two.
  const shown = brk ? (lines[i + 1] ? [{ l: lines[i + 1], n: i + 1 }] : [])
    : lines.slice(Math.max(0, i - 1), i + 3).map((l, k) => ({ l, n: Math.max(0, i - 1) + k }));
  return (
    <div className="kar" aria-live="off">
      {brk && <div className="kar-break" aria-hidden="true"><span>♪</span><span>♪</span><span>♪</span></div>}
      {shown.map(({ l, n }) => {
        const state = n === i ? 'is-now' : n < i ? 'is-past' : 'is-next';
        return (
          <button type="button" key={n} className={`kar-line ${state}`} onClick={() => onSeek(Math.max(0, l.t - 0.3))}>
            {state === 'is-now'
              ? l.w.map((w, k) => <span key={k} className="kar-w" style={{ '--k': wordProgress(w, now) } as React.CSSProperties}>{w.w}</span>)
              : l.text}
          </button>
        );
      })}
    </div>
  );
}

