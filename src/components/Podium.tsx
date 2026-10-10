/**
 * The podium celebration (a league's trophy room, migration 20261128): 2nd · 1st · 3rd steps, the names floating above
 * their step, confetti and camera-flash pops. Data: one week's podium (league_trophy_room → weeks[n].podium).
 * Motion is transform + opacity only, and prefers-reduced-motion turns all of it off (the podium itself stays).
 */
import { useMemo, useState } from 'react';
import { entryName, podiumIsDubs, podiumStage, stepLabel, type PodiumStep } from '../lib/leagues/leagues';
import { fmtToPar } from '../lib/rounds/rounds';
import './podium.css';

const CONFETTI_COLORS = ['var(--accent-gold)', 'var(--accent-a)', 'var(--accent-c)', 'var(--accent-b)', 'var(--bone)', '#ff8a7a'];
// Flash spots around the stage (left %, top %): the photographers.
const FLASHES: Array<[number, number]> = [[6, 18], [92, 12], [18, 62], [84, 58], [48, 4], [70, 30], [28, 26]];

/** Seeded so a re-render doesn't reshuffle the confetti mid-fall. */
function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

export default function Podium({ podium, size = 'l', confetti = 40 }: { podium: PodiumStep[]; size?: 'l' | 's'; confetti?: number }) {
  const [burst, setBurst] = useState(1); // bump to fire the confetti again
  const dubs = podiumIsDubs(podium);
  const pieces = useMemo(() => {
    const r = rng(7919 * burst);
    return Array.from({ length: confetti }, (_, i) => ({
      left: r() * 100, delay: r() * 1.4, dur: 2.4 + r() * 1.8, drift: (r() - .5) * 120, spin: 360 + r() * 720,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length], w: 6 + r() * 6, h: 8 + r() * 10, round: r() > .7,
    }));
  }, [burst, confetti]);

  return (
    <div className={`pd pd-${size}`}>
      <div className="pd-fx" aria-hidden="true">
        <span key={`all${burst}`} className="pd-flashall" />
        {FLASHES.slice(0, size === 'l' ? 7 : 4).map(([x, y], i) => (
          <span key={i} className="pd-flash" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${.4 + i * .9}s`, animationDuration: `${3.4 + (i % 3) * 1.1}s` }} />
        ))}
        <div key={burst} className="pd-confetti">
          {pieces.map((p, i) => (
            <span key={i} style={{
              left: `${p.left}%`, width: p.w, height: p.round ? p.w : p.h, background: p.color, borderRadius: p.round ? '50%' : 2,
              animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`,
              ['--drift' as string]: `${p.drift}px`, ['--spin' as string]: `${p.spin}deg`,
            }} />
          ))}
        </div>
      </div>

      <ol className="pd-stage" aria-label="Podium">
        {podiumStage(podium).map(({ place, step }) => (
          <li key={place} className={`pd-col pd-p${place}`} aria-label={step ? `${stepLabel(step)}: ${step.entries.map((e) => entryName(e, dubs)).join(', ')}, ${fmtToPar(step.to_par)}` : `${place}: nobody`}>
            <div className="pd-names">
              {step ? (
                <>
                  {step.entries.map((e) => <b key={e.join()}>{entryName(e, dubs)}</b>)}
                  <span className="pd-par">{fmtToPar(step.to_par)}</span>
                </>
              ) : <span className="pd-empty">—</span>}
            </div>
            <div className="pd-step"><span className="pd-num">{step ? stepLabel(step) : place}</span></div>
          </li>
        ))}
      </ol>
      {size === 'l' && confetti > 0 && (
        <button type="button" className="pd-again" onClick={() => setBurst((b) => b + 1)}>Pop it again</button>
      )}
    </div>
  );
}
