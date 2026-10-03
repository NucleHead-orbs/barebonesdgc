import { useCallback, useEffect, useState } from 'react';
import { addMember, cardUrl, loadAllBand, moveSorts, nextSort, removeMember, updateMember, uploadCard, type BandMember } from '../../lib/band/band';
import { rpcError } from '../../lib/td/builder';
import './band-panel.css';

/**
 * Meet the Band (super admin; the database refuses anyone else). Each member: name, role, character card,
 * order, Visible on /jewel-xi/band. New members start hidden so a half-made card never goes public.
 */
export default function BandPanel({ onBack }: { onBack: () => void }) {
  const [band, setBand] = useState<BandMember[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');

  const reload = useCallback(async () => {
    const r = await loadAllBand();
    if (r.error) return setError(rpcError(r.error).message);
    setError(''); setBand(r.data ?? []);
  }, []);
  useEffect(() => { void (async () => { await reload(); })(); }, [reload]);

  const run = async (key: string, fn: () => Promise<{ error?: unknown }>) => {
    setBusy(key); const r = await fn(); setBusy(null);
    if (r.error) setError(r.error instanceof Error ? r.error.message : rpcError(r.error).message);
    await reload();
  };
  const list = band ?? [];

  return (
    <main className="td-hub td-band">
      <div className="td-row">
        <button className="td-btn quiet" onClick={onBack}>‹ EVENTS</button>
        <h2 className="td-h2">The Band</h2>
        <div style={{ flex: 1 }} />
        <a className="td-btn" href="/jewel-xi/band" target="_blank" rel="noreferrer">VIEW PAGE ↗</a>
      </div>
      <p className="td-hint">Admins and managers on <b>Meet the Band</b>. Upload each person's character card (a tall card like the Jewel XI ones looks best). New members start hidden: flip <b>Visible</b> when their card is ready.</p>
      {error && <div className="td-warn" role="alert">⚠ {error}</div>}

      <form className="td-row td-band-add" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; void run('add', () => addMember(name, role, nextSort(list))).then(() => { setName(''); setRole(''); }); }}>
        <input className="td-input" placeholder="Name (e.g. WTF Jerry)" aria-label="New member name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        <input className="td-input" placeholder="Role (e.g. Admin)" aria-label="New member role" maxLength={60} value={role} onChange={(e) => setRole(e.target.value)} />
        <button className="td-btn cta" type="submit" disabled={!name.trim() || busy === 'add'}>{busy === 'add' ? 'ADDING…' : '+ ADD MEMBER'}</button>
      </form>

      {band === null && !error && <p className="td-empty">Loading the band…</p>}
      {band && !band.length && <p className="td-empty">No one yet. Add the first member above.</p>}
      <ol className="td-band-grid">
        {list.map((m, i) => {
          const url = cardUrl(m.card);
          return (
            <li key={m.id} className={`td-band-item${m.hidden ? ' is-hidden' : ''}`}>
              <div className="td-band-card">{url ? <img src={url} alt={`${m.name} card`} /> : <span>NO CARD YET</span>}</div>
              <label className={`td-btn${busy === `card${m.id}` ? ' disabled' : ''}`}>
                {busy === `card${m.id}` ? 'UPLOADING…' : url ? 'REPLACE CARD' : 'UPLOAD CARD'}
                <input type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy !== null}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void run(`card${m.id}`, () => uploadCard(m, f)); }} />
              </label>
              <input className="td-input" aria-label={`${m.name} name`} defaultValue={m.name} key={`n${m.name}`} maxLength={60}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== m.name) void run('edit', () => updateMember(m.id, { name: v })); }} />
              <input className="td-input" aria-label={`${m.name} role`} placeholder="Role" defaultValue={m.role} key={`r${m.role}`} maxLength={60}
                onBlur={(e) => { const v = e.target.value.trim(); if (v !== m.role) void run('edit', () => updateMember(m.id, { role: v })); }} />
              <div className="td-row td-band-actions">
                <label className="td-check"><input type="checkbox" checked={!m.hidden} disabled={busy !== null}
                  onChange={(e) => void run('edit', () => updateMember(m.id, { hidden: !e.target.checked }))} /> Visible</label>
                <div style={{ flex: 1 }} />
                <button className="td-btn quiet" aria-label={`Move ${m.name} earlier`} disabled={i === 0 || busy !== null}
                  onClick={() => void run('move', async () => { for (const u of moveSorts(list, m.id, -1)) { const r = await updateMember(u.id, { sort: u.sort }); if (r.error) return r; } return {}; })}>◀</button>
                <button className="td-btn quiet" aria-label={`Move ${m.name} later`} disabled={i === list.length - 1 || busy !== null}
                  onClick={() => void run('move', async () => { for (const u of moveSorts(list, m.id, 1)) { const r = await updateMember(u.id, { sort: u.sort }); if (r.error) return r; } return {}; })}>▶</button>
                <button className="td-btn quiet" disabled={busy !== null}
                  onClick={() => { if (window.confirm(`Remove ${m.name} from the band? Their uploaded card is deleted too.`)) void run('del', () => removeMember(m)); }}>REMOVE</button>
              </div>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
