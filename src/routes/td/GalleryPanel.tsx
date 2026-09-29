import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import * as api from '../../lib/gallery/api';
import {
  CATEGORIES, IMPORTABLE, guessFromPath, titleFromFilename, youtubeThumb,
  type GalleryCategory, type GalleryItem,
} from '../../lib/gallery/gallery';
import { rpcError } from '../../lib/td/builder';
import './gallery-panel.css';

type Show = 'waiting' | 'visible' | 'all';
const PAGE = 60;
const WORKERS = 3;

/**
 * Club gallery curation (super admin only; the database refuses anyone else).
 * Everything lands Hidden. Bulk-import a Drive folder (first-pass tags come from the folder names),
 * fix what's wrong, switch on Visible. Re-importing the same folder skips files already in.
 */
export default function GalleryPanel({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const [error, setError] = useState('');
  const [show, setShow] = useState<Show>('waiting');
  const [cat, setCat] = useState<GalleryCategory | ''>('');
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);
  const [prog, setProg] = useState<{ done: number; total: number; added: number; skipped: number; failed: string[] } | null>(null);
  const [vUrl, setVUrl] = useState('');
  const [vTitle, setVTitle] = useState('');
  const [vCat, setVCat] = useState<GalleryCategory>('photo');

  const reload = useCallback(async () => {
    const r = await api.loadAll();
    if (r.error) return setError(rpcError(r.error).message);
    setError(''); setItems(r.data ?? []);
  }, []);
  useEffect(() => { void (async () => { await reload(); })(); }, [reload]);

  const all = useMemo(() => items ?? [], [items]);
  const waiting = all.filter((i) => i.hidden).length;
  const filtered = all.filter((i) => (show === 'all' || (show === 'waiting') === i.hidden) && (!cat || i.category === cat));
  const shown = filtered.slice(0, limit);

  const patch = (next: GalleryItem) => setItems((xs) => (xs ?? []).map((x) => (x.id === next.id ? next : x)));
  const save = async (it: GalleryItem, p: api.GalleryPatch) => {
    setBusy(it.id);
    const r = await api.update(it.id, p);
    setBusy(null);
    if (r.error) return setError(rpcError(r.error).message);
    setError(''); patch(r.data!);
  };
  const del = async (it: GalleryItem) => {
    setBusy(it.id);
    const r = await api.remove(it);
    setBusy(null);
    if (r.error) return setError(rpcError(r.error).message);
    setItems((xs) => (xs ?? []).filter((x) => x.id !== it.id));
  };
  const approveShown = async (hidden: boolean) => {
    setBusy('bulk');
    const r = await api.setHidden(shown.map((i) => i.id), hidden);
    setBusy(null);
    if (r.error) return setError(rpcError(r.error).message);
    await reload();
  };

  const onFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) => IMPORTABLE.test(f.name));
    e.target.value = '';
    if (!files.length) return setError('No PNG, JPG, WebP or GIF files in that pick.');
    setError('');
    const st = { done: 0, total: files.length, added: 0, skipped: 0, failed: [] as string[] };
    setProg({ ...st });
    const queue = files.slice();
    const work = async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        const g = guessFromPath(path);
        const r = await api.addImage({ file: f, title: titleFromFilename(path), ...g, source_path: path.includes('/') ? path : null });
        st.done++;
        if (r.error) st.failed.push(`${f.name}: ${rpcError(r.error).message}`);
        else if (r.data === 'exists') st.skipped++;
        else st.added++;
        setProg({ ...st, failed: st.failed.slice() });
      }
    };
    await Promise.all(Array.from({ length: Math.min(WORKERS, files.length) }, work));
    setShow('waiting');
    await reload();
  };

  const addVideo = async () => {
    setBusy('video');
    const r = await api.addVideo(vUrl, vTitle.trim() || 'Untitled clip', vCat, null);
    setBusy(null);
    if (r.error) return setError(r.error instanceof Error ? r.error.message : rpcError(r.error).message);
    setVUrl(''); setVTitle(''); setShow('waiting'); await reload();
  };

  const running = !!prog && prog.done < prog.total;

  return (
    <div className="td-main">
      <div className="td-row">
        <button className="td-btn" onClick={onBack}>‹ BACK TO EVENTS</button>
        <div className="td-title">Club Gallery</div>
        <div className="td-stat"><b>{all.length}</b><span>TOTAL</span></div>
        <div className="td-stat"><b style={{ color: 'var(--under)' }}>{all.length - waiting}</b><span>VISIBLE</span></div>
        <div className="td-stat"><b style={{ color: waiting ? 'var(--gold)' : '#fff' }}>{waiting}</b><span>WAITING</span></div>
        <div style={{ flex: 1 }} />
        <a className="td-btn cyan" href="/gallery" target="_blank" rel="noreferrer">VIEW PUBLIC PAGE</a>
      </div>
      <div className="td-hint">
        Everything lands Hidden. Pick a whole folder from the Drive archive: Funny Pics become memes, Events/The Jewel/&lt;year&gt; become that Jewel,
        Events/&lt;name&gt; become events, the rest are photos. Images are shrunk to 1600px before upload. Picking the same folder again skips files already in.
      </div>
      {error && <div className="td-warn" role="alert">⚠ {error}</div>}

      <div className="td-row">
        <label className={`td-btn cta${running ? ' disabled' : ''}`}>
          IMPORT A FOLDER
          <input type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif" disabled={running}
            onChange={(e) => void onFiles(e)} {...{ webkitdirectory: '', directory: '' }} />
        </label>
        <label className={`td-btn${running ? ' disabled' : ''}`}>
          ADD FILES
          <input type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif" disabled={running} onChange={(e) => void onFiles(e)} />
        </label>
        {prog && (
          <div className="td-hint" role="status" aria-live="polite">
            {running ? 'Uploading' : 'Done'}: {prog.done} / {prog.total} · {prog.added} added · {prog.skipped} already in{prog.failed.length ? ` · ${prog.failed.length} failed` : ''}
          </div>
        )}
      </div>
      {prog && prog.failed.length > 0 && !running && (
        <details className="td-warn soft"><summary>{prog.failed.length} file{prog.failed.length === 1 ? '' : 's'} didn't make it</summary>
          <ul>{prog.failed.slice(0, 50).map((f) => <li key={f}>{f}</li>)}</ul>
        </details>
      )}

      <div className="td-row">
        <input className="td-input" style={{ flex: 2, minWidth: 220 }} placeholder="YouTube link (watch, youtu.be or shorts)" value={vUrl} onChange={(e) => setVUrl(e.target.value)} />
        <input className="td-input" style={{ flex: 1, minWidth: 160 }} placeholder="Title (e.g. Pig Day 2022)" value={vTitle} onChange={(e) => setVTitle(e.target.value)} />
        <select className="td-select" aria-label="Video category" value={vCat} onChange={(e) => setVCat(e.target.value as GalleryCategory)}>
          {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <button className="td-btn cta" onClick={() => void addVideo()} disabled={!vUrl.trim() || busy === 'video'}>ADD VIDEO</button>
      </div>

      <div className="td-row">
        {(['waiting', 'visible', 'all'] as Show[]).map((s) => (
          <button key={s} className={`td-btn${show === s ? ' cyan' : ' quiet'}`} aria-pressed={show === s} onClick={() => { setShow(s); setLimit(PAGE); }}>{s.toUpperCase()}</button>
        ))}
        <select className="td-select" aria-label="Category" value={cat} onChange={(e) => { setCat(e.target.value as GalleryCategory | ''); setLimit(PAGE); }}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        {shown.length > 0 && show !== 'visible' && (
          <button className="td-btn" onClick={() => void approveShown(false)} disabled={busy === 'bulk'}>MAKE THESE {shown.length} VISIBLE</button>
        )}
        {shown.length > 0 && show === 'visible' && (
          <button className="td-btn quiet" onClick={() => void approveShown(true)} disabled={busy === 'bulk'}>HIDE THESE {shown.length}</button>
        )}
      </div>

      {items === null && !error && <div className="td-empty">Loading the gallery…</div>}
      {items && !filtered.length && <div className="td-empty">{all.length ? 'Nothing here with these filters.' : 'The gallery is empty. Import a folder or add a YouTube link.'}</div>}

      <div className="td-gal">
        {shown.map((it) => <Row key={it.id} it={it} busy={busy === it.id} onSave={(p) => void save(it, p)} onDelete={() => void del(it)} />)}
      </div>
      {filtered.length > limit && <button className="td-btn quiet" onClick={() => setLimit(limit + PAGE)}>SHOW {Math.min(PAGE, filtered.length - limit)} MORE ({filtered.length - limit} left)</button>}
    </div>
  );
}

