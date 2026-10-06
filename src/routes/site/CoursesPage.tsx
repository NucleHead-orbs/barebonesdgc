/**
 * /courses: every course in the library with the owner's write-up, its layouts (holes, par, feet) and the hole-by-hole.
 * The owner (signed in at /td on this browser) gets WRITE IT UP / EDIT on each course. Source: courses + course_layouts + course_holes.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import * as api from '../../lib/rounds/api';
import type { CourseOption } from '../../lib/rounds/api';
import { roundMessage } from '../../lib/rounds/rounds';
import { Banner, Button, SectionHeading } from '../../components/ui';
import { Prose } from '../../components/Prose';
import './courses.css';

const MAX = 1500;

export default function CoursesPage() {
  const [courses, setCourses] = useState<CourseOption[] | null>(null);
  const [err, setErr] = useState('');
  const [owner, setOwner] = useState(false);
  const load = useCallback(async () => {
    const r = await api.loadCourses();
    if (r.error || !r.data) return setErr(roundMessage(r.error));
    setCourses(r.data);
  }, []);
  useEffect(() => { void (async () => { await load(); })(); }, [load]);
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
      const r = await supabase.rpc('is_owner');
      setOwner(!!r.data);
    })();
  }, []);

  return (
    <section className="sec">
      <div className="sec-inner cr-page">
        <SectionHeading kicker="Where we throw" title="Courses" size="l" as="h1" />
        <p className="lead">Every course on the club scorecard: the layouts, pars and feet, and the inside scoop. Missing one? Tap the skull and tell us.</p>
        <div className="row"><Button to="/scorecard">Open the scorecard</Button></div>
        {err && <Banner tone="error">{err}</Banner>}
        {!courses && !err && <p className="br-empty">Loading…</p>}
        <div className="cr-list">
          {courses?.map((c) => <CourseCard key={c.id} c={c} owner={owner} onSaved={load} />)}
        </div>
      </div>
    </section>
  );
}

function CourseCard({ c, owner, onSaved }: { c: CourseOption; owner: boolean; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(c.description ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    setBusy(true); setErr('');
    const r = await api.describeCourse(c.id, text);
    setBusy(false);
    if (r.error) return setErr(/too_long/.test(String((r.error as { message?: string }).message)) ? `${MAX} characters max.` : roundMessage(r.error));
    setEditing(false);
    await onSaved();
  };
  return (
    <article className="cr-card" id={c.id}>
      <header><h2>{c.name}</h2>{c.city && <span className="cr-city">{c.city}</span>}</header>
      {editing ? (
        <div className="cr-edit">
          <textarea value={text} maxLength={MAX} rows={7} onChange={(e) => setText(e.target.value)} placeholder="Have some fun. Blank line = new paragraph, **double stars** = bold." />
          <div className="cr-edit-row">
            <span className="cr-count">{text.length}/{MAX}</span>
            <button className="br-btn" onClick={() => { setEditing(false); setText(c.description ?? ''); }}>Cancel</button>
            <button className="br-btn cta" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
          {text.trim() && <div className="cr-preview"><span>Preview</span><Prose text={text.trim()} className="cr-desc" /></div>}
          {err && <p className="br-note" role="alert">{err}</p>}
        </div>
      ) : (
        <>
          {c.description ? <Prose text={c.description} className="cr-desc" /> : owner ? <p className="cr-empty">No write-up yet.</p> : null}
          {owner && <button className="cr-link" onClick={() => { setText(c.description ?? ''); setEditing(true); }}>{c.description ? 'Edit write-up' : 'Write it up'}</button>}
        </>
      )}
      {c.layouts.length > 0 ? (
        <ul className="cr-layouts">
          {c.layouts.map((l) => {
            const par = l.pars.reduce((a, b) => a + b, 0);
            const ft = l.ft.every((x) => x != null) ? l.ft.reduce((a, b) => a + (b ?? 0), 0) : null;
            const shown = open === l.id;
            return (
              <li key={l.id}>
                <button className="cr-layout" aria-expanded={shown} onClick={() => setOpen(shown ? null : l.id)}>
                  <b>{l.name}</b><span>{l.pars.length} holes · par {par}{ft ? ` · ${ft.toLocaleString()} ft` : ''}</span><i>{shown ? '−' : '+'}</i>
                </button>
                {shown && (
                  <div className="br-tablewrap">
                    <table className="sc-table">
                      <tbody>
                        <tr><th>Hole</th>{l.pars.map((_, i) => <th key={i}>{l.labels?.[i] ?? i + 1}</th>)}</tr>
                        <tr><th>Par</th>{l.pars.map((p, i) => <td key={i}>{p}</td>)}</tr>
                        {l.ft.some((x) => x != null) && <tr><th>Ft</th>{l.ft.map((f, i) => <td key={i}>{f ?? ''}</td>)}</tr>}
                      </tbody>
                    </table>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : <p className="cr-empty">No layout yet: the scorecard starts every hole at par 3.</p>}
    </article>
  );
}
