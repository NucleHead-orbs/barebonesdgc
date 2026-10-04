/**
 * /room/:token: the tag room. One shared link per tag set. Tap your name, your tag activates (first come, first
 * numbered) and this phone becomes your My Tag. Everything is room_get / room_activate checked against the link.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as room from '../../lib/tags/room';
import { TAG_ART } from '../../lib/tags/tags';
import { ME_KEY } from '../../lib/rounds/rounds';
import { DigitalTag } from '../../components/DigitalTag';
import { useTheme } from '../../lib/theme';
import '../td/td.css';
import './mytag.css';
import './room.css';

const POLL_MS = 15_000; // taken tiles update while the room is open

export default function TagRoom() {
  const { token = '' } = useParams();
  const [data, setData] = useState<room.Room | null>(null);
  const [fatal, setFatal] = useState('');
  const [err, setErr] = useState('');
  const [pick, setPick] = useState<room.RoomTile | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ number: number; token: string; name: string } | null>(null);
  useTheme('event', 'bone');

  const load = useCallback(async () => {
    const r = await room.getRoom(token);
    if (r.error || !r.data) { setFatal(room.roomMessage(r.error)); return; }
    setData(r.data); setFatal('');
  }, [token]);
  useEffect(() => {
    void (async () => { await load(); })();
    const tick = () => { if (document.visibilityState === 'visible') void load(); };
    const t = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [load]);

  const go = async () => {
    if (!pick) return;
    setBusy(true);
    const r = await room.activate(token, pick.member_id);
    setBusy(false);
    if (r.error || !r.data) { setErr(room.roomMessage(r.error)); setPick(null); await load(); return; }
    try { localStorage.setItem(ME_KEY, r.data.token); } catch { /* the button below still opens it */ }
    setDone(r.data); setPick(null); setErr('');
    await load();
  };

  if (fatal) return <div className="td"><main className="td-main mt-app"><div className="td-warn" role="alert">{fatal}</div></main></div>;
  if (!data) return <div className="td"><main className="td-main mt-app"><p className="td-empty">Opening the room…</p></main></div>;

  const art = TAG_ART[data.pool.slug];
  const active = data.tiles.filter((t) => t.active).length;

  return (
    <div className="td">
      <header className="td-top">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <div className="td-title">{data.pool.name} Tag Room</div>
          <div className="td-sub">{active} OF {data.tiles.length} TAGS ACTIVE · FIRST COME, FIRST NUMBERED</div>
        </div>
      </header>
      <main className="td-main rm-app">
        {err && <div className="td-warn" role="alert">{err} <button className="td-btn quiet" onClick={() => setErr('')}>OK</button></div>}

        {done ? (
          <section className="td-panel rm-done">
            <h2>You're #{done.number}!</h2>
            {art && <div className="mt-dtag rm-done-tag"><DigitalTag art={art} number={done.number} label={data.pool.name} /></div>}
            <p className="td-hint">Your {data.pool.name} tag is live. This phone is now your My Tag: your tags, rounds to confirm, and the link to the Scorecard. Bookmark it or add it to your home screen. Don't share it.</p>
            <div className="td-row">
              <Link className="td-btn cta" to={`/tag/${done.token}`}>OPEN MY TAG</Link>
              <Link className="td-btn quiet" to={`/tags/${data.pool.slug}`}>SEE THE BOARD</Link>
            </div>
          </section>
        ) : (
          <>
            {!data.open && <div className="td-warn soft">The room is closed right now. Ask an admin to open it.</div>}
            {data.open && <p className="rm-lead">Tap your name. Your tag activates right away and gets the next number.</p>}
            <div className="rm-grid">
              {data.tiles.map((t) => (
                <button key={t.member_id} type="button" className={`rm-tile${t.active ? ' is-active' : ''}`} disabled={t.active || !data.open}
                  onClick={() => setPick(t)} aria-label={t.active ? `${room.tileTitle(t)}: tag #${t.number ?? '?'} active` : `I'm ${room.tileTitle(t)}`}>
                  {art && <img className="rm-tile-art" src={art.front} alt="" draggable={false} />}
                  <b className="rm-tile-name">{room.tileTitle(t)}</b>
                  {t.nickname && <span className="rm-tile-sub">{t.name}</span>}
                  <span className="rm-tile-state">{t.active ? `#${t.number ?? '?'} ✓` : 'TAP TO ACTIVATE'}</span>
                </button>
              ))}
            </div>
            {!data.tiles.length && <p className="td-empty">Nobody's on the list yet.</p>}
          </>
        )}

        {pick && (
          <div className="rm-sheet" role="dialog" aria-modal="true" aria-label="Confirm your name">
            <div className="td-panel rm-sheet-card">
              <h2>You're {room.tileTitle(pick)}?</h2>
              <p className="td-hint">This can only be done once. Your tag activates now and this phone becomes {pick.name}'s My Tag.</p>
              <div className="td-row">
                <button className="td-btn cta" disabled={busy} onClick={() => void go()}>{busy ? 'ACTIVATING…' : "YES, THAT'S ME"}</button>
                <button className="td-btn quiet" disabled={busy} onClick={() => setPick(null)}>NO</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
