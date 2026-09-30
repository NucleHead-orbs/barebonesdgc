import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { supabase, syncScores } from '../../lib/supabase';
import { ScoreQueue, deviceId, type QueuedScore, type RejectedScore } from '../../lib/offline/queue';
import { useTheme } from '../../lib/theme';
import {
  bump, cardComplete, cleanInitials, firstOpenHole, holeDone, holeOrder, mergeScores, playerLine,
  resultMessage, shortNames, signState, signStatusLine, tileTone, toParText, type CardPlayer, type HoleInfo, type ScoreMap,
} from '../../lib/scorecard/logic';
import { CardError, cachedCard, fetchCard, signCard, submitCard, unlockCard, type CardSnapshot } from '../../lib/scorecard/api';
import './card.css';

const queue = new ScoreQueue();
const REFRESH_MS = 20_000;

/**
 * /c/:token: the phone scorecard behind each card's QR code.
 * Taps save to this phone first (IndexedDB), then sync. No signal never loses a score.
 */
export default function CardApp() {
  const { token = '' } = useParams();
  const [snap, setSnap] = useState<CardSnapshot>();
  const [fatal, setFatal] = useState('');
  const [pending, setPending] = useState<QueuedScore[]>([]);
  const [rejected, setRejected] = useState<RejectedScore[]>([]);
  const [online, setOnline] = useState(true);
  const [hole, setHole] = useState<number>();
  const [td, setTd] = useState(false);
  const alive = useRef(true);
  // no snapshot yet: neutral; old cached snapshot without event info: it can only be Jewel XI
  const skin = snap?.event ? (snap.event.skin === 'jewel-xi' ? 'jewel-xi' : 'event') : snap ? 'jewel-xi' : 'event';
  useTheme(skin, snap?.event?.palette ?? null);
  const brand = snap?.event?.name ?? (snap ? 'The Jewel XI' : '');

  const refreshLocal = useCallback(async () => {
    const [p, r] = await Promise.all([queue.pending(), queue.rejected()]);
    if (!alive.current) return;
    setPending(p.filter((x) => x.token === token));
    setRejected(r.filter((x) => x.token === token));
  }, [token]);

  const load = useCallback(async () => {
    try {
      const s = await fetchCard(token);
      if (!alive.current) return;
      setSnap(s); setOnline(true); setFatal('');
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof CardError && e.code === 'invalid_token') setFatal(e.message);
      else setOnline(false);
    }
  }, [token]);

  /** Push queued taps, then re-read the card so signatures / completeness match the server. */
  const sync = useCallback(async () => {
    const out = await queue.flush(syncScores);
    if (!alive.current) return;
    setOnline(out.online);
    await refreshLocal();
    if (out.online) await load();
  }, [load, refreshLocal]);

  useEffect(() => {
    alive.current = true;
    cachedCard(token).then((c) => { if (c && alive.current) setSnap((s) => s ?? c); });
    void refreshLocal().then(sync);
    const tick = () => { if (document.visibilityState === 'visible') void sync(); };
    const id = window.setInterval(tick, REFRESH_MS);
    window.addEventListener('online', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      alive.current = false;
      window.clearInterval(id);
      window.removeEventListener('online', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [token, refreshLocal, sync]);

  // TD tools show for anyone the database says can run THIS event (super admin or its event TDs).
  const eventId = snap?.card.event_id;
  useEffect(() => {
    if (!eventId) return;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
      const r = await supabase.rpc('can_td', { p_event: eventId });
      if (alive.current) setTd(r.data === true);
    })();
  }, [eventId]);

  const scores = useMemo(() => mergeScores(snap?.scores ?? {}, pending, token), [snap, pending, token]);

  if (fatal) return <Shell brand={brand}><div className="sc-msg sc-msg-bad"><h1>Card not found</h1><p>{fatal}</p></div></Shell>;
  if (!snap) {
    return (
      <Shell brand={brand}>
        <div className="sc-msg">
          {online ? <p>Loading your card…</p> : <><h1>No signal</h1><p>This card hasn't been opened on this phone yet, so it needs signal once. Step toward the parking lot and it will load on its own.</p></>}
        </div>
      </Shell>
    );
  }
  if (!snap.holes.length || !snap.players.length) {
    return <Shell brand={brand}><div className="sc-msg"><h1>{snap.card.label}</h1><p>This card has no {snap.players.length ? 'course holes' : 'players'} yet. Check with the TD.</p></div></Shell>;
  }

  const order = holeOrder(snap.card.start_hole, snap.holes.map((h) => h.n));
  const current = hole ?? firstOpenHole(order, snap.players, scores);
  const info = snap.holes.find((h) => h.n === current) ?? snap.holes[0];
  const idx = order.indexOf(current);
  const go = (d: 1 | -1) => setHole(order[(idx + d + order.length) % order.length]);
  const locked = snap.submitted;

  const tap = async (pid: string, strokes: number) => {
    if (locked) return;
    await queue.enqueue({ token, playerId: pid, hole: current, strokes, clientTs: new Date().toISOString(), deviceId: deviceId() });
    await refreshLocal();
    void sync();
  };

  const complete = cardComplete(snap.players, snap.holes, scores);
  const signed = snap.players.filter((p) => snap.signoffs[p.id]).length;
  const state = signState({ submitted: snap.submitted, complete, pending: pending.length, signed, players: snap.players.length });

  return (
    <Shell brand={brand}>
      <header className="sc-top">
        <div>
          <div className="sc-label">{snap.card.label}</div>
          <div className="sc-sub">{[(snap.event?.rounds ?? 2) > 1 ? `Round ${snap.card.round}` : '', (snap.event?.waves ?? 2) > 1 ? `${snap.card.wave} wave` : '', `starts on ${snap.card.start_hole}`, snap.card.format === 'doubles' ? `Dubs · ${snap.card.dubs_style ?? 'Best shot'}` : ''].filter(Boolean).join(' · ')}</div>
          {snap.card.format === 'doubles' && <div className="sc-sub">One score per team. Either partner can enter it and sign for the team.</div>}
        </div>
        <div className={`sc-net ${online ? (pending.length ? 'is-pending' : 'is-ok') : 'is-off'}`} role="status">
          {!online ? `offline · ${pending.length} saved on phone` : pending.length ? `syncing ${pending.length}…` : '✓ saved'}
        </div>
      </header>

      {rejected.length > 0 && (
        <div className="sc-rejected" role="alert">
          {rejected.map((r) => (
            <div key={`${r.playerId}|${r.hole}`} className="sc-rej-row">
              <span>
                <b>Hole {r.hole}, {snap.players.find((p) => p.id === r.playerId)?.name ?? 'player'}: {r.strokes}</b> not saved. {resultMessage(r.result)}
              </span>
              <button type="button" onClick={() => void queue.dismissRejected(r).then(refreshLocal)}>OK</button>
            </div>
          ))}
        </div>
      )}

      <section className="sc-hole" aria-label={`Hole ${info.n}`}>
        <button type="button" className="sc-arrow" aria-label="Previous hole" onClick={() => go(-1)}>‹</button>
        <div className="sc-hole-mid">
          <h1 className="sc-hole-n">Hole {info.n}</h1>
          <div className="sc-hole-meta">PAR {info.par}{info.dist_ft ? ` · ${info.dist_ft} FT` : ''}</div>
          {info.ob && <div className="sc-hole-ob">OB: {info.ob}</div>}
        </div>
        <button type="button" className="sc-arrow" aria-label="Next hole" onClick={() => go(1)}>›</button>
      </section>

      <nav className="sc-dots" aria-label="Holes">
        {order.map((n) => (
          <button key={n} type="button" aria-label={`Hole ${n}`} aria-current={n === current ? 'step' : undefined}
            className={`sc-dot${n === current ? ' is-cur' : holeDone(snap.players, scores, n) ? ' is-done' : ''}`}
            onClick={() => setHole(n)}>{n}</button>
        ))}
      </nav>

      <ul className={`sc-players${locked ? ' is-locked' : ''}`}>
        {snap.players.map((p) => (
          <PlayerRow key={p.id} p={p} hole={info} scores={scores} holes={snap.holes} locked={locked}
            signed={!!snap.signoffs[p.id]} onSet={(n) => void tap(p.id, n)} />
        ))}
      </ul>
      {complete || locked ? null : (
        <button type="button" className="sc-next" onClick={() => go(1)}>NEXT HOLE ›</button>
      )}
      {!locked && signed > 0 && <p className="sc-note">Changing any score clears every signature on the card.</p>}

      {(complete || locked) && (
        <SignPanel token={token} snap={snap} scores={scores} state={state} signed={signed} onDone={sync} />
      )}
      {td && (snap.submitted || signed > 0) && <TdUnlock cardId={snap.card.id} onDone={sync} />}
      <a className="sc-board" href={snap.event ? `/e/${snap.event.slug}` : '/jewel'}>Live leaderboard ›</a>
    </Shell>
  );
}

function Shell({ brand, children }: { brand: string; children: ReactNode }) {
  return <div className="sc"><div className="sc-brand">{brand.toUpperCase()}</div>{children}</div>;
}

function PlayerRow({ p, hole, holes, scores, locked, signed, onSet }: {
  p: CardPlayer; hole: HoleInfo; holes: HoleInfo[]; scores: ScoreMap; locked: boolean; signed: boolean; onSet: (n: number) => void;
}) {
  const v = scores[p.id]?.[hole.n];
  const line = playerLine(p.id, holes, scores);
  return (
    <li className="sc-row">
      <div className="sc-who">
        <div className="sc-name">{p.name}{signed && <span className="sc-signed" title="Signed">✓</span>}</div>
        <div className="sc-line">{p.div_code} · {line.thru ? `${toParText(line.toPar)} thru ${line.thru}` : 'no scores yet'}</div>
      </div>
      <div className="sc-ctl">
        <button type="button" className="sc-pm" aria-label={`${p.name} minus one`} disabled={locked} onClick={() => onSet(bump(v, hole.par, -1))}>−</button>
        <button type="button" className={`sc-tile tone-${tileTone(v, hole.par)}`} disabled={locked}
          aria-label={v == null ? `${p.name}: tap to save par ${hole.par}` : `${p.name}: ${v} strokes`}
          onClick={() => { if (v == null) onSet(hole.par); }}>
          {v ?? hole.par}
        </button>
        <button type="button" className="sc-pm" aria-label={`${p.name} plus one`} disabled={locked} onClick={() => onSet(bump(v, hole.par, 1))}>+</button>
      </div>
    </li>
  );
}

function SignPanel({ token, snap, scores, state, signed, onDone }: {
  token: string; snap: CardSnapshot; scores: ScoreMap; state: ReturnType<typeof signState>; signed: number; onDone: () => Promise<void>;
}) {
  const [ini, setIni] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const canSign = state === 'signing' || state === 'ready';

  const run = async (key: string, fn: () => Promise<string>, ok: string[]) => {
    setBusy(key); setMsg('');
    try {
      const r = await fn();
      if (!ok.includes(r)) setMsg(resultMessage(r));
      await onDone();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const sign = (p: CardPlayer) => {
    const v = cleanInitials(ini[p.id] ?? '');
    if (!v) return setMsg('Initials: 1 to 4 letters.');
    void run(p.id, () => signCard(token, p.id, v), ['signed']);
  };

  return (
    <section className={`sc-sign${state === 'submitted' ? ' is-done' : ''}`} aria-label="Sign-off">
      <h2>Sign-off</h2>
      <CardTable snap={snap} scores={scores} />
      <p className="sc-sign-status" role="status">{signStatusLine(state, signed, snap.players.length)}</p>
      {state !== 'submitted' && (
        <ul className="sc-sign-list">
          {snap.players.map((p) => {
            const done = snap.signoffs[p.id];
            const line = playerLine(p.id, snap.holes, scores);
            return (
              <li key={p.id}>
                <span className="sc-sign-name">{p.name} <em>{line.strokes} ({toParText(line.toPar)})</em></span>
                {done ? <span className="sc-sign-ok">✓ {done}</span> : (
                  <span className="sc-sign-form">
                    <input aria-label={`${p.name} initials`} maxLength={4} autoCapitalize="characters" autoComplete="off" placeholder="ABC"
                      value={ini[p.id] ?? ''} disabled={!canSign} onChange={(e) => setIni({ ...ini, [p.id]: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter') sign(p); }} />
                    <button type="button" disabled={!canSign || !!busy} onClick={() => sign(p)}>{busy === p.id ? '…' : 'Sign'}</button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {state !== 'submitted' && <p className="sc-note">Signing says this whole card is right. Check every hole above first.</p>}
      {msg && <p className="sc-err" role="alert">{msg}</p>}
      {state === 'ready' && (
        <button type="button" className="sc-next" disabled={!!busy}
          onClick={() => void run('submit', () => submitCard(token), ['submitted', 'already_submitted'])}>
          {busy === 'submit' ? 'SUBMITTING…' : 'SUBMIT CARD'}
        </button>
      )}
    </section>
  );
}

function CardTable({ snap, scores }: { snap: CardSnapshot; scores: ScoreMap }) {
  const short = shortNames(snap.players);
  return (
    <div className="sc-table-wrap">
      <table className="sc-table">
        <thead>
          <tr><th scope="col">Hole</th>{snap.holes.map((h) => <th key={h.n} scope="col">{h.n}</th>)}<th scope="col">Tot</th></tr>
          <tr className="sc-par"><th scope="row">Par</th>{snap.holes.map((h) => <td key={h.n}>{h.par}</td>)}<td>{snap.holes.reduce((a, h) => a + h.par, 0)}</td></tr>
        </thead>
        <tbody>
          {snap.players.map((p) => {
            const line = playerLine(p.id, snap.holes, scores);
            return (
              <tr key={p.id}>
                <th scope="row">{short[p.id]}</th>
                {snap.holes.map((h) => {
                  const v = scores[p.id]?.[h.n];
                  return <td key={h.n} className={`tone-${tileTone(v, h.par)}`}>{v ?? '·'}</td>;
                })}
                <td className="sc-tot">{line.strokes}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TdUnlock({ cardId, onDone }: { cardId: string; onDone: () => Promise<void> }) {
  const [armed, setArmed] = useState(false);
  const [msg, setMsg] = useState('');
  const go = async () => {
    setMsg('');
    try {
      const r = await unlockCard(cardId);
      if (r === 'forbidden') setMsg('Your TD session expired. Sign in again at /td.');
      setArmed(false);
      await onDone();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <section className="sc-td">
      <span>TD tools</span>
      {armed
        ? <><button type="button" className="sc-td-go" onClick={() => void go()}>Yes, unlock: clears submission + all signatures</button>
            <button type="button" onClick={() => setArmed(false)}>Cancel</button></>
        : <button type="button" onClick={() => setArmed(true)}>TD: unlock card</button>}
      {msg && <p className="sc-err" role="alert">{msg}</p>}
    </section>
  );
}
