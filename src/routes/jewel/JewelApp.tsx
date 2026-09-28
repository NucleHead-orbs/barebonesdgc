import { useEffect, useState } from 'react';
import { loadJewel, type JewelData, type PublicSponsor } from '../../lib/jewel/api';
import { CourseGuide, SponsorPanel } from '../../components/event';
import Leaderboard from '../../components/Leaderboard';
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
        {data && tab === 'leaders' && <Leaderboard board={data.board} rounds={2} empty="No players yet. Registration is open on Disc Golf Scene." />}
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
