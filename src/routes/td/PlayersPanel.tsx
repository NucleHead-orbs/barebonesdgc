import { Fragment, useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import type { ImportRow } from '../../lib/import/dgs';
import * as api from '../../lib/td/api';
import { importDiff, rpcError, type ExistingPlayer } from '../../lib/td/builder';
import { cycleVibe, VIBE_LABEL, VIBE_MARK } from '../../lib/td/requests';
import ImportReview from './ImportReview';
import { PlayerPicker } from './PlayerPicker';
import { bagLine } from '../../lib/prep/packs';

/**
 * Players tab: the check-in table. Built for a folding table at the course:
 * big tap targets, search-as-you-type, walk-up add in one line, DGS import for pre-registration.
 * Check-in state is saved the moment it's tapped (and reverted on screen if the save fails).
 */
export default function PlayersPanel({ setup, players, sponsors, priv, onPlayers, onReload, onSponsors, onPrivate }: {
  setup: api.EventSetup; players: ExistingPlayer[]; sponsors: api.Sponsor[]; priv: api.PrivateInfo;
  onPlayers: (p: ExistingPlayer[]) => void; onReload: () => Promise<void>; onSponsors: (s: api.Sponsor[]) => void; onPrivate: () => Promise<void>;
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
  const [open, setOpen] = useState<string | null>(null); // player whose private details are expanded

  const loadLocked = useCallback(async () => {
    const r = await api.lockedPlayerIds(ev.id);
    if (r.data) setLocked(r.data);
  }, [ev.id]);
  useEffect(() => { void (async () => { await loadLocked(); })(); }, [loadLocked, players.length]); // roster changed => locks may have too
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 6000); return () => clearTimeout(t); }, [toast]);

  const query = q.trim().toLowerCase();
  const shown = useMemo(() => players.filter((p) => !query || p.name.toLowerCase().includes(query)), [players, query]);
  // Round 2 confirm (2-round events with check-in): the same table, switched to Round 2 answers
  const asksR2 = ev.use_checkin && ev.rounds === 2;
  const [day, setDay] = useState<1 | 2>(1);
  const r2 = asksR2 && day === 2;
  const inCount = players.filter((p) => (r2 ? p.r2_in === true : p.checked_in)).length;
  const outCount = r2 ? players.filter((p) => p.r2_in === false).length : 0;
  const setR2 = async (p: ExistingPlayer, v: boolean | null) => {
    const before = p.r2_in ?? null;
    onPlayers(players.map((x) => (x.id === p.id ? { ...x, r2_in: v } : x)));
    const r = await api.setR2(p.id, v, 'td');
    if (r.error) {
      onPlayers(players.map((x) => (x.id === p.id ? { ...x, r2_in: before } : x)));
      setErr(`${p.name}: ${rpcError(r.error).message}`);
    } else if (v === true) setToast(`${p.name} is in for Round 2.`);
    else if (v === false) setToast(`${p.name} is out for Round 2. They won't get a Round 2 card.`);
  };
  const byDiv = divCodes.map((d) => [d, shown.filter((p) => p.div_code === d)] as const).filter(([, ps]) => ps.length);

  const setIn = async (p: ExistingPlayer, on: boolean) => {
    onPlayers(players.map((x) => (x.id === p.id ? { ...x, checked_in: on } : x)));
    const r = await api.setCheckedIn(p.id, on);
    if (r.error) {
      onPlayers(players.map((x) => (x.id === p.id ? { ...x, checked_in: !on } : x)));
      setErr(`${p.name}: ${rpcError(r.error).message}`);
    } else if (on) setToast(`${p.name} is in. ${bagLine(p.shirt_size)}. Send them to the pack table.`);
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

  /** Private tag: none → ⭐ (needs a good card) → ☺ (plays with anyone) → none. TD-only table. */
  const tag = async (p: ExistingPlayer) => {
    const r = await api.setVibe(ev.id, p.id, cycleVibe(priv.vibe[p.id]));
    if (r.error) setErr(`${p.name}: ${rpcError(r.error).message}`);
    await onPrivate();
  };
  const apartOf = (id: string) => priv.apart.flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : []));
  const setApart = async (p: ExistingPlayer, next: string[]) => {
    const cur = apartOf(p.id);
    const added = next.filter((x) => !cur.includes(x));
    const gone = cur.filter((x) => !next.includes(x));
    const rs = await Promise.all([...added.map((x) => api.addApart(ev.id, p.id, x)), ...gone.map((x) => api.removeApart(p.id, x))]);
    const bad = rs.find((r) => r.error);
    if (bad) setErr(rpcError(bad.error).message);
    await onPrivate();
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
      {toast && <div className="td-ok td-float" role="status">{toast}</div>}
      {err && <div className="td-warn" role="alert">{err} <button className="td-btn quiet" onClick={() => setErr('')}>DISMISS</button></div>}
      {pending && (
        <ImportReview fileName={pending.fileName} text={pending.text} divCodes={divCodes} existing={players} withSponsors={ev.use_sponsors}
          existingSponsors={sponsors.flatMap((s) => (s.source_name ? [s.source_name] : []))}
          busy={busy === 'import'} onImport={(rows, sp) => void doImport(rows, sp)} onCancel={() => setPending(null)} />
      )}

      {asksR2 && (
        <div className="td-seg cyan" role="tablist" aria-label="Which check-in">
          <button role="tab" aria-selected={day === 1} aria-pressed={day === 1} onClick={() => setDay(1)}>ROUND 1 CHECK-IN</button>
          <button role="tab" aria-selected={day === 2} aria-pressed={day === 2} onClick={() => setDay(2)}>ROUND 2 CONFIRM</button>
        </div>
      )}
      {r2 && <div className="td-hint">Only players marked <b>IN</b> get Round 2 cards. Players answer on their Round 1 card after it's submitted (<b>self</b>); tap IN or OUT here to set or change anyone.</div>}
      <div className="td-row">
        <div className="td-stat"><b>{players.length}</b><span>REGISTERED</span></div>
        {ev.use_checkin && <div className="td-stat"><b style={{ color: 'var(--under)' }}>{inCount}</b><span>{r2 ? 'IN FOR R2' : 'CHECKED IN'}</span></div>}
        {r2 && <div className="td-stat"><b style={{ color: outCount ? 'var(--over)' : '#fff' }}>{outCount}</b><span>OUT</span></div>}
        {ev.use_checkin && <div className="td-stat"><b style={{ color: players.length - inCount - outCount ? 'var(--gold)' : '#fff' }}>{players.length - inCount - outCount}</b><span>{r2 ? 'NO ANSWER' : 'NOT YET'}</span></div>}
        <div style={{ flex: 1 }} />
        <label className="td-btn cyan td-file">IMPORT DGS CSV<input type="file" accept=".csv,text/csv" onChange={onFile} disabled={!!busy} /></label>
        {ev.use_checkin && !r2 && <button className="td-btn" onClick={() => void checkInAll()} disabled={!!busy || !shown.some((p) => !p.checked_in)}>CHECK IN {query ? 'MATCHES' : 'ALL'}</button>}
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
          <div className="td-label">{d} · {ps.length}{ev.use_checkin ? ` · ${ps.filter((p) => (r2 ? p.r2_in === true : p.checked_in)).length} IN` : ''}</div>
          {ps.map((p) => (
            <Fragment key={p.id}>
            <div className={`td-roster-row${(r2 ? p.r2_in === true : p.checked_in) ? ' is-in' : ''}${r2 && p.r2_in === false ? ' is-out' : ''}`}>
              {r2 && (
                <span className="td-r2">
                  <button className="td-checkin" aria-pressed={p.r2_in === true} aria-label={`${p.name} in for Round 2`} onClick={() => void setR2(p, p.r2_in === true ? null : true)}>{p.r2_in === true ? '✓ IN' : 'IN'}</button>
                  <button className="td-checkin is-outbtn" aria-pressed={p.r2_in === false} aria-label={`${p.name} out for Round 2`} onClick={() => void setR2(p, p.r2_in === false ? null : false)}>OUT</button>
                </span>
              )}
              {ev.use_checkin && !r2 && (
                <button className="td-checkin" aria-pressed={!!p.checked_in} aria-label={`${p.name} checked in`} onClick={() => void setIn(p, !p.checked_in)}>
                  {p.checked_in ? '✓ IN' : 'CHECK IN'}
                </button>
              )}
              <button className="td-roster-name" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
                {p.name}{apartOf(p.id).length > 0 && <span className="td-hint"> · ⊘{apartOf(p.id).length}</span>}
                {p.shirt_size && <span className="td-bagsize" title="Player pack bag">{p.shirt_size}</span>}
              </button>
              <button className={`td-vibe${priv.vibe[p.id] ? ` is-${priv.vibe[p.id]}` : ''}`} onClick={() => void tag(p)}
                title={priv.vibe[p.id] ? `${VIBE_LABEL[priv.vibe[p.id]]} (private). Tap to change.` : 'Private tag: tap for ⭐ needs a good card, again for ☺ plays with anyone'}
                aria-label={`${p.name} private tag: ${priv.vibe[p.id] ? VIBE_LABEL[priv.vibe[p.id]] : 'none'}`}>
                {priv.vibe[p.id] ? VIBE_MARK[priv.vibe[p.id]] : '·'}
              </button>
              <span className="td-hint">{p.reg_order != null ? `#${p.reg_order}` : ''}</span>
              {!locked.has(p.id) && <button className="td-btn quiet" onClick={() => void remove(p)} aria-label={`Remove ${p.name}`}>REMOVE</button>}
            </div>
            {open === p.id && (
              <div className="td-private">
                <div className="td-label">PRIVATE · ONLY TDS SEE THIS</div>
                <div className="td-hint">Tag: {priv.vibe[p.id] ? `${VIBE_MARK[priv.vibe[p.id]]} ${VIBE_LABEL[priv.vibe[p.id]]}` : 'none'} (tap the dot next to their name to change)</div>
                <div className="td-label">KEEP APART FROM</div>
                <PlayerPicker players={players} picked={apartOf(p.id)} max={10} exclude={[p.id]} placeholder="Type a name. The generator never puts them on the same card."
                  onChange={(ids) => void setApart(p, ids)} />
              </div>
            )}
            </Fragment>
          ))}
        </section>
      ))}
    </main>
  );
}
