import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { supabase, syncScores } from '../../lib/supabase';
import { ScoreQueue, deviceId, type QueuedScore, type RejectedScore } from '../../lib/offline/queue';
import { useTheme } from '../../lib/theme';
import {
  bump, cardComplete, cleanInitials, firstOpenHole, holeDone, holeOrder, mergeScores, playerLine,
  resultMessage, shortNames, signState, signStatusLine, tileTone, toParText, type CardPlayer, type HoleInfo, type ScoreMap,
} from '../../lib/scorecard/logic';
import { CardError, cachedCard, fetchCard, r2Set, r2Status, signCard, submitCard, unlockCard, type CardSnapshot, type R2Status } from '../../lib/scorecard/api';
import { handoffKey, handoffStep, handoffUrl, holesDone } from '../../lib/scorecard/handoff';
import './card.css';

const queue = new ScoreQueue();
const readLs = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeLs = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode: handoff still works, this phone just won't remember it */ } };
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
  const [params, setParams] = useSearchParams();
  // opened from a handoff QR: this phone has the card now (and if it handed off earlier, it just got it back)
  const [welcome, setWelcome] = useState(() => params.get('handoff') === '1');
  const [handed, setHanded] = useState(() => params.get('handoff') !== '1' && !!readLs(handoffKey(token)));
  const [sheet, setSheet] = useState(false);
  useEffect(() => { if (params.get('handoff') === '1') writeLs(handoffKey(token), null); }, [params, token]);
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
  const watching = handed && !locked;

  const tap = async (pid: string, strokes: number) => {
    if (locked || watching) return;
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

      {welcome && !locked && (
        <div className="sc-handoff-hi" role="status">
          <b>You've got the card.</b> Every score so far is loaded (thru {holesDone(order, snap.players.map((p) => p.id), scores)} of {order.length}). Pick up on hole {current}.
          <button type="button" onClick={() => { setWelcome(false); setParams({}, { replace: true }); }}>GOT IT</button>
        </div>
      )}
      {watching && (
        <div className="sc-handoff-watch" role="status">
          <b>You handed this card off.</b> Watching only: scores update every 20 seconds.
          <button type="button" onClick={() => { writeLs(handoffKey(token), null); setHanded(false); }}>Take the card back</button>
        </div>
      )}

      <section className="sc-hole" aria-label={`Hole ${info.n}`}>
        <button type="button" className="sc-arrow" aria-label="Previous hole" onClick={() => go(-1)}>‹</button>
        <div className="sc-hole-mid">
          <h1 className="sc-hole-n">Hole {info.n}</h1>
          <div className="sc-hole-meta">PAR {info.par}{info.dist_ft ? ` · ${info.dist_ft} FT` : ''}</div>
          {info.ob && <div className="sc-hole-ob">OB: {info.ob}</div>}
          {info.ctp_prize && <div className="sc-ctp-tag" role="status"><CtpTarget /> CTP · {info.ctp_prize}</div>}
        </div>
        <button type="button" className="sc-arrow" aria-label="Next hole" onClick={() => go(1)}>›</button>
      </section>

      {info.ctp_prize && <CtpFlash key={info.n} prize={info.ctp_prize} />}

      <nav className="sc-dots" aria-label="Holes">
        {order.map((n) => (
          <button key={n} type="button" aria-label={`Hole ${n}`} aria-current={n === current ? 'step' : undefined}
            className={`sc-dot${n === current ? ' is-cur' : holeDone(snap.players, scores, n) ? ' is-done' : ''}`}
            onClick={() => setHole(n)}>{n}</button>
        ))}
      </nav>

      <ul className={`sc-players${locked ? ' is-locked' : ''}`}>
        {snap.players.map((p) => (
          <PlayerRow key={p.id} p={p} hole={info} scores={scores} holes={snap.holes} locked={locked || watching}
            signed={!!snap.signoffs[p.id]} onSet={(n) => void tap(p.id, n)} />
        ))}
      </ul>
      {complete || locked ? null : (
        <button type="button" className="sc-next" onClick={() => go(1)}>NEXT HOLE ›</button>
      )}
      {!locked && signed > 0 && <p className="sc-note">Changing any score clears every signature on the card.</p>}

      {(complete || locked) && !watching && (
        <SignPanel token={token} snap={snap} scores={scores} state={state} signed={signed} onDone={sync} />
      )}
      {snap.submitted && <R2Ask token={token} players={snap.players} />}
      {td && (snap.submitted || signed > 0) && <TdUnlock cardId={snap.card.id} onDone={sync} />}
      {!locked && !watching && <button type="button" className="sc-handoff" onClick={() => setSheet(true)}>HAND THE CARD OFF</button>}
      {sheet && <HandoffSheet token={token} pending={pending.length} online={online} sync={sync}
        onClose={() => setSheet(false)} onDone={() => { writeLs(handoffKey(token), new Date().toISOString()); setHanded(true); setSheet(false); }} />}
      <a className="sc-board" href={snap.event ? `/e/${snap.event.slug}` : '/jewel'}>Live leaderboard ›</a>
    </Shell>
  );
}

/** Concentric target, drawn (no image). */
function CtpTarget({ big }: { big?: boolean }) {
  return (
    <svg className={big ? 'sc-ctp-target big' : 'sc-ctp-target'} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="18" /><circle cx="20" cy="20" r="12" /><circle cx="20" cy="20" r="6" /><circle className="dot" cx="20" cy="20" r="2.5" />
    </svg>
  );
}

