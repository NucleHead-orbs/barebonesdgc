/**
 * Bug Squasher (/td?view=squasher): the owner's inbox for the skull. Only the owner gets here (EventHub checks
 * is_owner(); every call is checked again in the database). Squash, won't fix, dupe, reopen. GENERATE VERSION UPDATE
 * drafts the next dev report from the squashed reports; publishing bumps the version everywhere.
 */
import { useCallback, useEffect, useState } from 'react';
import * as dev from '../../lib/dev/api';
import { KINDS, deviceLabel, draftBody, draftTitle, nextVersion, reportMessage, reporterLabel, type Bump, type Release, type Report, type ReportKind, type ReportStatus } from '../../lib/dev/releases';
import { ReleaseBody } from '../../components/dev/DevReports';
import { SkullMascot } from '../../components/dev/SkullMascot';
import './squasher.css';

type View = 'open' | 'squashed' | 'shipped' | 'closed' | 'all';
const VIEWS: Array<[View, string]> = [['open', 'OPEN'], ['squashed', 'SQUASHED'], ['shipped', 'SHIPPED'], ['closed', "WON'T FIX / DUPE"], ['all', 'ALL']];
const inView = (r: Report, v: View) =>
  v === 'all' || (v === 'open' ? r.status === 'new' : v === 'squashed' ? r.status === 'squashed' && !r.version : v === 'shipped' ? !!r.version : (r.status === 'wontfix' || r.status === 'dupe'));
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const BUMPS: Array<[Bump, string]> = [['patch', 'PATCH · fixes'], ['minor', 'MINOR · new stuff'], ['major', 'MAJOR · big drop']];

