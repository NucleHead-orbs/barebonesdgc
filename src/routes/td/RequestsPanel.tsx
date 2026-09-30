import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import * as api from '../../lib/td/api';
import { rpcError, slotKey, toPublishPayload, type ExistingPlayer } from '../../lib/td/builder';
import { SEAT_REASON, ago, pairingFor, requestLine, seatRequest } from '../../lib/td/requests';
import { captainMap } from '../../lib/cards/doubles';
import { roundFormat } from '../../lib/td/setup';
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
  const [info, setInfo] = useState('');
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

  /**
   * Approved after Round 1 cards are published: seat them together now (swaps only, locked cards untouched, never once
   * scoring started) and republish. QR codes survive (they're tied to the start slot, not the players).
   */
  const seatNow = async (ids: string[], asked: api.CardRequest[]): Promise<string> => {
    const pub = await api.loadPublished(ev.id, 1);
    if (pub.error || !pub.data) return `Approved. Couldn't check Round 1 cards (${rpcError(pub.error).message}).`;
    if (!pub.data.cards.length) return 'Approved. They\'ll be seated together when you generate Round 1.';
    const dubs = roundFormat(ev, 1) === 'doubles';
    const [teams, priv] = await Promise.all([dubs ? api.loadTeams(ev.id, 1) : Promise.resolve({ data: [] as Array<[string, string | null]>, error: undefined }), api.loadPrivate(ev.id)]);
    if (teams.error || priv.error || !priv.data) return 'Approved. Couldn\'t load the draw / keep-apart list, so cards didn\'t change. Move them by hand in Cards.';
    const cap = captainMap(teams.data ?? []);
    const res = seatRequest(pub.data.cards, ids, {
      unitOf: (id) => cap.get(id) ?? id, max: dubs ? 6 : 5, keyOf: slotKey, nameOf: (id) => nameOf(id) ?? '?',
      pairing: pairingFor(asked, priv.data, 1),
    });
    if (!res.ok) return res.reason === 'already' ? 'Approved. They\'re already on the same card.' : `Approved, but not moved: ${SEAT_REASON[res.reason]}`;
    const r = await api.publishRound(ev.id, 1, toPublishPayload(res.cards), false);
    if (r.error || !r.data) {
      const m = rpcError(r.error, 1);
      return m.kind === 'has_scores' ? 'Approved. Round 1 is already being scored, so cards didn\'t change. Move them by hand if they haven\'t teed off.' : `Approved, but republishing failed: ${m.message}`;
    }
    const label = r.data.find((c) => c.wave === res.target.wave && c.start_hole === res.target.startHole && ids.every((id) => c.players.includes(id)))?.label ?? res.target.startHole;
    return `Approved and seated together on hole ${label} (${res.moved} moved). Round 1 republished; every QR code still works. Reprint only if you hand out printed player lists.`;
  };
  const approve = async (r: api.CardRequest) => {
    setBusy(r.id); setErr(''); setInfo('');
    const a = await api.setRequestStatus(r.id, 'approved');
    if (a.error) { await onReload(); setBusy(''); return setErr(rpcError(a.error).message); }
    const asked = requests.map((x) => (x.id === r.id ? { ...x, status: 'approved' as const } : x));
    const msg = await seatNow(r.players, asked);
    await onReload(); setBusy(''); setInfo(msg);
  };
  const add = () => {
    if (pick.length < 2) return setErr('Pick at least 2 players.');
    const ids = pick;
    setBusy('add'); setErr(''); setInfo('');
    void (async () => {
      const r = await api.addRequest(ev.id, ids, note.trim());
      if (r.error) { await onReload(); setBusy(''); return setErr(rpcError(r.error).message); }
      const msg = await seatNow(ids, [...requests, { id: 'new', status: 'approved', players: ids } as api.CardRequest]);
      await onReload(); setBusy(''); setInfo(msg); setPick([]); setNote('');
    })();
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
            <button className="td-btn cta" disabled={!!busy} onClick={() => void approve(r)}>{busy === r.id ? 'SEATING…' : '✓ APPROVE'}</button>
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
        Approving seats them together right away: if Round 1 cards are already out (and nobody has scored), they're swapped onto one card and Round 1 republishes (QR codes keep working). Before cards exist, they're seated together when you generate. In doubles their whole teams move. New ones show up on their own every 20 seconds.
      </p>
      {err && <div className="td-warn" role="alert">{err}</div>}
      {info && <div className={/^Approved and seated|already/.test(info) ? 'td-ok' : 'td-warn soft'} role="status">{info} <button className="td-btn quiet" onClick={() => setInfo('')}>OK</button></div>}

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
