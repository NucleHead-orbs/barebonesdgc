import type { SyntheticEvent } from 'react';
import './tracks.css';

export interface Track { slug: string; title: string; note?: string; length: string }

/** One song plays at a time: starting a track pauses every other player on the page. */
const soloPlay = (e: SyntheticEvent<HTMLAudioElement>) => {
  document.querySelectorAll('audio').forEach((a) => { if (a !== e.currentTarget) a.pause(); });
};

export function Tracks({ tracks, artist, base = '/music' }: { tracks: Track[]; artist: string; base?: string }) {
  return (
    <ol className="trk">
      {tracks.map((t, i) => (
        <li key={t.slug} className="trk-row">
          <img className="trk-cover" src={`${base}/${t.slug}.webp`} alt={`${t.title} cover art`} loading="lazy" width={600} height={600} />
          <div className="trk-main">
            <div className="trk-head">
              <span className="trk-n">{String(i + 1).padStart(2, '0')}</span>
              <span className="trk-title">{t.title}{t.note && <span className="trk-note"> ({t.note})</span>}</span>
              <span className="trk-len">{t.length}</span>
            </div>
            <div className="trk-artist">{artist}</div>
            <audio className="trk-audio" controls preload="none" src={`${base}/${t.slug}.mp3`} onPlay={soloPlay}>
              <a href={`${base}/${t.slug}.mp3`}>Download {t.title}</a>
            </audio>
          </div>
        </li>
      ))}
    </ol>
  );
}
