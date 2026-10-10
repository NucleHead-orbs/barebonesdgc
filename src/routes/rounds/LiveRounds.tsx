/**
 * Live rounds, public (migration 20261105). LiveStrip: "Live now" on the club home and Boner Rounds (nothing when nobody's
 * playing). LivePage (/rounds/live/:id): the full card, refreshing itself; FINAL once it's saved.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as api from '../../lib/rounds/api';
import { LIVE_REACTIONS, UPCOMING_KIND, agoLabel, groupThru, liveStandings, reactionLine, startsIn, whenLabel, type LiveCard, type LiveKind, type LiveRound, type UpcomingRound } from '../../lib/rounds/live';
import { useLiveReactions } from '../../lib/rounds/useLiveReactions';
import { LiveFx } from './LiveFx';
import { ME_KEY, fmtToPar, roundMessage, running, toParClass } from '../../lib/rounds/rounds';
import { Banner, Button } from '../../components/ui';
import './rounds.css';

function usePoll<T>(load: () => Promise<{ data?: T; error?: unknown }>, ms: number) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let live = true;
    const pull = async () => { const r = await load(); if (!live) return; if (r.error) setFailed(true); else { setFailed(false); setData(r.data); } setNow(Date.now()); };
    void pull();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void pull(); }, ms);
    return () => { live = false; window.clearInterval(t); };
  }, [load, ms]);
  return { data, failed, now };
}

export function LiveStrip({ hide }: { hide?: Set<string> } = {}) {
  const { data: all, now } = usePoll(api.liveRounds, 30_000);
  const data = all?.filter((r) => !hide?.has(r.id));
  if (!data?.length) return null;
  return (
    <section className="sec lv-sec">
      <div className="sec-inner">
        <div className="lv-head"><span className="lv-dot" aria-hidden="true" /><b>Live now</b><span>{data.length} round{data.length === 1 ? '' : 's'} on the course</span></div>
        <div className="lv-strip">
          {data.map((r) => {
            const st = liveStandings(r.card);
            const lead = st[0];
            return (
              <Link key={r.id} to={`/rounds/live/${r.id}`} className="lv-card">
                <b>{r.course}</b>
                <span>{r.card.players.map((p) => p.name).join(', ')}</span>
                <span className="lv-meta">Thru {groupThru(r.card)} of {r.card.pars.length}{lead && lead.thru > 0 ? ` · ${lead.name} ${fmtToPar(lead.toPar)}` : ''} · {agoLabel(r.updated_at, now)}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default function LivePage() {
  const { id = '' } = useParams();
  const load = useCallback(() => api.liveRound(id), [id]);
  const { data: r, failed, now } = usePoll<LiveRound | null>(load, 15_000);
  if (r === undefined) return <section className="sec"><div className="sec-inner br"><p className="br-empty">{failed ? 'No signal. Trying again…' : 'Loading…'}</p></div></section>;
  if (r === null) return <section className="sec"><div className="sec-inner br"><Banner tone="warn">That live round isn't here anymore.</Banner><Button to="/rounds">Boner Rounds</Button></div></section>;
  const c = r.card;
  const st = liveStandings(c);
  const quiet = !r.ended && now - new Date(r.updated_at).getTime() > 30 * 60_000;
  return (
    <section className="sec">
      <div className="sec-inner br">
        <Link to="/rounds" className="br-back">‹ Boner Rounds</Link>
        <div className="lv-title">
          {r.ended ? <span className="lv-final">FINAL</span> : quiet ? <span className="lv-final">PAUSED</span> : <span className="lv-live"><span className="lv-dot" aria-hidden="true" />LIVE</span>}
          <h1>{c.course}</h1>
          <span className="lv-meta">Thru {groupThru(c)} of {c.pars.length} · updated {agoLabel(r.updated_at, now)}</span>
        </div>
        {!r.ended && !quiet && <ReactBar liveId={r.id} card={c} muted={!!r.muted} />}
        {r.ended && <p className="lead">They saved it. Look for it on <Link to="/rounds">Boner Rounds</Link> once everyone confirms.</p>}
        <ol className="lv-board">
          {st.map((p, i) => (
            <li key={p.name + i}><span className="lv-pos">{p.thru ? i + 1 : '–'}</span><b>{p.name}</b><span className={toParClass(p.toPar)}>{p.thru ? fmtToPar(p.toPar) : '–'}</span><span className="lv-thru">{p.thru ? `thru ${p.thru}` : 'not started'}</span></li>
          ))}
        </ol>
        <div className="br-tablewrap">
          <table className="sc-table">
            <tbody>
              <tr><th>Hole</th>{c.pars.map((_, i) => <th key={i}>{c.labels?.[i] ?? i + 1}</th>)}<th>Tot</th></tr>
              <tr><th>Par</th>{c.pars.map((p, i) => <td key={i}>{p}</td>)}<td>{c.pars.reduce((a, b) => a + b, 0)}</td></tr>
              {c.players.map((p, pi) => (
                <tr key={pi}><th>{p.name}</th>{c.pars.map((pp, i) => { const s = p.scores[i]; return <td key={i} className={s == null ? '' : toParClass(s - pp)}>{s ?? ''}</td>; })}<td><b>{running(c.pars, p.scores).strokes || ''}</b></td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="br-note">Live from the scorer's phone. It isn't official until it's saved and everyone confirms.</p>
      </div>
    </section>
  );
}

/** Send a razz or a congrats to the card (your My Tag link on this phone signs it). Plays everyone's reactions here too. */
function ReactBar({ liveId, card, muted }: { liveId: string; card: LiveCard; muted: boolean }) {
  const [token] = useState<string | null>(() => { try { return localStorage.getItem(ME_KEY); } catch { return null; } });
  const [target, setTarget] = useState<string | null>(null);
  const [wait, setWait] = useState(false);
  const [err, setErr] = useState('');
  const fx = useLiveReactions(liveId, true);
  const off = muted || fx.muted;
  const send = async (kind: LiveKind) => {
    if (!token || wait) return;
    setErr(''); setWait(true);
    const r = await api.liveReact(liveId, token, kind, target);
    if (r.error) { setErr(roundMessage(r.error)); setWait(false); return; }
    window.setTimeout(() => setWait(false), 15_000);
  };
  return (
    <div className="lv-react">
      <LiveFx key={fx.queue[0]?.id ?? 0} r={fx.queue[0]} onDone={fx.shift} />
      {off ? <p className="br-note">The scorer muted reactions for this round.</p>
        : !token ? <p className="br-note">Want to razz them? Open your My Tag link on this phone once, then come back here.</p>
        : (
          <>
            <div className="lv-react-row"><b>At</b>
              <button className="lv-who" aria-pressed={target === null} onClick={() => setTarget(null)}>Everyone</button>
              {card.players.map((p) => <button key={p.name} className="lv-who" aria-pressed={target === p.name} onClick={() => setTarget(p.name)}>{p.name}</button>)}
            </div>
            {(['razz', 'congrats'] as const).map((tone) => (
              <div key={tone} className="lv-react-row"><b>{tone === 'razz' ? 'Razz' : 'Congrats'}</b>
                {LIVE_REACTIONS.filter((x) => x.tone === tone).map((x) => (
                  <button key={x.kind} className="lv-rx" disabled={wait} onClick={() => void send(x.kind)}><span aria-hidden="true">{x.glyph}</span>{x.label}</button>
                ))}
              </div>
            ))}
            {wait && <p className="br-note">Sent. It pops up on their card. Next one in a few seconds.</p>}
          </>
        )}
      {err && <p className="br-note" role="alert">{err}</p>}
      {fx.feed.length > 0 && <ul className="lv-feed">{fx.feed.slice(0, 6).map((x) => <li key={x.id}>{reactionLine(x)}</li>)}</ul>}
    </div>
  );
}

