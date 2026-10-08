import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../../lib/td/api';
import { rpcError, type ExistingPlayer } from '../../lib/td/builder';
import type { CrewMember } from '../../lib/crew/crew';
import ContactsPanel from './ContactsPanel';
import { isAmateur, packCount, packRows } from '../../lib/prep/packs';
import {
  DESIGN_CATEGORIES, MAX_FILE_BYTES, SIZES, STATUS_LABEL, TASK_CATEGORIES, designCategoryLabel, dueDate, fmtBytes, fmtDay,
  isImage, latest, localToday, normalizeSize, offsetLabel, orderCsv, rollup, shirtTally, sortTasks, starterToAdd,
  taskCategoryLabel, taskState, zipEntries, type DesignAsset, type DesignStatus, type PrepTask, type TaskState,
} from '../../lib/prep/prep';

import { ProofView } from '../../components/proofs/Proofs';
import { PROOF_CATEGORY, PROOF_KINDS, PROOF_LABEL, type ProofKind } from '../../lib/proofs/proofs';
const DiscOrderPanel = lazy(() => import('./DiscOrderPanel'));
const VotesPanel = lazy(() => import('./VotesPanel'));
type View = 'dash' | 'tasks' | 'shirts' | 'packs' | 'designs' | 'votes' | 'innova' | 'contacts';
const VIEWS: Array<[View, string]> = [['dash', 'DASHBOARD'], ['tasks', 'TASKS'], ['shirts', 'SHIRTS'], ['packs', 'PACK BAGS'], ['designs', 'DESIGNS'], ['votes', 'VOTES'], ['innova', 'INNOVA ORDER'], ['contacts', 'CONTACTS']];
const STATE_LABEL: Record<TaskState, string> = { done: 'DONE', overdue: 'OVERDUE', soon: 'THIS WEEK', later: 'LATER', nodate: 'NO DATE' };
const SHARE_DAYS = 7;
const CORE_SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL'];

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const slug = (s: string) => s.replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'event';

/**
 * Event prep: Dashboard · Tasks · Shirts · Designs. TD-only (RLS by can_td; files in the private event-assets bucket).
 * Task due dates are relative to the event start, so a duplicated event's checklist lines up automatically.
 */
export default function PrepPanel({ setup, players, onPlayers, email }: {
  setup: api.EventSetup; players: ExistingPlayer[]; onPlayers: (p: ExistingPlayer[]) => void; email: string;
}) {
  const ev = setup.event;
  const [data, setData] = useState<api.PrepData | null>(null);
  const [view, setView] = useState<View>('dash');
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const today = localToday();
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [notes, setNotes] = useState<api.TaskNote[]>([]);

  const load = useCallback(async () => {
    const [r, c, n] = await Promise.all([api.loadPrep(ev.id), api.loadCrew(ev.id), api.loadTaskNotes(ev.id)]);
    if (r.error || !r.data) return setErr(rpcError(r.error).message);
    setData(r.data);
    if (c.data) setCrew(c.data.crew.filter((x) => !x.revoked_at));
    if (n.data) setNotes(n.data);
  }, [ev.id]);
  useEffect(() => { void (async () => { await load(); })(); }, [load]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t); }, [toast]);

  const tally = useMemo(() => shirtTally(players.map((p) => ({ name: p.name, shirt_size: p.shirt_size ?? null })), data?.order.extras ?? {}), [players, data?.order.extras]);

  if (!data) return <main className="td-main">{err ? <div className="td-warn" role="alert">{err}</div> : <p className="td-empty">Loading…</p>}</main>;

  const fail = (what: string) => (e: unknown) => setErr(`${what}: ${rpcError(e).message}`);
  const patchTasks = (fn: (t: PrepTask[]) => PrepTask[]) => setData((d) => (d ? { ...d, tasks: fn(d.tasks) } : d));
  const patchAssets = (fn: (a: DesignAsset[]) => DesignAsset[]) => setData((d) => (d ? { ...d, assets: fn(d.assets) } : d));
  const ctx: Ctx = { ev, data, setData, patchTasks, patchAssets, fail, setToast, email, today, tds: setup.tds, crew, notes,
    addNote: async (taskId: string, body: string) => {
      const r = await api.addTaskNote(ev.id, taskId, email, body);
      if (r.error || !r.data) { fail('Update')(r.error); return false; }
      setNotes((ns) => [...ns, r.data!]);
      return true;
    } };

  return (
    <main className="td-main">
      {toast && <div className="td-ok" role="status">{toast}</div>}
      {err && <div className="td-warn" role="alert">{err} <button className="td-btn quiet" onClick={() => setErr('')}>DISMISS</button></div>}
      <div className="td-row">
        <h2 className="td-h2">Event prep</h2>
        <div className="td-seg" role="tablist" aria-label="Prep views">
          {VIEWS.map(([v, l]) => <button key={v} role="tab" aria-selected={view === v} aria-pressed={view === v} onClick={() => setView(v)}>{l}</button>)}
        </div>
      </div>
      {view === 'dash' && <Dashboard ctx={ctx} tally={tally} go={setView} />}
      {view === 'tasks' && <Tasks ctx={ctx} />}
      {view === 'shirts' && <Shirts ctx={ctx} tally={tally} players={players} onPlayers={onPlayers} />}
      {view === 'packs' && <Packs ev={ev} players={players} divisions={setup.divisions} />}
      {view === 'designs' && <Designs ctx={ctx} />}
      {view === 'votes' && <Suspense fallback={<p className="td-empty">Loading…</p>}><VotesPanel eventId={ev.id} email={email} assets={data.assets} creditLabel={data.creditLabel} onToast={setToast} /></Suspense>}
      {view === 'innova' && <Suspense fallback={<p className="td-empty">Loading…</p>}><DiscOrderPanel ev={ev} email={email} /></Suspense>}
      {view === 'contacts' && <ContactsPanel eventId={ev.id} email={email} useSponsors={ev.use_sponsors} />}
    </main>
  );
}

