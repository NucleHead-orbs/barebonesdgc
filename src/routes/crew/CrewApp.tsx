import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import * as crewApi from '../../lib/crew/api';
import type { CrewDesign, CrewHome, CrewTask } from '../../lib/crew/api';
import { CrewDesigns } from './CrewDesigns';
import CrewStations from './CrewStations';
import CrewVotes from './CrewVotes';
import { waiting, type Ballot } from '../../lib/votes/votes';
import {
  CONTACT_KINDS, KIND_LABEL, ROLE_GUIDE, ROLE_LABEL, STATUS_LABEL, crewMessage, crewNextStatuses, raffleTotals, saleProblem,
  type ContactKind, type ContactStatus, type RaffleSale, type Role,
} from '../../lib/crew/crew';
import { dueDate, fmtDay, sortTasks, taskState } from '../../lib/prep/prep';
import { boldParts } from '../../lib/td/help';
import { useTheme } from '../../lib/theme';
import { dateRange } from '../../lib/td/setup';
import '../td/td.css';

type Tab = 'brief' | 'vote' | 'stations' | 'tasks' | 'designs' | Role;
const TAB_LABEL: Record<Tab, string> = { brief: 'BRIEFING', vote: 'VOTE', stations: 'STATIONS', tasks: 'TASKS', designs: 'DESIGNS', checkin: 'CHECK-IN', raffle: 'RAFFLE', requests: 'REQUESTS', contacts: 'CONTACTS' };
const POLL_MS = 30_000;
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** /crew/:token: one volunteer's view of the event. Everything goes through crew_* RPCs checked against the link. */
export default function CrewApp() {
  const { token = '' } = useParams();
  const [home, setHome] = useState<CrewHome | null>(null);
  const [fatal, setFatal] = useState('');
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [tab, setTab] = useState<Tab>('brief');
  const [designs, setDesigns] = useState<CrewDesign[]>([]);
  const [ballots, setBallots] = useState<Ballot[]>([]);

  useTheme(home?.event.skin === 'jewel-xi' ? 'jewel-xi' : 'event', home?.event.palette ?? null);

  const load = useCallback(async () => {
    const r = await crewApi.home(token);
    if (r.error || !r.data) {
      const m = crewMessage(r.error);
      if (/link|closed/.test(m)) setFatal(m); else setErr(m);
      return;
    }
    setHome(r.data); setFatal('');
    const [d, v] = await Promise.all([crewApi.designs(token), crewApi.polls(token)]);
    if (d.data) setDesigns(d.data);
    if (v.data) setBallots(v.data);
  }, [token]);
  useEffect(() => {
    void (async () => { await load(); })();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t); }, [toast]);

  /** Run a crew action, then refresh. Returns true on success. */
  const act = useCallback(async (p: Promise<{ error?: unknown }>, ok?: string) => {
    const r = await p;
    if (r.error) { setErr(crewMessage(r.error)); return false; }
    setErr(''); if (ok) setToast(ok);
    await load();
    return true;
  }, [load]);

  if (fatal) return <div className="td"><main className="td-main td-crewapp"><div className="td-warn" role="alert">{fatal}</div></main></div>;
  if (!home) return <div className="td"><main className="td-main td-crewapp"><p className="td-empty">{err || 'Loading your crew page…'}</p></main></div>;

  const roles = home.me.roles;
  const tabs: Tab[] = ['brief', ...(ballots.length ? ['vote' as const] : []), ...((home.stations ?? []).length ? ['stations' as const] : []), 'tasks', ...(designs.length ? ['designs' as const] : []), ...(['checkin', 'raffle', 'requests', 'contacts'] as Role[]).filter((r) => roles.includes(r))];
  const cur = tabs.includes(tab) ? tab : 'brief';
  const unread = home.announcements.filter((a) => !a.read).length;
  const ctx = { token, home, act };

  return (
    <div className="td">
      <header className="td-top">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <div className="td-title">{home.event.name}</div>
          <div className="td-sub">{[home.event.club_name, dateRange(home.event)].filter(Boolean).join(' · ').toUpperCase()} · CREW: {home.me.name.toUpperCase()}</div>
        </div>
      </header>
      <nav className="td-tabs" aria-label="Crew sections">
        {tabs.map((t) => (
          <button key={t} aria-current={cur === t ? 'page' : undefined} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}{t === 'brief' && unread > 0 && <span className="td-badge">{unread}</span>}{t === 'vote' && waiting(ballots) > 0 && <span className="td-badge">{waiting(ballots)}</span>}
          </button>
        ))}
      </nav>
      <main className="td-main td-crewapp">
        {toast && <div className="td-ok" role="status">{toast}</div>}
        {err && <div className="td-warn" role="alert">{err} <button className="td-btn quiet" onClick={() => setErr('')}>OK</button></div>}
        {cur === 'brief' && <Briefing {...ctx} />}
        {cur === 'tasks' && <Tasks {...ctx} />}
        {cur === 'designs' && <CrewDesigns token={token} eventId={home.event.id} designs={designs} onError={(m) => setErr(m)} />}
        {cur === 'checkin' && <Checkin {...ctx} />}
        {cur === 'raffle' && <Raffle {...ctx} />}
        {cur === 'requests' && <Requests {...ctx} />}
        {cur === 'contacts' && <Contacts {...ctx} />}
        {cur === 'stations' && <CrewStations {...ctx} />}
        {cur === 'vote' && <CrewVotes token={token} ballots={ballots} act={act} />}
      </main>
    </div>
  );
}

