import { useCallback, useEffect, useState, type ReactNode } from 'react';
import * as api from '../../lib/td/api';
import { rpcError, type ExistingPlayer } from '../../lib/td/builder';
import { dateRange, eventTabs, formatSummary, type Tab } from '../../lib/td/setup';
import { useTheme } from '../../lib/theme';
import CardBuilder from './CardBuilder';
import PlayersPanel from './PlayersPanel';
import SetupPanel from './SetupPanel';
import SponsorsPanel from './SponsorsPanel';

const TAB_LABEL: Record<Tab, string> = { setup: 'SETUP', players: 'PLAYERS', cards: 'CARDS & QR', sponsors: 'SPONSORS' };

/**
 * One event: Setup (the build menu) · Players (import, walk-ups, check-in) · Cards & QR · Sponsors (if on).
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

  useEffect(() => {
    void (async () => {
      await Promise.all([loadSetup(), loadPlayers()]);
      const sp = await api.loadSponsors(eventId);
      if (sp.data) setSponsors(sp.data);
    })();
  }, [eventId, loadSetup, loadPlayers]);

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

  return (
    <Frame title={ev.name} sub={`${[ev.club_name, dateRange(ev)].filter(Boolean).join(' · ')} · ${formatSummary(ev, setup.holes.length)}`}
      email={email} onSignOut={onSignOut} onBack={onBack}
      links={<a className="td-btn quiet" href={board} target="_blank" rel="noreferrer">LEADERBOARD ↗</a>}>
      <nav className="td-tabs" aria-label="Event sections">
        {tabs.map((t) => (
          <button key={t} aria-current={current === t ? 'page' : undefined} onClick={() => setTab(t)}>{TAB_LABEL[t]}</button>
        ))}
      </nav>
      {current === 'setup' && <SetupPanel setup={setup} admin={admin} players={players} onSaved={loadSetup} onDeleted={onBack} />}
      {current === 'players' && <PlayersPanel setup={setup} players={players} sponsors={sponsors}
        onPlayers={setPlayers} onReload={loadPlayers} onSponsors={setSponsors} />}
      {current === 'cards' && <CardBuilder key={rev} setup={setup} players={players} />}
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
          <button className="td-btn quiet" onClick={onSignOut} title={email}>SIGN OUT</button>
        </div>
      </header>
      {children}
    </div>
  );
}
