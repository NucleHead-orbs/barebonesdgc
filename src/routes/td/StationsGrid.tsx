import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../../lib/td/api';
import { rpcError } from '../../lib/td/builder';
import type { CrewMember } from '../../lib/crew/crew';
import {
  cell, doubleBooked, gridCsv, gridSummary, isDouble, shifts, starterStationsToAdd,
  type Half, type Shift, type Slot, type Station,
} from '../../lib/crew/stations';

function saveBlob(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * CREW → STATIONS: the volunteer grid. Rows = stations, columns = every event day × AM/PM.
 * The TD assigns; crew can claim open spots from their link (shown with ✋). Double-booking saves but is flagged ⚠.
 */
export default function StationsGrid({ eventId, eventName, startsOn, endsOn, crew }: {
  eventId: string; eventName: string; startsOn: string; endsOn: string; crew: CrewMember[];
}) {
  const [data, setData] = useState<api.StationsData | null>(null);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [need, setNeed] = useState('1');
  const [editing, setEditing] = useState(false);
  const live = useMemo(() => crew.filter((c) => !c.revoked_at), [crew]);
  const nameOf = useCallback((id: string) => crew.find((c) => c.id === id)?.name ?? '?', [crew]);
  const sh = useMemo(() => shifts(startsOn, endsOn), [startsOn, endsOn]);

  const load = useCallback(async () => {
    const r = await api.loadStations(eventId);
    if (r.error || !r.data) return setErr(rpcError(r.error).message);
    setData(r.data);
  }, [eventId]);
  useEffect(() => { void (async () => { await load(); })(); }, [load]);

  if (!data) return err ? <div className="td-warn" role="alert">{err}</div> : <p className="td-empty">Loading…</p>;
  const fail = (what: string) => (e: unknown) => setErr(`${what}: ${rpcError(e).message}`);
  const sum = gridSummary(data.stations, sh, data.slots);
  const dbl = doubleBooked(data.slots, data.stations);
  const toAdd = starterStationsToAdd(data.stations);

  const add = async (rows: Array<{ name: string; need: number; sort: number }>) => {
    const r = await api.addStations(eventId, rows);
    if (r.error || !r.data) return fail('Add station')(r.error);
    setData({ ...data, stations: [...data.stations, ...r.data] });
    setName(''); setNeed('1'); setErr('');
  };
  const addOne = () => {
    const n = name.replace(/\s+/g, ' ').trim();
    if (!n) return;
    if (data.stations.some((s) => s.name.toLowerCase() === n.toLowerCase())) return setErr(`"${n}" is already a station.`);
    void add([{ name: n.slice(0, 40), need: Math.max(0, Math.min(50, Math.round(Number(need) || 0))), sort: Math.max(-1, ...data.stations.map((s) => s.sort)) + 1 }]);
  };
  const patchStation = async (s: Station, p: { name?: string; need?: number }) => {
    setData({ ...data, stations: data.stations.map((x) => (x.id === s.id ? { ...x, ...p } : x)) });
    const r = await api.updateStation(s.id, p);
    if (r.error) { fail(s.name)(r.error); await load(); }
  };
  const removeStation = async (s: Station) => {
    const n = data.slots.filter((x) => x.station_id === s.id).length;
    if (!window.confirm(`Delete ${s.name}${n ? ` and its ${n} assignment${n === 1 ? '' : 's'}` : ''}?`)) return;
    const r = await api.deleteStation(s.id);
    if (r.error) return fail(s.name)(r.error);
    setData({ stations: data.stations.filter((x) => x.id !== s.id), slots: data.slots.filter((x) => x.station_id !== s.id) });
  };
  const move = async (s: Station, dir: -1 | 1) => {
    const i = data.stations.indexOf(s), j = i + dir;
    if (j < 0 || j >= data.stations.length) return;
    const a = data.stations.slice(); [a[i], a[j]] = [a[j], a[i]];
    const re = a.map((x, k) => ({ ...x, sort: k }));
    setData({ ...data, stations: re });
    await Promise.all(re.filter((x, k) => x.sort !== data.stations[k]?.sort || x.id !== data.stations[k]?.id).map((x) => api.updateStation(x.id, { sort: x.sort })));
  };
  const assign = async (s: Station, t: Shift, crewId: string) => {
    const r = await api.assignSlot(eventId, s.id, t.day, t.half, crewId);
    if (r.error || !r.data) return fail(`${s.name} ${t.label}`)(r.error);
    setData({ ...data, slots: [...data.slots, r.data] });
  };
  const unassign = async (x: Slot) => {
    const r = await api.removeSlot(x.id);
    if (r.error) return fail('Remove')(r.error);
    setData({ ...data, slots: data.slots.filter((y) => y.id !== x.id) });
  };
  const setShiftNeed = async (s: Station, day: number, half: Half, v: number | null) => {
    const needs = s.needs.filter((n) => !(n.day === day && n.half === half));
    const next = v == null || v === s.need ? needs : [...needs, { day, half, need: v }];
    setData({ ...data, stations: data.stations.map((x) => (x.id === s.id ? { ...x, needs: next } : x)) });
    const r = await api.setShiftNeed(s.id, day, half, v == null || v === s.need ? null : v);
    if (r.error) { fail(s.name)(r.error); await load(); }
  };
  const csv = () => saveBlob(gridCsv(data.stations, sh, data.slots, nameOf), `${eventName.replace(/[^\w-]+/g, '-')}-stations.csv`);

  return (
    <>
      {err && <div className="td-warn" role="alert">{err} <button className="td-btn quiet" onClick={() => setErr('')}>DISMISS</button></div>}
      <section className="td-panel">
        <div className="td-counts">
          <div className="td-stat"><b style={{ color: sum.open ? 'var(--gold)' : 'var(--under)' }}>{sum.filled}/{sum.need}</b><span>SPOTS FILLED</span></div>
          <div className="td-stat"><b>{sum.shortCells}</b><span>SHORT</span></div>
          <div className="td-stat"><b style={{ color: sum.conflicts ? 'var(--error)' : '#fff' }}>{sum.conflicts}</b><span>DOUBLE-BOOKED</span></div>
          <div className="td-stat"><b>{sum.people}/{live.length}</b><span>CREW PLACED</span></div>
        </div>
        <div className="td-row">
          <form className="td-row" onSubmit={(e) => { e.preventDefault(); addOne(); }}>
            <input className="td-input" aria-label="New station name" placeholder="New station (e.g. Raffle table)" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
            <input className="td-input" style={{ width: 64 }} inputMode="numeric" aria-label="People needed per shift" value={need} onChange={(e) => setNeed(e.target.value.replace(/\D/g, ''))} />
            <button className="td-btn cta" disabled={!name.trim()}>ADD STATION</button>
          </form>
          {toAdd.length > 0 && <button className="td-btn cyan" onClick={() => void add(toAdd)}>{data.stations.length ? `ADD ${toAdd.length} STARTER` : 'LOAD STARTER STATIONS'}</button>}
          <div style={{ flex: 1 }} />
          <button className={`td-btn ${editing ? 'cyan' : 'quiet'}`} aria-pressed={editing} onClick={() => setEditing(!editing)}>{editing ? 'DONE EDITING' : 'EDIT HEADCOUNTS'}</button>
          {data.stations.length > 0 && <button className="td-btn quiet" onClick={csv}>CSV</button>}
          {data.stations.length > 0 && <button className="td-btn quiet" onClick={() => window.print()}>PRINT</button>}
        </div>
        <span className="td-hint">Tap + in a cell to assign someone. ✋ = they claimed it from their link. ⚠ = same person in two stations that shift. {editing ? 'Change a station\'s usual headcount on the left, or one shift\'s in its cell (blank = usual).' : ''}</span>
        {!live.length && <div className="td-warn soft">Add crew in ROSTER first. Only crew members can be placed on the grid.</div>}
      </section>

      {!data.stations.length && <div className="td-empty">No stations yet. Load the starter set or add your own.</div>}
      {data.stations.length > 0 && (
        <div className="td-gridwrap">
          <table className="td-stations">
            <thead>
              <tr><th className="td-st-name">STATION</th>{sh.map((t) => <th key={t.key}>{t.label}</th>)}</tr>
            </thead>
            <tbody>
              {data.stations.map((s, i) => (
                <tr key={s.id}>
                  <th className="td-st-name">
                    {editing
                      ? <div className="td-st-edit">
                        <input className="td-input" aria-label="Station name" defaultValue={s.name} maxLength={40}
                          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.name) void patchStation(s, { name: v }); }} />
                        <label className="td-inline"><input className="td-input" style={{ width: 54 }} inputMode="numeric" aria-label={`${s.name} usual headcount`} defaultValue={s.need}
                          onBlur={(e) => { const v = Math.max(0, Math.min(50, Math.round(Number(e.target.value) || 0))); if (v !== s.need) void patchStation(s, { need: v }); }} /><span className="td-hint">per shift</span></label>
                        <div className="td-row">
                          <button className="td-link" disabled={i === 0} onClick={() => void move(s, -1)}>↑</button>
                          <button className="td-link" disabled={i === data.stations.length - 1} onClick={() => void move(s, 1)}>↓</button>
                          <button className="td-link danger" onClick={() => void removeStation(s)}>Delete</button>
                        </div>
                      </div>
                      : <><b>{s.name}</b><span className="td-hint">{s.need} per shift</span></>}
                  </th>
                  {sh.map((t) => {
                    const c = cell(s, t, data.slots);
                    const there = new Set(c.slots.map((x) => x.crew_id));
                    const free = live.filter((p) => !there.has(p.id));
                    const override = s.needs.find((n) => n.day === t.day && n.half === t.half);
                    return (
                      <td key={t.key} className={`td-st-cell${c.need === 0 ? ' is-none' : c.short ? ' is-short' : c.over ? ' is-over' : ' is-full'}`}>
                        <div className="td-st-count">{c.slots.length}/{c.need}{override ? ' *' : ''}</div>
                        {c.slots.map((x) => (
                          <span key={x.id} className={`td-st-person${isDouble(dbl, x) ? ' is-double' : ''}`} title={isDouble(dbl, x) ? `Also at ${dbl.get(`${x.crew_id}@${t.key}`)?.filter((n) => n !== s.name).join(', ')} this shift` : ''}>
                            {isDouble(dbl, x) ? '⚠ ' : ''}{nameOf(x.crew_id)}{x.claimed ? ' ✋' : ''}
                            <button className="td-st-x" aria-label={`Remove ${nameOf(x.crew_id)} from ${s.name} ${t.label}`} onClick={() => void unassign(x)}>×</button>
                          </span>
                        ))}
                        {free.length > 0 && (
                          <select className="td-select td-st-add" aria-label={`Assign to ${s.name} ${t.label}`} value="" onChange={(e) => { if (e.target.value) void assign(s, t, e.target.value); }}>
                            <option value="">+</option>
                            {free.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        )}
                        {editing && (
                          <input className="td-input td-st-need" inputMode="numeric" aria-label={`${s.name} ${t.label} headcount`} placeholder={String(s.need)} defaultValue={override ? override.need : ''}
                            onBlur={(e) => { const raw = e.target.value.trim(); const v = raw === '' ? null : Math.max(0, Math.min(50, Math.round(Number(raw) || 0))); if (v !== (override?.need ?? null)) void setShiftNeed(s, t.day, t.half, v); }} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
