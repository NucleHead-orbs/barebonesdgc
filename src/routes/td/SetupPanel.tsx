import { useCallback, useEffect, useState, type ReactNode } from 'react';
import * as api from '../../lib/td/api';
import { rpcError, type ExistingPlayer } from '../../lib/td/builder';
import {
  PALETTES, coursePar, ctpHoles, divisionsProblem, emailOk, holesProblem, normEmail, resizeHoles, withWaves,
  type DivisionRow, type EventConfig, type EventKind, type HoleRow,
  DUBS_STYLES, type DubsStyle,
} from '../../lib/td/setup';
import { DivisionPicker, Field } from './EventHub';
import { LibraryBar } from './CourseLibrary';
import { sortLibrary, type LibCourse } from '../../lib/courses/courses';
import type { HoleTee } from '../../lib/proofs/teeSigns';
import { loadPools } from '../../lib/tags/api';
import type { TagPool } from '../../lib/tags/tags';

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
      <KindSection ev={ev} onSaved={onSaved} />
      <EventSection ev={ev} onSaved={onSaved} />
      <CourseSection eventId={ev.id} holes={setup.holes} onSaved={onSaved} admin={admin} lib={lib} onLib={loadLib} linkedId={ev.course_layout_id ?? null} />
      <CtpSection eventId={ev.id} holes={setup.holes} onSaved={onSaved} />
      {ev.kind !== 'league' && <TeePadSection eventId={ev.id} holes={setup.holes} />}
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

