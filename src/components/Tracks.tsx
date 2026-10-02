import { fmtPlays } from '../lib/music/listens';
import './tracks.css';

/** No `length` = no audio yet (shows "coming soon"). `cover` overrides <base>/<slug>.webp. */
export interface Track { slug: string; title: string; note?: string; length?: string; cover?: string }

/**
 * A release's tracklist. Rows are tap-to-play into the page player (`onPick` with the track's slug);
 * the current row shows dancing bars while it plays. Coming-soon rows can't be picked.
 */
export function Tracks({ tracks, artist, base = '/music', current, playing, onPick, plays = {} }: {
  tracks: Track[]; artist: string; base?: string; current?: string; playing?: boolean; onPick: (slug: string) => void; plays?: Record<string, number>;
}) {
  return (
    <ol className="trk">
      {tracks.map((t, i) => {
        const on = t.slug === current;
        return (
          <li key={t.slug} className={`trk-row${t.length ? '' : ' is-soon'}${on ? ' is-current' : ''}`}>
            <button type="button" className="trk-btn" disabled={!t.length} onClick={() => onPick(t.slug)}
              aria-label={t.length ? `${on && playing ? 'Pause' : 'Play'} ${t.title}` : `${t.title}: coming soon`} aria-current={on || undefined}>
              <img className="trk-cover" src={t.cover ?? `${base}/${t.slug}.webp`} alt="" loading="lazy" width={600} height={600} />
              <span className="trk-main">
                <span className="trk-head">
                  <span className="trk-n">{on && playing ? <span className="trk-eq" aria-hidden="true"><i /><i /><i /></span> : String(i + 1).padStart(2, '0')}</span>
                  <span className="trk-title">{t.title}{t.note && <span className="trk-note"> ({t.note})</span>}</span>
                  {t.length ? <span className="trk-len">{t.length}</span> : <span className="trk-soon">Coming soon</span>}
                </span>
                <span className="trk-artist">{artist}{t.length && plays[t.slug] ? <span className="trk-plays"> · {fmtPlays(plays[t.slug])}</span> : null}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
