/** Leagues & Pop Ups (/leagues). Facts: src/lib/leagues/leagues.ts. Live bits (scores, next Pop Up): the events table. Design: canvas Leagues.dc.html + Leagues-Mobile.dc.html. */
import { useRef, useState } from 'react';
import { CLUB } from '../../lib/jewel/content';
import { Banner, Button, SectionHeading } from '../../components/ui';
import { useLoad } from '../../lib/useLoad';
import { loadPublicEvents } from '../../lib/leagues/api';
import { LEAGUES, POPUPS_PAST, POPUP_FORMAT, leagueEvent, localDate, nextPopUp, niceDate, type League, type PublicEvent } from '../../lib/leagues/leagues';
import '../../components/gallery.css';
import './leagues.css';

export default function LeaguesPage() {
  const { data: events } = useLoad(loadPublicEvents); // a failed load just means no live buttons, never a broken page
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
            {LEAGUES.map((l) => <a key={l.id} className="ds-chip lg-chip" href={`#${l.id}`}>{l.name}</a>)}
            <a className="ds-chip lg-chip" aria-pressed="true" href="#popups">Pop Ups · coming back</a>
          </nav>
        </div>
      </section>

      <section className="sec">
        <div className="sec-inner" style={{ gap: 24 }}>
          <SectionHeading kicker="Weekly damage" title="The Leagues" size="l" aside={`${LEAGUES.length} leagues`} />
          <div className="lg-grid">
            {LEAGUES.map((l) => <LeagueCard key={l.id} league={l} event={events ? leagueEvent(l, events, today) : null} group={group} />)}
          </div>
          <span className="lg-scrawl lg-gold">I'll put you down for a 4 there...</span>
          <Banner>Scores run on our own scorecard: scan the QR on your card, score every hole, everybody signs, submit. Only signed &amp; submitted rounds count.</Banner>
        </div>
      </section>

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
            <p className="lg-muted">Duplicate last week's event, check in walk-ups, print the QR cards. Standings go live on the event's leaderboard.</p>
          </div>
          <Button to="/td" variant="outline-accent" size="lg">TD login</Button>
        </div>
      </section>
    </>
  );
}

function LeagueCard({ league: l, event, group }: { league: League; event: PublicEvent | null; group: string | undefined }) {
  return (
    <article id={l.id} className="ds-card lg-card">
      {l.banner && <img className="lg-banner" src={l.banner} alt="" loading="lazy" />}
      {l.logos && (
        <div className="lg-logos">{l.logos.map((g) => <img key={g.src} src={g.src} alt={g.alt} loading="lazy" />)}</div>
      )}
      <div className="ds-card-head"><span className="ds-card-title">{l.name}</span><span className="ds-card-aside">{l.tag}</span></div>
      <div className="ds-card-body lg-card-body">
        <h3 className="ds-display ds-display-m" style={{ margin: 0 }}>{l.title}</h3>
        <span className="lg-scrawl">{l.scrawl}</span>
        <div className="ds-tour">
          <Row k="Runs it" v={l.runBy} />
          {l.startedBy && <Row k="Started by" v={l.startedBy} />}
          <Row k="When" v={l.when} />
          <Row k="Where" v={l.where} note={l.whereNote} />
          {l.buyIn && <Row k="Cost" v={l.buyIn} />}
        </div>
        <div className="row lg-card-actions">
          {event && <Button to={`/e/${event.slug}`}>This week's scores</Button>}
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
