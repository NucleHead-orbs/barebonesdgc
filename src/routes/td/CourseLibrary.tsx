import { useState } from 'react';
import * as api from '../../lib/td/api';
import { rpcError } from '../../lib/td/builder';
import { findLayout, hasCustomHoles, layoutFacts, layoutNameProblem, newCourseProblem, type LibCourse } from '../../lib/courses/courses';
import type { HoleRow } from '../../lib/td/setup';

/** One <select> for every layout in the library, grouped by course. Courses with no holes yet are shown, disabled. */
export function LayoutSelect({ lib, value, onChange, blankLabel, label }: {
  lib: LibCourse[]; value: string; onChange: (id: string) => void; blankLabel: string; label: string;
}) {
  return (
    <select className="td-select td-layout-select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{blankLabel}</option>
      {lib.map((c) => (
        <optgroup key={c.id} label={`${c.name}${c.city ? ` · ${c.city}` : ''}`}>
          {c.layouts.length
            ? c.layouts.map((l) => <option key={l.id} value={l.id}>{c.name}: {l.name} ({layoutFacts(l)})</option>)
            : <option disabled value={`none-${c.id}`}>{c.name}: no holes yet (save one from an event)</option>}
        </optgroup>
      ))}
    </select>
  );
}

/**
 * Setup → Course: load a layout from the library into this event, save this event's holes back to the
 * library (new course / new layout / update), and (super admin) verify. Saving reads the event's holes
 * from the server, so unsaved edits are never sent and mandos/rules come along.
 */
