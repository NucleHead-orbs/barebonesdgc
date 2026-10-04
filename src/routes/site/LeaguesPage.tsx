/** Leagues & Pop Ups (/leagues). Leagues: the leagues table (edited by league TDs). Live bits (scores, next Pop Up, vest wall): events. Design: canvas Leagues.dc.html + Leagues-Mobile.dc.html. */
import { useRef, useState } from 'react';
import { CLUB } from '../../lib/jewel/content';
import { Banner, Button, SectionHeading } from '../../components/ui';
import { useLoad } from '../../lib/useLoad';
import { imageSrc, loadLeaguesPage, loadPublicEvents, photoUrl } from '../../lib/leagues/api';
import { POPUPS_PAST, POPUP_FORMAT, currentHolder, leagueEvent, localDate, nextPopUp, niceDate, type League, type LeagueWeek, type PublicEvent } from '../../lib/leagues/leagues';
import '../../components/gallery.css';
import './leagues.css';

export default function LeaguesPage() {
  const { data: events } = useLoad(loadPublicEvents); // a failed load just means no live buttons, never a broken page
  const { data: page } = useLoad(loadLeaguesPage); // a failed load = no league cards, never a broken page
  const leagues = page?.leagues ?? [];
  const weeks = page?.weeks;
  const today = localDate();
  const next = events ? nextPopUp(events, today) : null;
  const group = CLUB.facebookUrl;

  return (
    <>
      <section className="hero">
        <div className="sec-inner" style={{ gap: 18 }}>
          <div className="kick">Leagues &amp; Pop Ups · Mesa, AZ</div>
          <h1>Leagues &amp;<span className="hl">Pop Ups</span></h1>
          <p className="lead lg-lead">Two leagues on the regular, and Pop Ups whenever the Boners get restless. Same crew, same trash talk, more rounds.</p>
          <nav className="chips" aria-label="On this page">
            {leagues.map((l) => <a key={l.id} className="ds-chip lg-chip" href={`#${l.slug}`}>{l.name}</a>)}
            <a className="ds-chip lg-chip" aria-pressed="true" href="#popups">Pop Ups · coming back</a>
          </nav>
        </div>
      </section>

      <section className="sec">
        <div className="sec-inner" style={{ gap: 24 }}>
          <SectionHeading kicker="Weekly damage" title="The Leagues" size="l" aside={page ? `${leagues.length} league${leagues.length === 1 ? '' : 's'}` : undefined} />
          <div className="lg-grid">
            {leagues.map((l) => <LeagueCard key={l.id} league={l} event={events ? leagueEvent(l.id, events, today) : null} group={group} weeks={weeks?.[l.id] ?? []} />)}
          </div>
          <span className="lg-scrawl lg-gold">I'll put you down for a 4 there...</span>
          <Banner>Scores run on our own scorecard: scan the QR on your card, score every hole, everybody signs, submit. Only signed &amp; submitted rounds count.</Banner>
        </div>
      </section>

      {weeks && leagues.some((l) => l.award && weeks[l.id]?.length) && <VestWall leagues={leagues} weeks={weeks} />}

      <section id="popups" className="lg-pop">
        <div className="sec-inner" style={{ gap: 28 }}>
          <div className="lg-pop-top">
            <div className="lg-pop-copy">
              <div className="ds-kicker lg-pop-kick">Pop Ups · the comeback tour · Have fun. Help out.</div>
              <h2 className="ds-display lg-pop-title">Bring Back<br />the Pop Ups</h2>
              <span className="lg-scrawl lg-pop-green">It's been way too long, Boners.</span>
              <p>A Pop Up is a one-day throw at a park near you. Show up, get paired, eat, then battle for tags. No season, no commitment, all Boner.</p>
              {group && (
                <div className="row">
                  <Button href={group} external variant="accent" size="lg">I want one · tell the group ↗</Button>
                  <a className="ds-btn ds-btn-lg ds-btn-outline lg-pop-outline" href={group} target="_blank" rel="noreferrer">Help run one ↗</a>
                </div>
              )}
            </div>
            <NextPopUp next={next} group={group} />
          </div>
          <PopUpsPast />
        </div>
      </section>

      <section className="sec">
        <div className="sec-inner lg-td">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="ds-kicker">For TDs</div>
            <h2 className="ds-display ds-display-m" style={{ margin: 0 }}>Every league night and Pop Up runs on the same scorecard as the Jewel.</h2>
            <p className="lg-muted">League TDs add next week from LEAGUES, check in walk-ups, print the QR cards. Standings go live on the event's leaderboard.</p>
          </div>
          <Button to="/td" variant="outline-accent" size="lg">TD login</Button>
        </div>
      </section>
    </>
  );
}

