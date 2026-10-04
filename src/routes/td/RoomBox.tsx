/** Tag room admin (inside Bag Tags): the shared link, who gets a tile, reset a wrong tap. Every action is a td_room_* RPC. */
import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import * as room from '../../lib/tags/room';
import type { AdminMember } from '../../lib/tags/api';
import type { Tag, TagPool } from '../../lib/tags/tags';
import { niceDate } from '../../lib/leagues/leagues';

export default function RoomBox({ pool, members, held, onTags }: { pool: TagPool; members: AdminMember[]; held: Tag[]; onTags: () => Promise<void> }) {
  const [d, setD] = useState<room.RoomAdmin | null>(null);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState('');
  const [who, setWho] = useState('');
  const [name, setName] = useState('');
  const [nick, setNick] = useState('');

  const load = useCallback(async () => {
    const r = await room.adminRoom(pool.id);
    if (r.error || !r.data) return setErr(room.roomMessage(r.error));
    setD(r.data); setErr('');
  }, [pool.id]);
  useEffect(() => { void (async () => { await load(); })(); }, [load]);
  const url = d?.token ? room.roomUrl(window.location.origin, d.token) : '';
  useEffect(() => { if (url) void QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(setQr); }, [url]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t); }, [toast]);

  const run = async (p: () => Promise<{ error?: unknown }>, ok?: string) => {
    setBusy(true);
    const r = await p();
    setBusy(false);
    if (r.error) { setErr(room.roomMessage(r.error)); return false; }
    setErr(''); if (ok) setToast(ok);
    await Promise.all([load(), onTags()]);
    return true;
  };
  const copy = async () => { try { await navigator.clipboard.writeText(url); setToast('Room link copied.'); } catch { window.prompt('Copy the room link:', url); } };

  if (!d) return null;
  if (!d.on) {
    return (
      <section className="td-panel">
        <h2>Tag room</h2>
        <p className="td-hint">One link for the whole crew instead of one per person. Everyone you add gets a tile with their name. They tap it, their tag activates with the next number (first come, first numbered), and their phone becomes their My Tag.</p>
        {err && <div className="td-warn" role="alert">{err}</div>}
        <button className="td-btn cta" disabled={busy} onClick={() => void run(() => room.startRoom(pool.id), 'Room open.')}>OPEN A TAG ROOM</button>
      </section>
    );
  }

  const invites = d.invites ?? [];
  const tapped = invites.filter((i) => i.activated_at).length;
  const invitedIds = new Set(invites.map((i) => i.member_id));
  const holderIds = new Set(held.map((t) => t.holder_id));
  const pickable = members.filter((m) => !invitedIds.has(m.id) && !holderIds.has(m.id));

  return (
    <section className="td-panel">
      <div className="td-row">
        <h2 style={{ flex: 1 }}>Tag room</h2>
        <span className="td-hint">{tapped} of {invites.length} tapped in</span>
      </div>
      {toast && <div className="td-ok" role="status">{toast}</div>}
      {err && <div className="td-warn" role="alert">{err} <button className="td-btn quiet" onClick={() => setErr('')}>OK</button></div>}
      <div className="tp-link">
        <div className="td-crew-qr" dangerouslySetInnerHTML={{ __html: qr }} aria-label={`QR code for the ${pool.name} room`} />
        <div className="tp-link-body">
          <b>{pool.name} room link {d.open ? '' : '(CLOSED)'}</b>
          <span className="td-hint">Send this one link to the group. Anyone holding it can tap any open tile, so keep it in the crew. Wrong tile tapped? <b>RESET</b> it below: the tag goes back in the pot and that person gets a new My Tag link, so the wrong phone loses access.</span>
          <code className="tp-url">{url}</code>
          <div className="td-row">
            <button className="td-btn cyan" onClick={() => void copy()}>COPY LINK</button>
            <a className="td-btn" href={url} target="_blank" rel="noreferrer">OPEN ROOM ↗</a>
            <button className="td-btn quiet" disabled={busy} onClick={() => void run(() => room.setOpen(pool.id, !d.open), d.open ? 'Room closed.' : 'Room open.')}>{d.open ? 'CLOSE ROOM' : 'OPEN ROOM'}</button>
            <button className="td-btn quiet" disabled={busy} onClick={() => { if (window.confirm('Replace the room link? The old one stops working right away.')) void run(() => room.newLink(pool.id), 'New room link. Send it again.'); }}>NEW LINK</button>
          </div>
        </div>
      </div>

      <form className="td-row" onSubmit={(e) => {
        e.preventDefault();
        const w = who ? { member: who } : { name, nickname: nick };
        void run(() => room.invite(pool.id, w), 'Added to the room.').then((ok) => { if (ok) { setWho(''); setName(''); setNick(''); } });
      }}>
        <select className="td-select" aria-label="Existing person" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">New person…</option>
          {pickable.map((m) => <option key={m.id} value={m.id}>{m.nickname ? `${m.name} (${m.nickname})` : m.name}</option>)}
        </select>
        {!who && <>
          <input className="td-input" placeholder="Name" aria-label="Name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          <input className="td-input" placeholder="Nickname (on the tile)" aria-label="Nickname" maxLength={40} value={nick} onChange={(e) => setNick(e.target.value)} />
        </>}
        <button className="td-btn cta" type="submit" disabled={busy || (!who && !name.trim())}>+ ADD TILE</button>
      </form>

      {invites.length > 0 && (
        <table className="td-table">
          <tbody>
            {invites.map((i) => (
              <tr key={i.member_id}>
                <td><b>{i.nickname || i.name}</b>{i.nickname ? <span className="td-hint"> {i.name}</span> : null}</td>
                <td>{i.activated_at ? `#${i.number ?? '?'} · ${niceDate(i.activated_at.slice(0, 10))}` : <span className="td-hint">waiting</span>}</td>
                <td style={{ textAlign: 'right' }}>
                  {i.activated_at
                    ? <button className="td-btn quiet" disabled={busy} onClick={() => { if (window.confirm(`Reset ${i.name}? Their tag #${i.number} goes back in the pot and they get a new My Tag link (the old one stops working).`)) void run(() => room.reset(pool.id, i.member_id), 'Reset. They can tap in again.'); }}>RESET</button>
                    : <button className="td-btn quiet" disabled={busy} onClick={() => void run(() => room.uninvite(pool.id, i.member_id), 'Tile removed.')}>REMOVE</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
