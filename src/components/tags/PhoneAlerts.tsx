/** My Tag → PHONE ALERTS: turn push alerts on for this phone, pick which kinds, send a test. Rules: migration 20261118. */
import { useCallback, useEffect, useState } from 'react';
import { PUSH_KINDS, currentSub, pushMessage, pushPrefs, pushStatus, pushSupport, pushTest, turnOff, turnOn, type PushKind, type PushStatus } from '../../lib/tags/push';

export function PhoneAlerts({ token, onInstall }: { token: string; onInstall: () => void }) {
  const [support] = useState(pushSupport);
  const [st, setSt] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const sub = support === 'ok' ? await currentSub() : null;
    const r = await pushStatus(token, sub?.endpoint ?? null);
    if (r.data) setSt(r.data);
  }, [token, support]);
  useEffect(() => { void (async () => { await load(); })(); }, [load]);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 5000); return () => clearTimeout(t); }, [msg]);

  const go = async (f: () => Promise<unknown>, done: string) => {
    setBusy(true); setErr('');
    try { await f(); setMsg(done); } catch (e) { setErr(pushMessage(e)); }
    setBusy(false); await load();
  };
  const flip = (k: PushKind) => {
    if (!st) return;
    const off = st.off.includes(k) ? st.off.filter((x) => x !== k) : [...st.off, k];
    setSt({ ...st, off });
    void (async () => { const r = await pushPrefs(token, off); if (r.error) { setErr(pushMessage(r.error)); await load(); } })();
  };

  const on = !!st?.device;
  return (
    <section className={`td-panel pa${on ? ' is-on' : ''}`}>
      <div className="td-row">
        <h2 style={{ margin: 0 }}>Phone alerts</h2>
        <span className={`pa-dot${on ? ' on' : ''}`}>{on ? 'ON FOR THIS PHONE' : 'OFF'}</span>
      </div>
      {support === 'install-first' && <>
        <p className="td-hint">On iPhone, alerts only work from the home-screen app. Add My Tag to your home screen, open it from the new icon, then turn alerts on in there.</p>
        <button className="td-btn cta" onClick={onInstall}>ADD MY TAG TO HOME SCREEN</button>
      </>}
      {support === 'unsupported' && <p className="td-hint">This browser can't do push alerts. Chrome on Android, or the My Tag home-screen app on iPhone (iOS 16.4+), can.</p>}
      {support === 'blocked' && <p className="td-hint">Alerts are blocked for this site. Allow notifications for it in your phone or browser settings, then come back here.</p>}
      {support === 'ok' && !on && <>
        <p className="td-hint">Get a buzz when someone challenges you, answers your challenge, picks a tee time, @mentions or replies to you, invites you to a round, needs your confirm, or your fuse is about to blow.</p>
        <button className="td-btn cta" disabled={busy} onClick={() => void go(() => turnOn(token), 'Alerts are on. Sending a test…').then(async () => { await pushTest(token); })}>
          {busy ? 'TURNING ON…' : 'TURN ON PHONE ALERTS'}
        </button>
      </>}
      {support === 'ok' && on && st && <>
        <div className="td-row">
          <button className="td-btn quiet" aria-expanded={open} onClick={() => setOpen((x) => !x)}>{open ? 'HIDE' : 'CHOOSE'} ALERTS ({PUSH_KINDS.length - st.off.length}/{PUSH_KINDS.length})</button>
          <button className="td-btn quiet" disabled={busy} onClick={() => void go(async () => { const r = await pushTest(token); if (r.error) throw r.error; }, 'Test sent. It should land in a few seconds.')}>SEND A TEST</button>
          <button className="td-btn quiet" disabled={busy} onClick={() => void go(() => turnOff(token), 'Alerts are off for this phone.')}>TURN OFF</button>
        </div>
        {open && (
          <div className="pa-kinds">
            {PUSH_KINDS.map((k) => (
              <button key={k.kind} type="button" className="td-toggle" aria-pressed={!st.off.includes(k.kind)} onClick={() => flip(k.kind)}>
                <span className="track"><span className="knob" /></span><span>{k.label}</span>
              </button>
            ))}
            {st.devices > 1 && <p className="td-hint">These choices cover all {st.devices} of your phones and browsers.</p>}
          </div>
        )}
      </>}
      {msg && <div className="td-ok" role="status">{msg}</div>}
      {err && <div className="td-warn" role="alert">{err}</div>}
    </section>
  );
}