function Row({ it, busy, onSave, onDelete }: { it: GalleryItem; busy: boolean; onSave: (p: api.GalleryPatch) => void; onDelete: () => void }) {
  const [sure, setSure] = useState(false);
  const src = it.kind === 'video' ? youtubeThumb(it.youtube_id!) : api.imageUrl(it.storage_path!);
  const num = (v: string) => (v.trim() && Number.isInteger(Number(v)) ? Number(v) : null);
  return (
    <div className={`td-gal-row${it.hidden ? ' waiting' : ''}`} aria-busy={busy}>
      <a className="td-gal-thumb" href={src} target="_blank" rel="noreferrer" title="Open full size">
        <img src={src} alt="" loading="lazy" />
        {it.kind === 'video' && <span className="td-gal-badge">VIDEO</span>}
      </a>
      <div className="td-gal-fields">
        <input className="td-input" aria-label="Title" defaultValue={it.title} key={`t${it.title}`} maxLength={120}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== it.title) onSave({ title: v }); }} />
        <div className="td-row" style={{ gap: 8 }}>
          <select className="td-select" aria-label="Category" value={it.category} onChange={(e) => onSave({ category: e.target.value as GalleryCategory })}>
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <input className="td-input" style={{ width: 84 }} type="number" aria-label="Year" placeholder="Year" defaultValue={it.year ?? ''} key={`y${it.year}`}
            onBlur={(e) => { const v = num(e.target.value); if (v !== it.year && (v === null || (v >= 2000 && v <= 2100))) onSave({ year: v }); }} />
          {it.category === 'jewel' && (
            <input className="td-input" style={{ width: 84 }} type="number" aria-label="Jewel number" placeholder="Jewel #" defaultValue={it.jewel_no ?? ''} key={`j${it.jewel_no}`}
              onBlur={(e) => { const v = num(e.target.value); if (v !== it.jewel_no && (v === null || (v >= 1 && v <= 99))) onSave({ jewel_no: v }); }} />
          )}
          {it.category === 'event' && (
            <input className="td-input" style={{ flex: 1, minWidth: 120 }} aria-label="Event name" placeholder="Event name" defaultValue={it.event_label ?? ''} key={`e${it.event_label}`} maxLength={80}
              onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== it.event_label) onSave({ event_label: v }); }} />
          )}
          <input className="td-input" style={{ width: 70 }} type="number" aria-label="Order" title="Display order" defaultValue={it.sort} key={`s${it.sort}`}
            onBlur={(e) => { const v = num(e.target.value); if (v !== null && v !== it.sort) onSave({ sort: v }); }} />
        </div>
        <input className="td-input" aria-label="Caption" placeholder="Caption (optional)" defaultValue={it.caption ?? ''} key={`c${it.caption}`} maxLength={300}
          onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== it.caption) onSave({ caption: v }); }} />
        {it.source_path && <div className="td-hint">From: {it.source_path}</div>}
      </div>
      <div className="td-sponsor-actions">
        <button className="td-toggle" aria-pressed={!it.hidden} onClick={() => onSave({ hidden: !it.hidden })} disabled={busy}>
          <span className="track"><span className="knob" /></span><span>{it.hidden ? 'Hidden' : 'Visible'}</span>
        </button>
        {sure
          ? <button className="td-btn quiet" onClick={onDelete} disabled={busy} onBlur={() => setSure(false)}>SURE? DELETE</button>
          : <button className="td-btn quiet" onClick={() => setSure(true)} disabled={busy}>DELETE</button>}
      </div>
    </div>
  );
}
