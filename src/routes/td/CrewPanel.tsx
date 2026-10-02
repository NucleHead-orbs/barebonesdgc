import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import * as api from '../../lib/td/api';
import { rpcError } from '../../lib/td/builder';
import StationsGrid from './StationsGrid';
import {
  ROLES, ROLE_LABEL, audienceLabel, crewLink, raffleTotals, readiness, receipts,
  type Announcement, type CrewMember, type RaffleSale, type Role,
} from '../../lib/crew/crew';

type View = 'roster' | 'stations' | 'news' | 'raffle';
const ago = (iso: string | null | undefined) => {
  if (!iso) return 'never opened';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 2 ? 'opened just now' : m < 60 ? `opened ${m} min ago` : m < 1440 ? `opened ${Math.round(m / 60)} h ago` : `opened ${new Date(iso).toLocaleDateString()}`;
};

/**
 * CREW tab: roster + private links, announcements with read receipts, raffle log.
 * Crew act only through their link (/crew/<token>); nothing here is visible to them except what the crew_* RPCs return.
 */
export default function CrewPanel({ eventId, eventName, email, startsOn, endsOn }: { eventId: string; eventName: string; email: string; startsOn: string; endsOn: string }) {
  const [data, setData] = useState<api.CrewData | null>(null);
  const [sales, setSales] = useState<RaffleSale[]>([]);
  const [view, setView] = useState<View>('roster');
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    const [c, r] = await Promise.all([api.loadCrew(eventId), api.loadRaffle(eventId)]);
    if (c.error || !c.data) return setErr(rpcError(c.error).message);
    setData(c.data);
    if (r.data) setSales(r.data);
  }, [eventId]);
  useEffect(() => { void (async () => { await load(); })(); }, [load]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t); }, [toast]);

  if (!data) return <main className="td-main">{err ? <div className="td-warn" role="alert">{err}</div> : <p className="td-empty">Loading…</p>}</main>;
  const fail = (what: string) => (e: unknown) => setErr(`${what}: ${rpcError(e).message}`);
  const live = data.crew.filter((c) => !c.revoked_at);
  const unread = data.announcements.reduce((a, x) => a + receipts(x, data.crew, data.reads).missing.length, 0);

  return (
    <main className="td-main">
      {toast && <div className="td-ok" role="status">{toast}</div>}
      {err && <div className="td-warn" role="alert">{err} <button className="td-btn quiet" onClick={() => setErr('')}>DISMISS</button></div>}
      <div className="td-row">
        <h2 className="td-h2">Crew</h2>
        <div className="td-seg">
          <button aria-pressed={view === 'roster'} onClick={() => setView('roster')}>ROSTER {live.length}</button>
          <button aria-pressed={view === 'stations'} onClick={() => setView('stations')}>STATIONS</button>
          <button aria-pressed={view === 'news'} onClick={() => setView('news')}>ANNOUNCEMENTS{unread ? ` · ${unread} UNREAD` : ''}</button>
          <button aria-pressed={view === 'raffle'} onClick={() => setView('raffle')}>RAFFLE</button>
        </div>
      </div>
      {view === 'roster' && <Roster eventId={eventId} eventName={eventName} data={data} setData={setData} fail={fail} toast={setToast} />}
      {view === 'news' && <News eventId={eventId} email={email} data={data} setData={setData} fail={fail} toast={setToast} />}
      {view === 'stations' && <StationsGrid eventId={eventId} eventName={eventName} startsOn={startsOn} endsOn={endsOn} crew={data.crew} />}
      {view === 'raffle' && <Raffle eventId={eventId} email={email} sales={sales} reload={load} fail={fail} />}
    </main>
  );
}

type Setter = (d: api.CrewData) => void;
type Fail = (what: string) => (e: unknown) => void;

function RoleChips({ value, onChange, label }: { value: Role[]; onChange: (r: Role[]) => void; label: string }) {
  return (
    <div className="td-chips" role="group" aria-label={label}>
      {ROLES.map((r) => (
        <button key={r} type="button" className="td-chip" aria-pressed={value.includes(r)}
          onClick={() => onChange(value.includes(r) ? value.filter((x) => x !== r) : [...value, r])}>{ROLE_LABEL[r].toUpperCase()}</button>
      ))}
    </div>
  );
}

