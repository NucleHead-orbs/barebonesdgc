/**
 * Dev reports (app_releases, written in the Bug Squasher): one renderer, four places.
 *   BoneLabCard     club home: the newest version, a few lines, link to all
 *   DevReportsPage  /dev-reports: every version
 *   TdDevReports    TD home: the newest two
 *   NewVersionNote  My Tag: "New in vX" until dismissed (per browser)
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { loadReleases } from '../../lib/dev/api';
import { SEEN_RELEASE_KEY, groupBlocks, isUnseen, releaseBlocks, teaser, type Release } from '../../lib/dev/releases';
import { boldParts } from '../../lib/text';
import { useLoad } from '../../lib/useLoad';
import { SkullMascot } from './SkullMascot';
import './dev.css';

const loadAll = () => loadReleases().then((r) => { if (r.error) throw r.error; return r.data; });
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const Bold = ({ text }: { text: string }) => <>{boldParts(text).map((p, i) => (p.bold ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>))}</>;

export function ReleaseBody({ body }: { body: string }) {
  return (
    <div className="dev-body">
      {groupBlocks(releaseBlocks(body)).map((g, i) => g.kind === 'ul'
        ? <ul key={i}>{g.items.map((t, j) => <li key={j}><Bold text={t} /></li>)}</ul>
        : g.kind === 'h' ? <h4 key={i}>{g.text}</h4> : <p key={i}><Bold text={g.text} /></p>)}
    </div>
  );
}

function ReleaseItem({ r, latest }: { r: Release; latest?: boolean }) {
  return (
    <article className="dev-rel" id={`v${r.version}`}>
      <div className="dev-rel-head"><span className={`dev-ver${latest ? ' is-latest' : ''}`}>v{r.version}</span><b>{r.title}</b><span className="dev-date">{day(r.published_at)}</span></div>
      <ReleaseBody body={r.body} />
    </article>
  );
}

/** Club home card. Nothing at all if it can't load. */
export function BoneLabCard() {
  const { data } = useLoad(loadAll);
  const r = data?.[0];
  if (!r) return null;
  const lines = teaser(r.body, 4);
  return (
    <section className="sec">
      <div className="sec-inner">
        <div className="dev-card">
          <SkullMascot size={64} />
          <div className="dev-card-main">
            <div className="kick">Fresh from the Bone Lab · v{r.version} · {day(r.published_at)}</div>
            <h3>{r.title}</h3>
            {lines.length > 0 && <ul>{lines.map((t, i) => <li key={i}><Bold text={t} /></li>)}</ul>}
            <p className="dev-card-foot"><Link to="/dev-reports">Every dev report ›</Link> <span>See something busted? Tap the skull.</span></p>
          </div>
        </div>
      </div>
    </section>
  );
}

/** /dev-reports */
export function DevReportsPage() {
  const { data, error } = useLoad(loadAll);
  return (
    <>
      <section className="hero">
        <div className="sec-inner" style={{ gap: 14 }}>
          <div className="kick">The Bone Lab</div>
          <h1>Dev<span className="hl">Reports</span></h1>
          <p className="lead">Every fix and new thing, version by version. Found a bug or got an idea? Tap the skull in the corner.</p>
        </div>
      </section>
      <section className="sec">
        <div className="sec-inner dev-list">
          {error && <p>Couldn't load the dev reports. Reload to try again.</p>}
          {!data && !error && <p>Loading…</p>}
          {data?.map((r, i) => <ReleaseItem key={r.id} r={r} latest={i === 0} />)}
        </div>
      </section>
    </>
  );
}

/** TD home section. */
export function TdDevReports() {
  const { data } = useLoad(loadAll);
  if (!data?.length) return null;
  return (
    <section className="td-panel dev-td">
      <div className="td-row"><h2>Dev reports</h2><span className="td-badge">v{data[0].version}</span><div style={{ flex: 1 }} /><a className="td-link" href="/dev-reports" target="_blank" rel="noreferrer">ALL VERSIONS ›</a></div>
      {data.slice(0, 2).map((r, i) => <ReleaseItem key={r.id} r={r} latest={i === 0} />)}
    </section>
  );
}

const readSeen = () => { try { return localStorage.getItem(SEEN_RELEASE_KEY); } catch { return null; } };
const writeSeen = (v: string) => { try { localStorage.setItem(SEEN_RELEASE_KEY, v); } catch { /* shows again next time */ } };

/** My Tag: a note about the newest version until this browser dismisses it. */
export function NewVersionNote() {
  const { data } = useLoad(loadAll);
  const [seen, setSeen] = useState(readSeen);
  const [open, setOpen] = useState(false);
  const r = data?.[0];
  if (!r || !isUnseen(r, seen)) return null;
  const close = () => { writeSeen(r.version); setSeen(r.version); };
  return (
    <div className="dev-note" role="status">
      <div className="dev-note-row">
        <SkullMascot size={34} />
        <div className="dev-note-main"><b>New in v{r.version}:</b> {r.title}</div>
        <button className="td-btn quiet" onClick={() => setOpen(!open)}>{open ? 'LESS' : 'READ'}</button>
        <button className="dev-note-x" onClick={close} aria-label="Dismiss">×</button>
      </div>
      {open && <ReleaseBody body={r.body} />}
    </div>
  );
}
