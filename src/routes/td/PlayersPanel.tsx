import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import type { ImportRow } from '../../lib/import/dgs';
import * as api from '../../lib/td/api';
import { importDiff, rpcError, type ExistingPlayer } from '../../lib/td/builder';
import ImportReview from './ImportReview';

/**
 * Players tab: the check-in table. Built for a folding table at the course:
 * big tap targets, search-as-you-type, walk-up add in one line, DGS import for pre-registration.
 * Check-in state is saved the moment it's tapped (and reverted on screen if the save fails).
 */
export default function PlayersPanel({ setup, players, sponsors, onPlayers, onReload, onSponsors }: {
  setup: api.EventSetup; players: ExistingPlayer[]; sponsors: api.Sponsor[];
  onPlayers: (p: ExistingPlayer[]) => void; onReload: () => Promise<void>; onSponsors: (s: api.Sponsor[]) => void;
}) {
  const ev = setup.event;
  const divCodes = setup.divisions.map((d) => d.code);
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [div, setDiv] = useState(divCodes[0] ?? '');
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  const [err, setErr] = useState('');
  const [pending, setPending] = useState<{ fileName: string; text: string } | null>(null);

  const loadLocked = useCallback(async () => {
    const r = await api.lockedPlayerIds(ev.id);
    if (r.data) setLocked(r.data);
  }, [ev.id]);
  useEffect(() => { void (async () => { await loadLocked(); })(); }, [loadLocked, players.length]); // roster changed => locks may have too
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t); }, [toast]);

  const query = q.trim().toLowerCase();
  const shown = useMemo(() => players.filter((p) => !query || p.name.toLowerCase().includes(query)), [players, query]);
  const inCount = players.filter((p) => p.checked_in).length;
  const byDiv = divCodes.map((d) => [d, shown.filter((p) => p.div_code === d)] as const).filter(([, ps]) => ps.length);

  const setIn = async (p: ExistingPlayer, on: boolean) => {
    onPlayers(players.map((x) => (x.id === p.id ? { ...x, checked_in: on } : x)));
    const r = await api.setCheckedIn(p.id, on);
    if (r.error) {
      onPlayers(players.map((x) => (x.id === p.id ? { ...x, checked_in: !on } : x)));
      setErr(`${p.name}: ${rpcError(r.error).message}`);
    }
  };

  const checkInAll = async () => {
    const todo = shown.filter((p) => !p.checked_in);
    if (!todo.length || !window.confirm(`Check in ${todo.length} player${todo.length === 1 ? '' : 's'}${query ? ' matching your search' : ''}?`)) return;
    setBusy('all'); setErr('');
    const results = await Promise.all(todo.map((p) => api.setCheckedIn(p.id, true)));
    setBusy('');
    const failed = results.filter((r) => r.error).length;
    await onReload();
    if (failed) setErr(`${failed} check-in(s) didn't save. Check signal and try again.`);
    else setToast(`Checked in ${todo.length}.`);
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim().replace(/\s+/g, ' ');
    if (!n || !div) return;
    const dupe = players.find((p) => p.name.toLowerCase() === n.toLowerCase());
    if (dupe && !window.confirm(`${dupe.name} (${dupe.div_code}) is already registered. Update them to ${div}${ev.use_checkin ? ' and check them in' : ''}?`)) return;
    setBusy('add'); setErr('');
    const next = Math.max(0, ...players.map((p) => p.reg_order ?? 0)) + 1;
    const r = await api.quickAddPlayer(ev.id, { name: n, div_code: div, reg_order: dupe?.reg_order ?? next, checked_in: ev.use_checkin });
    setBusy('');
    if (r.error || !r.data) return setErr(rpcError(r.error).message);
    if (r.data.skipped.length) return setErr(`Not added: ${r.data.skipped[0].reason.replace(/_/g, ' ')}.`);
    await onReload();
    setName('');
    setToast(`${dupe ? 'Updated' : 'Added'} ${n} (${div})${ev.use_checkin ? ', checked in' : ''}.`);
  };

  const remove = async (p: ExistingPlayer) => {
    if (!window.confirm(`Remove ${p.name} from this event?`)) return;
    const r = await api.removePlayer(p.id);
    if (r.error) return setErr(rpcError(r.error).message);
    await onReload();
    setToast(`Removed ${p.name}.`);
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) setPending({ fileName: f.name, text: await f.text() });
  };

  const doImport = async (rows: ImportRow[], sponsorNames: string[]) => {
    const diff = importDiff(rows, players);
    setBusy('import'); setErr('');
    const r = rows.length ? await api.importPlayers(ev.id, rows) : { data: { inserted: 0, updated: 0, skipped: [] } };
    if (r.error || !r.data) { setBusy(''); return setErr(rpcError(r.error).message); }
    let spMsg = '';
    if (ev.use_sponsors && sponsorNames.length) {
      const sp = await api.importSponsors(ev.id, sponsorNames);
      if (sp.error || !sp.data) spMsg = ` Sponsors failed: ${rpcError(sp.error).message}`;
      else if (sp.data.inserted) spMsg = ` ${sp.data.inserted} new sponsor(s) waiting for approval in Sponsors.`;
      const sl = await api.loadSponsors(ev.id);
      if (sl.data) onSponsors(sl.data);
    }
    await onReload();
    setBusy(''); setPending(null);
    const srv = r.data.skipped.length ? ` The server skipped ${r.data.skipped.length} row(s).` : '';
    setToast(`Import done: ${diff.inserts.length} new, ${diff.updates.length} changed, ${diff.unchanged.length} unchanged.${srv}${spMsg}`);
  };

  return (
    <main className="td-main">
      {toast && <div className="td-ok" role="status">{toast}</div>}
      {err && <div className="td-warn" role="alert">{err} <button className="td-btn quiet" onClick={() => setErr('')}>DISMISS</button></div>}
      {pending && (
        <ImportReview fileName={pending.fileName} text={pending.text} divCodes={divCodes} existing={players} withSponsors={ev.use_sponsors}
          existingSponsors={sponsors.flatMap((s) => (s.source_name ? [s.source_name] : []))}
          busy={busy === 'import'} onImport={(rows, sp) => void doImport(rows, sp)} onCancel={() => setPending(null)} />
      )}

      <div className="td-row">
        <div className="td-stat"><b>{players.length}</b><span>REGISTERED</span></div>
        {ev.use_checkin && <div className="td-stat"><b style={{ color: 'var(--under)' }}>{inCount}</b><span>CHECKED IN</span></div>}
        {ev.use_checkin && <div className="td-stat"><b style={{ color: players.length - inCount ? 'var(--gold)' : '#fff' }}>{players.length - inCount}</b><span>NOT YET</span></div>}
        <div style={{ flex: 1 }} />
        <label className="td-btn cyan td-file">IMPORT DGS CSV<input type="file" accept=".csv,text/csv" onChange={onFile} disabled={!!busy} /></label>
        {ev.use_checkin && <button className="td-btn" onClick={() => void checkInAll()} disabled={!!busy || !shown.some((p) => !p.checked_in)}>CHECK IN {query ? 'MATCHES' : 'ALL'}</button>}
      </div>

      <form className="td-walkup" onSubmit={add}>
        <input className="td-input" placeholder="Walk-up: first and last name" value={name} onChange={(e) => setName(e.target.value)} aria-label="New player name" />
        <select className="td-select" value={div} onChange={(e) => setDiv(e.target.value)} aria-label="Division">
          {divCodes.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <button className="td-btn cta" type="submit" disabled={busy === 'add' || !name.trim() || !div}>{busy === 'add' ? 'ADDING…' : ev.use_checkin ? 'ADD + CHECK IN' : 'ADD PLAYER'}</button>
      </form>

      <input className="td-search td-search-wide" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find player…" aria-label="Find player" />

      {!players.length && <div className="td-empty">No players yet. Import the Disc Golf Scene CSV or add walk-ups above.</div>}
      {players.length > 0 && !shown.length && <div className="td-empty">No one matches “{q}”.</div>}

      {byDiv.map(([d, ps]) => (
        <section key={d} className="td-roster" aria-label={`${d} players`}>
          <div className="td-label">{d} · {ps.length}{ev.use_checkin ? ` · ${ps.filter((p) => p.checked_in).length} IN` : ''}</div>
          {ps.map((p) => (
            <div key={p.id} className={`td-roster-row${p.checked_in ? ' is-in' : ''}`}>
              {ev.use_checkin && (
                <button className="td-checkin" aria-pressed={!!p.checked_in} aria-label={`${p.name} checked in`} onClick={() => void setIn(p, !p.checked_in)}>
                  {p.checked_in ? '✓ IN' : 'CHECK IN'}
                </button>
              )}
              <span className="td-roster-name">{p.name}</span>
              <span className="td-hint">{p.reg_order != null ? `#${p.reg_order}` : ''}</span>
              {!locked.has(p.id) && <button className="td-btn quiet" onClick={() => void remove(p)} aria-label={`Remove ${p.name}`}>REMOVE</button>}
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}