type Ctx = { token: string; home: CrewHome; act: (p: Promise<{ error?: unknown }>, ok?: string) => Promise<boolean> };
const Bold = ({ text }: { text: string }) => <>{boldParts(text).map((p, i) => (p.bold ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>))}</>;

// ---------- briefing ----------
function Briefing({ token, home, act }: Ctx) {
  const roles = home.me.roles;
  const guides = (['general', ...roles] as Array<Role | 'general'>).map((r) => ROLE_GUIDE[r]);
  return (
    <>
      <section className="td-panel">
        <h2>Hey {home.me.name}!</h2>
        <p className="td-hint">Your jobs: <b>{['Everyone', ...roles.map((r) => ROLE_LABEL[r])].join(' · ')}</b>. Read the announcements below and tap <b>Got it</b> on each one, so the TD knows you're ready.</p>
      </section>
      {!home.announcements.length && <div className="td-empty">No announcements yet. Check back before the event.</div>}
      {home.announcements.map((a) => (
        <article key={a.id} className={`td-panel td-news${a.pinned ? ' is-pinned' : ''}${a.read ? ' is-read' : ''}`}>
          <div className="td-row">
            <b>{a.pinned ? '📌 ' : ''}{a.title}</b>
            <span className="td-hint">{a.roles.length ? a.roles.map((r) => ROLE_LABEL[r]).join(' + ') : 'Everyone'}</span>
          </div>
          {a.body && <p className="td-news-body">{a.body}</p>}
          {a.read ? <span className="td-hint">✓ You said got it</span>
            : <button className="td-btn cta" style={{ alignSelf: 'flex-start' }} onClick={() => void act(crewApi.ack(token, a.id), 'Thanks!')}>GOT IT</button>}
        </article>
      ))}
      <section className="td-panel">
        <h2>How your jobs work</h2>
        {guides.map((g) => (
          <details key={g.title} className="td-help-sec" open={home.announcements.every((a) => a.read)}>
            <summary><b>{g.title}</b></summary>
            <ol>{g.steps.map((s, i) => <li key={i}><Bold text={s} /></li>)}</ol>
          </details>
        ))}
      </section>
      <section className="td-panel">
        <h2>The crew</h2>
        <ul className="td-crew-mini">
          {home.crew.map((c) => <li key={c.id}><b>{c.name}</b> <span className="td-hint">{c.roles.length ? c.roles.map((r) => ROLE_LABEL[r]).join(', ') : 'General'}</span></li>)}
        </ul>
      </section>
    </>
  );
}

