/**
 * /scorecard: the club's casual-round scorecard. Anyone can keep score (it lives on this phone);
 * a member saves it to Boner Rounds with their My Tag link. Nothing here decides anything the database doesn't re-check.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as api from '../../lib/rounds/api';
import type { CourseOption, RoundMe } from '../../lib/rounds/api';
import {
  DRAFT_KEY, HOLE_CHOICES, MAX_PLAYERS, ME_KEY, fmtToPar, holeDone, leaders, newDraft, parseTagLink, roundMessage, running,
  saveProblems, setHoles, toPayload, toParClass, type Draft,
} from '../../lib/rounds/rounds';
import { display, type TagMember } from '../../lib/tags/tags';
import { localDate } from '../../lib/leagues/leagues';
import { useTheme } from '../../lib/theme';
import './rounds.css';

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode: still works, just not remembered */ } };
const loadDraft = (): Draft | null => { try { const d = JSON.parse(read(DRAFT_KEY) ?? 'null'); return d && Array.isArray(d.pars) ? d as Draft : null; } catch { return null; } };

export default function ScorecardApp() {
  useTheme(null);
  const nav = useNavigate();
  const [token, setToken] = useState<string | null>(() => read(ME_KEY));
  const [me, setMe] = useState<RoundMe | null>(null);
  const [members, setMembers] = useState<TagMember[]>([]);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [d, setD] = useState<Draft>(() => loadDraft() ?? newDraft(localDate()));
  const [view, setView] = useState<'setup' | 'card'>(() => (loadDraft()?.players.length ? 'card' : 'setup'));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { write(DRAFT_KEY, JSON.stringify(d)); }, [d]);
  useEffect(() => {
    void (async () => {
      const [m, c] = await Promise.all([api.loadMembers(), api.loadCourses()]);
      if (m.data) setMembers(m.data);
      if (c.data) setCourses(c.data);
    })();
  }, []);
  /** Who this phone is. A fresh card gets them as player 1. */
  const known = useCallback((r: RoundMe) => {
    setMe(r);
    setD((x) => (x.players.length || x.scores.some((s) => s.length) ? x
      : { ...x, players: [{ key: r.me.id, memberId: r.me.id, name: r.me.nickname || r.me.name }], scores: [[]] }));
  }, []);
  useEffect(() => {
    if (!token) return;
    void (async () => {
      const r = await api.roundMe(token);
      if (r.data) known(r.data);
      else if (/invalid_link/.test(String((r.error as { message?: string })?.message))) { write(ME_KEY, null); setToken(null); setErr(roundMessage(r.error)); }
    })();
  }, [token, known]);

  const connect = useCallback(async (input: string) => {
    const t = parseTagLink(input);
    if (!t) return setErr('Paste your whole My Tag link (it looks like barebonesdiscgolf.club/tag/…).');
    const r = await api.roundMe(t);
    if (r.error || !r.data) return setErr(roundMessage(r.error));
    write(ME_KEY, t); setToken(t); known(r.data); setErr('');
  }, [known]);
  const forget = () => { write(ME_KEY, null); setToken(null); setMe(null); };

  const save = async () => {
    if (!token) return;
    setBusy(true);
    const r = await api.saveRound(token, toPayload(d));
    setBusy(false);
    if (r.error || !r.data) return setErr(roundMessage(r.error));
    write(DRAFT_KEY, null);
    nav(`/rounds/${r.data}?saved=1`);
  };

  return (
    <div className="sc">
      <header className="sc-top">
        <Link to="/rounds" className="sc-brand" aria-label="Boner Rounds">BARE BONES <span>SCORECARD</span></Link>
        <div className="sc-who">{me ? <>Saving as <b>{display(me.me)}</b> · <button className="sc-link" onClick={forget}>not you?</button></> : 'Keeping score on this phone'}</div>
      </header>
      {err && <div className="sc-warn" role="alert">{err} <button className="sc-link" onClick={() => setErr('')}>OK</button></div>}
      {me && me.to_confirm.length > 0 && (
        <div className="sc-note">{me.to_confirm.length} round{me.to_confirm.length === 1 ? '' : 's'} waiting on your OK: {me.to_confirm.map((x, i) => (
          <span key={x.id}>{i > 0 && ', '}<Link to={`/rounds/${x.id}`}>{x.course}</Link></span>))}</div>
      )}
      {view === 'setup'
        ? <Setup d={d} setD={setD} me={me} members={members} courses={courses} onStart={() => setView('card')} />
        : <Card d={d} setD={setD} onSetup={() => setView('setup')} me={me} busy={busy} onSave={() => void save()} onConnect={connect}
            onNew={() => { setD(newDraft(localDate(), me ? { id: me.me.id, name: me.me.nickname || me.me.name } : null)); setView('setup'); }} />}
    </div>
  );
}