interface Ctx {
  ev: api.EventSetup['event']; data: api.PrepData; setData: (d: api.PrepData) => void;
  patchTasks: (fn: (t: PrepTask[]) => PrepTask[]) => void; patchAssets: (fn: (a: DesignAsset[]) => DesignAsset[]) => void;
  fail: (what: string) => (e: unknown) => void; setToast: (s: string) => void; email: string; today: string; tds: string[];
  crew: CrewMember[]; notes: api.TaskNote[]; addNote: (taskId: string, body: string) => Promise<boolean>;
}

const Stat = ({ v, k, color = 'var(--fg-1)' }: { v: string | number; k: string; color?: string }) => (
  <div className="td-stat"><b style={{ color }}>{v}</b><span>{k}</span></div>
);

// ---------- dashboard ----------
function Dashboard({ ctx, tally, go }: { ctx: Ctx; tally: ReturnType<typeof shirtTally>; go: (v: View) => void }) {
  const { ev, data, today } = ctx;
  const r = rollup({ startsOn: ev.starts_on, today, tasks: data.tasks, tally, ordered: !!data.order.ordered_at, assets: data.assets });
  const toggle = useToggleDone(ctx);
  return (
    <>
      <section className="td-panel">
        <div className="td-row">
          <div className="td-counts">
            <Stat v={r.daysOut > 0 ? r.daysOut : r.daysOut === 0 ? 'TODAY' : 'DONE'} k={r.daysOut > 0 ? 'DAYS OUT' : 'EVENT'} color="var(--cyan)" />
            <Stat v={`${r.tasks.pct}%`} k={`${r.tasks.done}/${r.tasks.total} TASKS`} color="var(--under)" />
            <Stat v={r.tasks.overdue} k="OVERDUE" color={r.tasks.overdue ? 'var(--error)' : 'var(--fg-1)'} />
            <Stat v={r.tasks.soon} k="DUE THIS WEEK" color={r.tasks.soon ? 'var(--gold)' : 'var(--fg-1)'} />
          </div>
        </div>
        <div className="td-progress" role="progressbar" aria-label="Tasks done" aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.tasks.pct}>
          <span style={{ width: `${r.tasks.pct}%` }} />
        </div>
        {!data.tasks.length && <div className="td-row"><span className="td-hint">No checklist yet.</span><button className="td-btn cyan" onClick={() => go('tasks')}>START THE CHECKLIST</button></div>}
      </section>

      {r.next.length > 0 && (
        <section className="td-panel">
          <div className="td-row"><h2>Up next</h2><div style={{ flex: 1 }} /><button className="td-link" onClick={() => go('tasks')}>All tasks</button></div>
          <ul className="td-tasks">
            {r.next.map((t) => (
              <li key={t.id} className={`td-task is-${t.state}`}>
                <input type="checkbox" checked={false} aria-label={`Mark "${t.title}" done`} onChange={() => void toggle(t)} />
                <div className="td-task-main"><b>{t.title}</b><span>{t.due ? fmtDay(t.due) : 'no date'}{t.assignee ? ` · ${t.assignee}` : ''}</span></div>
                <span className={`td-due is-${t.state}`}>{STATE_LABEL[t.state]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="td-grid">
        <button className="td-panel td-tile" onClick={() => go('shirts')}>
          <h2>Shirts</h2>
          <div className="td-counts"><Stat v={r.shirts.total} k="TO ORDER" color="var(--cyan)" /><Stat v={r.shirts.missing} k="NO SIZE" color={r.shirts.missing ? 'var(--gold)' : 'var(--fg-1)'} /></div>
          <span className="td-hint">{r.shirts.ordered ? `Ordered ${new Date(data.order.ordered_at!).toLocaleDateString()}` : 'Not ordered yet'}{r.shirts.unknown ? ` · ${r.shirts.unknown} odd size${r.shirts.unknown === 1 ? '' : 's'} to check` : ''}</span>
        </button>
        <button className="td-panel td-tile" onClick={() => go('designs')}>
          <h2>Designs</h2>
          <div className="td-counts"><Stat v={r.designs.total} k="DESIGNS" color="var(--cyan)" /><Stat v={r.designs.approved} k="APPROVED" color="var(--under)" /></div>
          <span className="td-hint">
            {r.designs.byCategory.filter((c) => c.count).map((c) => `${designCategoryLabel(c.category, data.creditLabel)} ${c.approved}/${c.count}`).join(' · ') || 'Nothing uploaded yet'}
          </span>
        </button>
      </div>
    </>
  );
}

function useToggleDone(ctx: Ctx) {
  return async (t: PrepTask) => {
    const done = !t.done_at;
    const patch = { done_at: done ? new Date().toISOString() : null, done_by: done ? ctx.email : null };
    ctx.patchTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, ...patch } : x)));
    const r = await api.updateTask(t.id, patch);
    if (r.error) { ctx.patchTasks((ts) => ts.map((x) => (x.id === t.id ? t : x))); ctx.fail(t.title)(r.error); }
  };
}

// ---------- tasks ----------
type Filter = 'open' | 'mine' | 'all';
function Tasks({ ctx }: { ctx: Ctx }) {
  const { ev, data, today, email } = ctx;
  const [filter, setFilter] = useState<Filter>('open');
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [cat, setCat] = useState('general');
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = useToggleDone(ctx);
  const me = email.toLowerCase();
  const shown = sortTasks(data.tasks).filter((t) => filter === 'all' || (!t.done_at && (filter === 'open' || t.assignee === me)));
  const toAdd = starterToAdd(data.tasks);

  const add = async () => {
    const d = days.trim() === '' ? null : Math.round(Number(days));
    if (!title.trim() || (d != null && !Number.isFinite(d))) return;
    setBusy(true);
    const r = await api.addTasks(ev.id, [{ title: title.trim().slice(0, 140), category: cat, due_offset_days: d == null ? null : -d, sort: Math.max(0, ...data.tasks.map((t) => t.sort)) + 1 }]);
    setBusy(false);
    if (r.error || !r.data) return ctx.fail('Add task')(r.error);
    ctx.patchTasks((ts) => [...ts, ...r.data!]);
    setTitle(''); setDays('');
  };
  const loadStarter = async () => {
    setBusy(true);
    const r = await api.addTasks(ev.id, toAdd);
    setBusy(false);
    if (r.error || !r.data) return ctx.fail('Starter checklist')(r.error);
    ctx.patchTasks((ts) => [...ts, ...r.data!]);
    ctx.setToast(`Added ${r.data.length} tasks. Due dates count back from ${fmtDay(ev.starts_on)}.`);
  };

  return (
    <>
      <section className="td-panel">
        <div className="td-row">
          <div className="td-seg">
            {(['open', 'mine', 'all'] as Filter[]).map((f) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === 'open' ? 'TO DO' : f === 'mine' ? 'MINE' : 'ALL'}</button>)}
          </div>
          <div style={{ flex: 1 }} />
          {toAdd.length > 0 && <button className="td-btn cyan" disabled={busy} onClick={() => void loadStarter()}>
            {data.tasks.length ? `ADD ${toAdd.length} STARTER TASKS` : 'LOAD STARTER CHECKLIST'}</button>}
        </div>
        <form className="td-row" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <input className="td-input" style={{ flex: '2 1 220px' }} aria-label="New task" placeholder="New task…" maxLength={140} value={title} onChange={(e) => setTitle(e.target.value)} />
          <select className="td-select" aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}>
            {TASK_CATEGORIES.map((c) => <option key={c} value={c}>{taskCategoryLabel(c)}</option>)}
          </select>
          <label className="td-inline">
            <input className="td-input" style={{ width: 70 }} inputMode="numeric" aria-label="Days before the event" placeholder="—" value={days}
              onChange={(e) => setDays(e.target.value.replace(/[^0-9-]/g, ''))} />
            <span className="td-hint">days before</span>
          </label>
          <button className="td-btn cta" disabled={busy || !title.trim()}>ADD</button>
        </form>
      </section>

      {!shown.length && <div className="td-empty">{data.tasks.length ? 'Nothing here. Nice.' : 'No tasks yet. Load the starter checklist or add your own.'}</div>}
      <ul className="td-tasks">
        {shown.map((t) => {
          const st = taskState(t, ev.starts_on, today);
          const due = dueDate(ev.starts_on, t);
          return (
            <li key={t.id} className={`td-task is-${st}`}>
              <input type="checkbox" checked={!!t.done_at} aria-label={`${t.title} done`} onChange={() => void toggle(t)} />
              <div className="td-task-main">
                <b>{t.title}</b>
                <span>
                  {taskCategoryLabel(t.category)} · {due ? `${fmtDay(due)} (${offsetLabel(t.due_offset_days)})` : 'no date'}
                  {t.crew_id ? ` · ${ctx.crew.find((c) => c.id === t.crew_id)?.name ?? 'crew'}` : t.assignee ? ` · ${t.assignee}` : ''}{t.done_at ? ` · done${t.done_by ? ` by ${t.done_by}` : ''}` : ''}
                  {(() => { const k = ctx.notes.filter((n) => n.task_id === t.id).length; return k ? ` · ${k} update${k === 1 ? '' : 's'}` : ''; })()}
                </span>
                {t.notes && <span className="td-task-notes">{t.notes}</span>}
              </div>
              <span className={`td-due is-${st}`}>{STATE_LABEL[st]}</span>
              <button className="td-link" onClick={() => setEditing(editing === t.id ? null : t.id)}>{editing === t.id ? 'Close' : 'Edit'}</button>
              {editing === t.id && <TaskEditor ctx={ctx} t={t} onDone={() => setEditing(null)} />}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function TaskEditor({ ctx, t, onDone }: { ctx: Ctx; t: PrepTask; onDone: () => void }) {
  const [title, setTitle] = useState(t.title);
  const [cat, setCat] = useState(t.category);
  const [days, setDays] = useState(t.due_offset_days == null ? '' : String(-t.due_offset_days));
  const [who, setWho] = useState(t.crew_id ? `crew:${t.crew_id}` : t.assignee ?? '');
  const [notes, setNotes] = useState(t.notes ?? '');
  const [update, setUpdate] = useState('');
  const thread = ctx.notes.filter((n) => n.task_id === t.id);
  const people = Array.from(new Set([ctx.email.toLowerCase(), ...ctx.tds.map((e) => e.toLowerCase()), ...(t.assignee ? [t.assignee] : [])]));
  const save = async () => {
    const d = days.trim() === '' ? null : Math.round(Number(days));
    if (!title.trim() || (d != null && !Number.isFinite(d))) return;
    const toCrew = who.startsWith('crew:');
    const patch = { title: title.trim().slice(0, 140), category: cat, due_offset_days: d == null ? null : -d,
      assignee: toCrew ? null : who || null, crew_id: toCrew ? who.slice(5) : null, notes: notes.trim() || null };
    const r = await api.updateTask(t.id, patch);
    if (r.error || !r.data) return ctx.fail(t.title)(r.error);
    ctx.patchTasks((ts) => ts.map((x) => (x.id === t.id ? r.data! : x)));
    onDone();
  };
  const remove = async () => {
    if (!window.confirm(`Delete "${t.title}"?`)) return;
    const r = await api.deleteTask(t.id);
    if (r.error) return ctx.fail(t.title)(r.error);
    ctx.patchTasks((ts) => ts.filter((x) => x.id !== t.id));
  };
  return (
    <div className="td-task-edit">
      <input className="td-input" aria-label="Task title" maxLength={140} value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="td-row">
        <select className="td-select" aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}>
          {TASK_CATEGORIES.map((c) => <option key={c} value={c}>{taskCategoryLabel(c)}</option>)}
        </select>
        <label className="td-inline">
          <input className="td-input" style={{ width: 70 }} inputMode="numeric" aria-label="Days before the event" value={days} onChange={(e) => setDays(e.target.value.replace(/[^0-9-]/g, ''))} />
          <span className="td-hint">days before (negative = after)</span>
        </label>
        <select className="td-select" aria-label="Assigned to" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Nobody</option>
          <optgroup label="TDs">{people.map((p) => <option key={p} value={p}>{p}</option>)}</optgroup>
          {ctx.crew.length > 0 && <optgroup label="Crew">{ctx.crew.map((c) => <option key={c.id} value={`crew:${c.id}`}>{c.name}</option>)}</optgroup>}
        </select>
      </div>
      <textarea className="td-input" aria-label="Notes" rows={2} maxLength={1000} placeholder="Notes (vendor, phone, links…)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      {thread.map((n) => <p key={n.id} className="td-update"><b>{n.author}</b> <span className="td-hint">{new Date(n.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span><br />{n.body}</p>)}
      <div className="td-row">
        <input className="td-input" style={{ flex: 1 }} aria-label="Post an update" placeholder="Post an update (crew see it)…" maxLength={1000} value={update} onChange={(e) => setUpdate(e.target.value)} />
        <button className="td-btn cyan" disabled={!update.trim()} onClick={async () => { if (await ctx.addNote(t.id, update)) setUpdate(''); }}>POST</button>
      </div>
      <div className="td-row">
        <button className="td-btn cta" onClick={() => void save()}>SAVE</button>
        <button className="td-btn quiet" onClick={onDone}>CANCEL</button>
        <div style={{ flex: 1 }} />
        <button className="td-btn quiet" onClick={() => void remove()}>DELETE</button>
      </div>
    </div>
  );
}

// ---------- shirts ----------
function Shirts({ ctx, tally, players, onPlayers }: {
  ctx: Ctx; tally: ReturnType<typeof shirtTally>; players: ExistingPlayer[]; onPlayers: (p: ExistingPlayer[]) => void;
}) {
  const { ev, data } = ctx;
  const o = data.order;
  const [onlyMissing, setOnlyMissing] = useState(true);
  const save = async (next: api.ShirtOrder) => {
    ctx.setData({ ...data, order: next });
    const r = await api.saveShirtOrder(ev.id, next);
    if (r.error) ctx.fail('Shirt order')(r.error);
  };
  const setExtra = (size: string, v: string) => {
    const n = Math.max(0, Math.floor(Number(v) || 0));
    const extras = { ...o.extras };
    if (n) extras[size] = n; else delete extras[size];
    void save({ ...o, extras });
  };
  const setSize = async (p: ExistingPlayer, v: string) => {
    const size = v || null;
    onPlayers(players.map((x) => (x.id === p.id ? { ...x, shirt_size: size } : x)));
    const r = await api.setShirtSize(p.id, size);
    if (r.error) ctx.fail(p.name)(r.error);
  };
  const shownSizes = SIZES.filter((s) => CORE_SIZES.includes(s) || tally.rows.some((r) => r.size === s));
  const row = (s: string) => tally.rows.find((r) => r.size === s);
  const list = players.filter((p) => !onlyMissing || !p.shirt_size || !normalizeSize(p.shirt_size))
    .slice().sort((a, b) => a.name.localeCompare(b.name));
  const exportCsv = () => saveBlob(new Blob([orderCsv(tally)], { type: 'text/csv' }), `${slug(ev.name)}-shirt-order.csv`);

  return (
    <>
      <section className="td-panel">
        <div className="td-row">
          <h2>Order</h2>
          <div className="td-counts"><Stat v={tally.total} k="TOTAL" color="var(--cyan)" /><Stat v={tally.missing} k="NO SIZE" color={tally.missing ? 'var(--gold)' : 'var(--fg-1)'} /></div>
          <div style={{ flex: 1 }} />
          <button className="td-btn cyan" onClick={exportCsv} disabled={!tally.total}>DOWNLOAD CSV</button>
          <button className={`td-btn ${o.ordered_at ? 'quiet' : 'cta'}`} onClick={() => void save({ ...o, ordered_at: o.ordered_at ? null : new Date().toISOString() })}>
            {o.ordered_at ? `ORDERED ${new Date(o.ordered_at).toLocaleDateString()} · UNDO` : 'MARK ORDERED'}
          </button>
        </div>
        <table className="td-table td-shirts">
          <thead><tr><th>SIZE</th><th>REGISTERED</th><th>EXTRAS</th><th>ORDER</th></tr></thead>
          <tbody>
            {shownSizes.map((s) => (
              <tr key={s}>
                <td><b>{s}</b></td>
                <td>{row(s)?.registered ?? 0}</td>
                <td><ExtraBox size={s} value={o.extras[s] ?? 0} onCommit={(v) => setExtra(s, v)} /></td>
                <td><b>{row(s)?.total ?? 0}</b></td>
              </tr>
            ))}
            <tr><td><b>TOTAL</b></td><td>{tally.rows.reduce((a, r) => a + r.registered, 0)}</td><td>{tally.rows.reduce((a, r) => a + r.extra, 0)}</td><td><b>{tally.total}</b></td></tr>
          </tbody>
        </table>
        <div className="td-row">
          <label className="td-field" style={{ flex: '1 1 200px' }}>
            <span className="td-label">VENDOR</span>
            <input className="td-input" aria-label="Vendor" maxLength={120} defaultValue={o.vendor ?? ''} onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== o.vendor) void save({ ...o, vendor: v }); }} />
          </label>
          <label className="td-field" style={{ flex: '2 1 280px' }}>
            <span className="td-label">NOTES</span>
            <input className="td-input" aria-label="Order notes" maxLength={1000} placeholder="Colors, print locations, due date…" defaultValue={o.notes ?? ''}
              onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== o.notes) void save({ ...o, notes: v }); }} />
          </label>
        </div>
        {tally.unknown.length > 0 && <div className="td-warn soft">Not counted (size not recognized): {tally.unknown.map((u) => `${u.name} "${u.raw}"`).join(', ')}. Fix them below.</div>}
      </section>

      <section className="td-panel">
        <div className="td-row">
          <h2>Player sizes</h2>
          <span className="td-hint">From the DGS "T-shirt size" column. Re-imports never wipe a size you set here.</span>
          <div style={{ flex: 1 }} />
          <div className="td-seg">
            <button aria-pressed={onlyMissing} onClick={() => setOnlyMissing(true)}>NEEDS A SIZE</button>
            <button aria-pressed={!onlyMissing} onClick={() => setOnlyMissing(false)}>EVERYONE</button>
          </div>
        </div>
        {!list.length && <p className="td-hint">{players.length ? 'Everyone has a size.' : 'No players yet.'}</p>}
        <div className="td-sizelist">
          {list.map((p) => {
            const norm = normalizeSize(p.shirt_size);
            return (
              <label key={p.id} className="td-sizerow">
                <span>{p.name}<em>{p.div_code}</em></span>
                <select className="td-select" aria-label={`${p.name} shirt size`} value={norm ?? (p.shirt_size ? '?' : '')} onChange={(e) => void setSize(p, e.target.value === '?' ? p.shirt_size ?? '' : e.target.value)}>
                  <option value="">no shirt</option>
                  {p.shirt_size && !norm && <option value="?">{p.shirt_size} (?)</option>}
                  {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            );
          })}
        </div>
      </section>
    </>
  );
}

