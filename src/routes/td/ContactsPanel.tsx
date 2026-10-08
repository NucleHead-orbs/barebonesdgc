import { useCallback, useEffect, useState } from 'react';
import * as api from '../../lib/td/api';
import { rpcError } from '../../lib/td/builder';
import {
  CONTACT_KINDS, CONTACT_STATUSES, KIND_LABEL, STATUS_LABEL, contactRollup,
  type Contact, type ContactKind, type ContactStatus, type CrewMember,
} from '../../lib/crew/crew';

type Filter = 'open' | 'leads' | 'yes' | 'all';
const blank = (): Partial<Contact> => ({ kind: 'sponsor', name: '', org: '', phone: '', email: '', status: 'to_ask', amount: null, notes: '', crew_id: null });

/**
 * PREP → CONTACTS: vendors + sponsor prospects. Crew add leads from their link (status 'lead');
 * the TD approves (moves on) or says no. A sponsor at yes/paid can be promoted into the Sponsors list (hidden until approved there).
 */
export default function ContactsPanel({ eventId, email, useSponsors }: { eventId: string; email: string; useSponsors: boolean }) {
  const [list, setList] = useState<Contact[] | null>(null);
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [filter, setFilter] = useState<Filter>('open');
  const [kind, setKind] = useState<ContactKind | 'all'>('all');
  const [editing, setEditing] = useState<Partial<Contact> | null>(null);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    const [c, k] = await Promise.all([api.loadContacts(eventId), api.loadCrew(eventId)]);
    if (c.error || !c.data) return setErr(rpcError(c.error).message);
    setList(c.data);
    if (k.data) setCrew(k.data.crew.filter((x) => !x.revoked_at));
  }, [eventId]);
  useEffect(() => { void (async () => { await load(); })(); }, [load]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t); }, [toast]);

  if (!list) return err ? <div className="td-warn" role="alert">{err}</div> : <p className="td-empty">Loading…</p>;
  const r = contactRollup(list);
  const byName = new Map(crew.map((c) => [c.id, c.name]));
  const shown = list.filter((c) => (kind === 'all' || c.kind === kind) && (
    filter === 'all' || (filter === 'leads' && c.status === 'lead') || (filter === 'yes' && (c.status === 'yes' || c.status === 'paid'))
    || (filter === 'open' && ['lead', 'to_ask', 'asked'].includes(c.status))));

  const save = async (c: Partial<Contact>) => {
    if (!c.name?.trim()) return setErr('A contact needs a name.');
    const x = await api.saveContact(eventId, { ...c, name: c.name.trim() }, email);
    if (x.error || !x.data) return setErr(rpcError(x.error).message);
    setList([x.data, ...list.filter((y) => y.id !== x.data!.id)]);
    setEditing(null); setErr('');
  };
  const setStatus = async (c: Contact, status: ContactStatus) => save({ ...c, status });
  const promote = async (c: Contact) => {
    const x = await api.promoteContact(c.id);
    if (x.error || !x.data) return setErr(rpcError(x.error).message);
    setList(list.map((y) => (y.id === c.id ? { ...y, sponsor_id: x.data! } : y)));
    setToast(`${c.org || c.name} added to Sponsors (hidden). Approve it and add the logo in the Sponsors tab.`);
  };
  const remove = async (c: Contact) => {
    if (!window.confirm(`Delete ${c.name}?`)) return;
    const x = await api.deleteContact(c.id);
    if (x.error) return setErr(rpcError(x.error).message);
    setList(list.filter((y) => y.id !== c.id));
  };

  return (
    <>
      {toast && <div className="td-ok" role="status">{toast}</div>}
      {err && <div className="td-warn" role="alert">{err} <button className="td-btn quiet" onClick={() => setErr('')}>DISMISS</button></div>}
      <section className="td-panel">
        <div className="td-counts">
          <div className="td-stat"><b style={{ color: r.leads ? 'var(--gold)' : 'var(--fg-1)' }}>{r.leads}</b><span>NEW LEADS</span></div>
          <div className="td-stat"><b>{r.open}</b><span>IN PROGRESS</span></div>
          <div className="td-stat"><b style={{ color: 'var(--under)' }}>{r.sponsorsYes}</b><span>SPONSORS YES</span></div>
          <div className="td-stat"><b>${r.pledged.toLocaleString()}</b><span>PLEDGED</span></div>
          <div className="td-stat"><b>${r.paid.toLocaleString()}</b><span>PAID</span></div>
        </div>
        <div className="td-row">
          <div className="td-seg">
            {([['open', 'OPEN'], ['leads', `LEADS${r.leads ? ` ${r.leads}` : ''}`], ['yes', 'YES / PAID'], ['all', 'ALL']] as Array<[Filter, string]>)
              .map(([f, l]) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{l}</button>)}
          </div>
          <select className="td-select" aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as ContactKind | 'all')}>
            <option value="all">All kinds</option>
            {CONTACT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}s</option>)}
          </select>
          <div style={{ flex: 1 }} />
          <button className="td-btn cta" onClick={() => setEditing(blank())}>+ ADD CONTACT</button>
        </div>
      </section>
      {editing && <ContactForm c={editing} crew={crew} onSave={save} onCancel={() => setEditing(null)} />}
      {!shown.length && <div className="td-empty">{list.length ? 'Nothing in this filter.' : 'No contacts yet. Add vendors and sponsor prospects, or let crew add leads.'}</div>}
      <div className="td-grid td-contacts">
        {shown.map((c) => (
          <article key={c.id} className={`td-card td-contact is-${c.status}`}>
            <div className="td-card-head">
              <div className="td-card-title">
                <b>{c.org || c.name}</b>
                <span>{KIND_LABEL[c.kind]}{c.org ? ` · ${c.name}` : ''}{c.amount != null ? ` · $${Number(c.amount).toLocaleString()}` : ''}</span>
              </div>
              <span className={`td-due is-${c.status === 'lead' ? 'soon' : c.status === 'yes' || c.status === 'paid' ? 'done' : c.status === 'no' ? 'overdue' : 'later'}`}>{STATUS_LABEL[c.status].toUpperCase()}</span>
            </div>
            <div className="td-design-body">
              {(c.phone || c.email) && <span className="td-hint">
                {c.phone && <a className="td-link" href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>{c.phone}</a>}{c.phone && c.email ? ' · ' : ''}
                {c.email && <a className="td-link" href={`mailto:${c.email}`}>{c.email}</a>}
              </span>}
              {c.notes && <p className="td-news-body">{c.notes}</p>}
              <span className="td-hint">{c.crew_id ? `Owner: ${byName.get(c.crew_id) ?? 'crew'}` : 'No owner'}{c.created_by ? ` · added by ${c.created_by}` : ''}</span>
              {c.status === 'lead'
                ? <div className="td-row">
                  <button className="td-btn cta" onClick={() => void setStatus(c, 'to_ask')}>APPROVE LEAD</button>
                  <button className="td-btn quiet" onClick={() => void setStatus(c, 'no')}>NO THANKS</button>
                </div>
                : <select className="td-select" aria-label={`${c.name} status`} value={c.status} onChange={(e) => void setStatus(c, e.target.value as ContactStatus)}>
                  {CONTACT_STATUSES.filter((s) => s !== 'lead').map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>}
              {c.kind === 'sponsor' && (c.status === 'yes' || c.status === 'paid') && (
                c.sponsor_id ? <span className="td-hint">✓ In the Sponsors list</span>
                  : <button className="td-btn cyan" onClick={() => void promote(c)} title={useSponsors ? '' : 'Turn on hole sponsors in Setup to show them publicly'}>ADD TO SPONSORS</button>
              )}
              <div className="td-row">
                <button className="td-link" onClick={() => setEditing(c)}>Edit</button>
                <button className="td-link danger" onClick={() => void remove(c)}>Delete</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function ContactForm({ c, crew, onSave, onCancel }: { c: Partial<Contact>; crew: CrewMember[]; onSave: (c: Partial<Contact>) => Promise<void>; onCancel: () => void }) {
  const [f, setF] = useState(c);
  const set = (p: Partial<Contact>) => setF({ ...f, ...p });
  return (
    <section className="td-panel td-form">
      <div className="td-row">
        <select className="td-select" aria-label="Kind" value={f.kind} onChange={(e) => set({ kind: e.target.value as ContactKind })}>
          {CONTACT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <input className="td-input" style={{ flex: '1 1 160px' }} aria-label="Contact name" placeholder="Person's name" maxLength={80} value={f.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
        <input className="td-input" style={{ flex: '1 1 160px' }} aria-label="Business" placeholder="Business" maxLength={80} value={f.org ?? ''} onChange={(e) => set({ org: e.target.value })} />
      </div>
      <div className="td-row">
        <input className="td-input" style={{ flex: '1 1 140px' }} aria-label="Phone" placeholder="Phone" inputMode="tel" maxLength={40} value={f.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} />
        <input className="td-input" style={{ flex: '1 1 180px' }} aria-label="Email" placeholder="Email" inputMode="email" maxLength={120} value={f.email ?? ''} onChange={(e) => set({ email: e.target.value })} />
        <input className="td-input" style={{ width: 110 }} aria-label="Amount" placeholder="$ amount" inputMode="decimal" value={f.amount ?? ''}
          onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ''); set({ amount: v ? Number(v) : null }); }} />
      </div>
      <div className="td-row">
        <select className="td-select" aria-label="Status" value={f.status} onChange={(e) => set({ status: e.target.value as ContactStatus })}>
          {CONTACT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select className="td-select" aria-label="Owner" value={f.crew_id ?? ''} onChange={(e) => set({ crew_id: e.target.value || null })}>
          <option value="">No owner</option>
          {crew.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>
      <textarea className="td-input" rows={3} aria-label="Notes" placeholder="What they said, what they want, follow-up date…" maxLength={2000} value={f.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
      <div className="td-row">
        <button className="td-btn cta" disabled={!f.name?.trim()} onClick={() => void onSave(f)}>SAVE</button>
        <button className="td-btn quiet" onClick={onCancel}>CANCEL</button>
      </div>
    </section>
  );
}
