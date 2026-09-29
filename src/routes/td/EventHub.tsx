import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as api from '../../lib/td/api';
import { rpcError } from '../../lib/td/builder';
import { DIVISION_PRESETS, addDays, dateRange, daysBetween, divisionsProblem, isoDate, normalizeDivCode, type DivisionRow, type EventConfig } from '../../lib/td/setup';
import { useTheme } from '../../lib/theme';
import EventWorkspace from './EventWorkspace';
import { HelpButton } from './Help';
import { LayoutSelect } from './CourseLibrary';
import { findLayout, sortLibrary, type LibCourse } from '../../lib/courses/courses';

/**
 * Home of /td: the events this account runs. ?e=<id> opens one.
 * Super admin creates events from scratch; any TD of an event can duplicate it (league week 2).
 */
export default function EventHub({ email, admin, onSignOut }: { email: string; admin: boolean; onSignOut: () => void }) {
  const [params, setParams] = useSearchParams();
  const openId = params.get('e');
  const [events, setEvents] = useState<EventConfig[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [dupOf, setDupOf] = useState<EventConfig | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const reload = useCallback(async () => {
    const r = await api.myEvents();
    if (r.error || !r.data) return setError(rpcError(r.error).message);
    setError(''); setEvents(r.data);
  }, []);
  useEffect(() => { void (async () => { await reload(); })(); }, [reload]);

  const open = (id: string | null) => setParams(id ? { e: id } : {});

  if (openId) {
    return <EventWorkspace key={openId} eventId={openId} email={email} admin={admin} onSignOut={onSignOut}
      onBack={() => { open(null); void reload(); }} />;
  }

  const shown = (events ?? []).filter((e) => showArchived || !e.archived);
  return (
    <HubShell email={email} onSignOut={onSignOut} admin={admin}>
      <main className="td-hub">
        {error && <div className="td-warn" role="alert">{error}</div>}
        <div className="td-row">
          <h2 className="td-h2">Your events</h2>
          <div style={{ flex: 1 }} />
          {events?.some((e) => e.archived) && (
            <button className="td-btn quiet" onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'HIDE ARCHIVED' : 'SHOW ARCHIVED'}</button>
          )}
          {admin && <button className="td-btn cta" onClick={() => setCreating(true)}>+ NEW EVENT</button>}
        </div>
        {creating && <NewEventForm onCancel={() => setCreating(false)} onCreated={(id) => { setCreating(false); open(id); }} />}
        {dupOf && <DuplicateForm src={dupOf} onCancel={() => setDupOf(null)} onCreated={(id) => { setDupOf(null); open(id); }} />}
        {events === null && !error && <p className="td-empty">Loading events…</p>}
        {events && !events.length && (
          <div className="td-warn soft">
            No events yet for <b>{email}</b>. Ask your organizer to add this email as a TD, then reload.
            {admin ? '' : ' (Your email has to be confirmed: use the link from the sign-up email.)'}
          </div>
        )}
        <div className="td-events">
          {shown.map((e) => (
            <article key={e.id} className={`td-event${e.archived ? ' archived' : ''}`} data-palette={e.palette}>
              <button className="td-event-open" onClick={() => open(e.id)}>
                <span className="td-event-name">{e.name}</span>
                <span className="td-event-meta">{[e.club_name, dateRange(e)].filter(Boolean).join(' · ')}</span>
                <span className="td-event-meta">{e.rounds} round{e.rounds === 2 ? 's' : ''} · {e.waves === 2 ? 'AM/PM' : 'single wave'}{e.use_checkin ? ' · check-in' : ''}{e.use_sponsors ? ' · sponsors' : ''}{e.archived ? ' · archived' : ''}</span>
              </button>
              <div className="td-actions">
                <button className="td-btn" onClick={() => open(e.id)}>OPEN</button>
                <button className="td-btn quiet" onClick={() => setDupOf(e)}>DUPLICATE</button>
              </div>
            </article>
          ))}
        </div>
      </main>
    </HubShell>
  );
}