/** Plays once each time a CTP hole comes up (remounted per hole via key). Pure CSS: never blocks a tap. */
function CtpFlash({ prize }: { prize: string }) {
  return (
    <div className="sc-ctp-flash" aria-hidden="true">
      <div className="sc-ctp-card">
        <span className="sc-ctp-ring" /><span className="sc-ctp-ring r2" />
        <CtpTarget big />
        <b>CTP HOLE</b>
        <span className="sc-ctp-prize">{prize}</span>
        <small>Closest to the pin takes it</small>
      </div>
    </div>
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

/**
 * Pass the scoring to a cardmate: make sure every tap on this phone is saved, then show the card's QR for them to scan.
 * Their phone opens the same card (/c/:token); this phone goes watch-only once "Done" is tapped.
 */
function HandoffSheet({ token, pending, online, sync, onClose, onDone }: {
  token: string; pending: number; online: boolean; sync: () => Promise<void>; onClose: () => void; onDone: () => void;
}) {
  const [checking, setChecking] = useState(true);
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const url = handoffUrl(location.origin, token);
  const check = useCallback(async () => { setChecking(true); await sync(); setChecking(false); }, [sync]);
  useEffect(() => { void (async () => { await check(); })(); }, [check]);
  useEffect(() => { void QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(setQr); }, [url]);
  const step = handoffStep({ checking, pending });
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Scorecard', url });
      else { await navigator.clipboard.writeText(url); setCopied(true); }
    } catch { /* closed the share sheet */ }
  };
  return (
    <div className="sc-sheet" role="dialog" aria-modal="true" aria-labelledby="sc-handoff-h">
      <div className="sc-sheet-box">
        <h2 id="sc-handoff-h">Hand the card off</h2>
        {step === 'syncing' && <p>Saving every score on this phone first…</p>}
        {step === 'unsynced' && <>
          <p className="sc-sheet-warn"><b>{pending} score{pending === 1 ? ' is' : 's are'} only on this phone.</b> {online ? 'Still sending.' : 'No signal right now.'} The next scorer won't see {pending === 1 ? 'it' : 'them'} until {pending === 1 ? 'it saves' : 'they save'}. Step toward signal and try again.</p>
          <button type="button" className="sc-next" onClick={() => void check()}>TRY AGAIN</button>
        </>}
        {step === 'ready' && <>
          <p>All scores are saved. Have the next scorer point their camera here. (The QR on the paper card works too.)</p>
          <div className="sc-qr" aria-label="Scorecard QR code" dangerouslySetInnerHTML={{ __html: qr }} />
          <button type="button" className="sc-sheet-link" onClick={() => void share()}>{copied ? 'Link copied' : 'Text or copy the link instead'}</button>
          <button type="button" className="sc-next" onClick={onDone}>DONE: THEY'VE GOT IT</button>
          <p className="sc-note">This phone switches to watching only. You can take the card back any time.</p>
        </>}
        <button type="button" className="sc-sheet-close" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

/**
 * After a Round 1 card is submitted (2-round events): "Playing Round 2?" for each player on the card.
 * Only players who say IN get Round 2 cards. Answers lock once that player is on a published Round 2 card.
 */
function R2Ask({ token, players }: { token: string; players: CardPlayer[] }) {
  const [st, setSt] = useState<R2Status | null>(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => { try { setSt(await r2Status(token)); setMsg(''); } catch { setMsg('No signal: answers will load when you have a bar.'); } }, [token]);
  useEffect(() => { void (async () => { await load(); })(); }, [load]);
  if (!st?.asks) return msg ? <p className="sc-note">{msg}</p> : null;
  if (!st.open) return null;
  const answer = async (id: string, v: boolean) => {
    setSt((s) => (s ? { ...s, players: s.players.map((p) => (p.id === id ? { ...p, r2_in: v } : p)) } : s));
    try {
      const r = await r2Set(token, id, v);
      if (r === 'r2_closed') setMsg('Round 2 cards are already out for that player. Tell the check-in table.');
      await load();
    } catch { setMsg('No signal: that answer didn\'t save. Try again.'); await load(); }
  };
  const waiting = st.players.filter((p) => p.r2_in == null).length;
  return (
    <section className="sc-r2" aria-label="Playing Round 2?">
      <h2>Playing Round 2?</h2>
      <p>Only players who tap <b>IN</b> get a Round 2 card. {waiting ? `${waiting} still to answer.` : 'Everyone answered. Thanks!'}</p>
      <ul>
        {st.players.map((p) => {
          const name = players.find((x) => x.id === p.id)?.name ?? 'Player';
          return (
            <li key={p.id}>
              <b>{name}</b>
              {p.locked ? <span className="sc-r2-locked">{p.r2_in === false ? 'Out' : 'On a Round 2 card'}</span> : (
                <span className="sc-r2-btns">
                  <button type="button" aria-pressed={p.r2_in === true} className="in" onClick={() => void answer(p.id, true)}>{p.r2_in === true ? '✓ IN' : 'IN'}</button>
                  <button type="button" aria-pressed={p.r2_in === false} className="out" onClick={() => void answer(p.id, false)}>OUT</button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {msg && <p className="sc-note">{msg}</p>}
    </section>
  );
}
