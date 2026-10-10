/**
 * A league's trophy room (/leagues/<slug>/trophy, and the old /leagues/<slug>/vest). The TD picks the room in LEAGUES →
 * SETUP → Trophy room (leagues.trophy_room, migration 20261128):
 *   single = one weekly prize the TD hands out (the Lazy Boner Safety Vest) → the vest page;
 *   podium = the week's top 3 straight from the results (playoff picks count) → this page: the newest podium with
 *            confetti + flash pops, that week's group photo, the MVP board and every week's podium.
 */
import { useCallback, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import Podium from '../../components/Podium';
import { Button, SectionHeading } from '../../components/ui';
import { useLoad } from '../../lib/useLoad';
import { imageSrc, loadTrophyRoom, photoUrl } from '../../lib/leagues/api';
import { entryName, niceDate, podiumIsDubs, stepLabel, type TrophyRoomData } from '../../lib/leagues/leagues';
import { fmtToPar } from '../../lib/rounds/rounds';
import VestPage from './VestPage';
import '../../components/gallery.css';
import './leagues.css';
import './vest.css';

export default function TrophyRoomPage() {
  const { slug = '' } = useParams();
  const load = useCallback(() => loadTrophyRoom(slug), [slug]);
  const { data, error } = useLoad(load);
  if (error) return <Notice title="Couldn't load the trophy room" note="No signal or something broke. Try again in a moment." />;
  if (data === undefined) return <section className="sec"><div className="sec-inner"><p className="lg-muted">Loading…</p></div></section>;
  if (data?.league.trophy_room === 'podium') return <PodiumRoom data={data} />;
  return <VestPage />; // a single prize (or no room: the vest page says so)
}

function PodiumRoom({ data }: { data: TrophyRoomData }) {
  const { league, weeks, mvp } = data;
  const dlg = useRef<HTMLDialogElement>(null);
  const [big, setBig] = useState<{ src: string; alt: string } | null>(null);
  const enlarge = (src: string, alt: string) => { setBig({ src, alt }); dlg.current?.showModal(); };
  const now = weeks[0] ?? null;
  const title = league.award ?? 'The Podium';
  const players = mvp.players.slice(0, 10);

  return (
    <>
      <section className="hero tr-hero">
        <div className="sec-inner tr-top">
          <div className="tr-copy">
            <div className="kick">{league.name} · trophy room</div>
            <h1>{title}</h1>
            {now
              ? <div className="vp-meta">{niceDate(now.starts_on)}{now.course ? ` · ${now.course}` : ''}</div>
              : <p className="lead">Nobody's on the podium yet. It fills itself once the first week's cards are in.</p>}
          </div>
          {now && <Podium podium={now.podium} />}
          <div className="row tr-actions">
            {now && <Button to={`/e/${now.slug}`}>That week's scores</Button>}
            <Button to={`/leagues#${league.slug}`} variant="outline">{league.name} on Leagues</Button>
          </div>
          {league.award_image && <img className="tr-art" src={imageSrc(league.award_image)} alt={title} />}
        </div>
      </section>

      {now?.photo && (
        <section className="sec">
          <div className="sec-inner" style={{ gap: 16 }}>
            <SectionHeading kicker={niceDate(now.starts_on)} title="The crew" size="m" aside={now.course ?? undefined} />
            <button type="button" className="vp-photo" onClick={() => enlarge(photoUrl(now.photo!), `${league.name} group photo, ${niceDate(now.starts_on)}`)}
              aria-label="Enlarge the group photo">
              <img src={photoUrl(now.photo)} alt={`${league.name} group photo, ${niceDate(now.starts_on)}`} />
            </button>
          </div>
        </section>
      )}

      {weeks.length > 0 && (
        <section className="sec">
          <div className="sec-inner vp-cols">
            {players.length > 0 && (
              <div className="vp-board">
                <SectionHeading kicker={`${mvp.weeks} week${mvp.weeks === 1 ? '' : 's'}`} title="MVP · most wins" size="m" />
                <ol className="ds-card vp-list">
                  {players.map((p, i) => (
                    <li key={p.name}>
                      <span className="vp-place">{i + 1}</span>
                      <span className="tr-mvp"><b>{p.name}</b><small>{p.podiums} podium{p.podiums === 1 ? '' : 's'} · {p.weeks} wk{p.best != null ? ` · best ${fmtToPar(p.best)}` : ''}</small></span>
                      <span className="vp-count">{p.wins}<small>{p.wins === 1 ? 'win' : 'wins'}</small></span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <div className="vp-weeks">
              <SectionHeading kicker="Every week" title="Who stood up there" size="m" aside={`${weeks.length} week${weeks.length === 1 ? '' : 's'}`} />
              <div className="vp-timeline">
                {weeks.map((w) => {
                  const dubs = podiumIsDubs(w.podium);
                  return (
                    <article key={w.slug} className="ds-card vp-week">
                      {w.photo && (
                        <button type="button" className="vp-thumb" onClick={() => enlarge(photoUrl(w.photo!), `${league.name} group photo, ${niceDate(w.starts_on)}`)} aria-label={`Enlarge the ${niceDate(w.starts_on)} group photo`}>
                          <img src={photoUrl(w.photo)} alt="" loading="lazy" />
                        </button>
                      )}
                      <div className="vp-week-body">
                        <span className="lg-vest-k">{niceDate(w.starts_on)}{w.course ? ` · ${w.course}` : ''}</span>
                        <ol className="tr-steps">
                          {w.podium.map((s) => (
                            <li key={s.place} className={`tr-s${s.place}`}>
                              <span className="tr-place">{stepLabel(s)}</span>
                              <span>{s.entries.map((e) => entryName(e, dubs)).join(' · ')}</span>
                              <span className="tr-par">{fmtToPar(s.to_par)}</span>
                            </li>
                          ))}
                        </ol>
                        <a href={`/e/${w.slug}`}>Scores ›</a>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      )}

      <dialog ref={dlg} className="gal-dlg" onClose={() => setBig(null)} onClick={(e) => { if (e.target === e.currentTarget) dlg.current?.close(); }}>
        {big && <img src={big.src} alt={big.alt} />}
        <button type="button" className="gal-x" onClick={() => dlg.current?.close()} aria-label="Close">×</button>
      </dialog>
    </>
  );
}

function Notice({ title, note }: { title: string; note: string }) {
  return (
    <section className="hero">
      <div className="sec-inner" style={{ gap: 16 }}>
        <h1>{title}</h1><p className="lead">{note}</p>
        <div className="row"><Button to="/leagues">Leagues</Button></div>
      </div>
    </section>
  );
}
