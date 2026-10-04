/**
 * LEAGUES (TD hub, ?view=leagues): every league this account runs. ?l=<id> opens one: WEEKS (+ NEW WEEK copies the newest
 * week), SETUP (what /leagues shows), TAGS (its own tag set), TDS (who runs it). Rules: migration 20261024 (leagues).
 * Super admin creates leagues and adds their TDs; league TDs run everything else.
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as api from '../../lib/td/api';
import * as tagApi from '../../lib/tags/api';
import { addDays, dateRange, divisionsProblem, isoDate, type DivisionRow, type EventConfig } from '../../lib/td/setup';
import { LEAGUE_FIELDS, leagueSlug, niceDate, validSlug, weekName, type League } from '../../lib/leagues/leagues';
import { createLeague, imageSrc, myLeagues, newWeek, saveLeague, uploadLeagueImage, type MyLeague } from '../../lib/leagues/api';
import { findLayout, sortLibrary, type LibCourse } from '../../lib/courses/courses';
import { LayoutSelect } from './CourseLibrary';
import { DivisionPicker, Field } from './EventHub';

const TagsPanel = lazy(() => import('./TagsPanel'));

const why = (e: unknown): string => {
  const m = e instanceof Error ? e.message : String((e as { message?: string } | null)?.message ?? e);
  if (/forbidden/.test(m)) return 'Only this league\'s TDs can do that.';
  if (/slug_taken/.test(m)) return 'That short name is taken (by a league or a tag set). Try another.';
  if (/invalid_slug/.test(m)) return 'Short name: 2–40 lowercase letters, numbers or dashes.';
  if (/invalid_name/.test(m)) return 'The name needs 1–40 characters.';
  if (/no_divisions/.test(m)) return 'Pick at least one division.';
  if (/_check|violates check/.test(m)) return 'One of the fields is too long or not allowed.';
  if (/row-level security|Unauthorized|403/i.test(m)) return 'Upload refused: you\'re not a TD of this league.';
  return m;
};

export default function LeaguesPanel({ admin, onBack }: { admin: boolean; onBack: () => void }) {
  const [params, setParams] = useSearchParams();
  const lid = params.get('l');
  const [leagues, setLeagues] = useState<MyLeague[] | null>(null);
  const [err, setErr] = useState('');
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    try { setLeagues(await myLeagues()); setErr(''); } catch (e) { setErr(why(e)); }
  }, []);
  useEffect(() => { void (async () => { await reload(); })(); }, [reload]);

  const league = leagues?.find((l) => l.id === lid);
  if (lid && league) {
    return <LeagueHome key={league.id} league={league} admin={admin} onBack={() => setParams({ view: 'leagues' })} onSaved={reload}
      onOpenWeek={(id) => setParams({ e: id, l: league.id })} />;
  }

  return (
    <main className="td-hub">
      <div className="td-row">
        <button className="td-btn quiet" onClick={onBack}>‹ EVENTS</button>
        <h2 className="td-h2">Leagues</h2>
        <div style={{ flex: 1 }} />
        {admin && <button className="td-btn cta" onClick={() => setCreating(true)}>+ NEW LEAGUE</button>}
      </div>
      {err && <div className="td-warn" role="alert">{err}</div>}
      {creating && <NewLeagueForm onCancel={() => setCreating(false)} onCreated={async (id) => { setCreating(false); await reload(); setParams({ view: 'leagues', l: id }); }} />}
      {leagues === null && !err && <p className="td-empty">Loading leagues…</p>}
      {leagues && !leagues.length && <div className="td-warn soft">You don't run a league yet. Ask Mike to add your email as a league TD.</div>}
      <div className="td-events">
        {(leagues ?? []).map((l) => (
          <article key={l.id} className={`td-event${l.hidden ? ' archived' : ''}`}>
            <button className="td-event-open" onClick={() => setParams({ view: 'leagues', l: l.id })}>
              <span className="td-event-name">{l.name}</span>
              <span className="td-event-meta">{[l.subtitle, l.when_text, l.where_text].filter(Boolean).join(' · ') || 'Set it up: tap OPEN → SETUP'}</span>
              <span className="td-event-meta">{l.award ? `Award: ${l.award}` : 'No weekly award'}{l.hidden ? ' · hidden from the site' : ''}</span>
            </button>
            <div className="td-actions"><button className="td-btn" onClick={() => setParams({ view: 'leagues', l: l.id })}>OPEN</button></div>
          </article>
        ))}
      </div>
    </main>
  );
}

function NewLeagueForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const s = touched ? slug : leagueSlug(name);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErr('The league needs a name.');
    if (!validSlug(s)) return setErr('Short name: 2–40 lowercase letters, numbers or dashes.');
    setBusy(true); setErr('');
    try { await onCreated(await createLeague(name.trim(), s)); } catch (x) { setErr(why(x)); setBusy(false); }
  };
  return (
    <form className="td-panel td-form" onSubmit={submit}>
      <h2>New league</h2>
      <p className="td-hint">Creates the league and its own bag tag set (same name). Add its TDs, then they fill in the rest and add weeks.</p>
      <div className="td-fields">
        <Field label="LEAGUE NAME"><input className="td-input" required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="Thursday Thumpers" /></Field>
        <Field label="SHORT NAME (LINKS, CAN'T CHANGE)"><input className="td-input" value={s} maxLength={40} onChange={(e) => { setTouched(true); setSlug(e.target.value.toLowerCase()); }} placeholder="thursday-thumpers" /></Field>
      </div>
      {s && <p className="td-hint">Tag board: /tags/{s} · Leagues page: /leagues#{s}</p>}
      {err && <div className="td-warn" role="alert">{err}</div>}
      <div className="td-actions">
        <button className="td-btn cta" type="submit" disabled={busy}>{busy ? 'CREATING…' : 'CREATE LEAGUE'}</button>
        <button className="td-btn quiet" type="button" onClick={onCancel}>CANCEL</button>
      </div>
    </form>
  );
}

type LTab = 'weeks' | 'setup' | 'tags' | 'tds';
const LTAB_LABEL: Record<LTab, string> = { weeks: 'WEEKS', setup: 'SETUP', tags: 'TAGS', tds: 'TDS' };

function LeagueHome({ league, admin, onBack, onSaved, onOpenWeek }: {
  league: MyLeague; admin: boolean; onBack: () => void; onSaved: () => Promise<void>; onOpenWeek: (id: string) => void;
}) {
  const [tab, setTab] = useState<LTab>('weeks');
  return (
    <>
      <div className="td-hub" style={{ paddingBottom: 0 }}>
        <div className="td-row">
          <button className="td-btn quiet" onClick={onBack}>‹ LEAGUES</button>
          <h2 className="td-h2">{league.name}</h2>
          <div style={{ flex: 1 }} />
          <a className="td-btn quiet" href={`/leagues#${league.slug}`} target="_blank" rel="noreferrer">LEAGUES PAGE ↗</a>
        </div>
      </div>
      <nav className="td-tabs" aria-label="League sections">
        {(Object.keys(LTAB_LABEL) as LTab[]).map((t) => (
          <button key={t} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>{LTAB_LABEL[t]}</button>
        ))}
      </nav>
      {tab === 'weeks' && <WeeksTab league={league} onOpenWeek={onOpenWeek} />}
      {tab === 'setup' && <SetupTab league={league} onSaved={onSaved} />}
      {tab === 'tags' && <Suspense fallback={<p className="td-empty">Loading tags…</p>}><TagsPanel admin={admin} onlyPool={league.tag_pool_id} /></Suspense>}
      {tab === 'tds' && <TdsTab league={league} admin={admin} />}
    </>
  );
}

function WeeksTab({ league, onOpenWeek }: { league: MyLeague; onOpenWeek: (id: string) => void }) {
  const [weeks, setWeeks] = useState<EventConfig[] | null>(null);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await api.myEvents();
      if (!live) return;
      if (r.error || !r.data) return setErr(why(r.error));
      setWeeks(r.data.filter((e) => e.league_id === league.id).sort((a, b) => b.starts_on.localeCompare(a.starts_on)));
    })();
    return () => { live = false; };
  }, [league.id]);
  const today = isoDate(new Date());
  const latest = weeks?.[0];
  return (
    <main className="td-main">
      <div className="td-row">
        <h2 className="td-h2">Weeks</h2>
        <div style={{ flex: 1 }} />
        {weeks && <button className="td-btn cta" onClick={() => setAdding(true)}>+ NEW WEEK</button>}
      </div>
      {err && <div className="td-warn" role="alert">{err}</div>}
      {adding && weeks && <NewWeekForm league={league} latest={latest ?? null} onCancel={() => setAdding(false)} onCreated={onOpenWeek} />}
      {weeks === null && !err && <p className="td-empty">Loading weeks…</p>}
      {weeks && !weeks.length && !adding && <div className="td-warn soft">No weeks yet. Tap <b>+ NEW WEEK</b> to set up the first one.</div>}
      <div className="td-events">
        {(weeks ?? []).map((w) => (
          <article key={w.id} className={`td-event${w.archived ? ' archived' : ''}`}>
            <button className="td-event-open" onClick={() => onOpenWeek(w.id)}>
              <span className="td-event-name">{w.name}</span>
              <span className="td-event-meta">{dateRange(w)} · {w.starts_on === today ? 'TODAY' : w.starts_on > today ? 'coming up' : 'done'}</span>
            </button>
            <div className="td-actions"><button className="td-btn" onClick={() => onOpenWeek(w.id)}>OPEN</button></div>
          </article>
        ))}
      </div>
    </main>
  );
}

function NewWeekForm({ league, latest, onCancel, onCreated }: { league: League; latest: EventConfig | null; onCancel: () => void; onCreated: (id: string) => void }) {
  const [date, setDate] = useState(latest ? addDays(latest.starts_on, 7) : isoDate(new Date()));
  const [name, setName] = useState('');
  const [copyPlayers, setCopyPlayers] = useState(true);
  const [holes, setHoles] = useState(18);
  const [divs, setDivs] = useState<DivisionRow[]>([]);
  const [lib, setLib] = useState<LibCourse[]>([]);
  const [layoutId, setLayoutId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  useEffect(() => { if (!latest) void (async () => { const r = await api.loadLibrary(); if (r.data) setLib(sortLibrary(r.data)); })(); }, [latest]);
  const chosen = findLayout(lib, layoutId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!latest) { const bad = divisionsProblem(divs); if (bad) return setErr(bad); }
    setBusy(true); setErr('');
    try {
      const id = await newWeek(league.id, date, { name, copyPlayers, holes: chosen?.layout.holes ?? holes, divisions: divs });
      if (!latest && chosen) {
        const a = await api.applyLayout(id, chosen.layout.id);
        if (a.error) { setBusy(false); setCreated(id); return setErr('The week was created, but the course didn\'t load. Open it and use SETUP → Course → LOAD.'); }
      }
      onCreated(id);
    } catch (x) { setErr(why(x)); setBusy(false); }
  };

  return (
    <form className="td-panel td-form" onSubmit={submit}>
      <h2>New week</h2>
      <p className="td-hint">{latest
        ? `Copies ${latest.name} (${niceDate(latest.starts_on)}): course, CTP holes, divisions, payouts and the player list. Never cards, scores, the award or the photo.`
        : 'The first week. Pick the course and divisions; every week after copies the one before.'}</p>
      <div className="td-fields">
        <Field label="DATE"><input className="td-input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="NAME"><input className="td-input" maxLength={80} value={name} placeholder={weekName(league, date)} onChange={(e) => setName(e.target.value)} /></Field>
        {!latest && !chosen && <Field label="HOLES"><input className="td-input" type="number" min={1} max={40} value={holes} onChange={(e) => setHoles(Math.max(1, Math.min(40, Number(e.target.value) || 1)))} /></Field>}
      </div>
      {latest ? (
        <button type="button" className="td-toggle" aria-pressed={copyPlayers} onClick={() => setCopyPlayers(!copyPlayers)}>
          <span className="track"><span className="knob" /></span><span>Copy the player list (everyone starts not checked in)</span>
        </button>
      ) : (
        <>
          <Field label="COURSE"><LayoutSelect lib={lib} value={layoutId} onChange={setLayoutId} blankLabel="Not in the list: I'll enter holes in Setup" label="Course" /></Field>
          <DivisionPicker divs={divs} waves={1} onChange={setDivs} />
        </>
      )}
      {err && <div className="td-warn" role="alert">{err}</div>}
      <div className="td-actions">
        {created
          ? <button className="td-btn cta" type="button" onClick={() => onCreated(created)}>OPEN WEEK</button>
          : <button className="td-btn cta" type="submit" disabled={busy}>{busy ? 'CREATING…' : 'CREATE WEEK'}</button>}
        <button className="td-btn quiet" type="button" onClick={onCancel}>CANCEL</button>
      </div>
    </form>
  );
}

function SetupTab({ league, onSaved }: { league: MyLeague; onSaved: () => Promise<void> }) {
  const init = () => Object.fromEntries(LEAGUE_FIELDS.map((f) => [f.key, (league[f.key] as string | null) ?? '']));
  const [vals, setVals] = useState<Record<string, string>>(init);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const banner = useRef<HTMLInputElement>(null);
  const logo = useRef<HTMLInputElement>(null);
  const dirty = LEAGUE_FIELDS.some((f) => (vals[f.key] ?? '').trim() !== ((league[f.key] as string | null) ?? ''));

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key); setMsg(null);
    try { await fn(); await onSaved(); setMsg({ ok: true, text: ok }); } catch (e) { setMsg({ ok: false, text: why(e) }); }
    setBusy('');
  };
  const save = () => {
    if (!vals.name?.trim()) return setMsg({ ok: false, text: 'The league needs a name.' });
    void run('save', () => saveLeague(league.id, Object.fromEntries(LEAGUE_FIELDS.map((f) => [f.key, (vals[f.key] ?? '').trim()]))), 'Saved. The Leagues page shows it now.');
  };
  const img = (which: 'banner' | 'logo', f: File | undefined, input: HTMLInputElement | null) => {
    if (!f) return;
    void run(which, () => uploadLeagueImage(league.id, which, f), which === 'banner' ? 'Banner is up.' : 'Logo is up.').then(() => { if (input) input.value = ''; });
  };

  return (
    <main className="td-main">
      <section className="td-panel td-form">
        <h2>On the Leagues page</h2>
        <p className="td-hint">Everything here shows on barebonesdiscgolf.club/leagues as soon as you save. Blank fields are left off.</p>
        <div className="td-fields">
          {LEAGUE_FIELDS.map((f) => (
            <Field key={f.key} label={f.label}>
              <input className="td-input" maxLength={f.max} value={vals[f.key] ?? ''} placeholder={f.hint} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
            </Field>
          ))}
        </div>
        <div className="td-actions">
          <button className="td-btn cta" disabled={!!busy || !dirty} onClick={save}>{busy === 'save' ? 'SAVING…' : 'SAVE'}</button>
          {dirty && <button className="td-btn quiet" onClick={() => setVals(init())}>UNDO CHANGES</button>}
        </div>
      </section>

      <section className="td-panel td-form">
        <h2>Banner or logo</h2>
        <p className="td-hint">A wide banner across the top of the card, or a logo on black when there's no banner. JPG or PNG; it shrinks itself.</p>
        <div className="lw-grid">
          {(['banner', 'logo'] as const).map((which) => {
            const cur = league[which];
            const ref = which === 'banner' ? banner : logo;
            return (
              <div key={which} className="lw-block">
                <div className="td-label">{which.toUpperCase()}</div>
                {cur ? <img className={which === 'banner' ? 'lw-photo' : 'lg-td-logo'} src={imageSrc(cur)} alt={`${league.name} ${which}`} /> : <p className="td-hint">None.</p>}
                <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => img(which, e.target.files?.[0], ref.current)} />
                <div className="td-row">
                  <button className="td-btn" disabled={!!busy} onClick={() => ref.current?.click()}>{busy === which ? 'UPLOADING…' : cur ? 'REPLACE' : 'UPLOAD'}</button>
                  {cur && <button className="td-btn quiet" disabled={!!busy} onClick={() => void run(which, () => saveLeague(league.id, { [which]: '' }), `${which === 'banner' ? 'Banner' : 'Logo'} removed.`)}>REMOVE</button>}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="td-panel td-form">
        <h2>Show on the site</h2>
        <button type="button" className="td-toggle" aria-pressed={!league.hidden} disabled={!!busy}
          onClick={() => void run('hidden', () => saveLeague(league.id, { hidden: !league.hidden }), league.hidden ? 'It\'s on the Leagues page now.' : 'Hidden from the Leagues page.')}>
          <span className="track"><span className="knob" /></span><span>{league.hidden ? 'Hidden from the Leagues page' : 'Showing on the Leagues page'}</span>
        </button>
        <p className="td-hint">Tag board: /tags/{league.slug} · this league's link: /leagues#{league.slug}</p>
      </section>
      {msg && <div className={msg.ok ? 'td-ok' : 'td-warn'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
    </main>
  );
}

function TdsTab({ league, admin }: { league: MyLeague; admin: boolean }) {
  const [tds, setTds] = useState<string[] | null>(null);
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    const r = await tagApi.poolAdmins(league.tag_pool_id);
    if (r.error || !r.data) return setErr(why(r.error));
    setTds(r.data); setErr('');
  }, [league.tag_pool_id]);
  useEffect(() => { void (async () => { await load(); })(); }, [load]);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const v = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return setErr('That doesn\'t look like an email.');
    const r = await tagApi.addPoolAdmin(league.tag_pool_id, v);
    if (r.error) return setErr(why(r.error));
    setEmail(''); await load();
  };
  const remove = async (x: string) => {
    if (!window.confirm(`Remove ${x} as a TD of ${league.name}?`)) return;
    const r = await tagApi.removePoolAdmin(league.tag_pool_id, x);
    if (r.error) return setErr(why(r.error));
    await load();
  };
  return (
    <main className="td-main">
      <section className="td-panel td-form">
        <h2>League TDs</h2>
        <p className="td-hint">They run every week of {league.name} (no need to add them to each week), edit its setup and run its tags. They sign in at /td with this exact email.{admin ? '' : ' Only Mike adds or removes league TDs.'}</p>
        {tds === null && !err && <p className="td-empty">Loading…</p>}
        {tds && !tds.length && <p className="td-hint">Nobody yet.</p>}
        <ul className="td-list">
          {(tds ?? []).map((x) => (
            <li key={x} className="td-row"><span>{x}</span><div style={{ flex: 1 }} />{admin && <button className="td-btn quiet" onClick={() => void remove(x)}>REMOVE</button>}</li>
          ))}
        </ul>
        {admin && (
          <form className="td-row" onSubmit={add}>
            <input className="td-input" type="email" value={email} placeholder="their@email.com" onChange={(e) => setEmail(e.target.value)} aria-label="New league TD email" />
            <button className="td-btn cta" type="submit">ADD TD</button>
          </form>
        )}
        {err && <div className="td-warn" role="alert">{err}</div>}
      </section>
    </main>
  );
}