export function LibraryBar({ eventId, linkedId, holes, dirty, admin, lib, onLib, onApplied }: {
  eventId: string; linkedId: string | null; holes: HoleRow[]; dirty: boolean; admin: boolean;
  lib: LibCourse[]; onLib: () => Promise<void>; onApplied: () => Promise<void>;
}) {
  const linked = findLayout(lib, linkedId);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const hit = findLayout(lib, pick);
    if (!hit) return;
    if (hasCustomHoles(holes) && !window.confirm(`Replace this event's ${holes.length} holes with ${hit.course.name}: ${hit.layout.name} (${hit.layout.holes} holes)?`)) return;
    setBusy(true); setMsg(null);
    const r = await api.applyLayout(eventId, pick);
    if (r.error) { setBusy(false); return setMsg({ ok: false, text: rpcError(r.error).message }); }
    await onApplied();
    setBusy(false); setPick('');
    setMsg({ ok: true, text: `Loaded ${hit.course.name}: ${hit.layout.name}. ${layoutFacts(hit.layout)}.` });
  };
  const verify = async (on: boolean) => {
    if (!linked) return;
    setBusy(true);
    const r = await api.verifyLayout(linked.layout.id, on);
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: rpcError(r.error).message });
    await onLib();
  };

  return (
    <div className="td-library">
      <div className="td-row">
        <span className="td-label">LIBRARY</span>
        <span className="td-hint">
          {linked ? <>Built from <b>{linked.course.name}: {linked.layout.name}</b>{linked.layout.verified_at ? ' ✓ verified' : ' (not verified)'}</> : 'Not from the course library.'}
        </span>
        {admin && linked && (
          <button className="td-btn quiet" disabled={busy} onClick={() => void verify(!linked.layout.verified_at)}>
            {linked.layout.verified_at ? 'UNVERIFY' : 'MARK VERIFIED'}
          </button>
        )}
      </div>
      <div className="td-row">
        <LayoutSelect lib={lib} value={pick} onChange={setPick} blankLabel="Pick a course layout…" label="Course layout to load" />
        <button className="td-btn cyan" disabled={!pick || busy} onClick={() => void load()}>{busy ? 'LOADING…' : 'LOAD'}</button>
        <button className="td-btn quiet" onClick={() => setSaving(!saving)}>{saving ? 'CLOSE' : 'SAVE TO LIBRARY'}</button>
      </div>
      {saving && <SaveToLibrary eventId={eventId} lib={lib} linked={linked} dirty={dirty} holeCount={holes.length} admin={admin}
        onDone={async (text) => { await onLib(); setSaving(false); setMsg({ ok: true, text }); }} />}
      {msg && <div className={msg.ok ? 'td-ok' : 'td-warn'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
    </div>
  );
}

function SaveToLibrary({ eventId, lib, linked, dirty, holeCount, admin, onDone }: {
  eventId: string; lib: LibCourse[]; linked: ReturnType<typeof findLayout>; dirty: boolean; holeCount: number; admin: boolean;
  onDone: (text: string) => Promise<void>;
}) {
  const [courseId, setCourseId] = useState(linked?.course.id ?? '');
  const [newName, setNewName] = useState('');
  const [city, setCity] = useState('');
  const [mode, setMode] = useState<'update' | 'new'>(linked ? 'update' : 'new');
  const [layoutName, setLayoutName] = useState('');
  const [source, setSource] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const course = lib.find((c) => c.id === courseId) ?? null;
  const updating = mode === 'update' && linked && linked.course.id === courseId ? linked.layout : null;

  const save = async () => {
    setErr('');
    const creating = courseId === 'new';
    const bad = (creating ? newCourseProblem(newName, lib) : !course ? 'Pick a course.' : null)
      ?? (updating ? null : layoutNameProblem(layoutName, creating ? null : course, null));
    if (bad) return setErr(bad);
    setBusy(true);
    let cid = courseId;
    if (creating) {
      const r = await api.addCourse(newName.replace(/\s+/g, ' ').trim(), city.trim() || null);
      if (r.error || !r.data) { setBusy(false); return setErr(rpcError(r.error).message); }
      cid = r.data;
    }
    const name = updating ? updating.name : layoutName.replace(/\s+/g, ' ').trim();
    const r = await api.saveLayoutFromEvent(eventId, cid, updating?.id ?? null, name, source.trim() || null);
    setBusy(false);
    if (r.error) return setErr(rpcError(r.error).message);
    const cname = creating ? newName.trim() : course!.name;
    await onDone(updating
      ? `Updated ${cname}: ${name} with this event's ${holeCount} holes.${updating.verified_at && !admin ? ' A super admin will re-check it before it shows as verified again.' : ''}`
      : `Saved ${cname}: ${name} (${holeCount} holes) to the library. Every TD can load it now.`);
  };

  return (
    <div className="td-panel td-library-save">
      {dirty && <div className="td-warn soft">Save the course first. The library gets the saved holes, not unsaved edits.</div>}
      <div className="td-row">
        <select className="td-select" aria-label="Library course" value={courseId} onChange={(e) => { setCourseId(e.target.value); if (e.target.value !== linked?.course.id) setMode('new'); }}>
          <option value="">Pick a course…</option>
          {lib.map((c) => <option key={c.id} value={c.id}>{c.name}{c.city ? ` (${c.city})` : ''}</option>)}
          <option value="new">+ New course…</option>
        </select>
        {courseId === 'new' && <>
          <input className="td-input" aria-label="New course name" placeholder="Course name" maxLength={80} value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input className="td-input" aria-label="City" placeholder="City" maxLength={60} style={{ maxWidth: 140 }} value={city} onChange={(e) => setCity(e.target.value)} />
        </>}
      </div>
      {linked && linked.course.id === courseId && (
        <div className="td-seg">
          <button aria-pressed={mode === 'update'} onClick={() => setMode('update')}>UPDATE "{linked.layout.name.toUpperCase()}"</button>
          <button aria-pressed={mode === 'new'} onClick={() => setMode('new')}>NEW LAYOUT</button>
        </div>
      )}
      <div className="td-row">
        {!updating && <input className="td-input" aria-label="Layout name" placeholder='Layout name (e.g. "A pins")' maxLength={60} value={layoutName} onChange={(e) => setLayoutName(e.target.value)} />}
        <input className="td-input" style={{ flex: '1 1 220px' }} aria-label="Where the numbers came from" placeholder="Where the numbers came from (tee signs, walked it…)" maxLength={300} value={source} onChange={(e) => setSource(e.target.value)} />
        <button className="td-btn cta" disabled={busy || dirty || !courseId} onClick={() => void save()}>{busy ? 'SAVING…' : updating ? 'UPDATE LAYOUT' : 'SAVE LAYOUT'}</button>
      </div>
      {err && <div className="td-warn" role="alert">{err}</div>}
    </div>
  );
}
