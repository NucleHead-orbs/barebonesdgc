/**
 * TD home header (top of /td): what the tool does, what's new (updates.ts), and every help topic (help.ts).
 * Content lives in those two files; this only lays it out. "New" = newer than the last update this browser saw.
 */
import { useEffect, useState } from 'react';
import { HELP, boldParts } from '../../lib/td/help';
import { UPDATES, unseenCount, updatesFor } from '../../lib/td/updates';
import { niceDate } from '../../lib/leagues/leagues';
import { HelpPanel } from './Help';

const SEEN_KEY = 'bb-td-updates-seen';
const readSeen = () => { try { return localStorage.getItem(SEEN_KEY); } catch { return null; } };
const writeSeen = (id: string) => { try { localStorage.setItem(SEEN_KEY, id); } catch { /* not remembered: everything shows as new */ } };

const RUN: Array<[string, string, string]> = [
  ['setup', 'SETUP', 'course, divisions, rounds'],
  ['players', 'PLAYERS', 'import and check in'],
  ['cards', 'CARDS & QR', 'generate, publish, print'],
  ['scoring', 'SCORING', 'phones score each card'],
  ['winners', 'WINNERS', 'payouts, post results'],
];
const ADMIN_ONLY = new Set(['band', 'gallery']);
const TAGS_ONLY = new Set(['tags']);

const Bold = ({ text }: { text: string }) => <>{boldParts(text).map((p, i) => (p.bold ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>))}</>;

export default function TdHome({ admin, tagAdmin }: { admin: boolean; tagAdmin: boolean }) {
  const [help, setHelp] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const list = updatesFor(UPDATES, { admin, tagAdmin });
  const [lastSeen] = useState(readSeen);
  const fresh = unseenCount(list, lastSeen);
  useEffect(() => { if (list[0]) writeSeen(list[0].id); }, [list]);
  const shown = all ? list : list.slice(0, Math.max(3, Math.min(fresh, 6)));
  const topics = HELP.filter((h) => (!ADMIN_ONLY.has(h.id) || admin) && (!TAGS_ONLY.has(h.id) || admin || tagAdmin));

  return (
    <div className="td-home">
      <section className="td-panel td-home-run">
        <h2>Run an event</h2>
        <ol className="td-home-steps">
          {RUN.map(([id, tab, what]) => (
            <li key={id}><button className="td-home-step" onClick={() => setHelp(id)}><b>{tab}</b><span>{what}</span></button></li>
          ))}
        </ol>
        <p className="td-hint">Before the day: <button className="td-link" onClick={() => setHelp('prep')}>PREP</button> (checklist, shirts, designs, votes) and{' '}
          <button className="td-link" onClick={() => setHelp('crew')}>CREW</button> (helper links, stations, raffle). League week 2? <button className="td-link" onClick={() => setHelp('week2')}>DUPLICATE</button> last week.</p>
        <p className="td-hint">On the club site: <a href="/scorecard">Scorecard</a> · <a href="/rounds">Boner Rounds</a> · <a href="/tags">Tag boards</a> · <a href="/leagues">Leagues</a></p>
      </section>

      <section className="td-panel td-home-news">
        <div className="td-row"><h2>What's new</h2>{fresh > 0 && <span className="td-badge">{fresh} new</span>}</div>
        <ul className="td-home-updates">
          {shown.map((u, i) => (
            <li key={u.id} className={i < fresh ? 'is-new' : undefined}>
              <div className="td-home-uhead"><b>{u.title}</b><span className="td-hint">{niceDate(u.date)}{i < fresh ? ' · NEW' : ''}</span></div>
              <p><Bold text={u.body} /></p>
              {u.help && <button className="td-link" onClick={() => setHelp(u.help!)}>How it works ›</button>}
            </li>
          ))}
        </ul>
        {list.length > shown.length && <button className="td-btn quiet" onClick={() => setAll(true)}>SHOW ALL {list.length}</button>}
      </section>

      <section className="td-panel">
        <h2>Help topics</h2>
        <div className="td-chips">
          {topics.map((h) => <button key={h.id} className="td-chip" onClick={() => setHelp(h.id)}>{h.title}</button>)}
        </div>
      </section>
      {help && <HelpPanel start={help} onClose={() => setHelp(null)} />}
    </div>
  );
}
