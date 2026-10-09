/** TD home, super admin: the club's default skin for My Tag, the Scorecard and the TD Builder (a season or holiday). */
import { useState } from 'react';
import { SKINS, arizonaToday, setClubDefault, skinMessage, skinOf, useSkin, type SkinId } from '../../lib/skins';
import { Mini } from '../../components/skins/SkinPicker';
import { niceDate } from '../../lib/leagues/leagues';

/** Re-mounts when the club default arrives from the server, so the form starts from what's live. */
export default function ClubSkinPanel() {
  const { dflt } = useSkin();
  return <Panel key={`${dflt?.skin ?? ''}:${dflt?.until ?? ''}`} />;
}

function Panel() {
  const { dflt } = useSkin();
  const [skin, setSkin] = useState<SkinId>(dflt?.skin ?? 'night');
  const [until, setUntil] = useState(dflt?.until ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const today = arizonaToday();
  const save = async () => {
    setBusy(true);
    const r = await setClubDefault(skin, until || null);
    setBusy(false);
    setMsg(r.error ? { ok: false, text: skinMessage(r.error) }
      : { ok: true, text: `Club skin is ${skinOf(r.data.skin).name}${r.data.until ? ` through ${niceDate(r.data.until)}, then Night Card` : ''}. Phones that picked their own keep it.` });
  };
  return (
    <section className="td-panel">
      <h2>Club skin</h2>
      <p className="td-hint">What My Tag, the Scorecard and the TD Builder wear for everyone who hasn't picked their own. Set an end date for a season and it switches back to Night Card on its own.</p>
      <div className="td-grid" role="radiogroup" aria-label="Club skin" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
        {SKINS.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={skin === s.id} className="sk-opt" style={{ gridTemplateColumns: '64px minmax(0, 1fr)' }} onClick={() => setSkin(s.id)}>
            <Mini s={s} /><span><b>{s.name}</b></span>
          </button>
        ))}
      </div>
      <div className="td-row">
        <label className="td-inline">Last day <input className="td-input" type="date" min={today} value={until} onChange={(e) => setUntil(e.target.value)} aria-label="Last day of the club skin (blank = until changed)" /></label>
        {until && <button className="td-btn quiet" onClick={() => setUntil('')}>NO END DATE</button>}
        <button className="td-btn cta" disabled={busy} onClick={() => void save()}>{busy ? 'SAVING…' : 'SET CLUB SKIN'}</button>
      </div>
      {msg && <div className={msg.ok ? 'td-ok' : 'td-warn'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
    </section>
  );
}
