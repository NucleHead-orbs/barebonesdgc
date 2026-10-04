/**
 * A league's weekly award page (/leagues/<slug>/vest), e.g. the Lazy Boner Safety Vest. Data: league_vest_page (migration
 * 20261025): this week's holders (both partners on a dubs week), the group photo, the most-vests board, every week.
 * The award art is the league's award_image (LEAGUES → SETUP); without one, a drawn vest stands in.
 */
import { useCallback, useId, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, SectionHeading } from '../../components/ui';
import { useLoad } from '../../lib/useLoad';
import { imageSrc, loadVestPage, photoUrl } from '../../lib/leagues/api';
import { boardPlaces, currentVest, holderNames, niceDate } from '../../lib/leagues/leagues';
import '../../components/gallery.css';
import './leagues.css';
import './vest.css';

export default function VestPage() {
  const { slug = '' } = useParams();
  const load = useCallback(() => loadVestPage(slug), [slug]);
  const { data, error } = useLoad(load);
  const dlg = useRef<HTMLDialogElement>(null);
  const [big, setBig] = useState<{ src: string; alt: string } | null>(null);
  const enlarge = (src: string, alt: string) => { setBig({ src, alt }); dlg.current?.showModal(); };

  if (error) return <Notice title="Couldn't load the vest" note="No signal or something broke. Try again in a moment." />;
  if (data === undefined) return <section className="sec"><div className="sec-inner"><p className="lg-muted">Loading…</p></div></section>;
  if (data === null || !data.league.award) return <Notice title="No award here" note="This league doesn't hand out a weekly award (yet)." />;

  const { league, weeks, board } = data;
  const award = league.award ?? 'Weekly award';
  const now = currentVest(weeks);
  const photoWeek = weeks.find((w) => w.photo) ?? null;
  const places = boardPlaces(board);

  return (
    <>
      <section className="hero vp-hero">
        <div className="sec-inner vp-top">
          <div className="vp-art">
            {league.award_image ? <img src={imageSrc(league.award_image)} alt={award} /> : <VestArt />}
          </div>
          <div className="vp-copy">
            <div className="kick">{league.name} · the weekly award</div>
            <h1>{award}</h1>
            {now ? (
              <>
                <div className="vp-k">Wearing it {now === weeks[0] ? 'this week' : 'right now'}</div>
                <div className="vp-names">{now.holders.map((n) => <b key={n}>{n}</b>)}</div>
                <div className="vp-meta">{niceDate(now.starts_on)}{now.course ? ` · ${now.course}` : ''}{now.holders.length > 1 ? ' · dubs' : ''}</div>
                {now.note && <span className="lg-scrawl vp-note">{now.note}</span>}
              </>
            ) : <p className="lead">Nobody's worn it yet. The first one goes out after the next round.</p>}
            <div className="row">
              {now && <Button to={`/e/${now.slug}`}>That week's scores</Button>}
              <Button to={`/leagues#${league.slug}`} variant="outline">{league.name} on Leagues</Button>
            </div>
          </div>
        </div>
      </section>

      {photoWeek?.photo && (
        <section className="sec">
          <div className="sec-inner" style={{ gap: 16 }}>
            <SectionHeading kicker={niceDate(photoWeek.starts_on)} title="The crew" size="m" aside={photoWeek.course ?? undefined} />
            <button type="button" className="vp-photo" onClick={() => enlarge(photoUrl(photoWeek.photo!), `${league.name} group photo, ${niceDate(photoWeek.starts_on)}`)}
              aria-label="Enlarge the group photo">
              <img src={photoUrl(photoWeek.photo)} alt={`${league.name} group photo, ${niceDate(photoWeek.starts_on)}`} />
            </button>
          </div>
        </section>
      )}

      {weeks.some((w) => w.holders.length) && (
        <section className="sec">
          <div className="sec-inner vp-cols">
            <div className="vp-board">
              <SectionHeading kicker="Hall of shame" title="Most vests" size="m" />
              <ol className="ds-card vp-list">
                {board.map((r, i) => (
                  <li key={r.name}>
                    <span className="vp-place">{places[i]}</span>
                    <b>{r.name}</b>
                    <span className="vp-count">{r.weeks}<small>{r.weeks === 1 ? 'week' : 'weeks'}</small></span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="vp-weeks">
              <SectionHeading kicker="Every week" title="Who wore it" size="m" aside={`${weeks.length} week${weeks.length === 1 ? '' : 's'}`} />
              <div className="vp-timeline">
                {weeks.map((w) => (
                  <article key={w.slug} className="ds-card vp-week">
                    {w.photo
                      ? <button type="button" className="vp-thumb" onClick={() => enlarge(photoUrl(w.photo!), `${league.name} group photo, ${niceDate(w.starts_on)}`)} aria-label={`Enlarge the ${niceDate(w.starts_on)} group photo`}>
                          <img src={photoUrl(w.photo)} alt="" loading="lazy" />
                        </button>
                      : <div className="vp-thumb vp-nothumb" aria-hidden="true"><VestArt small /></div>}
                    <div className="vp-week-body">
                      <span className="lg-vest-k">{niceDate(w.starts_on)}{w.course ? ` · ${w.course}` : ''}</span>
                      {w.holders.length ? <b>{holderNames(w.holders)}</b> : <span className="lg-muted">Not awarded</span>}
                      {w.note && <span className="lg-vest-note">{w.note}</span>}
                      <a href={`/e/${w.slug}`}>Scores ›</a>
                    </div>
                  </article>
                ))}
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

/** Stand-in vest until the league uploads its own art: hi-vis orange, reflective stripes that catch the light. */
const VEST = 'M56 10 L82 10 L97 108 L97 208 L28 208 L28 96 Q62 78 56 10Z M144 10 L118 10 L103 108 L103 208 L172 208 L172 96 Q138 78 144 10Z';
function VestArt({ small }: { small?: boolean }) {
  const id = useId().replace(/:/g, '');
  const [v, st, c] = [`${id}v`, `${id}s`, `${id}c`];
  return (
    <svg className={`vp-vest${small ? ' sm' : ''}`} viewBox="0 0 200 220" role="img" aria-label="Safety vest">
      <defs>
        <linearGradient id={v} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff9a2e" /><stop offset="1" stopColor="#f2610c" /></linearGradient>
        <linearGradient id={st} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#cfd6dc" /><stop offset=".5" stopColor="#ffffff" /><stop offset="1" stopColor="#aeb7bf" /></linearGradient>
        <clipPath id={c}><path d={VEST} /></clipPath>
      </defs>
      <path d={VEST} fill={`url(#${v})`} />
      <g clipPath={`url(#${c})`}>
        <rect x="0" y="146" width="200" height="15" fill={`url(#${st})`} />
        <rect x="0" y="176" width="200" height="15" fill={`url(#${st})`} />
        <rect x="62" y="0" width="13" height="150" fill={`url(#${st})`} transform="rotate(-8 68 75)" />
        <rect x="125" y="0" width="13" height="150" fill={`url(#${st})`} transform="rotate(8 132 75)" />
        <rect className="vp-glint" x="-60" y="0" width="40" height="220" fill="#fff" opacity=".55" />
      </g>
      <path d={VEST} fill="none" stroke="#120a12" strokeWidth="7" strokeLinejoin="round" />
    </svg>
  );
}