/** Theme lives in the leaf screens (list / workspace), never a parent: layout effects run child-first. */
function HubShell({ email, admin, onSignOut, children }: { email: string; admin: boolean; onSignOut: () => void; children: ReactNode }) {
  useTheme('event');
  return (
    <div className="td">
      <header className="td-top">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div className="td-title">TD Builder</div>
          <div className="td-sub">{admin ? 'SUPER ADMIN' : 'EVENT TD'} · {email}</div>
        </div>
        <div style={{ flex: 1 }} />
        <div className="td-actions">
          <HelpButton />
          <button className="td-btn quiet" onClick={onSignOut}>SIGN OUT</button>
        </div>
      </header>
      {children}
    </div>
  );
}

function NewEventForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const today = isoDate(new Date());
  const [name, setName] = useState('');
  const [club, setClub] = useState('');
  const [starts, setStarts] = useState(today);
  const [ends, setEnds] = useState(today);
  const [holes, setHoles] = useState(18);
  const [divs, setDivs] = useState<DivisionRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [lib, setLib] = useState<LibCourse[]>([]);
  const [layoutId, setLayoutId] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  useEffect(() => { void (async () => { const r = await api.loadLibrary(); if (r.data) setLib(sortLibrary(r.data)); })(); }, []);
  const chosen = findLayout(lib, layoutId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const bad = !name.trim() ? 'The event needs a name.' : ends < starts ? "The end date can't be before the start date." : divisionsProblem(divs);
    if (bad) return setErr(bad);
    setBusy(true); setErr('');
    const r = await api.createEvent({ name: name.trim(), club: club.trim(), starts, ends, holeCount: chosen?.layout.holes ?? holes, divisions: divs });
    if (r.error || !r.data) { setBusy(false); return setErr(rpcError(r.error).message); }
    if (chosen) {
      const a = await api.applyLayout(r.data.id, chosen.layout.id);
      if (a.error) {
        setBusy(false); setCreated(r.data.id);
        return setErr(`The event was created, but the course didn't load: ${rpcError(a.error).message} Open it and use Setup → Course → LOAD.`);
      }
    }
    setBusy(false);
    onCreated(r.data.id);
  };

  return (
    <form className="td-panel td-form" onSubmit={submit}>
      <h2>New event</h2>
      <p className="td-hint">The basics to get going. Everything here, plus format, course details and TDs, can change later in Setup.</p>
      <div className="td-fields">
        <Field label="EVENT NAME"><input className="td-input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Tuesday Doubles League" /></Field>
        <Field label="CLUB"><input className="td-input" value={club} onChange={(e) => setClub(e.target.value)} placeholder="Your club" /></Field>
        <Field label="STARTS"><input className="td-input" type="date" required value={starts} onChange={(e) => { setStarts(e.target.value); if (ends < e.target.value) setEnds(e.target.value); }} /></Field>
        <Field label="ENDS"><input className="td-input" type="date" required value={ends} min={starts} onChange={(e) => setEnds(e.target.value)} /></Field>
        {!chosen && <Field label="HOLES"><input className="td-input" type="number" min={1} max={40} value={holes} onChange={(e) => setHoles(Math.max(1, Math.min(40, Number(e.target.value) || 1)))} /></Field>}
      </div>
      <Field label="COURSE">
        <LayoutSelect lib={lib} value={layoutId} onChange={setLayoutId} blankLabel="Not in the list: I'll enter holes in Setup" label="Course" />
      </Field>
      <DivisionPicker divs={divs} waves={1} onChange={setDivs} />
      {err && <div className="td-warn" role="alert">{err}</div>}
      <div className="td-actions">
        {created
          ? <button className="td-btn cta" type="button" onClick={() => onCreated(created)}>OPEN EVENT</button>
          : <button className="td-btn cta" type="submit" disabled={busy}>{busy ? 'CREATING…' : 'CREATE EVENT'}</button>}
        <button className="td-btn quiet" type="button" onClick={onCancel}>CANCEL</button>
      </div>
    </form>
  );
}