function LeagueCard({ league: l, event, group, weeks }: { league: League; event: PublicEvent | null; group: string | undefined; weeks: LeagueWeek[] }) {
  const holder = l.award ? currentHolder(weeks) : null;
  return (
    <article id={l.slug} className="ds-card lg-card">
      {l.banner && <img className="lg-banner" src={imageSrc(l.banner)} alt="" loading="lazy" />}
      {!l.banner && l.logo && <div className="lg-logos"><img src={imageSrc(l.logo)} alt={`${l.name} logo`} loading="lazy" /></div>}
      <div className="ds-card-head"><span className="ds-card-title">{l.name}</span>{l.subtitle && <span className="ds-card-aside">{l.subtitle}</span>}</div>
      <div className="ds-card-body lg-card-body">
        <h3 className="ds-display ds-display-m" style={{ margin: 0 }}>{l.title ?? l.name}</h3>
        {l.scrawl && <span className="lg-scrawl">{l.scrawl}</span>}
        <div className="ds-tour">
          {l.run_by && <Row k="Runs it" v={l.run_by} />}
          {l.started_by && <Row k="Started by" v={l.started_by} />}
          {l.when_text && <Row k="When" v={l.when_text} />}
          {l.where_text && <Row k="Where" v={l.where_text} note={l.where_note ?? undefined} />}
          {l.buy_in && <Row k="Cost" v={l.buy_in} />}
        </div>
        {holder && (
          <a className="lg-vest" href="#vest-wall">
            <span className="lg-vest-k">{l.award} · {niceDate(holder.starts_on)}</span>
            <b>{holder.vest}</b>
            {holder.vest_note && <span className="lg-vest-note">{holder.vest_note}</span>}
          </a>
        )}
        <div className="row lg-card-actions">
          {event && <Button to={`/e/${event.slug}`}>This week's scores</Button>}
          <Button to={`/tags/${l.slug}`} variant="outline-accent">Tag board</Button>
          {group && <Button href={group} external variant="outline">Ask in the group ↗</Button>}
        </div>
      </div>
    </article>
  );
}

function Row({ k, v, note }: { k: string; v: string; note?: string }) {
  return (
    <div className="ds-tour-row">
      <span className="ds-tour-date">{k}</span>
      <span><span className="ds-tour-title">{v}</span>{note && <span className="ds-tour-note">{note}</span>}</span>
    </div>
  );
}

function NextPopUp({ next, group }: { next: PublicEvent | null; group: string | undefined }) {
  return (
    <div className="ds-card lg-next">
      <div className="ds-card-head lg-next-head">
        <span className="ds-card-title">Next Pop Up</span>
        <span className="ds-card-aside">{next ? niceDate(next.starts_on) : 'TBD'}</span>
      </div>
      <div className="ds-card-body lg-next-body">
        {next ? (
          <div className="lg-next-on">
            <b>{next.name}</b>
            <span>{niceDate(next.starts_on)}{next.ends_on && next.ends_on !== next.starts_on ? ` – ${niceDate(next.ends_on)}` : ''}</span>
            <div><Button to={`/e/${next.slug}`} size="sm">Event page</Button></div>
          </div>
        ) : (
          <div className="lg-next-off">
            Nothing on the calendar yet. {group ? <a href={group} target="_blank" rel="noreferrer">Watch the Facebook group ↗</a> : 'Watch the Facebook group.'}
          </div>
        )}
        <div className="ds-kicker lg-pop-kick">How they go</div>
        <div className="ds-tour lg-pop-tour">
          {POPUP_FORMAT.map((s) => <Row key={s.date} k={s.date} v={s.title} />)}
        </div>
      </div>
    </div>
  );
}

function PopUpsPast() {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState<(typeof POPUPS_PAST)[number] | null>(null);
  const close = () => ref.current?.close();
  return (
    <>
      <SectionHeading kicker={<span className="lg-pop-kick">The Archive</span>} title={<span className="lg-ink">Pop Ups past</span>} size="m" as="h3"
        aside={<span className="lg-pop-green">2016–2018 · tap to enlarge</span>} />
      <div className="lg-past">
        {POPUPS_PAST.map((p) => (
          <figure key={p.src}>
            <button type="button" className="lg-flier" onClick={() => { setOpen(p); ref.current?.showModal(); }} aria-label={`View: ${p.alt}`}>
              <img src={p.src} alt="" loading="lazy" width={612} height={792} />
            </button>
            <figcaption><b>{p.date}</b><span>{p.title}</span></figcaption>
          </figure>
        ))}
      </div>
      <dialog ref={ref} className="gal-dlg" onClose={() => setOpen(null)} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
        {open && <img src={open.src} alt={open.alt} />}
        <button type="button" className="gal-x" onClick={close} aria-label="Close">×</button>
      </dialog>
    </>
  );
}

/** Every league week with a vest or a group photo, newest first (league_weeks). Photos enlarge on tap. */
function VestWall({ leagues: all, weeks }: { leagues: League[]; weeks: Record<string, LeagueWeek[]> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState<{ src: string; alt: string } | null>(null);
  const close = () => ref.current?.close();
  const leagues = all.filter((l) => l.award && weeks[l.id]?.length);
  return (
    <section id="vest-wall" className="sec lg-wall">
      <div className="sec-inner" style={{ gap: 24 }}>
        {leagues.map((l) => (
          <div key={l.id} className="lg-wall-league">
            <SectionHeading kicker={`${l.name} · every week`} title={`The ${l.award} Wall`} size="m" as="h2" aside={`${weeks[l.id].length} weeks`} />
            <div className="lg-wall-grid">
              {weeks[l.id].map((w) => {
                const alt = `${l.name} group photo, ${niceDate(w.starts_on)}`;
                return (
                  <figure key={w.slug} className="ds-card lg-week">
                    {w.photo
                      ? <button type="button" className="lg-week-pic" onClick={() => { setOpen({ src: photoUrl(w.photo!), alt }); ref.current?.showModal(); }} aria-label={`View: ${alt}`}>
                          <img src={photoUrl(w.photo)} alt="" loading="lazy" />
                        </button>
                      : <div className="lg-week-pic lg-week-nopic">No group photo this week</div>}
                    <figcaption>
                      <span className="lg-vest-k">{niceDate(w.starts_on)}</span>
                      {w.vest ? <b>{w.vest}</b> : <span className="lg-muted">Vest not awarded</span>}
                      {w.vest_note && <span className="lg-vest-note">{w.vest_note}</span>}
                      <a href={`/e/${w.slug}`}>Scores ›</a>
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <dialog ref={ref} className="gal-dlg" onClose={() => setOpen(null)} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
        {open && <img src={open.src} alt={open.alt} />}
        <button type="button" className="gal-x" onClick={close} aria-label="Close">×</button>
      </dialog>
    </section>
  );
}
