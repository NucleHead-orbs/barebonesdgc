import { useEffect, useMemo, useState } from 'react';
import { loadJewel, type JewelData, type PublicSponsor } from '../../lib/jewel/api';
import { CourseGuide, SponsorPanel } from '../../components/event';
import { rankDivision, divisionsPresent, onCourse, toPar, parTone, type Mode } from '../../lib/jewel/leaderboard';
import { EVENT, SCHEDULE, HOUSE_RULES } from '../../lib/jewel/content';
import { useTheme } from '../../lib/theme';
import './jewel.css';

type Tab = 'leaders' | 'score' | 'course' | 'info';
const TABS: Array<[Tab, string, string]> = [['leaders', '♛', 'Leaders'], ['score', '✎', 'Score'], ['course', '⛳', 'Course'], ['info', '★', 'Info']];
const tabFromHash = (): Tab => {
  const h = window.location.hash.slice(1);
  return (TABS.some(([t]) => t === h) ? h : 'leaders') as Tab;
};

/** Public player app at /jewel. Tabs live in the URL hash so links like /jewel#course are shareable. */
export default function JewelApp() {
  useTheme('jewel-xi');
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
  return (
    <>
      <h2 className="jw-h2">The Setlist</h2>
      <img className="jw-map" src="/assets/coursemap-thumb.png" alt="Course map: Stripe Show Golf Course" />
      <CourseGuide sponsors={data.sponsors} />
      <a className="jw-note" href="/jewel-xi/course" style={{ color: 'var(--accent-a)' }}>Open the full course guide ›</a>
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
      <SponsorPanel sub={`Presented by ${EVENT.presentedBy}`} tagline={EVENT.tagline} sponsors={sponsors} />
    </>
  );
}
