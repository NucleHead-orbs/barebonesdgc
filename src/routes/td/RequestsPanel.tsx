import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import * as api from '../../lib/td/api';
import { rpcError, type ExistingPlayer } from '../../lib/td/builder';
import { ago, requestLine } from '../../lib/td/requests';
import { PlayerPicker } from './PlayerPicker';

const publicOrigin = (): string =>
  (import.meta.env.VITE_PUBLIC_ORIGIN as string | undefined)?.trim() || window.location.origin;

/**
 * Requests tab: "put me on a card with …". Players send them from the table QR (/e/<slug>/request);
 * the TD approves or declines. Only approved requests shape Round 1 cards. Hand-added ones land approved.
 */
export default function RequestsPanel({ setup, players, requests, onReload }: {
  setup: api.EventSetup; players: ExistingPlayer[]; requests: api.CardRequest[]; onReload: () => Promise<void>;
}) {
  const ev = setup.event;
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const nameOf = (id: string) => byId.get(id)?.name;
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [showDeclined, setShowDeclined] = useState(false);
  const [sign, setSign] = useState(false);
  const [pick, setPick] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, []);

  const act = async (key: string, fn: () => Promise<{ error?: unknown }>) => {
    setBusy(key); setErr('');
    const r = await fn();
    await onReload();
    setBusy('');
    if (r.error) setErr(rpcError(r.error).message);
  };

  const add = () => {
    if (pick.length < 2) return setErr('Pick at least 2 players.');
    void act('add', () => api.addRequest(ev.id, pick, note.trim())).then(() => { setPick([]); setNote(''); });
  };

  if (sign) return <RequestSign url={`${publicOrigin()}/e/${ev.slug}/request`} eventName={ev.name} onBack={() => setSign(false)} />;

  const by = (s: api.RequestStatus) => requests.filter((r) => r.status === s);
  const fresh = by('new');
  const approved = by('approved');
  const declined = by('declined');
  const notIn = (r: api.CardRequest) => ev.use_checkin ? r.players.filter((id) => byId.get(id) && !byId.get(id)!.checked_in).map((id) => byId.get(id)!.name) : [];

  const row = (r: api.CardRequest) => {
    const missing = notIn(r);
    return (
      <div key={r.id} className={`td-req td-req-${r.status}`}>
        <div className="td-req-main">
          <b>{requestLine(r.players, nameOf)}</b>
          <span className="td-hint">{r.source === 'td' ? 'added by TD' : r.source === 'crew' ? 'from the crew' : 'from the QR'} · {ago(r.created_at, now)}</span>
          {r.note && <span className="td-req-note">“{r.note}”</span>}
          {missing.length > 0 && <span className="td-req-warn">Not checked in yet: {missing.join(', ')}</span>}
        </div>
        <div className="td-actions">
          {r.status === 'new' && <>
            <button className="td-btn cta" disabled={!!busy} onClick={() => void act(r.id, () => api.setRequestStatus(r.id, 'approved'))}>✓ APPROVE</button>
            <button className="td-btn" disabled={!!busy} onClick={() => void act(r.id, () => api.setRequestStatus(r.id, 'declined'))}>✗ DECLINE</button>
          </>}
          {r.status !== 'new' && <button className="td-btn quiet" disabled={!!busy} onClick={() => void act(r.id, () => api.setRequestStatus(r.id, 'new'))}>UNDO</button>}
          {r.status === 'approved' && <button className="td-btn quiet" disabled={!!busy} onClick={() => void act(r.id, () => api.deleteRequest(r.id))}>REMOVE</button>}
        </div>
      </div>
    );
  };

  return (
    <main className="td-main">
      <div className="td-row">
        <h2 className="td-h2">Card requests</h2>
        <div style={{ flex: 1 }} />
        <button className="td-btn gold" onClick={() => setSign(true)}>PRINT TABLE QR</button>
      </div>
      <p className="td-hint">
        Players scan the table QR, pick themselves and who they want to play with. It shows up here, no line-stopping.
        Approved requests are seated together when you generate Round 1. New ones show up on their own every 20 seconds.
      </p>
      {err && <div className="td-warn" role="alert">{err}</div>}

      <section className="td-group">
        <div className="td-label">NEW · {fresh.length}</div>
        {!fresh.length && <div className="td-hint">Nothing waiting.</div>}
        {fresh.map(row)}
      </section>

      <section className="td-group">
        <div className="td-label">APPROVED · {approved.length}</div>
        {!approved.length && <div className="td-hint">None yet.</div>}
        {approved.map(row)}
      </section>

      <section className="td-panel td-form">
        <h2>Add one by hand</h2>
        <PlayerPicker players={players} picked={pick} max={5} onChange={setPick} placeholder="Type a name, tap to add (2–5 players)…" />
        <input className="td-input" value={note} maxLength={140} placeholder="Note (optional)" onChange={(e) => setNote(e.target.value)} />
        <div className="td-actions"><button className="td-btn cta" onClick={add} disabled={busy === 'add' || pick.length < 2}>ADD (APPROVED)</button></div>
      </section>

      {declined.length > 0 && (
        <section className="td-group">
          <button className="td-link" onClick={() => setShowDeclined(!showDeclined)}>{showDeclined ? 'Hide' : 'Show'} declined ({declined.length})</button>
          {showDeclined && declined.map(row)}
        </section>
      )}
    </main>
  );
}

/** Printable table sign: one big QR to the player request page. */
function RequestSign({ url, eventName, onBack }: { url: string; eventName: string; onBack: () => void }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let live = true;
    void QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then((s) => { if (live) setSvg(s); });
    return () => { live = false; };
  }, [url]);
  return (
    <div className="td-qr">
      <div className="td-row td-noprint">
        <button className="td-btn" onClick={onBack}>‹ BACK TO REQUESTS</button>
        <div style={{ flex: 1 }} />
        <button className="td-btn cta" onClick={() => window.print()} disabled={!svg}>PRINT</button>
      </div>
      <div className="td-sign">
        <div className="td-sign-event">{eventName}</div>
        <h1>Want to play with someone?</h1>
        <p>Scan this, pick your name and who you want on your card. The TD gets it. No need to wait in line.</p>
        <div className="td-sign-qr" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="td-sign-url">{url}</div>
      </div>
    </div>
  );
}
