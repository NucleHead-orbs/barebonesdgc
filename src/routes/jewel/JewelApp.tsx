import { useEffect, useMemo, useState } from 'react';
import { loadJewel, type JewelData, type PublicSponsor } from '../../lib/jewel/api';
import { rankDivision, divisionsPresent, onCourse, toPar, parTone, type Mode } from '../../lib/jewel/leaderboard';
import { EVENT, SCHEDULE, HOUSE_RULES } from '../../lib/jewel/content';
import './jewel.css';

type Tab = 'leaders' | 'score' | 'course' | 'info';
const TABS: Array<[Tab, string, string]> = [['leaders', '♛', 'Leaders'], ['score', '✎', 'Score'], ['course', '⛳', 'Course'], ['info', '★', 'Info']];
const tabFromHash = (): Tab => {
  const h = window.location.hash.slice(1);
  return (TABS.some(([t]) => t === h) ? h : 'leaders') as Tab;
};

/** Public player app at /jewel. Tabs live in the URL hash so links like /jewel#course are shareable. */
export default function JewelApp() {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [data, setData] = useState<JewelData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const on = () => setTab(tabFromHash());
    window.addEventListener('hashchange', on);
    window.addEventListener('popstate', on); // back/forward between tabs
    return () => { window.removeEventListener('hashchange', on); window.removeEventListener('popstate', on); };
  }, []);
  useEffect(() => {
    loadJewel().then(setData, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const go = (t: Tab) => { window.history.pushState(null, '', `#${t}`); setTab(t); window.scrollTo(0, 0); };

  return (
    <div className="jw">
      <header className="jw-head">
        <img src="/assets/wordmark-bare-bones-cut.png" alt="Bare Bones" />
        <div>
          <h1>{EVENT.title}</h1>
          <div className="jw-sub">{EVENT.subtitle}</div>
        </div>
      </header>
      <main className="jw-body">
        {error && <div className="jw-error" role="alert">{error}</div>}
        {!data && !error && <p className="jw-note">Loading…</p>}
        {data && tab === 'leaders' && <Leaders data={data} />}
        {tab === 'score' && <Score />}
        {data && tab === 'course' && <Course data={data} />}
        {tab === 'info' && <Info sponsors={data?.sponsors ?? []} />}
      </main>
      <nav className="jw-tabs" aria-label="Sections">
        {TABS.map(([t, ic, label]) => (
          <button key={t} className="jw-tab" aria-current={tab === t ? 'page' : undefined} onClick={() => go(t)}>
            <span className="ic" aria-hidden>{ic}</span>{label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function Leaders({ data }: { data: JewelData }) {
  const [mode, setMode] = useState<Mode>('live');
  const [div, setDiv] = useState<string>('All');
  const divs = useMemo(() => divisionsPresent(data.board), [data.board]);
  const live = onCourse(data.board);
  const shown = div === 'All' ? divs : divs.filter((d) => d === div);

  return (
    <>
      <div className="jw-row">
        <h2 className="jw-h2">Leaderboard</h2>
        <span className="jw-live">{live ? `● LIVE · ${live} ON COURSE` : `${data.board.length} REGISTERED`}</span>
      </div>
      <div className="jw-row">
        <div className="jw-seg">
          {(['official', 'live'] as Mode[]).map((m) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m === 'official' ? 'OFFICIAL' : 'LIVE'}</button>
          ))}
        </div>
        <span className="jw-note" style={{ flex: 1, minWidth: 160 }}>
          {mode === 'official' ? 'Only signed & submitted rounds count.' : 'Showing live, unsigned scores — unofficial until the card signs off.'}
        </span>
      </div>
      {divs.length > 1 && (
        <div className="jw-chips" role="group" aria-label="Division">
          {['All', ...divs].map((d) => <button key={d} className="jw-chip" aria-pressed={div === d} onClick={() => setDiv(d)}>{d}</button>)}
        </div>
      )}
      {!divs.length && <div className="jw-banner">No players yet. Registration is open on Disc Golf Scene.</div>}
      {shown.map((d) => {
        const ranked = rankDivision(data.board.filter((r) => r.div_code === d), mode);
        return (
          <section key={d} className="jw-div" aria-label={`${d} leaderboard`}>
            <div className="jw-div-head"><b>{d}</b><span>{ranked.length} player{ranked.length === 1 ? '' : 's'}</span></div>
            <div className="jw-grid hdr"><span>POS</span><span>PLAYER</span><span className="num">R1</span><span className="num">R2</span><span className="num">TOT</span></div>
            {ranked.map((p) => (
              <div key={p.id} className="jw-grid">
                <span className={`jw-pos${p.first ? ' first' : ''}`}>{p.pos}</span>
                <span className="jw-name"><b>{p.name}</b><span>{p.status}</span></span>
                <span className={`num ${parTone(p.r1)}`}>{toPar(p.r1)}</span>
                <span className={`num ${parTone(p.r2)}`}>{toPar(p.r2)}</span>
                <span className={`num tot ${parTone(p.total)}`}>{toPar(p.total)}</span>
              </div>
            ))}
          </section>
        );
      })}
    </>
  );
}

function Score() {
  return (
    <>
      <h2 className="jw-h2">Scorecard</h2>
      <div className="jw-banner">App scoring is optional — anyone on the card can keep score here, or turn in a paper card at TD Central. Every player signs off before a card can be submitted.</div>
      <div className="jw-banner">Scan the QR code on your card to open it. Codes go out at check-in, once cards are set.</div>
    </>
  );
}

function Course({ data }: { data: JewelData }) {
  const [open, setOpen] = useState<number | null>(null);
  const byHole = useMemo(() => {
    const m = new Map<number, PublicSponsor[]>();
    for (const s of data.sponsors) if (s.hole) m.set(s.hole, [...(m.get(s.hole) ?? []), s]);
    return m;
  }, [data.sponsors]);
  return (
    <>
      <h2 className="jw-h2">The Setlist</h2>
      <img className="jw-map" src="/assets/coursemap-thumb.png" alt="Course map: Stripe Show Golf Course" />
      {data.holes.map((h) => {
        const isOpen = open === h.n;
        const spons = byHole.get(h.n) ?? [];
        return (
          <div key={h.n} className="jw-hole" data-open={isOpen}>
            <button aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : h.n)}>
              <span className={`jw-ring${h.par >= 4 ? ' p4' : ''}`}>{h.n}</span>
              <span className="jw-hole-meta"><b>Par {h.par}{h.dist_ft ? ` · ${h.dist_ft} ft` : ''}</b>{h.ob && <span>{h.ob}</span>}</span>
              <span className="jw-chev" aria-hidden>›</span>
            </button>
            {isOpen && (
              <div className="jw-hole-body">
                {h.quote && <div className="jw-quote">{h.quote}</div>}
                {h.rules.map((r) => <div key={r} className="jw-rule">{r}</div>)}
                {spons.length > 0 && <div className="jw-hole-spon">HOLE SPONSOR: {spons.map((s) => s.name).join(' · ')}</div>}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function Info({ sponsors }: { sponsors: PublicSponsor[] }) {
  return (
    <>
      <h2 className="jw-h2">Tour Info</h2>
      <a className="jw-cta" href={EVENT.registerUrl} target="_blank" rel="noreferrer">REGISTER ON DISC GOLF SCENE</a>
      {SCHEDULE.map((d) => (
        <section key={d.day} className="jw-day">
          <h3>{d.day.toUpperCase()}</h3>
          {d.rows.map((r) => <div key={r.time + r.what} className="jw-time"><b>{r.time}</b><span>{r.what}</span></div>)}
        </section>
      ))}
      {HOUSE_RULES.length > 0 && (
        <section className="jw-day">
          <h3>HOUSE RULES</h3>
          {HOUSE_RULES.map((r) => <div key={r} className="jw-time"><b>•</b><span>{r}</span></div>)}
        </section>
      )}
      <section className="jw-spons">
        <h2>Our Sponsors</h2>
        <div className="jw-note" style={{ color: '#111' }}>Presented by {EVENT.presentedBy}</div>
        {sponsors.length > 0 ? (
          <div className="jw-spons-grid">
            {sponsors.map((s) => (
              <div key={s.id} className="jw-spon">
                {s.logo_url && <img src={s.logo_url} alt={s.name} loading="lazy" />}
                <b>{s.name}</b>
                {(s.hole || s.tier) && <span>{[s.hole ? `Hole ${s.hole}` : '', s.tier ?? ''].filter(Boolean).join(' · ')}</span>}
              </div>
            ))}
          </div>
        ) : <div>Sponsor lineup coming soon.</div>}
        <div className="jw-tagline">{EVENT.tagline}</div>
      </section>
    </>
  );
}
