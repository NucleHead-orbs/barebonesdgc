import { useState, type ChangeEvent } from 'react';
import * as api from '../../lib/td/api';
import { rpcError } from '../../lib/td/builder';

/**
 * Curate sponsors. DGS hole sponsors arrive here hidden; the TD sets the public name,
 * hole, tier and logo, then flips VISIBLE. Every change saves immediately (no Save button to forget).
 */
export default function SponsorsPanel({ eventId, holeCount, sponsors, onChange, onBack }: {
  eventId: string; holeCount: number; sponsors: api.Sponsor[];
  onChange: (next: api.Sponsor[]) => void; onBack: () => void;
}) {
  const [busy, setBusy] = useState<string>('');
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');

  const replace = (s: api.Sponsor) => onChange(sponsors.map((o) => (o.id === s.id ? s : o)));
  const save = async (s: api.Sponsor, patch: api.SponsorPatch) => {
    setBusy(s.id); setError('');
    const r = await api.updateSponsor(s.id, patch);
    setBusy('');
    if (r.error || !r.data) return setError(`${s.name}: ${rpcError(r.error).message}`);
    replace(r.data);
  };
  const onLogo = async (s: api.Sponsor, e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(s.id); setError('');
    const up = await api.uploadLogo(eventId, s.id, f);
    if (up.error || !up.data) { setBusy(''); return setError(`${s.name}: ${up.error instanceof Error ? up.error.message : rpcError(up.error).message}`); }
    await save(s, { logo_url: up.data });
  };
  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy('new'); setError('');
    const r = await api.addSponsor(eventId, name, Math.max(0, ...sponsors.map((s) => s.sort)) + 1);
    setBusy('');
    if (r.error || !r.data) return setError(rpcError(r.error).message);
    onChange([...sponsors, r.data]);
    setNewName('');
  };
  const remove = async (s: api.Sponsor) => {
    if (!window.confirm(`Delete ${s.name}? This can't be undone.`)) return;
    setBusy(s.id);
    const r = await api.deleteSponsor(s.id);
    setBusy('');
    if (r.error) return setError(rpcError(r.error).message);
    onChange(sponsors.filter((o) => o.id !== s.id));
  };

  const visible = sponsors.filter((s) => !s.hidden).length;
  const ordered = sponsors.slice().sort((a, b) => Number(!a.hidden) - Number(!b.hidden) || a.sort - b.sort);

  return (
    <div className="td-main">
      <div className="td-row">
        <button className="td-btn" onClick={onBack}>‹ BACK TO BUILDER</button>
        <div className="td-title">Sponsors</div>
        <div className="td-stat"><b>{sponsors.length}</b><span>TOTAL</span></div>
        <div className="td-stat"><b style={{ color: 'var(--under)' }}>{visible}</b><span>VISIBLE</span></div>
        <div className="td-stat"><b style={{ color: sponsors.length - visible ? 'var(--gold)' : '#fff' }}>{sponsors.length - visible}</b><span>WAITING</span></div>
        <div style={{ flex: 1 }} />
        <a className="td-btn cyan" href="/jewel#info" target="_blank" rel="noreferrer">VIEW PUBLIC PAGE</a>
      </div>
      <div className="td-hint">Hole sponsors from Disc Golf Scene land here hidden. Set the name people should see, the hole, and a logo, then switch on Visible. Re-importing DGS never overwrites these edits.</div>
      {error && <div className="td-warn" role="alert">⚠ {error}</div>}
      <div className="td-row">
        <input className="td-input" style={{ flex: 1, maxWidth: 360 }} placeholder="Add a sponsor by hand (e.g. Innova)" value={newName}
          onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void add(); }} />
        <button className="td-btn cta" onClick={() => void add()} disabled={!newName.trim() || busy === 'new'}>ADD SPONSOR</button>
      </div>
      {!sponsors.length && <div className="td-empty">No sponsors yet. Import the DGS CSV or add one by hand.</div>}
      <div className="td-sponsors">
        {ordered.map((s) => (
          <div key={s.id} className={`td-sponsor${s.hidden ? ' waiting' : ''}`} aria-busy={busy === s.id}>
            <label className="td-logo" title="Upload logo or photo (PNG, JPG or WebP, any size: it is shrunk for the web)">
              {s.logo_url ? <img src={s.logo_url} alt="" /> : <span>+ LOGO</span>}
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => void onLogo(s, e)} disabled={!!busy} />
            </label>
            <div className="td-sponsor-fields">
              <input className="td-input" aria-label="Public name" defaultValue={s.name} key={`n${s.id}${s.name}`}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.name) void save(s, { name: v }); }} />
              <div className="td-row" style={{ gap: 8 }}>
                <select className="td-select" aria-label="Hole" value={s.hole ?? ''}
                  onChange={(e) => void save(s, { hole: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">No hole</option>
                  {Array.from({ length: holeCount }, (_, i) => i + 1).map((n) => <option key={n} value={n}>Hole {n}</option>)}
                </select>
                <input className="td-input" style={{ flex: 1, minWidth: 100 }} aria-label="Tier" placeholder="Tier (e.g. Full hole)" defaultValue={s.tier ?? ''} key={`t${s.id}${s.tier}`}
                  onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== s.tier) void save(s, { tier: v }); }} />
                <input className="td-input" style={{ width: 70 }} type="number" aria-label="Order" title="Display order" defaultValue={s.sort} key={`s${s.id}${s.sort}`}
                  onBlur={(e) => { const v = Number(e.target.value); if (Number.isInteger(v) && v !== s.sort) void save(s, { sort: v }); }} />
              </div>
              <div className="td-hint">{s.source_name ? `From DGS: ${s.source_name}` : 'Added by hand'}</div>
            </div>
            <div className="td-sponsor-actions">
              <button className="td-toggle" aria-pressed={!s.hidden} onClick={() => void save(s, { hidden: !s.hidden })} disabled={busy === s.id}>
                <span className="track"><span className="knob" /></span><span>{s.hidden ? 'Hidden' : 'Visible'}</span>
              </button>
              {!s.source_name && <button className="td-btn quiet" onClick={() => void remove(s)} disabled={busy === s.id}>DELETE</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
