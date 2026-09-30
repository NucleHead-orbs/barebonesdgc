import { useCallback, useEffect, useState, type ReactNode } from 'react';
import * as api from '../../lib/td/api';
import { rpcError, type ExistingPlayer } from '../../lib/td/builder';
import {
  PALETTES, coursePar, divisionsProblem, emailOk, holesProblem, normEmail, resizeHoles, withWaves,
  type DivisionRow, type EventConfig, type HoleRow,
  DUBS_STYLES, type DubsStyle,
} from '../../lib/td/setup';
import { DivisionPicker, Field } from './EventHub';
import { LibraryBar } from './CourseLibrary';
import { sortLibrary, type LibCourse } from '../../lib/courses/courses';

/**
 * The build menu. Each section saves on its own through the matching RPC, so a refusal in one
 * (e.g. a division that still has players) never loses edits in another.
 */
export default function SetupPanel({ setup, admin, players, onSaved, onDeleted }: {
  setup: api.EventSetup; admin: boolean; players: ExistingPlayer[]; onSaved: () => Promise<void>; onDeleted: () => void;
}) {
  const ev = setup.event;
  const [lib, setLib] = useState<LibCourse[]>([]);
  const loadLib = useCallback(async () => {
    const r = await api.loadLibrary();
    if (r.data) setLib(sortLibrary(r.data));
  }, []);
  useEffect(() => { void (async () => { await loadLib(); })(); }, [loadLib]);
  return (
    <main className="td-main td-setup">
      <EventSection ev={ev} onSaved={onSaved} />
      <CourseSection eventId={ev.id} holes={setup.holes} onSaved={onSaved} admin={admin} lib={lib} onLib={loadLib} linkedId={ev.course_layout_id ?? null} />
      <DivisionSection eventId={ev.id} waves={ev.waves} divisions={setup.divisions} players={players} onSaved={onSaved} />
      <TdSection eventId={ev.id} tds={setup.tds} admin={admin} onSaved={onSaved} />
      {admin && ev.slug !== 'jewel-xi-2026' && <DangerSection ev={ev} onDeleted={onDeleted} />}
    </main>
  );
}

/** Shared save/feedback plumbing for a section. */
function useSave(onSaved: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<{ error?: unknown }>, okText: string) => {
    setBusy(true); setMsg(null);
    const r = await fn();
    if (r.error) { setBusy(false); return setMsg({ ok: false, text: rpcError(r.error).message }); }
    await onSaved();
    setBusy(false); setMsg({ ok: true, text: okText });
  };
  return { busy, msg, setMsg, run };
}

