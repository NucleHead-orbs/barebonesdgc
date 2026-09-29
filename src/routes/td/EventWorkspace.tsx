import { useCallback, useEffect, useState, type ReactNode } from 'react';
import * as api from '../../lib/td/api';
import { rpcError, type ExistingPlayer } from '../../lib/td/builder';
import { dateRange, eventTabs, formatSummary, type Tab } from '../../lib/td/setup';
import { useTheme } from '../../lib/theme';
import CardBuilder from './CardBuilder';
import PlayersPanel from './PlayersPanel';
import PrepPanel from './PrepPanel';
import RequestsPanel from './RequestsPanel';
import WinnersPanel from './WinnersPanel';
import SetupPanel from './SetupPanel';
import SponsorsPanel from './SponsorsPanel';
import { HelpButton } from './Help';

const TAB_LABEL: Record<Tab, string> = { setup: 'SETUP', prep: 'PREP', players: 'PLAYERS', requests: 'REQUESTS', cards: 'CARDS & QR', winners: 'WINNERS', sponsors: 'SPONSORS' };
const POLL_MS = 20_000; // new player requests show up without a reload

/**
 * One event: Setup (the build menu) · Prep (tasks, shirts, designs) · Players (import, walk-ups, check-in) · Cards & QR · Sponsors (if on).
 * Setup and players are loaded here once and shared, so every tab sees the same truth.
 */
export default function EventWorkspace({ eventId, email, admin, onSignOut, onBack }: {
  eventId: string; email: string; admin: boolean; onSignOut: () => void; onBack: () => void;
}) {
  const [setup, setSetup] = useState<api.EventSetup | null>(null);
  const [players, setPlayers] = useState<ExistingPlayer[]>([]);
  const [sponsors, setSponsors] = useState<api.Sponsor[]>([]);
  const [fatal, setFatal] = useState('');
  const [tab, setTab] = useState<Tab>('players');
  const [rev, setRev] = useState(0); // bumps when setup changes, so the card builder re-reads its inputs
  const [requests, setRequests] = useState<api.CardRequest[]>([]);
  const [priv, setPriv] = useState<api.PrivateInfo>({ vibe: {}, apart: [] });

  useTheme(setup?.event.skin === 'jewel-xi' ? 'jewel-xi' : 'event', setup?.event.palette ?? null);

  const loadSetup = useCallback(async () => {
    const r = await api.loadEventSetup(eventId);
    if (r.error || !r.data) return setFatal(rpcError(r.error).message);
    setSetup(r.data);
    setRev((n) => n + 1);
  }, [eventId]);

  const loadPlayers = useCallback(async () => {
    const r = await api.loadPlayers(eventId);
    if (r.error || !r.data) return setFatal(rpcError(r.error).message);
    setPlayers(r.data);
  }, [eventId]);

  const loadRequests = useCallback(async () => {
    const r = await api.loadRequests(eventId);
    if (r.data) setRequests(r.data);
  }, [eventId]);
  const loadPrivate = useCallback(async () => {
    const r = await api.loadPrivate(eventId);
    if (r.data) setPriv(r.data);
  }, [eventId]);

  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') void loadRequests(); };
    const t = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [loadRequests]);

  useEffect(() => {
    void (async () => {
      await Promise.all([loadSetup(), loadPlayers(), loadRequests(), loadPrivate()]);
      const sp = await api.loadSponsors(eventId);
      if (sp.data) setSponsors(sp.data);
    })();
  }, [eventId, loadSetup, loadPlayers, loadRequests, loadPrivate]);

  if (fatal) {
    return <Frame title="Event" sub="" email={email} onSignOut={onSignOut} onBack={onBack}>
      <div className="td-main"><div className="td-warn" role="alert">Could not open this event. {fatal}</div></div>
    </Frame>;
  }
  if (!setup) return <Frame title="Loading…" sub="" email={email} onSignOut={onSignOut} onBack={onBack}><p className="td-empty">Loading event…</p></Frame>;

  const ev = setup.event;
  const tabs = eventTabs(ev);
  const current = tabs.includes(tab) ? tab : 'setup';
  const board = `/e/${ev.slug}`;
  const newCount = requests.filter((r) => r.status === 'new').length;

  return (
    <Frame title={ev.name} sub={`${[ev.club_name, dateRange(ev)].filter(Boolean).join(' · ')} · ${formatSummary(ev, setup.holes.length)}`}
      email={email} onSignOut={onSignOut} onBack={onBack}
      links={<a className="td-btn quiet" href={board} target="_blank" rel="noreferrer">LEADERBOARD ↗</a>}>
      <nav className="td-tabs" aria-label="Event sections">
        {tabs.map((t) => (
          <button key={t} aria-current={current === t ? 'page' : undefined} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}{t === 'requests' && newCount > 0 && <span className="td-badge">{newCount}</span>}
          </button>
        ))}
      </nav>
      {current === 'setup' && <SetupPanel setup={setup} admin={admin} players={players} onSaved={loadSetup} onDeleted={onBack} />}
      {current === 'prep' && <PrepPanel setup={setup} players={players} onPlayers={setPlayers} email={email} />}
      {current === 'players' && <PlayersPanel setup={setup} players={players} sponsors={sponsors} priv={priv}
        onPlayers={setPlayers} onReload={async () => { await Promise.all([loadPlayers(), loadRequests(), loadPrivate()]); }} onSponsors={setSponsors} onPrivate={loadPrivate} />}
      {current === 'requests' && <RequestsPanel setup={setup} players={players} requests={requests} onReload={loadRequests} />}
      {current === 'cards' && <CardBuilder key={rev} setup={setup} players={players} requests={requests} priv={priv} />}
      {current === 'winners' && <WinnersPanel setup={setup} players={players} onPlayers={setPlayers} />}
      {current === 'sponsors' && (
        <SponsorsPanel eventId={ev.id} holeCount={setup.holes.length} sponsors={sponsors} onChange={setSponsors} onBack={() => setTab('cards')} />
      )}
    </Frame>
  );
}

function Frame({ title, sub, email, onSignOut, onBack, links, children }: {
  title: string; sub: string; email: string; onSignOut: () => void; onBack: () => void; links?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="td">
      <header className="td-top">
        <button className="td-btn quiet" onClick={onBack}>‹ EVENTS</button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <div className="td-title">{title}</div>
          {sub && <div className="td-sub">{sub.toUpperCase()}</div>}
        </div>
        <div style={{ flex: 1 }} />
        <div className="td-actions">
          {links}
          <HelpButton />
          <button className="td-btn quiet" onClick={onSignOut} title={email}>SIGN OUT</button>
        </div>
      </header>
      {children}
    </div>
  );
}