// ---------- tasks ----------
function Tasks({ token, home, act }: Ctx) {
  const [mine, setMine] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const today = localToday();
  const byId = new Map(home.crew.map((c) => [c.id, c.name]));
  const all = sortTasks(home.tasks.map((t) => ({ ...t, assignee: t.assignee })) as Array<CrewTask>);
  const shown = all.filter((t) => !mine || t.crew_id === home.me.id);
  const who = (t: CrewTask) => (t.crew_id ? byId.get(t.crew_id) ?? 'crew' : t.assignee ?? 'unassigned');
  return (
    <>
      <div className="td-seg">
        <button aria-pressed={mine} onClick={() => setMine(true)}>MINE {home.tasks.filter((t) => t.crew_id === home.me.id && !t.done_at).length}</button>
        <button aria-pressed={!mine} onClick={() => setMine(false)}>EVERYTHING</button>
      </div>
      {!shown.length && <div className="td-empty">{mine ? 'Nothing assigned to you right now.' : 'No checklist yet.'}</div>}
      <ul className="td-tasks">
        {shown.map((t) => {
          const st = taskState(t, home.event.starts_on, today);
          const due = dueDate(home.event.starts_on, t);
          const isMine = t.crew_id === home.me.id;
          return (
            <li key={t.id} className={`td-task is-${st}`}>
              {isMine
                ? <input type="checkbox" checked={!!t.done_at} aria-label={`${t.title} done`} onChange={() => void act(crewApi.taskDone(token, t.id, !t.done_at))} />
                : <span className="td-task-dot" aria-hidden>{t.done_at ? '✓' : '•'}</span>}
              <div className="td-task-main" role="button" tabIndex={0} onClick={() => setOpen(open === t.id ? null : t.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(open === t.id ? null : t.id); }}>
                <b>{t.title}</b>
                <span>{due ? fmtDay(due) : 'no date'} · {isMine ? 'you' : who(t)}{t.done_at ? ` · done${t.done_by ? ` by ${t.done_by}` : ''}` : ''}{t.updates.length ? ` · ${t.updates.length} update${t.updates.length === 1 ? '' : 's'}` : ''}</span>
              </div>
              {open === t.id && <TaskThread token={token} t={t} act={act} />}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function TaskThread({ token, t, act }: { token: string; t: CrewTask; act: Ctx['act'] }) {
  const [body, setBody] = useState('');
  return (
    <div className="td-task-edit">
      {t.notes && <p className="td-news-body">{t.notes}</p>}
      {t.updates.map((u, i) => <p key={i} className="td-update"><b>{u.author}</b> <span className="td-hint">{new Date(u.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span><br />{u.body}</p>)}
      <form className="td-row" onSubmit={async (e) => { e.preventDefault(); if (await act(crewApi.taskNote(token, t.id, body), 'Update posted.')) setBody(''); }}>
        <input className="td-input" style={{ flex: 1 }} aria-label="Post an update" placeholder="Post an update…" maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} />
        <button className="td-btn cyan" disabled={!body.trim()}>POST</button>
      </form>
    </div>
  );
}

// ---------- check-in ----------
function Checkin({ token, home, act }: Ctx) {
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [div, setDiv] = useState('');
  const players = useMemo(() => home.players ?? [], [home.players]);
  const hits = useMemo(() => {
    const k = q.trim().toLowerCase();
    return players.filter((p) => !k || p.name.toLowerCase().includes(k)).slice(0, 60);
  }, [players, q]);
  const inCount = players.filter((p) => p.checked_in).length;
  return (
    <>
      <section className="td-panel">
        <div className="td-counts">
          <div className="td-stat"><b style={{ color: 'var(--under)' }}>{inCount}</b><span>CHECKED IN</span></div>
          <div className="td-stat"><b>{players.length - inCount}</b><span>NOT YET</span></div>
        </div>
        <input className="td-input td-search-wide" type="search" aria-label="Search players" placeholder="Search a name…" value={q} onChange={(e) => setQ(e.target.value)} />
      </section>
      <ul className="td-checklist">
        {hits.map((p) => (
          <li key={p.id} className={p.checked_in ? 'is-in' : ''}>
            <span><b>{p.name}</b> <span className="td-hint">{p.div_code}</span></span>
            <button className={`td-btn ${p.checked_in ? 'quiet' : 'cta'}`} onClick={() => void act(crewApi.checkin(token, p.id, !p.checked_in), p.checked_in ? `${p.name} un-checked.` : `${p.name} checked in.`)}>
              {p.checked_in ? 'UNDO' : 'CHECK IN'}
            </button>
          </li>
        ))}
        {!hits.length && <li className="td-hint">No one by that name. Add them as a walk-up below.</li>}
      </ul>
      <section className="td-panel">
        <h2>Walk-up</h2>
        <form className="td-row" onSubmit={async (e) => { e.preventDefault(); if (await act(crewApi.walkup(token, name, div), `${name.trim()} added and checked in.`)) { setName(''); setQ(''); } }}>
          <input className="td-input" style={{ flex: '1 1 160px' }} aria-label="Walk-up name" placeholder="First and last name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          <select className="td-select" aria-label="Division" value={div} onChange={(e) => setDiv(e.target.value)}>
            <option value="">Division…</option>
            {(home.divisions ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <button className="td-btn cta" disabled={!name.trim() || !div}>ADD + CHECK IN</button>
        </form>
      </section>
    </>
  );
}

// ---------- raffle ----------
function Raffle({ token, home, act }: Ctx) {
  const [tickets, setTickets] = useState('');
  const [amount, setAmount] = useState('');
  const [buyer, setBuyer] = useState('');
  const [method, setMethod] = useState<RaffleSale['method']>('cash');
  const [problem, setProblem] = useState('');
  const r = home.raffle ?? { total: 0, tickets: 0, mine: [] };
  const mineT = raffleTotals(r.mine);
  const log = async () => {
    const p = saleProblem(tickets, amount);
    if (p) return setProblem(p);
    setProblem('');
    if (await act(crewApi.raffleSale(token, { buyer, tickets: Number(tickets), amount: Number(amount), method }), `Logged ${tickets} tickets, $${Number(amount).toFixed(2)}.`)) {
      setTickets(''); setAmount(''); setBuyer('');
    }
  };
  return (
    <>
      <section className="td-panel">
        <div className="td-counts">
          <div className="td-stat"><b style={{ color: 'var(--under)' }}>${Number(r.total).toLocaleString()}</b><span>EVERYONE'S TOTAL</span></div>
          <div className="td-stat"><b>{r.tickets}</b><span>TICKETS</span></div>
          <div className="td-stat"><b>${mineT.total.toLocaleString()}</b><span>YOUR SALES</span></div>
        </div>
        <div className="td-row">
          <input className="td-input td-big" style={{ width: 110 }} inputMode="numeric" aria-label="Tickets" placeholder="Tickets" value={tickets} onChange={(e) => setTickets(e.target.value.replace(/\D/g, ''))} />
          <input className="td-input td-big" style={{ width: 120 }} inputMode="decimal" aria-label="Amount in dollars" placeholder="$" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
        </div>
        <div className="td-seg">
          {(['cash', 'card', 'other'] as const).map((m) => <button key={m} aria-pressed={method === m} onClick={() => setMethod(m)}>{m.toUpperCase()}</button>)}
        </div>
        <input className="td-input" aria-label="Buyer" placeholder="Buyer's name (optional)" maxLength={80} value={buyer} onChange={(e) => setBuyer(e.target.value)} />
        {problem && <div className="td-warn" role="alert">{problem}</div>}
        <button className="td-btn cta td-big" onClick={() => void log()} disabled={!tickets || !amount}>LOG SALE</button>
      </section>
      {r.mine.length > 0 && (
        <section className="td-panel">
          <h2>Your sales</h2>
          <ul className="td-checklist">
            {r.mine.map((s) => (
              <li key={s.id} className={s.voided_at ? 'is-void' : ''}>
                <span>{s.tickets} tickets · ${Number(s.amount).toFixed(2)} · {s.method}{s.buyer ? ` · ${s.buyer}` : ''} <span className="td-hint">{new Date(s.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></span>
                {s.voided_at ? <span className="td-hint">voided</span>
                  : <button className="td-btn quiet" onClick={() => { if (window.confirm('Void this sale?')) void act(crewApi.raffleVoid(token, s.id), 'Sale voided.'); }}>VOID</button>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// ---------- card requests ----------
function Requests({ token, home, act }: Ctx) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const players = home.players ?? [];
  const byId = new Map(players.map((p) => [p.id, p]));
  const hits = q.trim() ? players.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()) && !picked.includes(p.id)).slice(0, 8) : [];
  const send = async () => {
    if (await act(crewApi.cardRequest(token, picked, note), 'Request sent to the TD.')) { setPicked([]); setNote(''); setQ(''); }
  };
  return (
    <>
      <section className="td-panel">
        <h2>New card request</h2>
        <div className="td-chips">
          {picked.map((id) => <button key={id} className="td-chip" aria-pressed onClick={() => setPicked(picked.filter((x) => x !== id))}>{byId.get(id)?.name} ✕</button>)}
        </div>
        {picked.length < 5 && <input className="td-input" type="search" aria-label="Find a player" placeholder={picked.length ? 'Add another player…' : 'Find the first player…'} value={q} onChange={(e) => setQ(e.target.value)} />}
        {hits.length > 0 && <ul className="td-checklist">{hits.map((p) => (
          <li key={p.id}><span><b>{p.name}</b> <span className="td-hint">{p.div_code}</span></span>
            <button className="td-btn cyan" onClick={() => { setPicked([...picked, p.id]); setQ(''); }}>ADD</button></li>
        ))}</ul>}
        <input className="td-input" aria-label="Note" placeholder="Note (optional)" maxLength={140} value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="td-btn cta" disabled={picked.length < 2} onClick={() => void send()}>SEND REQUEST</button>
      </section>
      {(home.my_requests ?? []).length > 0 && (
        <section className="td-panel">
          <h2>Your requests</h2>
          <ul className="td-checklist">
            {(home.my_requests ?? []).map((r) => (
              <li key={r.id}>
                <span>{r.players.map((id) => byId.get(id)?.name ?? '?').join(' + ')}{r.note ? <span className="td-hint"> · {r.note}</span> : null}</span>
                <span className={`td-due is-${r.status === 'approved' ? 'done' : r.status === 'declined' ? 'overdue' : 'soon'}`}>{r.status.toUpperCase()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// ---------- contacts ----------
function Contacts({ token, home, act }: Ctx) {
  const blank = { kind: 'sponsor' as ContactKind, name: '', org: '', phone: '', email: '', amount: '', notes: '' };
  const [f, setF] = useState(blank);
  const [adding, setAdding] = useState(false);
  const list = home.contacts ?? [];
  return (
    <>
      {adding
        ? <section className="td-panel td-form">
          <h2>Add a lead</h2>
          <div className="td-seg">{CONTACT_KINDS.map((k) => <button key={k} aria-pressed={f.kind === k} onClick={() => setF({ ...f, kind: k })}>{KIND_LABEL[k].toUpperCase()}</button>)}</div>
          <input className="td-input" aria-label="Person's name" placeholder="Person's name" maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input className="td-input" aria-label="Business" placeholder="Business" maxLength={80} value={f.org} onChange={(e) => setF({ ...f, org: e.target.value })} />
          <input className="td-input" aria-label="Phone" placeholder="Phone" inputMode="tel" maxLength={40} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <input className="td-input" aria-label="Email" placeholder="Email" inputMode="email" maxLength={120} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <input className="td-input" aria-label="Amount" placeholder="$ they might give (optional)" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^0-9.]/g, '') })} />
          <textarea className="td-input" rows={3} aria-label="Notes" placeholder="How you know them, what they might do…" maxLength={2000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          <div className="td-row">
            <button className="td-btn cta" disabled={!f.name.trim()} onClick={async () => { if (await act(crewApi.addContact(token, f), 'Lead sent to the TD.')) { setF(blank); setAdding(false); } }}>SEND LEAD</button>
            <button className="td-btn quiet" onClick={() => setAdding(false)}>CANCEL</button>
          </div>
        </section>
        : <button className="td-btn cta" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)}>+ ADD A LEAD</button>}
      {!list.length && <div className="td-empty">No contacts yet.</div>}
      {list.map((c) => <ContactCard key={c.id} token={token} c={c} act={act} />)}
    </>
  );
}

function ContactCard({ token, c, act }: { token: string; c: NonNullable<CrewHome['contacts']>[number]; act: Ctx['act'] }) {
  const [note, setNote] = useState('');
  const next = crewNextStatuses(c.status as ContactStatus);
  return (
    <article className={`td-panel td-contact is-${c.status}`}>
      <div className="td-row">
        <b>{c.org || c.name}</b>
        <span className="td-hint">{KIND_LABEL[c.kind]}{c.org ? ` · ${c.name}` : ''}{c.amount != null ? ` · $${Number(c.amount).toLocaleString()}` : ''}</span>
        <div style={{ flex: 1 }} />
        <span className="td-due">{STATUS_LABEL[c.status as ContactStatus].toUpperCase()}</span>
      </div>
      {(c.phone || c.email) && <span className="td-hint">
        {c.phone && <a className="td-link" href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>{c.phone}</a>}{c.phone && c.email ? ' · ' : ''}
        {c.email && <a className="td-link" href={`mailto:${c.email}`}>{c.email}</a>}
      </span>}
      {c.notes && <p className="td-news-body">{c.notes}</p>}
      <span className="td-hint">{c.mine ? 'Yours' : c.owner ? `${c.owner}'s` : 'TD\'s'}{c.status === 'lead' ? ' · waiting for the TD' : ''}</span>
      {c.mine && next.length > 0 && (
        <div className="td-row">
          <select className="td-select" aria-label={`${c.name} status`} value={c.status} onChange={(e) => void act(crewApi.updateContact(token, c.id, e.target.value as ContactStatus, ''), 'Status updated.')}>
            {next.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <input className="td-input" style={{ flex: 1 }} aria-label="Replace notes" placeholder="Update the notes…" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="td-btn cyan" disabled={!note.trim()} onClick={async () => { if (await act(crewApi.updateContact(token, c.id, null, note), 'Notes saved.')) setNote(''); }}>SAVE</button>
        </div>
      )}
    </article>
  );
}