function Section({ title, hint, children, msg }: { title: string; hint?: string; children: ReactNode; msg?: { ok: boolean; text: string } | null }) {
  return (
    <section className="td-panel td-form">
      <h2>{title}</h2>
      {hint && <p className="td-hint">{hint}</p>}
      {children}
      {msg && <div className={msg.ok ? 'td-ok' : 'td-warn'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
    </section>
  );
}

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="td-seg">
      {options.map(([v, l]) => <button type="button" key={String(v)} aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className="td-toggle" aria-pressed={on} onClick={() => onChange(!on)}>
      <span className="track"><span className="knob" /></span><span>{label}</span>
    </button>
  );
}

function EventSection({ ev, onSaved }: { ev: EventConfig; onSaved: () => Promise<void> }) {
  const [f, setF] = useState(ev);
  const { busy, msg, run } = useSave(onSaved);
  const set = (p: Partial<EventConfig>) => setF((x) => ({ ...x, ...p }));
  const dirty = (['name', 'club_name', 'starts_on', 'ends_on', 'palette', 'rounds', 'waves', 'use_checkin', 'use_sponsors', 'archived'] as const)
    .some((k) => f[k] !== ev[k]);
  const save = () => {
    if (!f.name.trim()) return;
    void run(() => api.updateEvent(ev.id, {
      name: f.name, club_name: f.club_name ?? '', starts_on: f.starts_on, ends_on: f.ends_on, palette: f.palette,
      rounds: f.rounds, waves: f.waves, use_checkin: f.use_checkin, use_sponsors: f.use_sponsors, archived: f.archived,
      r1_format: f.r1_format, r2_format: f.r2_format, dubs_style: f.dubs_style,
    }), 'Event saved.');
  };
  return (
    <Section title="Event" hint="Name, dates, look and format. Players see the name and palette on their scorecards and the leaderboard." msg={msg}>
      <div className="td-fields">
        <Field label="EVENT NAME"><input className="td-input" value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="CLUB"><input className="td-input" value={f.club_name ?? ''} onChange={(e) => set({ club_name: e.target.value })} /></Field>
        <Field label="STARTS"><input className="td-input" type="date" value={f.starts_on} onChange={(e) => set({ starts_on: e.target.value, ends_on: f.ends_on < e.target.value ? e.target.value : f.ends_on })} /></Field>
        <Field label="ENDS"><input className="td-input" type="date" value={f.ends_on} min={f.starts_on} onChange={(e) => set({ ends_on: e.target.value })} /></Field>
      </div>
      <div className="td-group">
        <div className="td-label">PALETTE</div>
        <div className="td-chips">
          {PALETTES.map((p) => (
            <button type="button" key={p.id} className="td-swatch" aria-pressed={f.palette === p.id} onClick={() => set({ palette: p.id })}>
              <span style={{ background: `linear-gradient(90deg, ${p.swatch.join(', ')})` }} />{p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="td-fields">
        <Field label="ROUNDS"><Seg value={f.rounds} options={[[1, '1 ROUND'], [2, '2 ROUNDS']]} onChange={(v) => set({ rounds: v })} /></Field>
        <Field label="WAVES"><Seg value={f.waves} options={[[1, 'SINGLE'], [2, 'AM / PM']]} onChange={(v) => set({ waves: v })} /></Field>
      </div>
      <div className="td-fields">
        <Field label="ROUND 1"><Seg value={f.r1_format} options={[['singles', 'SINGLES'], ['doubles', 'RANDOM DRAW DUBS']]} onChange={(v) => set({ r1_format: v })} /></Field>
        {f.rounds === 2 && <Field label="ROUND 2"><Seg value={f.r2_format} options={[['singles', 'SINGLES'], ['doubles', 'RANDOM DRAW DUBS']]} onChange={(v) => set({ r2_format: v })} /></Field>}
        {(f.r1_format === 'doubles' || (f.rounds === 2 && f.r2_format === 'doubles')) && (
          <Field label="DUBS STYLE (printed on cards)">
            <select className="td-select" value={f.dubs_style} onChange={(e) => set({ dubs_style: e.target.value as DubsStyle })}>
              {DUBS_STYLES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
        )}
      </div>
      {(f.r1_format === 'doubles' || (f.rounds === 2 && f.r2_format === 'doubles')) && (
        <div className="td-hint">Doubles: on the Cards tab you DRAW PARTNERS (random, re-drawable), then generate cards by team. An odd player out plays Cali (solo, two throws). Each round keeps its own results; bag tags only record from a singles round.</div>
      )}
      <div className="td-group">
        <Toggle on={f.use_checkin} label="Check-in: cards are built from checked-in players only" onChange={(v) => set({ use_checkin: v })} />
        <Toggle on={f.use_sponsors} label="Hole sponsors (DGS import, logos, hole assignment)" onChange={(v) => set({ use_sponsors: v })} />
        <Toggle on={f.archived} label="Archived (hidden from your event list)" onChange={(v) => set({ archived: v })} />
      </div>
      <div className="td-actions">
        <button className="td-btn cta" onClick={save} disabled={busy || !dirty || !f.name.trim()}>{busy ? 'SAVING…' : 'SAVE EVENT'}</button>
        {dirty && <button className="td-btn quiet" onClick={() => setF(ev)}>UNDO</button>}
      </div>
    </Section>
  );
}

function CourseSection({ eventId, holes, onSaved, admin, lib, onLib, linkedId }: {
  eventId: string; holes: HoleRow[]; onSaved: () => Promise<void>; admin: boolean; lib: LibCourse[]; onLib: () => Promise<void>; linkedId: string | null;
}) {
  const [rows, setRows] = useState(holes);
  // server truth changed (a save, or another tab): take it, without remounting (keeps the save message)
  const sig = JSON.stringify(holes);
  const [seen, setSeen] = useState(sig);
  if (seen !== sig) { setSeen(sig); setRows(holes); }
  const { busy, msg, setMsg, run } = useSave(onSaved);
  const dirty = JSON.stringify(rows) !== JSON.stringify(holes);
  const edit = (n: number, p: Partial<HoleRow>) => setRows((rs) => rs.map((h) => (h.n === n ? { ...h, ...p } : h)));
  const save = () => {
    const bad = holesProblem(rows);
    if (bad) return setMsg({ ok: false, text: bad });
    void run(() => api.setHoles(eventId, rows), `Course saved: ${rows.length} holes, par ${coursePar(rows)}.`);
  };
  return (
    <Section title="Course" hint="Holes are numbered 1 to N. Cards start on these holes (shotgun). Distance and OB show on the scorecard." msg={msg}>
      <LibraryBar eventId={eventId} linkedId={linkedId} holes={holes} dirty={dirty} admin={admin} lib={lib} onLib={onLib}
        onApplied={async () => { await onSaved(); await onLib(); }} />
      <div className="td-row">
        <Field label="HOLES">
          <input className="td-input" type="number" min={1} max={40} value={rows.length} style={{ maxWidth: 100 }}
            onChange={(e) => setRows(resizeHoles(rows, Number(e.target.value)))} />
        </Field>
        <div className="td-stat"><b>{coursePar(rows)}</b><span>PAR</span></div>
      </div>
      <div className="td-holes">
        <div className="td-hole hdr"><span>#</span><span>PAR</span><span>FEET</span><span>OB / NOTES</span></div>
        {rows.map((h) => (
          <div key={h.n} className="td-hole">
            <span className="td-ring sm">{h.n}</span>
            <select className="td-select" value={h.par} aria-label={`Hole ${h.n} par`} onChange={(e) => edit(h.n, { par: Number(e.target.value) })}>
              {[2, 3, 4, 5, 6].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <input className="td-input" inputMode="numeric" aria-label={`Hole ${h.n} distance in feet`} value={h.dist_ft ?? ''} placeholder="—"
              onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); edit(h.n, { dist_ft: v ? Number(v) : null }); }} />
            <input className="td-input" aria-label={`Hole ${h.n} OB notes`} value={h.ob ?? ''} placeholder="—" maxLength={120}
              onChange={(e) => edit(h.n, { ob: e.target.value || null })} />
          </div>
        ))}
      </div>
      <div className="td-actions">
        <button className="td-btn cta" onClick={save} disabled={busy || !dirty}>{busy ? 'SAVING…' : 'SAVE COURSE'}</button>
        {dirty && <button className="td-btn quiet" onClick={() => { setRows(holes); setMsg(null); }}>UNDO</button>}
      </div>
    </Section>
  );
}

function DivisionSection({ eventId, waves, divisions, players, onSaved }: {
  eventId: string; waves: 1 | 2; divisions: DivisionRow[]; players: ExistingPlayer[]; onSaved: () => Promise<void>;
}) {
  const base = divisions.map((d) => ({ code: d.code, wave: d.wave }));
  const [divs, setDivs] = useState<DivisionRow[]>(base);
  // server truth changed (a save, or switching to one wave): take it, without remounting
  const sig = `${waves}|${JSON.stringify(base)}`;
  const [seen, setSeen] = useState(sig);
  if (seen !== sig) { setSeen(sig); setDivs(base); }
  const { busy, msg, setMsg, run } = useSave(onSaved);
  const dirty = JSON.stringify(divs) !== JSON.stringify(base);
  const inUse = [...new Set(players.map((p) => p.div_code))];
  const save = () => {
    const bad = divisionsProblem(divs);
    if (bad) return setMsg({ ok: false, text: bad });
    void run(() => api.setDivisions(eventId, withWaves(divs, waves)), 'Divisions saved.');
  };
  return (
    <Section title="Divisions" msg={msg}
      hint={waves === 2 ? 'Order here is the order on the leaderboard. AM/PM is where each division starts in the Cards tab (you can still move them per round there).' : 'Order here is the order on the leaderboard and on cards.'}>
      <DivisionPicker divs={divs} waves={waves} locked={inUse} onChange={setDivs} />
      <div className="td-actions">
        <button className="td-btn cta" onClick={save} disabled={busy || !dirty}>{busy ? 'SAVING…' : 'SAVE DIVISIONS'}</button>
        {dirty && <button className="td-btn quiet" onClick={() => { setDivs(base); setMsg(null); }}>UNDO</button>}
      </div>
    </Section>
  );
}

function TdSection({ eventId, tds, admin, onSaved }: { eventId: string; tds: string[]; admin: boolean; onSaved: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const { busy, msg, setMsg, run } = useSave(onSaved);
  const signUp = `${window.location.origin}/td`;
  const add = () => {
    const e = normEmail(email);
    if (!emailOk(e)) return setMsg({ ok: false, text: 'That doesn’t look like an email address.' });
    if (tds.includes(e)) return setMsg({ ok: false, text: `${e} is already a TD here.` });
    void run(() => api.addTd(eventId, e), `Added ${e}. Send them ${signUp}: they create an account with that email, confirm it, and this event shows up.`);
    setEmail('');
  };
  return (
    <Section title="TDs" msg={msg}
      hint={admin ? `Who can run this event. They sign up at ${signUp} with the exact email you add here. They see only their events.` : 'Who can run this event. Ask the organizer to add or remove TDs.'}>
      {!tds.length && <p className="td-hint">No event TDs yet{admin ? ' (only you, as super admin).' : '.'}</p>}
      <ul className="td-list">
        {tds.map((t) => (
          <li key={t}>
            <span>{t}</span>
            {admin && <button className="td-btn quiet" disabled={busy} onClick={() => { if (window.confirm(`Remove ${t} as a TD of this event?`)) void run(() => api.removeTd(eventId, t), `Removed ${t}.`); }}>REMOVE</button>}
          </li>
        ))}
      </ul>
      {admin && (
        <div className="td-row">
          <input className="td-input" type="email" placeholder="tester@club.com" value={email} style={{ maxWidth: 320 }}
            onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
          <button className="td-btn cta" onClick={add} disabled={busy || !email.trim()}>ADD TD</button>
        </div>
      )}
    </Section>
  );
}

function DangerSection({ ev, onDeleted }: { ev: EventConfig; onDeleted: () => void }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const del = async () => {
    setBusy(true); setErr('');
    const r = await api.deleteEvent(ev.id);
    setBusy(false);
    if (r.error) return setErr(rpcError(r.error).message);
    onDeleted();
  };
  return (
    <Section title="Delete event" hint="Deletes the event with its players, cards, scores and sign-offs. There is no undo. Archive it instead if you might want it back.">
      <div className="td-row">
        <input className="td-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={`Type ${ev.name} to confirm`} style={{ maxWidth: 360 }} />
        <button className="td-btn danger" disabled={busy || text.trim() !== ev.name} onClick={() => void del()}>{busy ? 'DELETING…' : 'DELETE FOREVER'}</button>
      </div>
      {err && <div className="td-warn" role="alert">{err}</div>}
    </Section>
  );
}