// ---------- setup ----------
function Setup({ d, setD, me, members, courses, onStart }: {
  d: Draft; setD: (f: (d: Draft) => Draft) => void; me: RoundMe | null; members: TagMember[]; courses: CourseOption[]; onStart: () => void;
}) {
  const [guest, setGuest] = useState('');
  const course = courses.find((c) => c.id === d.courseId) ?? null;
  const onCard = new Set(d.players.map((p) => p.memberId).filter(Boolean));
  const addPlayer = (memberId: string | null, name: string) => setD((x) => x.players.length >= MAX_PLAYERS ? x
    : { ...x, players: [...x.players, { key: memberId ?? `g-${Date.now()}`, memberId, name }], scores: [...x.scores, []] });
  const pickCourse = (id: string) => {
    if (id === '') return setD((x) => ({ ...x, courseId: null, layoutId: null }));
    const c = courses.find((x) => x.id === id);
    if (!c) return;
    const l = c.layouts[0];
    setD((x) => ({ ...(l ? { ...x, pars: l.pars.slice(), scores: x.scores.map((s) => s.slice(0, l.pars.length)), cur: 0 } : x), course: c.name, courseId: c.id, layoutId: l?.id ?? null }));
  };
  const pickLayout = (id: string) => {
    const l = course?.layouts.find((x) => x.id === id);
    if (l) setD((x) => ({ ...x, layoutId: l.id, pars: l.pars.slice(), scores: x.scores.map((s) => s.slice(0, l.pars.length)), cur: 0 }));
    else setD((x) => ({ ...x, layoutId: null }));
  };
  const ready = d.course.trim() && d.players.length > 0 && d.players.every((p) => p.name.trim());
  return (
    <main className="sc-main">
      <section className="sc-panel">
        <h1>New round</h1>
        <label className="sc-field"><span>Course</span>
          <select id="sc-course" value={d.courseId ?? ''} onChange={(e) => pickCourse(e.target.value)}>
            <option value="">Other / not listed…</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.name}{c.city ? ` · ${c.city}` : ''}</option>)}
          </select>
        </label>
        {!d.courseId && <input id="sc-course-name" className="sc-input" placeholder="Course name" maxLength={80} value={d.course} onChange={(e) => { const v = e.target.value; setD((x) => ({ ...x, course: v })); }} />}
        {course && course.layouts.length > 0 && (
          <label className="sc-field"><span>Layout</span>
            <select id="sc-layout" value={d.layoutId ?? ''} onChange={(e) => pickLayout(e.target.value)}>
              {course.layouts.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.pars.length} holes · par {l.pars.reduce((a, b) => a + b, 0)}</option>)}
              <option value="">Custom (set pars as we go)</option>
            </select>
          </label>
        )}
        {(!course || !d.layoutId) && (
          <label className="sc-field"><span>Holes</span>
            <select id="sc-holes" value={d.pars.length} onChange={(e) => { const n = Number(e.target.value); setD((x) => setHoles(x, n)); }}>
              {[...new Set([...HOLE_CHOICES, d.pars.length])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        {course && !course.layouts.length && <p className="sc-hint">No hole-by-hole layout for {course.name} yet, so every hole starts at par 3. Change pars on the card as you go.</p>}
        <label className="sc-field"><span>Date</span>
          <input id="sc-date" className="sc-input" type="date" value={d.playedOn} max={localDate()} onChange={(e) => { const v = e.target.value; setD((x) => ({ ...x, playedOn: v })); }} />
        </label>
      </section>

      <section className="sc-panel">
        <h2>Who's playing</h2>
        <ul className="sc-players">
          {d.players.map((p, i) => (
            <li key={p.key}>
              <b>{p.name || `Player ${i + 1}`}</b><span className="sc-hint">{p.memberId ? (p.memberId === me?.me.id ? 'You' : 'Member') : 'Guest'}</span>
              <button className="sc-link" onClick={() => setD((x) => ({ ...x, players: x.players.filter((_, j) => j !== i), scores: x.scores.filter((_, j) => j !== i) }))}>Remove</button>
            </li>
          ))}
        </ul>
        {d.players.length < MAX_PLAYERS && (
          <div className="sc-row">
            <select id="sc-add-member" aria-label="Add a member" value="" onChange={(e) => { const m = members.find((x) => x.id === e.target.value); if (m) addPlayer(m.id, m.nickname || m.name); }}>
              <option value="">+ Add a member…</option>
              {members.filter((m) => !onCard.has(m.id)).map((m) => <option key={m.id} value={m.id}>{display(m)}</option>)}
            </select>
            <form className="sc-row" onSubmit={(e) => { e.preventDefault(); if (guest.trim()) { addPlayer(null, guest.trim().slice(0, 40)); setGuest(''); } }}>
              <input id="sc-guest" className="sc-input" placeholder="Guest name" maxLength={40} value={guest} onChange={(e) => setGuest(e.target.value)} />
              <button className="sc-btn" disabled={!guest.trim()}>+ Guest</button>
            </form>
          </div>
        )}
        <p className="sc-hint">Members can put tags on the line after the round. Guests just get a score.</p>
      </section>
      <button className="sc-btn cta big" disabled={!ready} onClick={onStart}>{d.scores.some((s) => s.some((x) => x != null)) ? 'Back to the card' : 'Tee off'}</button>
    </main>
  );
}

// ---------- the card ----------
function Card({ d, setD, onSetup, me, busy, onSave, onConnect, onNew }: {
  d: Draft; setD: (f: (d: Draft) => Draft) => void; onSetup: () => void; me: RoundMe | null; busy: boolean;
  onSave: () => void; onConnect: (s: string) => void; onNew: () => void;
}) {
  const [link, setLink] = useState('');
  const [confirmNew, setConfirmNew] = useState(false);
  const h = d.cur, par = d.pars[h];
  const tots = useMemo(() => d.players.map((_, p) => running(d.pars, d.scores[p] ?? [])), [d]);
  const lead = useMemo(() => leaders(d), [d]);
  const problems = saveProblems(d, me?.me.id ?? null);
  const allIn = d.pars.every((_, i) => holeDone(d, i));
  const set = (p: number, v: number | null) => setD((x) => {
    const scores = x.scores.map((r) => r.slice());
    while (scores.length <= p) scores.push([]);
    scores[p][h] = v;
    return { ...x, scores };
  });
  const go = (n: number) => { setD((x) => ({ ...x, cur: Math.max(0, Math.min(x.pars.length - 1, n)) })); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  return (
    <main className="sc-main">
      <div className="sc-course"><b>{d.course}</b><span>{d.pars.length} holes · par {d.pars.reduce((a, b) => a + b, 0)}</span><button className="sc-link" onClick={onSetup}>Edit round</button></div>
      <div className="sc-stand">
        {d.players.map((p, i) => (
          <div key={p.key} className={`sc-st${lead.includes(i) ? ' is-lead' : ''}`}>
            <b>{p.name}</b>
            <div><span className={`sc-tp ${tots[i].thru ? toParClass(tots[i].toPar) : ''}`}>{tots[i].thru ? fmtToPar(tots[i].toPar) : '–'}</span>
              <small>{tots[i].strokes} thru {tots[i].thru}</small></div>
          </div>
        ))}
      </div>

      <section className="sc-hole" aria-label={`Hole ${h + 1}`}>
        <div className="sc-hhead">
          <div><div className="sc-label">Hole</div><div className="sc-hnum">{h + 1}<small> / {d.pars.length}</small></div></div>
          <div className="sc-par">
            <button className="sc-round" aria-label="Par down" onClick={() => setD((x) => ({ ...x, pars: x.pars.map((v, i) => (i === h ? Math.max(2, v - 1) : v)), layoutId: null }))}>−</button>
            <span>PAR {par}</span>
            <button className="sc-round" aria-label="Par up" onClick={() => setD((x) => ({ ...x, pars: x.pars.map((v, i) => (i === h ? Math.min(6, v + 1) : v)), layoutId: null }))}>+</button>
          </div>
        </div>
        {d.players.map((p, i) => {
          const s = d.scores[i]?.[h] ?? null;
          return (
            <div key={p.key} className="sc-prow">
              <div className="sc-pname"><b>{p.name}</b>
                <small>{s == null ? 'Tap + for par' : `${s === 1 ? 'ACE' : s === par ? 'Par' : fmtToPar(s - par)} · ${fmtToPar(tots[i].toPar)} overall`}</small></div>
              <div className="sc-ctl">
                <button className="sc-big" aria-label={`${p.name} one less`} onClick={() => set(i, s == null ? Math.max(1, par - 1) : s <= 1 ? null : s - 1)}>−</button>
                <div className={`sc-score ${s == null ? 'unset' : s === 1 ? 'ace' : toParClass(s - par)}`} aria-live="polite">{s ?? '·'}</div>
                <button className="sc-big plus" aria-label={`${p.name} one more`} onClick={() => set(i, s == null ? par : Math.min(20, s + 1))}>+</button>
              </div>
            </div>
          );
        })}
        <div className="sc-nav">
          <button className="sc-btn" disabled={h === 0} onClick={() => go(h - 1)}>{h === 0 ? '‹ Back' : `‹ Hole ${h}`}</button>
          {h < d.pars.length - 1 ? <button className="sc-btn cta" onClick={() => go(h + 1)}>Hole {h + 2} ›</button>
            : <a className="sc-btn cta" href="#sc-finish">Finish ›</a>}
        </div>
        <div className="sc-strip" role="group" aria-label="Jump to hole">
          {d.pars.map((_, i) => <button key={i} className={holeDone(d, i) ? 'done' : ''} aria-current={i === h} onClick={() => go(i)}>{i + 1}</button>)}
        </div>
      </section>

      <details className="sc-panel">
        <summary>Full card</summary>
        <div className="sc-tablewrap">
          <table className="sc-table">
            <tbody>
              <tr><th>Hole</th>{d.pars.map((_, i) => <th key={i}>{i + 1}</th>)}<th>Tot</th><th>±</th></tr>
              <tr><th>Par</th>{d.pars.map((p, i) => <td key={i}>{p}</td>)}<td>{d.pars.reduce((a, b) => a + b, 0)}</td><td /></tr>
              {d.players.map((p, i) => (
                <tr key={p.key}><th>{p.name}</th>
                  {d.pars.map((pp, j) => { const s = d.scores[i]?.[j]; return <td key={j} className={s == null ? '' : toParClass(s - pp)}>{s ?? ''}</td>; })}
                  <td><b>{tots[i].strokes || ''}</b></td><td className={tots[i].thru ? toParClass(tots[i].toPar) : ''}>{tots[i].thru ? fmtToPar(tots[i].toPar) : ''}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <section className="sc-panel" id="sc-finish">
        <h2>Save to Boner Rounds</h2>
        {!me ? (
          <form className="sc-col" onSubmit={(e) => { e.preventDefault(); onConnect(link); }}>
            <p className="sc-hint">Saving needs your My Tag link (the private link your league TD sent you). Paste it once and this phone remembers you. Opening your My Tag link on this phone does it too.</p>
            <div className="sc-row"><input id="sc-link" className="sc-input" placeholder="barebonesdiscgolf.club/tag/…" value={link} onChange={(e) => setLink(e.target.value)} />
              <button className="sc-btn" disabled={!link.trim()}>Connect</button></div>
          </form>
        ) : problems.length ? (
          <ul className="sc-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        ) : (
          <p className="sc-hint">All {d.pars.length} holes in. It shows on Boner Rounds right away; the other members on it confirm from their My Tag link. You can put tags on the line next.</p>
        )}
        <button className="sc-btn cta big" disabled={!me || problems.length > 0 || busy || !allIn} onClick={onSave}>{busy ? 'Saving…' : 'Save round'}</button>
        <div className="sc-row">
          {confirmNew
            ? <><span className="sc-danger">Throw this card away?</span><button className="sc-btn danger" onClick={() => { setConfirmNew(false); onNew(); }}>Yes, new card</button><button className="sc-btn" onClick={() => setConfirmNew(false)}>Keep it</button></>
            : <button className="sc-link" onClick={() => setConfirmNew(true)}>Start a new card</button>}
        </div>
      </section>
    </main>
  );
}