export default function BugSquasher({ onBack }: { onBack: () => void }) {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [releases, setReleases] = useState<Release[]>([]);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [view, setView] = useState<View>('open');
  const [kind, setKind] = useState<ReportKind | 'all'>('all');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [popping, setPopping] = useState<Record<string, true>>({});
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');

  const reload = useCallback(async () => {
    const [r, rel] = await Promise.all([dev.ownerReports(), dev.loadReleases(true)]);
    if (r.error || !r.data) return setErr(reportMessage(r.error));
    const list = r.data;
    setErr(''); setReports(list); setReleases(rel.data ?? []);
    const paths = list.map((x) => x.photo_path).filter((p): p is string => !!p);
    const u = await dev.photoUrls(paths);
    if (u.data) setPhotos(u.data);
  }, []);
  useEffect(() => { void (async () => { await reload(); })(); }, [reload]);

  const set = async (rep: Report, status: ReportStatus) => {
    const note = status === 'new' ? null : (notes[rep.id] ?? rep.squash_note ?? '').trim() || null;
    const r = await dev.setStatus(rep.id, status, note);
    if (r.error) return setErr(reportMessage(r.error));
    const apply = () => setReports((all) => all && all.map((x) => x.id === rep.id ? { ...x, status, squash_note: note, squashed_at: status === 'new' ? null : x.squashed_at ?? new Date().toISOString() } : x));
    if (status === 'squashed') {
      setPopping((p) => ({ ...p, [rep.id]: true }));
      setTimeout(() => { apply(); setPopping((p) => { const n = { ...p }; delete n[rep.id]; return n; }); }, 520);
    } else apply();
  };

  const all = reports ?? [];
  const count = (v: View) => all.filter((r) => inView(r, v)).length;
  const shown = all.filter((r) => inView(r, view) && (kind === 'all' || r.kind === kind));
  const groups = kind === 'all' ? KINDS.map((k) => ({ ...k, rows: shown.filter((r) => r.kind === k.kind) })).filter((g) => g.rows.length) : [{ ...KINDS.find((k) => k.kind === kind)!, rows: shown }];
  const current = releases[0]?.version ?? null;

  return (
    <main className="td-hub bsq">
      <div className="td-row">
        <button className="td-btn quiet" onClick={onBack}>‹ EVENTS</button>
        <div style={{ flex: 1 }} />
      </div>
      <header className="bsq-head">
        <SkullMascot size={64} />
        <div>
          <h2>Bug Squasher</h2>
          <p className="td-hint">Everything the skull hears lands here. Only you see this page.{current ? ` The app is on v${current}.` : ''}</p>
        </div>
      </header>
      <div className="bsq-stats" aria-live="polite">
        <div className="bsq-stat s-open"><b>{count('open')}</b><span>open</span></div>
        <div className="bsq-stat s-squashed"><b>{count('squashed')}</b><span>squashed, not shipped</span></div>
        <div className="bsq-stat"><b>{count('shipped')}</b><span>shipped</span></div>
        <div className="bsq-stat"><b>{all.length}</b><span>total</span></div>
      </div>
      {err && <div className="td-warn" role="alert">{err} <button className="td-btn quiet" onClick={() => setErr('')}>OK</button></div>}
      {toast && <div className="td-ok" role="status">{toast}</div>}

      <VersionBox current={current} waiting={count('squashed')} onPublished={async (v) => { setToast(`v${v} is live: club home, TD home and My Tag.`); await reload(); }} />

      <div className="bsq-filters">
        <div className="td-chips">{VIEWS.map(([v, label]) => <button key={v} className={`td-chip${view === v ? ' on' : ''}`} aria-pressed={view === v} onClick={() => setView(v)}>{label} {count(v)}</button>)}</div>
        <div className="td-chips">
          <button className={`td-chip${kind === 'all' ? ' on' : ''}`} aria-pressed={kind === 'all'} onClick={() => setKind('all')}>EVERY TYPE</button>
          {KINDS.map((k) => <button key={k.kind} className={`td-chip${kind === k.kind ? ' on' : ''}`} aria-pressed={kind === k.kind} onClick={() => setKind(k.kind)}>{k.label.toUpperCase()}S</button>)}
        </div>
      </div>

      {reports === null && !err && <p className="td-empty">Loading reports…</p>}
      {reports && !shown.length && <p className="td-empty">{view === 'open' ? 'Nothing open. The skull is quiet. Suspiciously quiet.' : 'Nothing here.'}</p>}
      {groups.map((g) => (
        <section key={g.kind} className="bsq-group">
          <h3 className={`bsq-gh k-${g.kind}`}>{g.label}s <span>{g.rows.length}</span></h3>
          {g.rows.map((r) => (
            <article key={r.id} className={`bsq-card k-${r.kind} st-${r.status}${popping[r.id] ? ' is-pop' : ''}`}>
              <div className="bsq-meta">
                <span className={`bsq-kind k-${r.kind}`}>{r.kind.toUpperCase()}</span>
                <b>{reporterLabel(r)}</b>
                <span>{when(r.created_at)}</span>
                {r.version ? <span className="bsq-ship">shipped in v{r.version}</span> : r.status !== 'new' && <span className="bsq-st">{r.status === 'wontfix' ? "won't fix" : r.status}</span>}
              </div>
              <p className="bsq-body">{r.body}</p>
              {r.photo_path && (photos[r.photo_path]
                ? <a className="bsq-photo" href={photos[r.photo_path]} target="_blank" rel="noreferrer"><img src={photos[r.photo_path]} alt="Attached screenshot or photo" loading="lazy" /></a>
                : <p className="td-hint">Photo attached (loading…)</p>)}
              <p className="bsq-where">
                {r.page_url && <a href={r.page_url} target="_blank" rel="noreferrer">{r.page_title || r.page_url}</a>}
                {[r.page_url && r.page_title ? r.page_url : '', deviceLabel(r.user_agent), r.app_version ? `v${r.app_version}` : ''].filter(Boolean).map((t) => <span key={t}>{t}</span>)}
              </p>
              {r.squash_note && r.status !== 'new' && <p className="bsq-note">Note: {r.squash_note}</p>}
              {!r.version && (
                <div className="bsq-actions">
                  {r.status === 'new' ? (
                    <>
                      <input className="td-input" maxLength={300} placeholder="Squash note (goes in the dev report)" value={notes[r.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} />
                      <button className="td-btn cta bsq-squash" onClick={() => void set(r, 'squashed')}>SQUASH</button>
                      <button className="td-btn quiet" onClick={() => void set(r, 'wontfix')}>WON'T FIX</button>
                      <button className="td-btn quiet" onClick={() => void set(r, 'dupe')}>DUPE</button>
                    </>
                  ) : <button className="td-btn quiet" onClick={() => void set(r, 'new')}>REOPEN</button>}
                </div>
              )}
              {popping[r.id] && <span className="bsq-splat" aria-hidden="true" />}
            </article>
          ))}
        </section>
      ))}

      {releases.length > 0 && (
        <section className="td-panel bsq-history">
          <h2>Published versions</h2>
          {releases.map((r) => (
            <details key={r.id}>
              <summary><b>v{r.version}</b> {r.title} <span className="td-hint">{new Date(r.published_at).toLocaleDateString()}</span></summary>
              <ReleaseBody body={r.body} />
            </details>
          ))}
        </section>
      )}
    </main>
  );
}

/** GENERATE VERSION UPDATE: pick the bump, the draft writes itself from squashed reports, edit, publish. */
function VersionBox({ current, waiting, onPublished }: { current: string | null; waiting: number; onPublished: (v: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [bump, setBump] = useState<Bump | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [made, setMade] = useState<{ title: string; body: string } | null>(null);
  const [count, setCount] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const pick = async (b: Bump, regenerate = false) => {
    setBump(b); setConfirm(false); setErr('');
    const r = await dev.draft(b);
    if (r.error || !r.data) return setErr(reportMessage(r.error));
    setCount(r.data.items.length);
    const t = draftTitle(r.data.items), d = draftBody(r.data.items);
    const untouched = !made || (title === made.title && body === made.body);
    if (regenerate || untouched) { setTitle(t); setBody(d); }
    setMade({ title: t, body: d });
  };
  const go = async () => {
    if (!bump) return;
    setBusy(true); setErr('');
    const r = await dev.publish(bump, title, body);
    setBusy(false);
    if (r.error) return setErr(reportMessage(r.error));
    const v = nextVersion(current, bump);
    setOpen(false); setBump(null); setTitle(''); setBody(''); setMade(null); setConfirm(false);
    await onPublished(v);
  };
  const next = bump ? nextVersion(current, bump) : null;

  if (!open) {
    return (
      <div className="bsq-gen">
        <button className="td-generate fresh" onClick={() => setOpen(true)}>GENERATE VERSION UPDATE</button>
        <span className="td-hint">{waiting ? `${waiting} squashed report${waiting === 1 ? '' : 's'} waiting to ship.` : 'Nothing squashed yet. You can still publish a note.'}</span>
      </div>
    );
  }
  return (
    <section className="td-panel bsq-version">
      <div className="td-row"><h2>Version update</h2><div style={{ flex: 1 }} /><button className="td-btn quiet" onClick={() => setOpen(false)}>CLOSE</button></div>
      <p className="td-hint">Now on <b>v{current ?? '—'}</b>. Pick how big this one is:</p>
      <div className="bsq-bumps">
        {BUMPS.map(([b, label]) => (
          <button key={b} className={`bsq-bump${bump === b ? ' on' : ''}`} aria-pressed={bump === b} onClick={() => void pick(b)}>
            <b>v{nextVersion(current, b)}</b><span>{label}</span>
          </button>
        ))}
      </div>
      {bump && (
        <>
          <p className="td-hint">Drafted from {count} squashed report{count === 1 ? '' : 's'}. Edit away. <b># Heading</b> and <b>- bullet</b> lines, **bold**. {made && <button className="td-link" onClick={() => void pick(bump, true)}>Start over from the draft</button>}</p>
          <label className="td-field">TITLE<input className="td-input" maxLength={120} value={title} onChange={(e) => { setTitle(e.target.value); setConfirm(false); }} /></label>
          <label className="td-field">DEV REPORT<textarea className="td-input bsq-text" rows={10} maxLength={8000} value={body} onChange={(e) => { setBody(e.target.value); setConfirm(false); }} placeholder="# Squashed&#10;- What got fixed" /></label>
          {body.trim() && <div className="bsq-preview"><div className="td-hint">PREVIEW</div><b>v{next} · {title || 'Untitled'}</b><ReleaseBody body={body} /></div>}
          {err && <div className="td-warn" role="alert">{err}</div>}
          {!confirm
            ? <button className="td-generate fresh" disabled={!title.trim() || !body.trim()} onClick={() => setConfirm(true)}>PUBLISH v{next}</button>
            : (
              <div className="td-warn soft">
                Publish <b>v{next}</b> to the club home, TD home and My Tag? {count ? `It ships ${count} squashed report${count === 1 ? '' : 's'}.` : ''} Versions can't be unpublished.
                <div className="td-actions" style={{ marginTop: 8 }}>
                  <button className="td-btn cta" disabled={busy} onClick={() => void go()}>{busy ? 'PUBLISHING…' : `YES, PUBLISH v${next}`}</button>
                  <button className="td-btn quiet" onClick={() => setConfirm(false)}>NOT YET</button>
                </div>
              </div>
            )}
        </>
      )}
    </section>
  );
}