// ---------- roster ----------
function Roster({ eventId, eventName, data, setData, fail, toast }: { eventId: string; eventName: string; data: api.CrewData; setData: Setter; fail: Fail; toast: (s: string) => void }) {
  const [name, setName] = useState('');
  const [roles, setRoles] = useState<Role[]>([]);
  const [showRevoked, setShowRevoked] = useState(false);
  const add = async () => {
    const n = name.replace(/\s+/g, ' ').trim();
    if (!n) return;
    if (data.crew.some((c) => c.name.toLowerCase() === n.toLowerCase() && !c.revoked_at)) return fail(n)(new Error('Someone with that name is already on the crew.'));
    const r = await api.addCrew(eventId, n.slice(0, 60), roles);
    if (r.error || !r.data) return fail('Add crew')(r.error);
    setData({ ...data, crew: [...data.crew, r.data].sort((a, b) => a.name.localeCompare(b.name)) });
    setName(''); setRoles([]);
    toast(`${r.data.name} added. Send them their link.`);
  };
  const replace = (c: CrewMember) => setData({ ...data, crew: data.crew.map((x) => (x.id === c.id ? c : x)) });
  const shown = data.crew.filter((c) => showRevoked || !c.revoked_at);

  return (
    <>
      <section className="td-panel">
        <form className="td-row" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <input className="td-input" style={{ flex: '1 1 180px' }} aria-label="Crew member name" placeholder="Name (e.g. Sally)" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="td-btn cta" disabled={!name.trim()}>ADD TO CREW</button>
        </form>
        <RoleChips value={roles} onChange={setRoles} label="New crew member's jobs" />
        <span className="td-hint">Everyone gets announcements and tasks. Pick the extra jobs they'll do. Each person gets their own private link: no password, and you can cut it off any time.</span>
      </section>
      {!shown.length && <div className="td-empty">No crew yet. Add the people helping run the event.</div>}
      <div className="td-crewlist">
        {shown.map((c) => <CrewRow key={c.id} c={c} eventName={eventName} r={readiness(c, data.announcements, data.reads)} onChange={replace}
          onRemove={() => setData({ ...data, crew: data.crew.filter((x) => x.id !== c.id) })} fail={fail} toast={toast} />)}
      </div>
      {data.crew.some((c) => c.revoked_at) && <button className="td-link" onClick={() => setShowRevoked(!showRevoked)}>{showRevoked ? 'Hide' : 'Show'} cut-off links</button>}
    </>
  );
}

function CrewRow({ c, eventName, r, onChange, onRemove, fail, toast }: {
  c: CrewMember; eventName: string; r: { total: number; read: number }; onChange: (c: CrewMember) => void; onRemove: () => void; fail: Fail; toast: (s: string) => void;
}) {
  const [qr, setQr] = useState('');
  const url = crewLink(window.location.origin, c.token ?? '');
  const patch = async (p: { roles?: Role[]; revoked_at?: string | null }) => {
    const x = await api.updateCrew(c.id, p);
    if (x.error || !x.data) return fail(c.name)(x.error);
    onChange(x.data);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast(`${c.name}'s link copied.`); } catch { window.prompt(`Copy ${c.name}'s link:`, url); }
  };
  const showQr = async () => setQr(qr ? '' : await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
  const reissue = async () => {
    if (!window.confirm(`Send ${c.name} a new link? The old one stops working right away.`)) return;
    const x = await api.newCrewLink(c.id);
    if (x.error || !x.data) return fail(c.name)(x.error);
    onChange({ ...c, token: x.data, revoked_at: null }); setQr('');
    toast(`New link for ${c.name}. Copy or text it to them.`);
  };
  const remove = async () => {
    if (!window.confirm(`Remove ${c.name} from the crew? Their link stops working. Sales and notes they logged stay.`)) return;
    const x = await api.removeCrew(c.id);
    if (x.error) return fail(c.name)(x.error);
    onRemove();
  };
  const text = `Hey ${c.name}! Here's your crew link for ${eventName}. Tap it, read the briefing and hit "Got it": ${url}`;

  return (
    <article className={`td-panel td-crew${c.revoked_at ? ' is-off' : ''}`}>
      <div className="td-row">
        <b className="td-crew-name">{c.name}</b>
        <span className="td-hint">{c.revoked_at ? 'link cut off' : ago(c.last_seen_at)}</span>
        {r.total > 0 && <span className={`td-due ${r.read === r.total ? 'is-done' : 'is-soon'}`}>{r.read}/{r.total} READ</span>}
        <div style={{ flex: 1 }} />
        {!c.revoked_at && <>
          <button className="td-btn cyan" onClick={() => void copy()}>COPY LINK</button>
          <a className="td-btn quiet" href={`sms:?&body=${encodeURIComponent(text)}`}>TEXT IT</a>
          <button className="td-btn quiet" onClick={() => void showQr()}>{qr ? 'HIDE QR' : 'QR'}</button>
        </>}
      </div>
      <RoleChips value={c.roles} onChange={(roles) => void patch({ roles })} label={`${c.name}'s jobs`} />
      {qr && <div className="td-crew-qr" dangerouslySetInnerHTML={{ __html: qr }} aria-label={`QR code for ${c.name}'s link`} />}
      <div className="td-row">
        {c.revoked_at
          ? <button className="td-btn quiet" onClick={() => void reissue()}>GIVE A NEW LINK</button>
          : <>
            <button className="td-link" onClick={() => void reissue()}>New link</button>
            <button className="td-link" onClick={() => void patch({ revoked_at: new Date().toISOString() })}>Cut off link</button>
          </>}
        <button className="td-link danger" onClick={() => void remove()}>Remove</button>
      </div>
    </article>
  );
}

