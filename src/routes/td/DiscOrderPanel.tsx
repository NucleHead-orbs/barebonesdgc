import { useCallback, useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from 'react';
import * as api from '../../lib/innova/api';
import { rpcError } from '../../lib/td/builder';
import {
  GROUP_LABEL, detailIssues, exportName, fillForm, linesInForm, money, openBook, parseCatalog, remapLines, step, summarize,
  type Catalog, type Col, type Details, type Group, type Lines, type Mold,
} from '../../lib/innova/form';
import { MOLD_TYPES, moldInfo, type MoldInfo, type MoldType } from '../../lib/innova/molds';
import './disc-order.css';

type Tab = 'pick' | 'details' | 'review';
const MAX_FORM = 10 * 1024 * 1024;
const TYPE_CLASS: Record<MoldType, string> = { Putter: 'putter', Midrange: 'mid', Fairway: 'fairway', Distance: 'distance', Novelty: 'novelty' };
const mdy = (iso: string) => { const [y, m, d] = iso.split('-'); return y && m && d ? `${m}/${d}/${y}` : ''; };
const todayIso = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
function saveBlob(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * PREP → INNOVA ORDER. The TD uploads Innova's CFR/TFR order form; molds, stock, prices and rules are read from it
 * (src/lib/innova/form.ts), flight info is layered on (molds.ts), and EXPORT fills that same file for Innova.
 * Card details are never stored or filled: the TD types them into the downloaded file.
 */
export default function DiscOrderPanel({ ev, email }: { ev: { id: string; name: string; starts_on: string }; email: string }) {
  const [orders, setOrders] = useState<api.DiscOrder[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const load = useCallback(async () => {
    const r = await api.listOrders(ev.id);
    if (r.error || !r.data) return setErr(rpcError(r.error).message);
    setOrders(r.data); setSel((s) => (s && r.data.some((o) => o.id === s) ? s : r.data[0]?.id ?? null));
  }, [ev.id]);
  useEffect(() => { void (async () => { await load(); })(); }, [load]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 5000); return () => clearTimeout(t); }, [toast]);

  if (!orders) return err ? <div className="td-warn" role="alert">{err}</div> : <p className="td-empty">Loading…</p>;
  const add = async () => {
    const title = orders.length ? `Innova order ${orders.length + 1}` : 'Innova order';
    const r = await api.createOrder(ev.id, title, email, { email, event_date: mdy(ev.starts_on), die: 'Golf Disc', new_stamp: 'Y', misprints: 'No' });
    if (r.error || !r.data) return setErr(rpcError(r.error).message);
    setOrders((os) => [...(os ?? []), r.data!]); setSel(r.data.id);
  };
  const order = orders.find((o) => o.id === sel) ?? null;
  const patch = (o: api.DiscOrder) => setOrders((os) => (os ?? []).map((x) => (x.id === o.id ? o : x)));
  const remove = async (o: api.DiscOrder) => {
    if (!confirm(`Delete "${o.title}" and its uploaded form? This can't be undone.`)) return;
    const r = await api.deleteOrder(o); if (r.error) return setErr(rpcError(r.error).message);
    setToast(`Deleted ${o.title}.`); await load();
  };

  return (
    <div className="io">
      {toast && <div className="td-ok" role="status">{toast}</div>}
      {err && <div className="td-warn" role="alert">{err} <button className="td-btn quiet" onClick={() => setErr('')}>DISMISS</button></div>}
      <div className="td-row io-orders">
        {orders.length > 1 && (
          <div className="td-chips" role="tablist" aria-label="Orders">
            {orders.map((o) => <button key={o.id} className="td-chip" aria-pressed={o.id === sel} onClick={() => setSel(o.id)}>{o.title}{o.status === 'sent' ? ' · SENT' : ''}</button>)}
          </div>
        )}
        <button className="td-btn cyan" onClick={() => void add()}>+ NEW ORDER</button>
        {orders.length > 0 && <span className="td-hint">Innova needs one order per stamp die: minis get their own order.</span>}
      </div>
      {!order && (
        <section className="td-panel io-hero">
          <h2>Custom discs from Innova</h2>
          <p>Build the order here instead of fighting the spreadsheet: pick molds with flight numbers, tap in weights, see Innova's rules checked as you go, then export their own form, filled in and ready to send.</p>
          <button className="td-btn cta" onClick={() => void add()}>START AN ORDER</button>
        </section>
      )}
      {order && <OrderEditor key={order.id} order={order} ev={ev} onSaved={patch} onDelete={() => void remove(order)} setErr={setErr} setToast={setToast} />}
    </div>
  );
}

interface EdProps { order: api.DiscOrder; ev: { id: string; name: string; starts_on: string }; onSaved: (o: api.DiscOrder) => void; onDelete: () => void; setErr: (s: string) => void; setToast: (s: string) => void }

function OrderEditor({ order, ev, onSaved, onDelete, setErr, setToast }: EdProps) {
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [cat, setCat] = useState<Catalog | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [lines, setLines] = useState<Lines>(order.lines ?? {});
  const [details, setDetails] = useState<Details>(order.details ?? {});
  const [title, setTitle] = useState(order.title);
  const [tab, setTab] = useState<Tab>('pick');
  const [saving, setSaving] = useState<'idle' | 'dirty' | 'saving' | 'saved'>('idle');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // load + parse the stored form
  useEffect(() => {
    if (!order.form_path) return;
    let live = true;
    void (async () => {
      const r = await api.downloadForm(order.form_path!);
      if (!live) return;
      if (r.error || !r.data) return setLoadErr(`Couldn't load the stored form: ${rpcError(r.error).message}`);
      try { const c = parseCatalog(await openBook(r.data)); if (live) { setBytes(r.data); setCat(c); } }
      catch (e) { if (live) setLoadErr(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { live = false; };
  }, [order.form_path]);

  // autosave (debounced); flush on unmount
  const pending = useRef<api.OrderPatch | null>(null);
  const cb = useRef({ onSaved, setErr }); useEffect(() => { cb.current = { onSaved, setErr }; });
  const flush = useCallback(async () => {
    const p = pending.current; if (!p) return; pending.current = null; setSaving('saving');
    const r = await api.updateOrder(order.id, p);
    if (r.error || !r.data) { cb.current.setErr(`Save failed: ${rpcError(r.error).message}`); pending.current = { ...p, ...(pending.current ?? {}) }; setSaving('dirty'); return; }
    cb.current.onSaved(r.data); setSaving(pending.current ? 'dirty' : 'saved');
  }, [order.id]);
  const queue = useCallback((p: api.OrderPatch) => { pending.current = { ...(pending.current ?? {}), ...p }; setSaving('dirty'); }, []);
  useEffect(() => { if (saving !== 'dirty') return; const t = setTimeout(() => void flush(), 700); return () => clearTimeout(t); }, [saving, lines, details, title, flush]);
  useEffect(() => () => { void flush(); }, [flush]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (pending.current) e.preventDefault(); };
    window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h);
  }, []);

  const setQty = (m: Mold, col: Col, n: number) => setLines((ls) => {
    const q = { ...(ls[m.row]?.q ?? {}) }; if (n > 0) q[col] = n; else delete q[col];
    const next = { ...ls }; if (Object.keys(q).length) next[m.row] = { mold: m.name, q }; else delete next[m.row];
    queue({ lines: next }); return next;
  });
  const setDetail = (p: Partial<Details>) => setDetails((d) => { const next = { ...d, ...p }; queue({ details: next }); return next; });

  const upload = async (file: File) => {
    if (file.size > MAX_FORM) return setErr('That file is over 10 MB. Innova\'s form is well under 1 MB; is this the right file?');
    setBusy(true);
    try {
      const buf = await file.arrayBuffer(); const book = await openBook(buf); const c = parseCatalog(book);
      await flush();
      let nextLines = lines; let note = '';
      if (Object.keys(lines).length) {
        const r = remapLines(c, lines); nextLines = r.lines;
        note = [r.moved.length ? `${r.moved.length} moved to their new rows` : '', r.dropped.length ? `not on the new form: ${r.dropped.join(', ')}` : ''].filter(Boolean).join('; ');
      } else {
        nextLines = linesInForm(book, c); const n = Object.keys(nextLines).length; if (n) note = `picked up ${n} mold${n === 1 ? '' : 's'} already filled in`;
      }
      const r = await api.replaceForm(order, file, { form_label: c.label.slice(0, 80), lines: nextLines });
      if (r.error || !r.data) throw r.error;
      setLines(nextLines); setBytes(buf); setCat(c); setLoadErr(''); onSaved(r.data);
      setToast(`Loaded Innova's form (${c.label}, ${c.molds.length} molds)${note ? `: ${note}` : ''}.`);
    } catch (e) { setErr(e instanceof Error ? e.message : rpcError(e).message); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const sum = useMemo(() => (cat ? summarize(cat, lines, details) : null), [cat, lines, details]);
  const headIssues = useMemo(() => (cat ? detailIssues(cat, details) : []), [cat, details]);
  const blockers = [...(sum?.issues.filter((i) => i.level === 'error') ?? []), ...headIssues];

  const doExport = async () => {
    if (!bytes || !cat || blockers.length) return;
    setBusy(true);
    try {
      const d = { ...details, order_date: details.order_date || mdy(todayIso()) };
      const out = await fillForm(await openBook(bytes.slice(0)), cat, lines, d);
      saveBlob(out, exportName(d, todayIso()));
      setToast('Downloaded. Open it, type the card number + exp/CVC into the Credit Card boxes, then email it to your Innova rep with the art files.');
    } catch (e) { setErr(`Export failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };
  const setStatus = async (status: 'draft' | 'sent') => {
    await flush(); const r = await api.updateOrder(order.id, { status });
    if (r.error || !r.data) return setErr(rpcError(r.error).message); onSaved(r.data);
  };

  const fileInput = <input ref={fileRef} type="file" hidden accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />;

  return (
    <section className="td-panel io-editor">
      <div className="td-row io-head">
        <input className="td-input io-title" value={title} maxLength={80} aria-label="Order name"
          onChange={(e) => { setTitle(e.target.value); if (e.target.value.trim()) queue({ title: e.target.value.trim() }); }} />
        <span className={`io-save ${saving}`} aria-live="polite">{saving === 'saving' ? 'Saving…' : saving === 'dirty' ? 'Unsaved' : saving === 'saved' ? 'Saved' : ''}</span>
        <div className="td-seg cyan" role="group" aria-label="Status">
          <button aria-pressed={order.status === 'draft'} onClick={() => void setStatus('draft')}>DRAFT</button>
          <button aria-pressed={order.status === 'sent'} onClick={() => void setStatus('sent')}>SENT{order.sent_at ? ` ${new Date(order.sent_at).toLocaleDateString()}` : ''}</button>
        </div>
        <button className="td-btn quiet" onClick={onDelete}>DELETE</button>
      </div>
      {fileInput}
      {order.status === 'sent' && <p className="td-hint io-sent-note">Marked sent. Changes here don't reach Innova until you export and send the file again.</p>}

      {!order.form_path && (
        <div className="io-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void upload(f); }}>
          <b>Step 1: drop in Innova's order form</b>
          <p>The CFR/TFR order form (.xlsx) from your Innova rep. Every mold, weight, price and "out of stock" comes straight from it, and EXPORT fills in that same file.</p>
          <button className="td-btn cta" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'READING…' : 'UPLOAD THE FORM'}</button>
        </div>
      )}
      {order.form_path && !cat && (loadErr ? <div className="td-warn">{loadErr} <button className="td-btn quiet" onClick={() => fileRef.current?.click()}>UPLOAD AGAIN</button></div> : <p className="td-empty">Reading Innova's form…</p>)}

      {cat && sum && (
        <>
          <div className="io-stats">
            <Meter n={sum.golf || sum.minis} min={sum.minis && !sum.golf ? cat.sections.find((s) => s.group === 'minis')?.min ?? 100 : cat.orderMin} label={sum.minis && !sum.golf ? 'MINIS' : 'DISCS'} />
            <div className="td-stat"><b>{sum.lines.length}</b><span>MOLDS</span></div>
            <div className="td-stat"><b>{money(sum.subtotal)}</b><span>DISCS $</span></div>
            <div className="td-stat"><b>{money(sum.feeTotal)}</b><span>FEES (EST.)</span></div>
            <div className="td-stat"><b style={{ color: 'var(--gold)' }}>{money(sum.total)}</b><span>TOTAL (EST.)</span></div>
            <div className="io-form">
              <span>{cat.label} · {cat.molds.length} molds</span>
              <button className="td-btn quiet" disabled={busy} onClick={() => fileRef.current?.click()}>NEWER FORM?</button>
            </div>
          </div>
          {cat.warnings.map((w) => <p key={w} className="td-hint">⚠ {w}</p>)}
          <div className="td-seg" role="tablist" aria-label="Order steps">
            <button role="tab" aria-pressed={tab === 'pick'} onClick={() => setTab('pick')}>1 · PICK DISCS</button>
            <button role="tab" aria-pressed={tab === 'details'} onClick={() => setTab('details')}>2 · DETAILS{headIssues.length ? ` (${headIssues.length})` : ''}</button>
            <button role="tab" aria-pressed={tab === 'review'} onClick={() => setTab('review')}>3 · REVIEW + EXPORT{blockers.length ? ` (${blockers.length})` : ' ✓'}</button>
          </div>
          {tab === 'pick' && <Pick cat={cat} lines={lines} setQty={setQty} issues={sum.issues} />}
          {tab === 'details' && <DetailsForm cat={cat} d={details} set={setDetail} evName={ev.name} />}
          {tab === 'review' && (
            <Review cat={cat} sum={sum} lines={lines} blockers={blockers} busy={busy} onExport={() => void doExport()} go={setTab} />
          )}
        </>
      )}
    </section>
  );
}

function Meter({ n, min, label }: { n: number; min: number; label: string }) {
  const pct = Math.min(100, min ? (n / min) * 100 : 100);
  return (
    <div className="io-meter" title={`Innova minimum: ${min}`}>
      <b className={n >= min ? 'ok' : ''}>{n}<small> / {min}</small></b>
      <div className="io-bar"><i style={{ transform: `scaleX(${pct / 100})` }} /></div>
      <span>{label} · MIN {min}</span>
    </div>
  );
}

// ---------- 1 · pick ----------
function Pick({ cat, lines, setQty, issues }: { cat: Catalog; lines: Lines; setQty: (m: Mold, c: Col, n: number) => void; issues: ReturnType<typeof summarize>['issues'] }) {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<Group | 'all'>('custom');
  const [types, setTypes] = useState<MoldType[]>([]);
  const [sec, setSec] = useState<number | 0>(0);
  const [mine, setMine] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const groups = (['custom', 'tfr', 'minis'] as Group[]).filter((g) => cat.molds.some((m) => m.group === g));
  const secs = cat.sections.filter((s) => group === 'all' || s.group === group);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = cat.molds.filter((m) => {
    if (mine) return !!lines[m.row];
    if (group !== 'all' && m.group !== group) return false;
    if (sec && m.section !== sec) return false;
    const info = moldInfo(m.name);
    if (types.length && !(info && types.includes(info.type))) return false;
    const hay = `${m.name} ${info?.type ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const secTitle = new Map(cat.sections.map((s) => [s.row, s]));
  const secRange = (row: number) => { const m = cat.molds.find((x) => x.section === row); const l = m?.slots.filter((x) => x.label !== 'Qty') ?? [];
    return l.length ? ` · ${l[0].label.split('-')[0]}–${l[l.length - 1].label.split('-')[1]}g` : ''; };
  const rowIssues = new Map<number, string[]>(); for (const i of issues) if (i.row) rowIssues.set(i.row, [...(rowIssues.get(i.row) ?? []), i.text]);
  const inOrder = Object.keys(lines).length;
  return (
    <div className="io-pick">
      <div className="io-filters">
        <input className="td-input" type="search" placeholder="Search molds: destroyer, glow, star…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search molds" />
        <div className="td-chips">
          {groups.map((g) => <button key={g} className="td-chip" aria-pressed={!mine && group === g} onClick={() => { setMine(false); setGroup(g); setSec(0); }}>{GROUP_LABEL[g].toUpperCase()}</button>)}
          <button className="td-chip io-mine" aria-pressed={mine} onClick={() => setMine((v) => !v)}>IN THIS ORDER ({inOrder})</button>
        </div>
        {!mine && (
          <div className="td-row">
            <div className="td-chips">
              {MOLD_TYPES.map((t) => <button key={t} className={`td-chip io-t ${TYPE_CLASS[t]}`} aria-pressed={types.includes(t)} onClick={() => setTypes((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]))}>{t.toUpperCase()}</button>)}
            </div>
            <select className="td-select" value={sec} onChange={(e) => setSec(+e.target.value)} aria-label="Plastic">
              <option value={0}>All plastics</option>
              {secs.map((s) => <option key={s.row} value={s.row}>{s.title.replace(/\s*-\s*\d+ disc minimum/i, '')}{secRange(s.row)}{s.min ? ` · ${s.min} min` : ''}</option>)}
            </select>
          </div>
        )}
        <p className="td-hint">{shown.length} molds · tap one to add weights. Tapping + starts at Innova's minimum per weight. Orange = made for customs. Yellow = low stock.</p>
      </div>
      <div className="io-grid">
        {shown.map((m) => (
          <MoldCard key={m.row} m={m} info={moldInfo(m.name)} plastic={secTitle.get(m.section)?.title ?? ''} q={lines[m.row]?.q ?? {}}
            open={open === m.row} toggle={() => setOpen((o) => (o === m.row ? null : m.row))} setQty={(c, n) => setQty(m, c, n)} problems={rowIssues.get(m.row) ?? []} />
        ))}
        {!shown.length && <p className="td-empty">{mine ? 'Nothing picked yet.' : 'No molds match.'}</p>}
      </div>
    </div>
  );
}

function Flight({ info }: { info: MoldInfo }) {
  if (info.speed == null) return <div className="io-flight none">{info.type}</div>;
  const turn = info.turn ?? 0, fade = info.fade ?? 0;
  const xm = 22 - turn * 3.2, xe = xm - fade * 4;
  return (
    <div className="io-flight" aria-label={`Speed ${info.speed}, glide ${info.glide}, turn ${turn}, fade ${fade}`}>
      <svg viewBox="0 0 44 64" width="30" height="44" aria-hidden="true">
        <path d={`M22 62 C22 44 ${xm} 30 ${xm} 20 S ${xe} 6 ${xe} 4`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx={xe} cy="4" r="3" fill="currentColor" />
      </svg>
      <dl>{([['S', info.speed], ['G', info.glide], ['T', turn], ['F', fade]] as const).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </div>
  );
}

function MoldCard({ m, info, plastic, q, open, toggle, setQty, problems }: {
  m: Mold; info: MoldInfo | null; plastic: string; q: Partial<Record<Col, number>>; open: boolean; toggle: () => void; setQty: (c: Col, n: number) => void; problems: string[];
}) {
  const discs = Object.values(q).reduce<number>((a, n) => a + (n ?? 0), 0);
  const avail = m.slots.filter((s) => !s.out);
  const name = m.name.replace(/\s*-\s*requires.*$/i, '').replace(/\*+$/, '').trim();
  return (
    <article className={`io-card ${info ? TYPE_CLASS[info.type] : 'none'}${discs ? ' picked' : ''}${problems.length ? ' bad' : ''}${!avail.length ? ' soldout' : ''}`}>
      <button className="io-card-top" onClick={toggle} aria-expanded={open}>
        <div className="io-card-name">
          <b>{name}</b>
          <span>{plastic} · {money(m.price)}/disc{m.minMold ? ` · min ${m.minMold}` : ''}</span>
          <span className="io-badges">
            {info && <em className="io-type">{info.type}</em>}
            {m.customStock && <em className="io-orange">MADE FOR CUSTOMS</em>}
            {m.slots.some((s) => s.low && !s.out) && <em className="io-yellow">LOW STOCK</em>}
            {m.flatTop && <em>FLAT TOP +$</em>}
            {m.setup > 0 && <em>+{money(m.setup)} SETUP</em>}
            {!avail.length && <em>SOLD OUT</em>}
          </span>
        </div>
        {info && <Flight info={info} />}
        {discs > 0 && <div className="io-count"><b>{discs}</b><span>{money(discs * m.price)}</span></div>}
      </button>
      {open && (
        <div className="io-card-body">
          {info?.blurb && <p className="io-blurb">{info.blurb} {info.url && <a href={info.url} target="_blank" rel="noreferrer">Innova ↗</a>}</p>}
          <div className="io-weights">
            {m.slots.map((s) => {
              const n = q[s.col] ?? 0;
              return (
                <div key={s.col} className={`io-w${s.out ? ' out' : ''}${s.low ? ' low' : ''}${n ? ' on' : ''}`}>
                  <span className="io-w-label">{s.label}{s.label !== 'Qty' ? 'g' : ''}</span>
                  {s.out ? <span className="io-w-out">OUT</span> : (
                    <div className="io-step">
                      <button aria-label={`Less ${s.label}`} onClick={() => setQty(s.col, step(n, -1, m.minCell))} disabled={!n}>−</button>
                      <input inputMode="numeric" aria-label={`${name} ${s.label}`} value={n || ''} placeholder="0"
                        onChange={(e) => setQty(s.col, Math.max(0, Math.min(9999, parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)))} />
                      <button aria-label={`More ${s.label}`} onClick={() => setQty(s.col, step(n, 1, m.minCell))}>+</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {problems.map((p) => <p key={p} className="io-problem">{p}</p>)}
          {m.minCell > 0 && <p className="td-hint">Innova: at least {m.minCell} per weight you pick{m.minMold ? `, ${m.minMold} per mold` : ''}. Colors come assorted unless you ask in the notes.</p>}
        </div>
      )}
    </article>
  );
}

// ---------- 2 · details ----------
function DetailsForm({ cat, d, set, evName }: { cat: Catalog; d: Details; set: (p: Partial<Details>) => void; evName: string }) {
  const f = (k: keyof Details & string, label: string, props: Partial<InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <label className="td-field"><span className="td-hint">{label}</span>
      <input className="td-input" value={(d[k as keyof Details] as string) ?? ''} onChange={(e) => set({ [k]: e.target.value } as Partial<Details>)} {...props} /></label>
  );
  const lines = (k: 'ship' | 'bill', label: string, n: number) => (
    <fieldset className="io-addr"><legend className="td-hint">{label}</legend>
      {Array.from({ length: n }, (_, i) => (
        <input key={i} className="td-input" value={d[k]?.[i] ?? ''} placeholder={['Name / business', 'Street', 'City, State ZIP', 'Phone or attention'][i]} aria-label={`${label} line ${i + 1}`}
          onChange={(e) => { const next = [...(d[k] ?? [])]; next[i] = e.target.value; set({ [k]: next }); }} />
      ))}
    </fieldset>
  );
  return (
    <div className="io-details">
      <div className="td-fields">
        {f('name', 'Customer name (you)', { autoComplete: 'name' })}
        {f('email', 'Email Innova replies to', { type: 'email', autoComplete: 'email' })}
        {f('phone', 'Phone', { type: 'tel', autoComplete: 'tel' })}
        {f('artwork', 'Artwork name', { placeholder: `${evName} stamp` })}
        <label className="td-field"><span className="td-hint">Die size</span>
          <select className="td-select" value={d.die ?? ''} onChange={(e) => set({ die: e.target.value })}>
            <option value="">Pick…</option><option>Golf Disc</option><option>Mini</option>
          </select></label>
        <label className="td-field"><span className="td-hint">New stamp? (new art = new die)</span>
          <select className="td-select" value={d.new_stamp ?? 'Y'} onChange={(e) => set({ new_stamp: e.target.value })}>
            <option value="Y">Yes: new art ({money(cat.fees.dieNew.golf)} die)</option><option value="N">No: reorder a die Innova has ({money(cat.fees.dieReorder.golf)})</option>
          </select></label>
        <label className="td-field"><span className="td-hint">Include misprints?</span>
          <select className="td-select" value={d.misprints ?? 'No'} onChange={(e) => set({ misprints: e.target.value })}>
            <option>No</option><option>Yes</option>
          </select></label>
        {f('event_date', 'Event date', { placeholder: 'MM/DD/YYYY' })}
        {f('order_date', 'Order date (blank = export day)', { placeholder: 'MM/DD/YYYY' })}
        {f('rep', 'Innova rep (if you have one)')}
      </div>
      <p className="td-hint">Misprints: discs that stamp badly get re-stamped offset and sold by Innova as factory seconds, unless you say Yes and buy them at the misprint price.</p>
      <div className="io-addrs">{lines('ship', 'Shipping address', cat.ship.length || 4)}{lines('bill', 'Billing address (blank = same)', cat.bill.length || 4)}</div>
      <label className="td-field wide"><span className="td-hint">Notes to Innova: colors, foil, anything special (orders come in assorted colors unless you ask)</span>
        <textarea className="td-input io-notes" rows={3} maxLength={900} value={d.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></label>
      <div className="io-card-note" role="note">
        <b>Credit card:</b> not here, on purpose. The card number and exp/CVC never get saved in this app. After you export, type them into the Credit Card boxes in the file (or call your rep).
      </div>
    </div>
  );
}

// ---------- 3 · review ----------
function Review({ cat, sum, lines, blockers, busy, onExport, go }: {
  cat: Catalog; sum: ReturnType<typeof summarize>; lines: Lines; blockers: Array<{ text: string }>; busy: boolean; onExport: () => void; go: (t: Tab) => void;
}) {
  const sec = new Map(cat.sections.map((s) => [s.row, s.title]));
  const warns = sum.issues.filter((i) => i.level === 'warn');
  return (
    <div className="io-review">
      {sum.lines.length > 0 && (
        <div className="io-table-wrap">
          <table className="io-table">
            <thead><tr><th>Mold</th><th>Weights</th><th>Discs</th><th>Each</th><th>Total</th></tr></thead>
            <tbody>
              {sum.lines.map((l) => (
                <tr key={l.mold.row}>
                  <td><b>{l.mold.name.replace(/\s*-\s*requires.*$/i, '')}</b><small>{sec.get(l.mold.section)}</small></td>
                  <td>{l.mold.slots.filter((s) => lines[l.mold.row]?.q[s.col]).map((s) => `${lines[l.mold.row]!.q[s.col]}×${s.label}`).join(' · ')}</td>
                  <td>{l.discs}</td><td>{money(l.mold.price)}</td><td>{money(l.subtotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={2}>Discs</td><td>{sum.discs}</td><td /><td>{money(sum.subtotal)}</td></tr>
              {sum.fees.map((f) => <tr key={f.label} className="fee"><td colSpan={4}>{f.label}</td><td>{money(f.amount)}</td></tr>)}
              <tr className="grand"><td colSpan={4}>Estimated total (before shipping + tax)</td><td>{money(sum.total)}</td></tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="td-hint">Prices and fees come from this Innova form. Innova confirms the final invoice, shipping and any foil or color substitutions.</p>
      {blockers.length > 0 && (
        <div className="io-issues bad" role="alert"><b>Fix before exporting</b>
          <ul>{blockers.map((b) => <li key={b.text}>{b.text}</li>)}</ul>
          <div className="td-row"><button className="td-btn quiet" onClick={() => go('pick')}>BACK TO DISCS</button><button className="td-btn quiet" onClick={() => go('details')}>BACK TO DETAILS</button></div>
        </div>
      )}
      {warns.length > 0 && <div className="io-issues warn"><b>Heads up</b><ul>{warns.map((w) => <li key={w.text}>{w.text}</li>)}</ul></div>}
      <div className="io-export">
        <button className="td-btn cta" disabled={busy || blockers.length > 0} onClick={onExport}>{busy ? 'BUILDING…' : 'EXPORT INNOVA FORM (.XLSX)'}</button>
        <ol className="td-hint">
          <li>Download fills in Innova's own form: every disc, weight and header box.</li>
          <li>Open it and add the card number + exp/CVC (never stored here).</li>
          <li>Email it to your Innova rep with the stamp art (.ai / .eps / .pdf), then flip this order to SENT.</li>
        </ol>
      </div>
    </div>
  );
}