/**
 * Boner Rounds: "Coming up live" (migration 20261123). Scheduled rounds (league nights, locked challenges, casual
 * invites) advertised before tee-off; once a card started from one goes live the tile turns LIVE and links each card.
 * Then the regular Live now strip, minus the cards already shown on a tile.
 */
export function RoundsLive() {
  const { data, now } = usePoll(api.liveUpcoming, 30_000);
  const shown = new Set((data ?? []).flatMap((u) => u.live.map((l) => l.id)));
  return (
    <>
      {!!data?.length && (
        <section className="sec lv-sec">
          <div className="sec-inner">
            <div className="lv-head"><b>Coming up live</b><span>Scheduled rounds you can watch hole by hole</span></div>
            <div className="lv-grid">{data.map((u) => <UpcomingTile key={`${u.kind}-${u.id}`} u={u} now={now} />)}</div>
          </div>
        </section>
      )}
      <LiveStrip hide={shown} />
    </>
  );
}

function UpcomingTile({ u, now }: { u: UpcomingRound; now: number }) {
  const live = u.live.length > 0;
  const final = u.results && u.results.length ? u.results : null;
  const dubs = u.format === 'dubs';
  const who = u.players.length > 8 ? `${u.players.slice(0, 8).join(', ')} +${u.players.length - 8} more` : u.players.join(', ');
  return (
    <div className={`lv-card lv-up${live ? ' is-live' : ''}${final ? ' is-final' : ''}`}>
      <span className="lv-kind">{final ? 'FINAL' : live ? <><span className="lv-dot" aria-hidden="true" />LIVE</> : `${UPCOMING_KIND[u.kind]}${dubs ? ' · DUBS' : ''}`}</span>
      <b>{u.title}</b>
      <span>{whenLabel(u.at, now)}{u.course ? ` · ${u.course}` : ''}</span>
      {u.set && <span className="lv-meta">{u.set}{u.kind === 'challenge' ? ' tags on the line' : ''}</span>}
      {u.kind === 'night' && <span className="lv-meta">{dubs ? 'Dubs, no tags on the line' : 'Every tag set on the line'}{u.host ? ` · run by ${u.host}` : ''}</span>}
      {final ? (
        <ol className="lv-final-list">
          {final.slice(0, 5).map((t) => (
            <li key={t.team}><span>{final.filter((x) => x.place === t.place).length > 1 ? 'T' : ''}{t.place}.</span> {t.players.map((p) => p.name).join(' & ')} <b className={toParClass(t.to_par)}>{fmtToPar(t.to_par)}</b></li>
          ))}
          {final.length > 5 && <li className="lv-meta">+{final.length - 5} more teams</li>}
        </ol>
      ) : who && <span className="lv-meta">{u.kind === 'night' ? `Checked in (${u.players.length}): ` : ''}{who}</span>}
      {final ? null : dubs && !live ? <span className="lv-soon">Dubs, scored off the Scorecard. Results land here when {u.host ?? 'the host'} posts them.</span> : live ? (
        <div className="lv-watch">
          {u.live.map((l, i) => (
            <Link key={l.id} to={`/rounds/live/${l.id}`} className="lv-watchlink">
              Watch{u.live.length > 1 ? ` card ${i + 1}` : ''} · thru {groupThru(l.card)}
            </Link>
          ))}
        </div>
      ) : <span className="lv-soon">Goes live {startsIn(u.at, now) === 'teeing off' ? 'with the first score' : startsIn(u.at, now)}</span>}
    </div>
  );
}