function DuplicateForm({ src, onCancel, onCreated }: { src: EventConfig; onCancel: () => void; onCreated: (id: string) => void }) {
  const span = daysBetween(src.starts_on, src.ends_on);
  const [name, setName] = useState(src.name);
  const [starts, setStarts] = useState(addDays(src.starts_on, 7));
  const [copyPlayers, setCopyPlayers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErr('The event needs a name.');
    setBusy(true); setErr('');
    const r = await api.duplicateEvent(src.id, { name: name.trim(), starts, ends: addDays(starts, span), copyPlayers });
    setBusy(false);
    if (r.error || !r.data) return setErr(rpcError(r.error).message);
    onCreated(r.data.id);
  };

  return (
    <form className="td-panel td-form" onSubmit={submit}>
      <h2>Duplicate “{src.name}”</h2>
      <p className="td-hint">Copies the format, course, divisions, card rules and TDs. Cards and scores never copy.</p>
      <div className="td-fields">
        <Field label="NAME"><input className="td-input" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="STARTS"><input className="td-input" type="date" required value={starts} onChange={(e) => setStarts(e.target.value)} /></Field>
      </div>
      <button type="button" className="td-toggle" aria-pressed={copyPlayers} onClick={() => setCopyPlayers(!copyPlayers)}>
        <span className="track"><span className="knob" /></span><span>Copy the player list (everyone starts not checked in)</span>
      </button>
      {err && <div className="td-warn" role="alert">{err}</div>}
      <div className="td-actions">
        <button className="td-btn cta" type="submit" disabled={busy}>{busy ? 'COPYING…' : 'DUPLICATE'}</button>
        <button className="td-btn quiet" type="button" onClick={onCancel}>CANCEL</button>
      </div>
    </form>
  );
}

export function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={`td-field${wide ? ' wide' : ''}`}><span className="td-label">{label}</span>{children}</label>;
}

/**
 * Divisions in play order. Tap a preset to add/remove; type any other code. With AM/PM waves,
 * each division's chip toggles its wave (this is the default the Cards tab starts from).
 */
export function DivisionPicker({ divs, waves, locked = [], onChange }: {
  divs: DivisionRow[]; waves: 1 | 2; locked?: string[]; onChange: (d: DivisionRow[]) => void;
}) {
  const [custom, setCustom] = useState('');
  const [err, setErr] = useState('');
  const has = (c: string) => divs.some((d) => d.code === c);
  const toggle = (c: string) => {
    if (has(c)) {
      if (locked.includes(c)) return setErr(`${c} has players. Move or remove them before dropping the division.`);
      onChange(divs.filter((d) => d.code !== c));
    } else onChange([...divs, { code: c, wave: 'AM' }]);
    setErr('');
  };
  const addCustom = () => {
    const c = normalizeDivCode(custom);
    if (!c) return setErr('Division codes are 1–8 letters or numbers, no spaces.');
    if (!has(c)) onChange([...divs, { code: c, wave: 'AM' }]);
    setCustom(''); setErr('');
  };
  const presetCodes = new Set(DIVISION_PRESETS.flatMap((g) => g.codes));
  return (
    <div className="td-group">
      <div className="td-label">DIVISIONS · {divs.length} PICKED{waves === 2 ? ' · TAP A PICKED DIVISION’S WAVE TO FLIP AM/PM' : ''}</div>
      {divs.length > 0 && (
        <div className="td-chips">
          {divs.map((d) => (
            <span key={d.code} className="td-divpick">
              <b>{d.code}</b>
              {waves === 2 && (
                <button type="button" className={`td-wave ${d.wave}`} onClick={() => onChange(divs.map((x) => (x.code === d.code ? { ...x, wave: x.wave === 'AM' ? 'PM' : 'AM' } : x)))}>{d.wave}</button>
              )}
              <button type="button" aria-label={`Remove ${d.code}`} onClick={() => toggle(d.code)}>×</button>
            </span>
          ))}
        </div>
      )}
      {DIVISION_PRESETS.map((g) => (
        <div key={g.group} className="td-chips">
          <span className="td-hint" style={{ width: 56 }}>{g.group}</span>
          {g.codes.map((c) => <button type="button" key={c} className="td-chip" aria-pressed={has(c)} onClick={() => toggle(c)}>{c}</button>)}
        </div>
      ))}
      <div className="td-chips">
        <input className="td-input" style={{ maxWidth: 140 }} value={custom} placeholder="Custom code" maxLength={8}
          onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} />
        <button type="button" className="td-btn quiet" onClick={addCustom}>ADD</button>
        {divs.filter((d) => !presetCodes.has(d.code)).length > 0 && <span className="td-hint">Custom: {divs.filter((d) => !presetCodes.has(d.code)).map((d) => d.code).join(', ')}</span>}
      </div>
      {err && <div className="td-warn" role="alert">{err}</div>}
    </div>
  );
}