// ---------- announcements ----------
function News({ eventId, email, data, setData, fail, toast }: { eventId: string; email: string; data: api.CrewData; setData: Setter; fail: Fail; toast: (s: string) => void }) {
  const [editing, setEditing] = useState<Announcement | 'new' | null>(data.announcements.length ? null : 'new');
  const save = async (a: { title: string; body: string; roles: Role[]; pinned: boolean }) => {
    const r = editing && editing !== 'new' ? await api.updateAnnouncement(editing.id, a) : await api.postAnnouncement(eventId, a, email);
    if (r.error || !r.data) return fail('Announcement')(r.error);
    const rest = data.announcements.filter((x) => x.id !== r.data!.id);
    setData({ ...data, announcements: [r.data, ...rest].sort((x, y) => Number(y.pinned) - Number(x.pinned) || y.created_at.localeCompare(x.created_at)) });
    setEditing(null);
    toast(editing === 'new' ? `Posted to ${audienceLabel(a.roles)}.` : 'Updated. People who already tapped Got it keep their receipt.');
  };
  const del = async (a: Announcement) => {
    if (!window.confirm(`Delete "${a.title}"?`)) return;
    const r = await api.deleteAnnouncement(a.id);
    if (r.error) return fail(a.title)(r.error);
    setData({ ...data, announcements: data.announcements.filter((x) => x.id !== a.id) });
  };
  return (
    <>
      {editing
        ? <Composer initial={editing === 'new' ? null : editing} onSave={save} onCancel={() => setEditing(null)} />
        : <button className="td-btn cta" style={{ alignSelf: 'flex-start' }} onClick={() => setEditing('new')}>+ NEW ANNOUNCEMENT</button>}
      {!data.announcements.length && !editing && <div className="td-empty">Nothing posted yet.</div>}
      {data.announcements.map((a) => {
        const rc = receipts(a, data.crew, data.reads);
        return (
          <article key={a.id} className={`td-panel td-news${a.pinned ? ' is-pinned' : ''}`}>
            <div className="td-row">
              <b>{a.pinned ? '📌 ' : ''}{a.title}</b>
              <span className="td-hint">{audienceLabel(a.roles)} · {new Date(a.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
              <div style={{ flex: 1 }} />
              <span className={`td-due ${rc.missing.length ? 'is-soon' : 'is-done'}`}>{rc.read.length}/{rc.audience} GOT IT</span>
            </div>
            {a.body && <p className="td-news-body">{a.body}</p>}
            {rc.missing.length > 0 && <span className="td-hint">Waiting on: {rc.missing.join(', ')}</span>}
            <div className="td-row">
              <button className="td-link" onClick={() => setEditing(a)}>Edit</button>
              <button className="td-link danger" onClick={() => void del(a)}>Delete</button>
            </div>
          </article>
        );
      })}
    </>
  );
}

function Composer({ initial, onSave, onCancel }: { initial: Announcement | null; onSave: (a: { title: string; body: string; roles: Role[]; pinned: boolean }) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [roles, setRoles] = useState<Role[]>(initial?.roles ?? []);
  const [pinned, setPinned] = useState(initial?.pinned ?? false);
  const [busy, setBusy] = useState(false);
  return (
    <section className="td-panel td-form">
      <input className="td-input" aria-label="Announcement title" placeholder="Title (e.g. Crew call: 7:00 at the pavilion)" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="td-input" aria-label="Announcement details" rows={5} maxLength={4000} placeholder="Details, directions, what to bring…" value={body} onChange={(e) => setBody(e.target.value)} />
      <span className="td-label">WHO IS IT FOR? (none picked = everyone)</span>
      <RoleChips value={roles} onChange={setRoles} label="Announcement audience" />
      <label className="td-inline"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> <span>Pin to the top</span></label>
      <div className="td-row">
        <button className="td-btn cta" disabled={busy || !title.trim()} onClick={async () => { setBusy(true); await onSave({ title: title.trim(), body: body.trim(), roles, pinned }); setBusy(false); }}>
          {busy ? 'POSTING…' : initial ? 'SAVE' : 'POST'}
        </button>
        <button className="td-btn quiet" onClick={onCancel}>CANCEL</button>
      </div>
    </section>
  );
}

// ---------- raffle ----------
function Raffle({ eventId, email, sales, reload, fail }: { eventId: string; email: string; sales: RaffleSale[]; reload: () => Promise<void>; fail: Fail }) {
  const t = raffleTotals(sales);
  const [tickets, setTickets] = useState('');
  const [amount, setAmount] = useState('');
  const [buyer, setBuyer] = useState('');
  const [method, setMethod] = useState<RaffleSale['method']>('cash');
  const add = async () => {
    const n = Number(tickets), a = Number(amount);
    if (!Number.isInteger(n) || n < 1 || !Number.isFinite(a) || a < 0) return fail('Sale')(new Error('Tickets must be a whole number and the amount a dollar figure.'));
    const r = await api.tdRaffleSale(eventId, { buyer, tickets: n, amount: Math.round(a * 100) / 100, method }, email);
    if (r.error) return fail('Sale')(r.error);
    setTickets(''); setAmount(''); setBuyer('');
    await reload();
  };
  const toggleVoid = async (s: RaffleSale) => {
    const r = await api.voidSale(s.id, !s.voided_at);
    if (r.error) return fail('Void')(r.error);
    await reload();
  };
  return (
    <>
      <section className="td-panel">
        <div className="td-counts">
          <div className="td-stat"><b style={{ color: 'var(--under)' }}>${t.total.toLocaleString()}</b><span>RAFFLE TOTAL</span></div>
          <div className="td-stat"><b>{t.tickets}</b><span>TICKETS</span></div>
          <div className="td-stat"><b>${t.cash.toLocaleString()}</b><span>CASH</span></div>
          <div className="td-stat"><b>${t.card.toLocaleString()}</b><span>CARD</span></div>
          {t.other > 0 && <div className="td-stat"><b>${t.other.toLocaleString()}</b><span>OTHER</span></div>}
        </div>
        <span className="td-hint">To put this in the prize pool, go to WINNERS and tap USE next to the raffle total. It never changes payouts on its own.</span>
        <form className="td-row" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <input className="td-input" style={{ width: 80 }} inputMode="numeric" aria-label="Tickets" placeholder="Tickets" value={tickets} onChange={(e) => setTickets(e.target.value.replace(/\D/g, ''))} />
          <input className="td-input" style={{ width: 90 }} inputMode="decimal" aria-label="Amount in dollars" placeholder="$" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
          <select className="td-select" aria-label="Payment method" value={method} onChange={(e) => setMethod(e.target.value as RaffleSale['method'])}>
            <option value="cash">Cash</option><option value="card">Card</option><option value="other">Other</option>
          </select>
          <input className="td-input" style={{ flex: '1 1 140px' }} aria-label="Buyer" placeholder="Buyer (optional)" maxLength={80} value={buyer} onChange={(e) => setBuyer(e.target.value)} />
          <button className="td-btn cta" disabled={!tickets || !amount}>LOG SALE</button>
        </form>
      </section>
      {!sales.length && <div className="td-empty">No sales logged yet.</div>}
      {sales.length > 0 && (
        <table className="td-table">
          <thead><tr><th>TIME</th><th>BY</th><th>BUYER</th><th>TICKETS</th><th>$</th><th>PAID</th><th /></tr></thead>
          <tbody>
            {sales.map((s) => (
              <tr key={s.id} className={s.voided_at ? 'is-void' : ''}>
                <td>{new Date(s.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</td>
                <td>{s.logged_by}</td><td>{s.buyer ?? '—'}</td><td>{s.tickets}</td><td>${Number(s.amount).toFixed(2)}</td><td>{s.method}</td>
                <td><button className="td-link" onClick={() => void toggleVoid(s)}>{s.voided_at ? 'Restore' : 'Void'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
