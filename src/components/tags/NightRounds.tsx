/**
 * MATCHUPS → Check-in rounds (migration 20261122): one night (a glow league), as many cards as it takes. Players
 * check in when they get there; the host adds guests. Each card starts from here and picks its players from who's
 * checked in. Every tag set swaps across the whole field once the last checked-in member is on a saved card (or the
 * host closes the night). The database runs all of it; this is the buttons.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as tagApi from '../../lib/tags/api';
import * as roundsApi from '../../lib/rounds/api';
import { nightFree, nightMessage, nightWaiting, slotLabel, teamPlaces, teamsProblem, toLocalInput, type LibCourseLite, type Night, type NightFormat, type NightPerson, type TeamDraft } from '../../lib/tags/board';
import { fmtToPar, toParClass } from '../../lib/rounds/rounds';
import { cardLink } from '../../lib/rounds/fromRound';
import { display, tagMessage, type TagMember } from '../../lib/tags/tags';
import './board.css';

type Act = (p: Promise<{ error?: unknown }>, ok?: string) => Promise<boolean>;
const msg = (e: unknown) => nightMessage(e) ?? tagMessage(e);
const nm = (p: NightPerson) => (p.nickname?.trim() || p.name);
const SWAP_WORD = { pending: 'waiting on confirms', applied: 'swapped', disputed: 'disputed (TD sorts it out)', void: 'voided' } as const;

export function NightRounds({ token, canHost, nights, act, now }: { token: string; canHost: boolean; nights: Night[]; act: Act; now: number }) {
  const [making, setMaking] = useState(false);
  const [err, setErr] = useState('');
  const run = async (p: Promise<{ error?: unknown }>, ok: string) => {
    const r = await p;
    if (r.error) { setErr(msg(r.error)); return false; }
    setErr('');
    return act(Promise.resolve({}), ok);
  };
  if (!nights.length && !canHost) return null;
  return (
    <section className="td-panel cs nr">
      <div className="td-row">
        <h2>Check-in rounds</h2>
        <div style={{ flex: 1 }} />
        {canHost && !making && <button className="td-btn cta" onClick={() => setMaking(true)}>+ RUN A NIGHT</button>}
      </div>
      <p className="td-hint">League nights and big groups: one night, as many cards as it takes. Check in when you get there, then each card picks its players from who's checked in. <b>Every tag set is on the line across the whole field</b>, swapped once the last card is in.</p>
      {making && <NightForm token={token} now={now} onCancel={() => setMaking(false)}
        onSend={async (p) => { if (await run(p, 'Night is up. Everyone can check in from MATCHUPS.')) setMaking(false); }} />}
      {err && <div className="td-warn" role="alert">{err} <button className="td-btn quiet" onClick={() => setErr('')}>OK</button></div>}
      {nights.map((n) => <NightRow key={n.id} n={n} token={token} run={run} />)}
    </section>
  );
}

function NightRow({ n, token, run }: { n: Night; token: string; run: (p: Promise<{ error?: unknown }>, ok: string) => Promise<boolean> }) {
  const [members, setMembers] = useState<TagMember[] | null>(null);
  const [guest, setGuest] = useState('');
  const [adding, setAdding] = useState(false);
  const [posting, setPosting] = useState(false);
  const dubs = n.format === 'dubs';
  useEffect(() => {
    if ((!adding && !posting) || members) return;
    let live = true;
    void (async () => { const r = await roundsApi.loadMembers(); if (live && r.data) setMembers(r.data); })();
    return () => { live = false; };
  }, [adding, posting, members]);
  const waiting = nightWaiting(n);
  const free = nightFree(n);
  const inIds = new Set(n.players.map((p) => p.id).filter(Boolean));
  const hostName = n.host.nickname?.trim() || n.host.name;
  return (
    <div className={`cs-round nr-night${n.me_in ? ' is-in' : ''}${n.closed ? ' is-closed' : ''}`}>
      <div className="cs-main">
        <b>{n.title}<span className="cs-flag nr-flag-format">{dubs ? 'DUBS' : 'SINGLES'}</span>{n.me_in && !n.closed && <span className="cs-flag">CHECKED IN</span>}{n.closed && <span className="cs-flag nr-flag-closed">{n.results.length ? 'FINAL' : 'CLOSED'}</span>}</b>
        <span>{n.host_me ? 'Your night' : `${hostName}'s night`} · {slotLabel(n.starts_at, n.course)}</span>
        {n.note && <span className="cs-note">“{n.note}”</span>}
        {n.results.length > 0 ? (
          <ol className="nr-standings">
            {n.results.map((t) => (
              <li key={t.team}><span>{n.results.filter((x) => x.place === t.place).length > 1 ? 'T' : ''}{t.place}.</span> {t.players.map((p) => p.name).join(' & ')} <b className={toParClass(t.to_par)}>{fmtToPar(t.to_par)}</b></li>
            ))}
          </ol>
        ) : n.closed && dubs ? (
          <span className="td-hint">Closed without results.</span>
        ) : n.closed ? (
          <span className="td-hint">{n.swaps.length ? `${n.swaps.map((s) => `${s.pool_name}: ${SWAP_WORD[s.status]}`).join(' · ')}. Confirm your card in MY ROUNDS.` : 'Closed. No tag set had two holders in the field, so nothing swapped.'}</span>
        ) : n.open && dubs ? (
          <span className="td-hint">{n.players.length} checked in · dubs, scored off the Scorecard (UDisc is fine). No tags on the line; {n.host_me ? 'you post' : 'the host posts'} the team results at the end.</span>
        ) : n.open ? (
          <span className="td-hint">{n.players.length} checked in · {n.cards} card{n.cards === 1 ? '' : 's'} in{waiting.length ? ` · still to card: ${waiting.map(nm).join(', ')}` : ''}. Tags swap when the last one is in{n.host_me ? ' (or you close the night)' : ''}.</span>
        ) : (
          <span className="td-hint">Check-in opens 3 hours before the start.</span>
        )}
        {n.players.length > 0 && (
          <div className="nr-people">
            {n.players.map((p) => (
              <span key={p.id ?? `g-${p.name}`} className={`nr-person${p.carded ? ' is-carded' : ''}${p.guest ? ' is-guest' : ''}`}>
                {p.carded && <span aria-label="on a card">✓ </span>}{nm(p)}{p.guest && <small> guest</small>}
                {n.host_me && !n.closed && !p.carded && p.id !== n.host.id && (
                  <button type="button" className="nr-x" aria-label={`Take ${nm(p)} off`} onClick={() => void run(tagApi.nightRemove(token, n.id, p.id, p.guest ? p.name : null), `${nm(p)} is off the night.`)}>×</button>
                )}
              </span>
            ))}
          </div>
        )}
        {n.host_me && !n.closed && adding && (
          <div className="nr-add">
            <select className="td-input" aria-label="Check in a member" value="" onChange={(e) => {
              const m = members?.find((x) => x.id === e.target.value);
              if (m) void run(tagApi.nightAdd(token, n.id, m.id, null), `${display(m)} is checked in.`);
            }}>
              <option value="">{members ? '+ Check in a member…' : 'Loading members…'}</option>
              {(members ?? []).filter((m) => !inIds.has(m.id)).map((m) => <option key={m.id} value={m.id}>{display(m)}</option>)}
            </select>
            <form className="td-row" onSubmit={(e) => { e.preventDefault(); const g = guest.trim(); if (g) void run(tagApi.nightAdd(token, n.id, null, g.slice(0, 40)), `${g} is in as a guest.`).then((ok) => { if (ok) setGuest(''); }); }}>
              <input className="td-input" placeholder="Guest name" maxLength={40} value={guest} onChange={(e) => setGuest(e.target.value)} />
              <button className="td-btn" disabled={!guest.trim()}>+ GUEST</button>
            </form>
          </div>
        )}
        {n.host_me && dubs && posting && (
          <ResultsForm n={n} members={members ?? []} onCancel={() => setPosting(false)}
            onPost={async (teams, note) => { if (await run(tagApi.nightResults(token, n.id, teams, note), n.results.length ? 'Results updated.' : 'Results posted. It\'s on the Board and Boner Rounds.')) setPosting(false); }} />
        )}
      </div>
      <div className="cs-acts">
        {n.open && !n.me_in && <button className="td-btn cta" onClick={() => void run(tagApi.nightCheckin(token, n.id, true), `Checked in: ${n.title}.`)}>CHECK IN</button>}
        {n.open && n.me_in && !n.my_card && !dubs && <Link className="td-btn cta" to={cardLink('night', n.id)}>START THE CARD</Link>}
        {n.my_card && <Link className="td-btn quiet" to={`/rounds/${n.my_card}`}>YOUR CARD ›</Link>}
        {n.open && n.me_in && !n.my_card && !n.host_me && <button className="td-btn quiet" onClick={() => void run(tagApi.nightCheckin(token, n.id, false), 'Checked out.')}>CHECK OUT</button>}
        {n.host_me && dubs && (!n.closed || n.results.length > 0) && <button className="td-btn cta" onClick={() => setPosting((x) => !x)}>{posting ? 'CLOSE RESULTS' : n.results.length ? 'FIX RESULTS' : 'ENTER RESULTS'}</button>}
        {n.host_me && !n.closed && <button className="td-btn quiet" onClick={() => setAdding((a) => !a)}>{adding ? 'DONE ADDING' : '+ PLAYERS / GUESTS'}</button>}
        {n.host_me && !n.closed && (dubs || n.cards === 0) && (
          <button className="td-btn quiet" onClick={() => {
            const to: NightFormat = dubs ? 'singles' : 'dubs';
            if (window.confirm(to === 'dubs' ? `Switch ${n.title} to dubs? No Scorecard cards and no tag swap; you post the team results at the end.` : `Switch ${n.title} back to singles? Cards go on the Scorecard and every tag set swaps across the field.`))
              void run(tagApi.nightFormat(token, n.id, to), to === 'dubs' ? 'Switched to dubs.' : 'Back to singles.');
          }}>{dubs ? 'SWITCH TO SINGLES' : 'SWITCH TO DUBS'}</button>
        )}
        {n.host_me && !n.closed && !dubs && n.cards > 0 && (
          <button className="td-btn quiet" onClick={() => {
            const left = waiting.length ? ` ${waiting.map(nm).join(', ')} ${waiting.length === 1 ? "isn't" : "aren't"} on a card and will sit out the swap.` : '';
            if (window.confirm(`Close ${n.title} and put the tags up?${left}`)) void run(tagApi.nightClose(token, n.id), 'Closed. The swaps are up; everyone confirms their card in MY ROUNDS.');
          }}>CLOSE THE NIGHT</button>
        )}
        {n.host_me && !n.closed && n.cards === 0 && n.results.length === 0 && (
          <button className="td-btn quiet" onClick={() => { if (window.confirm(`Call off ${n.title}? It's posted on the Board.`)) void run(tagApi.nightCancel(token, n.id), 'Called off.'); }}>CALL IT OFF</button>
        )}
        {!n.closed && n.open && !dubs && free.length === 0 && n.players.length > 0 && <span className="td-hint">Everyone's on a card.</span>}
      </div>
    </div>
  );
}

function NightForm({ token, now, onSend, onCancel }: { token: string; now: number; onSend: (p: Promise<{ error?: unknown }>) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState('Glow League');
  const [when, setWhen] = useState('');
  const [course, setCourse] = useState('');
  const [note, setNote] = useState('');
  const [format, setFormat] = useState<NightFormat>('singles');
  const [lib, setLib] = useState<LibCourseLite[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => { const r = await tagApi.profileGet(token); if (!live) return; if (r.data) setLib(r.data.library); else setErr(tagMessage(r.error)); })();
    return () => { live = false; };
  }, [token]);
  const send = async () => {
    if (!title.trim()) return setErr('Give the night a name.');
    if (!when || !course) return setErr('Pick a start time and a course.');
    setBusy(true); setErr('');
    await onSend(tagApi.nightCreate(token, title.trim(), new Date(when).toISOString(), course, note.trim(), format));
    setBusy(false);
  };
  return (
    <div className="cr-slot cr-form cs-form">
      <label className="td-field">NAME<input className="td-input" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <div className="td-chips" role="group" aria-label="Format">
        <button type="button" className="td-chip" aria-pressed={format === 'singles'} onClick={() => setFormat('singles')}>SINGLES · Scorecard + tags</button>
        <button type="button" className="td-chip" aria-pressed={format === 'dubs'} onClick={() => setFormat('dubs')}>DUBS · you post results</button>
      </div>
      <label className="td-field">STARTS<input className="td-input" type="datetime-local" value={when} min={toLocalInput(now - 2 * 3600e3)} max={toLocalInput(now + 30 * 86_400_000)} onChange={(e) => setWhen(e.target.value)} /></label>
      <label className="td-field">COURSE
        <select className="td-input" value={course} onChange={(e) => setCourse(e.target.value)}>
          <option value="">{lib?.length ? 'Pick a course' : 'Loading courses…'}</option>
          {(lib ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.city ? ` · ${c.city}` : ''}</option>)}
        </select>
      </label>
      <label className="td-field">NOTE (OPTIONAL)<input className="td-input" maxLength={200} placeholder="Bring glow discs and a headlamp" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <p className="td-hint">{format === 'singles'
        ? "You're checked in as host. Check-in opens 3 hours before the start; you can add members and guests by hand. Every tag set swaps across the field when the last card is in, or when you hit CLOSE THE NIGHT. It closes itself 12 hours after the start."
        : "You're checked in as host. Check-in opens 3 hours before the start. Score it however you like (UDisc is fine); at the end tap ENTER RESULTS and type the teams and their scores. No tags on the line. You can switch formats until results are posted."}</p>
      {err && <div className="td-warn" role="alert">{err}</div>}
      <div className="td-row">
        <button className="td-btn cta" disabled={busy} onClick={() => void send()}>{busy ? 'POSTING…' : 'POST THE NIGHT'}</button>
        <button className="td-btn quiet" onClick={onCancel}>CANCEL</button>
      </div>
    </div>
  );
}

/** Dubs results: teams of 1–2 (from who's checked in, or any name) and a score to par. Places come from the scores. */
function ResultsForm({ n, members, onPost, onCancel }: { n: Night; members: TagMember[]; onPost: (teams: TeamDraft[], note: string) => Promise<void>; onCancel: () => void }) {
  const fromResults = (): TeamDraft[] => n.results.map((t) => ({ toPar: t.to_par, players: t.players.map((p) => ({ memberId: p.id, name: p.name })) }));
  const [teams, setTeams] = useState<TeamDraft[]>(() => (n.results.length ? fromResults() : [{ players: [], toPar: 0 }, { players: [], toPar: 0 }]));
  const [note, setNote] = useState(n.results_note ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const key = (p: { memberId: string | null; name: string }) => p.memberId ?? `g:${p.name.trim().toLowerCase()}`;
  const used = new Set(teams.flatMap((t) => t.players.map(key)));
  // pick list: who's checked in, then every other member (for anyone who never checked in)
  const pool = [
    ...n.players.map((p) => ({ memberId: p.id, name: p.nickname?.trim() || p.name })),
    ...members.filter((m) => !n.players.some((p) => p.id === m.id)).map((m) => ({ memberId: m.id, name: display(m) })),
  ];
  const places = teamPlaces(teams.map((t) => t.toPar));
  const setTeam = (i: number, f: (t: TeamDraft) => TeamDraft) => setTeams((ts) => ts.map((t, j) => (j === i ? f(t) : t)));
  const post = async () => {
    const problem = teamsProblem(teams);
    if (problem) return setErr(problem);
    setBusy(true); setErr('');
    await onPost(teams, note.trim());
    setBusy(false);
  };
  return (
    <div className="nr-results">
      <div className="td-label">TEAMS · SCORE TO PAR</div>
      {teams.map((t, i) => (
        <div key={i} className="nr-team">
          <span className="nr-place">{places[i]}.</span>
          <div className="nr-team-who">
            {t.players.map((p) => (
              <span key={key(p)} className="nr-person">{p.name}<button type="button" className="nr-x" aria-label={`Take ${p.name} off`} onClick={() => setTeam(i, (x) => ({ ...x, players: x.players.filter((y) => key(y) !== key(p)) }))}>×</button></span>
            ))}
            {t.players.length < 2 && <TeamAdd pool={pool.filter((p) => !used.has(key(p)))} onAdd={(p) => setTeam(i, (x) => ({ ...x, players: [...x.players, p] }))} />}
          </div>
          <div className="nr-par">
            <button type="button" className="td-btn quiet" aria-label="One better" onClick={() => setTeam(i, (x) => ({ ...x, toPar: Math.max(-99, x.toPar - 1) }))}>−</button>
            <b className={toParClass(t.toPar)}>{fmtToPar(t.toPar)}</b>
            <button type="button" className="td-btn quiet" aria-label="One worse" onClick={() => setTeam(i, (x) => ({ ...x, toPar: Math.min(99, x.toPar + 1) }))}>+</button>
          </div>
          {teams.length > 2 && <button type="button" className="nr-x" aria-label="Remove team" onClick={() => setTeams((ts) => ts.filter((_, j) => j !== i))}>×</button>}
        </div>
      ))}
      <div className="td-row">
        <button type="button" className="td-btn quiet" disabled={teams.length >= 60} onClick={() => setTeams((ts) => [...ts, { players: [], toPar: 0 }])}>+ TEAM</button>
      </div>
      <label className="td-field">NOTE (OPTIONAL)<input className="td-input" maxLength={200} placeholder="CTP: Danny on 7. Ace pot rolls." value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <p className="td-hint">One player = a Cali team. Ties share the place. Posting closes the night, puts the standings on the Board and Boner Rounds, and drops them in everyone's MY ROUNDS. Typo? Post again (the Board story only goes out once).</p>
      {err && <div className="td-warn" role="alert">{err}</div>}
      <div className="td-row">
        <button className="td-btn cta" disabled={busy} onClick={() => void post()}>{busy ? 'POSTING…' : n.results.length ? 'UPDATE RESULTS' : 'POST RESULTS'}</button>
        <button className="td-btn quiet" onClick={onCancel}>CANCEL</button>
      </div>
    </div>
  );
}

function TeamAdd({ pool, onAdd }: { pool: Array<{ memberId: string | null; name: string }>; onAdd: (p: { memberId: string | null; name: string }) => void }) {
  const [guest, setGuest] = useState('');
  return (
    <span className="nr-team-add">
      <select className="td-input" aria-label="Add a player" value="" onChange={(e) => {
        const v = e.target.value;
        const p = pool.find((x) => (x.memberId ?? `g:${x.name}`) === v);
        if (p) onAdd(p);
      }}>
        <option value="">+ Player…</option>
        {pool.map((p) => <option key={p.memberId ?? `g:${p.name}`} value={p.memberId ?? `g:${p.name}`}>{p.name}{p.memberId ? '' : ' (guest)'}</option>)}
      </select>
      <form onSubmit={(e) => { e.preventDefault(); const g = guest.trim(); if (g) { onAdd({ memberId: null, name: g.slice(0, 40) }); setGuest(''); } }}>
        <input className="td-input" placeholder="or a guest name" maxLength={40} value={guest} onChange={(e) => setGuest(e.target.value)} />
      </form>
    </span>
  );
}