/** Event (tournament) or League (weekly night). Changes the tabs; a league picks its tag set. */
function KindSection({ ev, onSaved }: { ev: EventConfig; onSaved: () => Promise<void> }) {
  const kind: EventKind = ev.kind ?? 'event';
  const [pools, setPools] = useState<TagPool[]>([]);
  const [k, setK] = useState<EventKind>(kind);
  const [pool, setPool] = useState(ev.tag_pool_id ?? '');
  const { busy, msg, run } = useSave(onSaved);
  useEffect(() => { void (async () => { const r = await loadPools(); if (r.data) setPools(r.data.filter((p) => !p.invite_only)); })(); }, []);
  const dirty = k !== kind || (k === 'league' && pool !== (ev.tag_pool_id ?? ''));
  return (
    <Section title="Event or league" hint={k === 'league'
      ? 'League night: one day, one round. No PREP, CREW or EARLY ACCESS. TAGS records your league\'s tag set from tonight\'s scores.'
      : 'Tournament: PREP (checklist, shirts, designs), CREW (helper links, stations) and EARLY ACCESS are on.'} msg={msg}>
      <Seg value={k} options={[['event', 'EVENT'], ['league', 'LEAGUE']]} onChange={setK} />
      {k === 'league' && (
        <Field label="LEAGUE TAG SET">
          <select className="td-select" value={pool} onChange={(e) => setPool(e.target.value)}>
            <option value="">None (no tags)</option>
            {pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      )}
      {k === 'league' && (ev.rounds === 2 || ev.waves === 2 || ev.ends_on !== ev.starts_on) && (
        <div className="td-hint">Saving the Event section below sets this to one day, one round, one wave.</div>
      )}
      <div className="td-actions">
        <button className="td-btn cta" disabled={busy || !dirty} onClick={() => void run(() => api.setLeague(ev.id, k, k === 'league' ? pool || null : null), k === 'league' ? 'League mode on.' : 'Event mode on.')}>
          {busy ? 'SAVING…' : 'SAVE'}</button>
      </div>
    </Section>
  );
}

/** Closest-to-the-pin holes and their prizes. Scorecards flag these holes. */
function CtpSection({ eventId, holes, onSaved }: { eventId: string; holes: HoleRow[]; onSaved: () => Promise<void> }) {
  const ctps = ctpHoles(holes);
  const free = holes.filter((h) => !h.ctp_prize);
  const [n, setN] = useState('');
  const [prize, setPrize] = useState('');
  const [edit, setEdit] = useState<Record<number, string>>({});
  const { busy, msg, run } = useSave(onSaved);
  const add = () => {
    const hole = Number(n);
    if (!hole || !prize.trim()) return;
    void run(() => api.setCtp(eventId, hole, prize.trim()), `Hole ${hole} is a CTP.`).then(() => { setN(''); setPrize(''); });
  };
  return (
    <Section title="CTP holes" hint="Closest to the pin. Pick the hole and what it pays. Players get a heads-up animation when they reach it on their scorecard. Duplicating for next week keeps these." msg={msg}>
      {ctps.length > 0 && (
        <ul className="td-ctps">
          {ctps.map((c) => (
            <li key={c.n}>
              <b>Hole {c.n}</b>
              <input className="td-input" aria-label={`Hole ${c.n} CTP prize`} maxLength={60} value={edit[c.n] ?? c.prize}
                onChange={(e) => setEdit({ ...edit, [c.n]: e.target.value })} />
              {(edit[c.n] ?? c.prize) !== c.prize && edit[c.n]?.trim() && (
                <button className="td-btn quiet" disabled={busy} onClick={() => void run(() => api.setCtp(eventId, c.n, edit[c.n]), `Hole ${c.n} prize saved.`)}>SAVE</button>
              )}
              <button className="td-link danger" disabled={busy} onClick={() => void run(() => api.setCtp(eventId, c.n, ''), `Hole ${c.n} is no longer a CTP.`)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      {holes.length === 0 ? <div className="td-hint">Set up the course first.</div> : (
        <form className="td-row" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <select className="td-select" aria-label="CTP hole" value={n} onChange={(e) => setN(e.target.value)}>
            <option value="">Hole…</option>
            {free.map((h) => <option key={h.n} value={h.n}>Hole {h.n} · par {h.par}{h.dist_ft ? ` · ${h.dist_ft} ft` : ''}</option>)}
          </select>
          <input className="td-input" style={{ flex: '1 1 180px' }} aria-label="CTP prize" placeholder="Prize (e.g. $20 + a disc)" maxLength={60} value={prize} onChange={(e) => setPrize(e.target.value)} />
          <button className="td-btn cta" disabled={busy || !n || !prize.trim()}>ADD CTP</button>
        </form>
      )}
    </Section>
  );
}

function EventSection({ ev, onSaved }: { ev: EventConfig; onSaved: () => Promise<void> }) {
  const [f, setF] = useState(ev);
  const { busy, msg, run } = useSave(onSaved);
  const set = (p: Partial<EventConfig>) => setF((x) => ({ ...x, ...p }));
  const dirty = (['name', 'club_name', 'starts_on', 'ends_on', 'palette', 'rounds', 'waves', 'use_checkin', 'use_sponsors', 'archived'] as const)
    .some((k) => f[k] !== ev[k]);
  const league = ev.kind === 'league';
  const save = () => {
    if (!f.name.trim()) return;
    void run(() => api.updateEvent(ev.id, {
      name: f.name, club_name: f.club_name ?? '', starts_on: f.starts_on, ends_on: league ? f.starts_on : f.ends_on, palette: f.palette,
      rounds: league ? 1 : f.rounds, waves: league ? 1 : f.waves, use_checkin: f.use_checkin, use_sponsors: f.use_sponsors, archived: f.archived,
      r1_format: f.r1_format, r2_format: f.r2_format, dubs_style: f.dubs_style,
    }), 'Event saved.');
  };
  return (
    <Section title="Event" hint="Name, dates, look and format. Players see the name and palette on their scorecards and the leaderboard." msg={msg}>
      <div className="td-fields">
        <Field label="EVENT NAME"><input className="td-input" value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="CLUB"><input className="td-input" value={f.club_name ?? ''} onChange={(e) => set({ club_name: e.target.value })} /></Field>
        <Field label={league ? 'DATE' : 'STARTS'}><input className="td-input" type="date" value={f.starts_on} onChange={(e) => set({ starts_on: e.target.value, ends_on: league || f.ends_on < e.target.value ? e.target.value : f.ends_on })} /></Field>
        {!league && <Field label="ENDS"><input className="td-input" type="date" value={f.ends_on} min={f.starts_on} onChange={(e) => set({ ends_on: e.target.value })} /></Field>}
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
      {!league && (
        <div className="td-fields">
          <Field label="ROUNDS"><Seg value={f.rounds} options={[[1, '1 ROUND'], [2, '2 ROUNDS']]} onChange={(v) => set({ rounds: v })} /></Field>
          <Field label="WAVES"><Seg value={f.waves} options={[[1, 'SINGLE'], [2, 'AM / PM']]} onChange={(v) => set({ waves: v })} /></Field>
        </div>
      )}
      <div className="td-fields">
        <Field label={league ? 'FORMAT' : 'ROUND 1'}><Seg value={f.r1_format} options={[['singles', 'SINGLES'], ['doubles', 'RANDOM DRAW DUBS']]} onChange={(v) => set({ r1_format: v })} /></Field>
        {!league && f.rounds === 2 && <Field label="ROUND 2"><Seg value={f.r2_format} options={[['singles', 'SINGLES'], ['doubles', 'RANDOM DRAW DUBS']]} onChange={(v) => set({ r2_format: v })} /></Field>}
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

/**
 * Extra tee pads (hole_tees). Each pad is its own tee sign and can be sponsored like a full hole.
 * Scoring is unchanged: everyone scores by hole. Saves as you go.
 */
function TeePadSection({ eventId, holes }: { eventId: string; holes: HoleRow[] }) {
  const [tees, setTees] = useState<HoleTee[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [n, setN] = useState<number>(holes[0]?.n ?? 1);
  const [label, setLabel] = useState('AM pad');
  const reload = useCallback(async () => {
    const r = await api.loadTees(eventId);
    if (r.error) setMsg({ ok: false, text: rpcError(r.error).message }); else setTees(r.data ?? []);
  }, [eventId]);
  useEffect(() => { void (async () => { await reload(); })(); }, [reload]);
  const act = async (fn: () => Promise<{ error?: unknown }>, ok: string) => {
    const r = await fn();
    const dup = (r.error as { code?: string } | undefined)?.code === '23505';
    setMsg(r.error ? { ok: false, text: dup ? 'That hole already has a pad with that name.' : rpcError(r.error).message } : { ok: true, text: ok });
    await reload();
  };
  const list = tees ?? [];
  return (
    <Section title="Extra tee pads" msg={msg}
      hint="Holes with a second tee (Rec / Ladies pad, AM pad…). Each pad gets its own tee sign and can be sponsored like a full hole. Scoring doesn't change: everyone scores by hole.">
      {tees === null ? <p className="td-empty">Loading…</p> : !list.length ? <p className="td-empty">No extra pads. Every hole has one tee sign.</p> : (
        <div className="td-holes td-pads">
          <div className="td-hole hdr"><span>HOLE</span><span>PAD NAME</span><span>FEET</span><span>PAR</span><span /></div>
          {list.map((t) => (
            <div key={t.id} className="td-hole">
              <span className="td-ring sm">{t.n}</span>
              <input className="td-input" aria-label={`Hole ${t.n} pad name`} defaultValue={t.label} key={`l${t.label}`} maxLength={30}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.label) void act(() => api.updateTee(t.id, { label: v }), 'Pad renamed.'); }} />
              <input className="td-input" inputMode="numeric" aria-label={`Hole ${t.n} ${t.label} feet`} placeholder="—" defaultValue={t.dist_ft ?? ''} key={`d${t.dist_ft}`}
                onBlur={(e) => { const v = e.target.value.replace(/\D/g, ''); const d = v ? Math.min(2000, Number(v)) : null; if (d !== t.dist_ft) void act(() => api.updateTee(t.id, { dist_ft: d }), 'Feet saved.'); }} />
              <select className="td-select" aria-label={`Hole ${t.n} ${t.label} par`} value={t.par ?? ''}
                onChange={(e) => void act(() => api.updateTee(t.id, { par: e.target.value ? Number(e.target.value) : null }), 'Par saved.')}>
                <option value="">Same</option>
                {[2, 3, 4, 5, 6].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <button className="td-btn quiet" onClick={() => { if (window.confirm(`Remove the ${t.label} on hole ${t.n}? Its sponsors go back on the hole's main tee sign.`)) void act(() => api.deleteTee(t.id), 'Pad removed.'); }}>REMOVE</button>
            </div>
          ))}
        </div>
      )}
      <div className="td-row">
        <Field label="HOLE">
          <select className="td-select" value={n} onChange={(e) => setN(Number(e.target.value))}>
            {holes.map((h) => <option key={h.n} value={h.n}>Hole {h.n}</option>)}
          </select>
        </Field>
        <Field label="PAD NAME">
          <input className="td-input" value={label} maxLength={30} onChange={(e) => setLabel(e.target.value)} placeholder="AM pad" />
        </Field>
        <button className="td-btn" disabled={!label.trim()}
          onClick={() => void act(() => api.addTee(eventId, n, label, list.filter((t) => t.n === n).length + 1), `Added ${label.trim()} on hole ${n}.`)}>+ ADD PAD</button>
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