function ExtraBox({ size, value, onCommit }: { size: string; value: number; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value ? String(value) : '');
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setText(value ? String(value) : ''); }
  return (
    <input className="td-input" style={{ width: 70 }} inputMode="numeric" aria-label={`Extra ${size}`} placeholder="0" value={text}
      onChange={(e) => setText(e.target.value.replace(/\D/g, ''))}
      onBlur={() => { if ((Number(text) || 0) !== value) onCommit(text); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

// ---------- designs ----------
function Designs({ ctx }: { ctx: Ctx }) {
  const { ev, data } = ctx;
  const [cat, setCat] = useState<string>('all');
  const [newCat, setNewCat] = useState<string>('shirts');
  const [newTitle, setNewTitle] = useState('');
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [proofId, setProofId] = useState<string | null>(null);
  const shown = data.assets.filter((a) => cat === 'all' || a.category === cat);
  const openProof = data.assets.find((a) => a.id === proofId && a.proof) ?? null;
  const missingProofs = PROOF_KINDS.filter((k) => !data.assets.some((a) => a.proof === k));
  const addProofs = async () => {
    for (const k of missingProofs) {
      const r = await api.createAsset(ev.id, PROOF_CATEGORY[k], PROOF_LABEL[k], k);
      if (r.error || !r.data) return ctx.fail('Add proofs')(r.error);
      ctx.patchAssets((as) => [...as, r.data!]);
    }
    ctx.setToast('Tour proofs added. Open one to pick colors, then switch on SHOW CREW.');
  };
  const saveProof = async (a: DesignAsset, o: Record<string, string>) => {
    const r = await api.updateAsset(a.id, { proof_opts: o });
    if (r.error || !r.data) { ctx.fail(a.title)(r.error); return false; }
    ctx.patchAssets((as) => as.map((x) => (x.id === a.id ? r.data! : x)));
    ctx.setToast(`${a.title}: picks saved${a.crew_visible ? '. The crew see them now.' : '.'}`);
    return true;
  };
  const label = (c: string) => designCategoryLabel(c, data.creditLabel);

  const thumbPaths = useMemo(() => data.assets.map(latest).filter((f) => f && isImage(f)).map((f) => f!.path), [data.assets]);
  const thumbKey = thumbPaths.join('|');
  useEffect(() => {
    void (async () => {
      const r = await api.signedUrls(thumbKey ? thumbKey.split('|') : []);
      if (r.data) setThumbs(r.data);
    })();
  }, [thumbKey]);

  const create = async () => {
    if (!newTitle.trim()) return;
    const r = await api.createAsset(ev.id, newCat, newTitle.trim().slice(0, 120));
    if (r.error || !r.data) return ctx.fail('New design')(r.error);
    ctx.patchAssets((as) => [...as, r.data!]);
    setNewTitle(''); setCat((c) => (c === 'all' ? c : newCat));
  };
  const exportZip = async (all: boolean) => {
    const entries = zipEntries(shown, all, data.creditLabel);
    if (!entries.length) return;
    setBusy(`Zipping 0/${entries.length}…`);
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      let i = 0;
      for (const e of entries) {
        const r = await api.downloadFile(e.path);
        if (r.error || !r.data) throw r.error ?? new Error(`Could not download ${e.zipName}`);
        zip.file(e.zipName, r.data);
        setBusy(`Zipping ${++i}/${entries.length}…`);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      saveBlob(blob, `${slug(ev.name)}-${cat === 'all' ? 'designs' : slug(label(cat))}${all ? '-all-versions' : ''}.zip`);
    } catch (e) { ctx.fail('Zip export')(e); }
    setBusy('');
  };

  return (
    <>
      <section className="td-panel">
        <div className="td-chips" role="group" aria-label="Filter by category">
          <button className="td-chip" aria-pressed={cat === 'all'} onClick={() => setCat('all')}>ALL {data.assets.length}</button>
          {DESIGN_CATEGORIES.map((c) => {
            const n = data.assets.filter((a) => a.category === c).length;
            return <button key={c} className="td-chip" aria-pressed={cat === c} onClick={() => setCat(c)}>{label(c).toUpperCase()}{n ? ` ${n}` : ''}</button>;
          })}
        </div>
        <form className="td-row" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <select className="td-select" aria-label="New design category" value={newCat} onChange={(e) => setNewCat(e.target.value)}>
            {DESIGN_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}
          </select>
          <input className="td-input" style={{ flex: '1 1 200px' }} aria-label="New design name" placeholder="Design name (e.g. Shirt front)" maxLength={120} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          <button className="td-btn cta" disabled={!newTitle.trim()}>ADD DESIGN</button>
          <div style={{ flex: 1 }} />
          <button type="button" className="td-btn cyan" disabled={!!busy || !shown.some((a) => a.files.length)} onClick={() => void exportZip(false)}>{busy || 'EXPORT ZIP'}</button>
          <button type="button" className="td-btn quiet" disabled={!!busy || !shown.some((a) => a.files.length)} onClick={() => void exportZip(true)}>ALL VERSIONS</button>
        </form>
        <span className="td-hint">Private to this event's TDs until you switch on SHOW CREW (then crew see it on their crew link). Share links work for anyone with the link for {SHARE_DAYS} days. Max {fmtBytes(MAX_FILE_BYTES)} per file.</span>
        {ev.skin === 'jewel-xi' && missingProofs.length > 0 && (
          <div className="td-row">
            <button type="button" className="td-btn cyan" onClick={() => void addProofs()}>ADD TOUR PROOFS</button>
            <span className="td-hint">Disc stamp, shirt, 3-color screen print and tee signs as live proof pages: {missingProofs.map((k) => PROOF_LABEL[k]).join(' · ')}.</span>
          </div>
        )}
      </section>

      {openProof && (
        <section className="td-proof">
          <div className="td-row">
            <button type="button" className="td-btn" onClick={() => setProofId(null)}>‹ BACK TO DESIGNS</button>
            <div style={{ flex: 1 }} />
            <span className="td-hint">{openProof.crew_visible ? 'Crew can see this proof and your saved picks.' : 'Crew can\'t see this yet: switch on SHOW CREW on its card.'}</span>
          </div>
          <ProofView kind={openProof.proof as ProofKind} eventId={ev.id} saved={openProof.proof_opts} onSave={(o) => saveProof(openProof, o)} />
        </section>
      )}

      {!shown.length && <div className="td-empty">No designs here yet. Add one, then upload the file.</div>}
      <div className="td-grid td-designs">
        {shown.map((a) => <DesignCard key={a.id} ctx={ctx} a={a} thumb={thumbs[latest(a)?.path ?? '']} label={label(a.category)} onOpen={() => setProofId(a.id)} />)}
      </div>
    </>
  );
}

function DesignCard({ ctx, a, thumb, label, onOpen }: { ctx: Ctx; a: DesignAsset; thumb?: string; label: string; onOpen: () => void }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const cur = latest(a);
  const replace = (next: DesignAsset) => ctx.patchAssets((as) => as.map((x) => (x.id === a.id ? next : x)));

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) return ctx.fail(file.name)(new Error(`File is ${fmtBytes(file.size)}. The limit is ${fmtBytes(MAX_FILE_BYTES)}.`));
    setBusy(true);
    const r = await api.uploadVersion(ctx.ev.id, a, file, ctx.email);
    setBusy(false);
    if (r.error || !r.data) return ctx.fail(`Upload ${file.name}`)(r.error);
    replace({ ...a, status: a.status, files: [r.data, ...a.files], updated_at: new Date().toISOString() });
    ctx.setToast(`${a.title}: v${r.data.version} uploaded.`);
  };
  const setStatus = async (status: DesignStatus) => {
    replace({ ...a, status });
    const r = await api.updateAsset(a.id, { status });
    if (r.error || !r.data) { replace(a); return ctx.fail(a.title)(r.error); }
  };
  const share = async () => {
    if (!cur) return;
    const r = await api.signedUrl(cur.path, SHARE_DAYS * 86_400);
    if (r.error || !r.data) return ctx.fail('Share link')(r.error);
    try { await navigator.clipboard.writeText(r.data); ctx.setToast(`Share link for ${a.title} v${cur.version} copied. Good for ${SHARE_DAYS} days.`); }
    catch { window.prompt('Copy this share link:', r.data); }
  };
  const download = async (f: DesignAsset['files'][number]) => {
    const r = await api.signedUrl(f.path, 300, f.file_name);
    if (r.error || !r.data) return ctx.fail('Download')(r.error);
    window.location.assign(r.data);
  };
  const removeFile = async (f: DesignAsset['files'][number]) => {
    if (!window.confirm(`Delete v${f.version} (${f.file_name})?`)) return;
    const r = await api.deleteFile(f);
    if (r.error) return ctx.fail('Delete file')(r.error);
    replace({ ...a, files: a.files.filter((x) => x.id !== f.id) });
  };
  const remove = async () => {
    if (!window.confirm(`Delete "${a.title}" and all ${a.files.length} file${a.files.length === 1 ? '' : 's'}?`)) return;
    const r = await api.deleteAsset(a);
    if (r.error) return ctx.fail(a.title)(r.error);
    ctx.patchAssets((as) => as.filter((x) => x.id !== a.id));
  };
  const setCrew = async (on: boolean) => {
    replace({ ...a, crew_visible: on });
    const r = await api.updateAsset(a.id, { crew_visible: on });
    if (r.error || !r.data) { replace(a); return ctx.fail(a.title)(r.error); }
    ctx.setToast(on ? `${a.title}: crew can see it now.` : `${a.title}: hidden from crew.`);
  };
  const rename = async (title: string) => {
    const t = title.trim().slice(0, 120);
    if (!t || t === a.title) return;
    const r = await api.updateAsset(a.id, { title: t });
    if (r.error || !r.data) return ctx.fail(a.title)(r.error);
    replace(r.data);
  };

  return (
    <article className={`td-card td-design is-${a.status}`}>
      <div className="td-thumb">
        {a.proof && !thumb ? <button type="button" className="td-proof-thumb" onClick={onOpen}><b>LIVE PROOF</b><span>OPEN ›</span></button>
          : thumb ? <img src={thumb} alt={`${a.title} v${cur?.version}`} loading="lazy" />
          : <span>{cur ? (cur.file_name.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] ?? 'FILE').toUpperCase() : 'NO FILE YET'}</span>}
      </div>
      <div className="td-card-head">
        <div className="td-card-title">
          <input className="td-title-input" aria-label="Design name" defaultValue={a.title} maxLength={120} onBlur={(e) => void rename(e.target.value)} />
          <span>{label}{cur ? ` · v${cur.version} · ${fmtBytes(cur.bytes)}` : ''}</span>
        </div>
      </div>
      <div className="td-design-body">
        <div className="td-seg">
          {(Object.keys(STATUS_LABEL) as DesignStatus[]).map((s) => <button key={s} aria-pressed={a.status === s} onClick={() => void setStatus(s)}>{STATUS_LABEL[s].toUpperCase()}</button>)}
        </div>
        <button className="td-toggle" aria-pressed={!!a.crew_visible} onClick={() => void setCrew(!a.crew_visible)}>
          <span className="track"><span className="knob" /></span><span>{a.crew_visible ? 'Crew can see it' : 'Show crew'}</span>
        </button>
        {a.proof && <button className="td-btn cyan" onClick={onOpen}>OPEN PROOF</button>}
        <div className="td-row">
          <label className={`td-btn ${cur ? 'quiet' : 'cyan'} td-file`}>{busy ? 'UPLOADING…' : cur ? `UPLOAD v${cur.version + 1}` : 'UPLOAD FILE'}
            <input type="file" disabled={busy} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {cur && <button className="td-btn quiet" onClick={() => void share()}>SHARE LINK</button>}
          {cur && <button className="td-btn quiet" onClick={() => void download(cur)}>DOWNLOAD</button>}
        </div>
        {a.files.length > 0 && <button className="td-link" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'} versions ({a.files.length})</button>}
        {open && (
          <ul className="td-versions">
            {a.files.map((f) => (
              <li key={f.id}>
                <b>v{f.version}</b>
                <span>{f.file_name} · {fmtBytes(f.bytes)} · {new Date(f.uploaded_at).toLocaleDateString()}{f.uploaded_by ? ` · ${f.uploaded_by}` : ''}</span>
                <button className="td-link" onClick={() => void download(f)}>Download</button>
                <button className="td-link" onClick={() => void removeFile(f)}>Delete</button>
              </li>
            ))}
          </ul>
        )}
        <button className="td-link danger" onClick={() => void remove()}>Delete design</button>
      </div>
    </article>
  );
}

// ---------- player pack bags ----------
/**
 * Pre-packed bags (shirt + disc), one per player in the chosen divisions (amateurs by default).
 * Count by size for packing, and labels for Avery 5163/8163 (2" x 4", 10 per letter sheet), A to Z by last name.
 */
function Packs({ ev, players, divisions }: { ev: api.EventSetup['event']; players: ExistingPlayer[]; divisions: api.EventSetup['divisions'] }) {
  const present = divisions.filter((d) => players.some((p) => p.div_code === d.code));
  const [divs, setDivs] = useState<string[]>(() => present.filter((d) => isAmateur(d.code)).map((d) => d.code));
  const waves = ev.waves === 2;
  const rows = useMemo(() => packRows(players, divs, (code) => (waves ? divisions.find((d) => d.code === code)?.wave ?? 'AM' : null)), [players, divs, waves, divisions]);
  const count = packCount(rows);
  const pages = Array.from({ length: Math.ceil(rows.length / 10) }, (_, i) => rows.slice(i * 10, i * 10 + 10));
  const print = () => {
    document.body.classList.add('bb-print-labels');
    const done = () => { document.body.classList.remove('bb-print-labels'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  };
  const toggle = (code: string) => setDivs((d) => (d.includes(code) ? d.filter((x) => x !== code) : [...d, code]));
  return (
    <>
      <section className="td-panel td-noprint">
        <div className="td-row">
          <h2>Player pack bags</h2>
          <div className="td-counts"><Stat v={count.total} k="BAGS" color="var(--cyan)" /><Stat v={count.noShirt} k="DISC ONLY" color={count.noShirt ? 'var(--gold)' : 'var(--fg-1)'} /></div>
          <div style={{ flex: 1 }} />
          <button className="td-btn cta" onClick={print} disabled={!rows.length}>PRINT BAG LABELS</button>
        </div>
        <div className="td-label">WHO GETS A BAG (tap a division)</div>
        <div className="td-chips">
          {present.map((d) => <button key={d.code} className="td-chip" aria-pressed={divs.includes(d.code)} onClick={() => toggle(d.code)}>{d.code}</button>)}
        </div>
        <p className="td-hint">Starts with the amateur divisions. Labels print A to Z by last name on Avery 5163 / 8163 (2" × 4", 10 per sheet): print at 100%, no "fit to page". Pack each bag with its shirt and a disc, then line them up A to Z at the pack table. Check-in shows the bag size the moment someone is checked in.</p>
        <table className="td-table td-shirts">
          <thead><tr><th>SIZE</th><th>BAGS</th></tr></thead>
          <tbody>
            {count.sizes.map((r) => <tr key={r.size}><td><b>{r.size}</b></td><td>{r.n}</td></tr>)}
            {count.noShirt > 0 && <tr><td><b>Disc only</b></td><td>{count.noShirt}</td></tr>}
            <tr><td><b>TOTAL</b></td><td><b>{count.total}</b></td></tr>
          </tbody>
        </table>
        {count.noShirt > 0 && <div className="td-warn soft">No shirt size: {rows.filter((r) => !r.size).map((r) => r.raw ? `${r.name} ("${r.raw}")` : r.name).join(', ')}. Fix sizes on SHIRTS, or pack them a disc only.</div>}
      </section>
      <style>{'@media print { @page { size: letter portrait; margin: 0; } }'}</style>
      <div className="td-labels" aria-label="Bag labels preview">
        {pages.map((pg, i) => (
          <div className="td-label-page" key={i}>
            {pg.map((r) => (
              <div className="td-bag" key={r.id}>
                <div className="who"><b>{r.last.toUpperCase()}</b><span>{r.first}</span></div>
                <div className="size">{r.size ?? 'DISC'}</div>
                <div className="foot">{ev.name} · {r.div}{r.wave ? ` · ${r.wave} wave` : ''}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
