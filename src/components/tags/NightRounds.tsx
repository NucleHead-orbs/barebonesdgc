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
import { nightFree, nightMessage, nightWaiting, slotLabel, toLocalInput, type LibCourseLite, type Night, type NightPerson } from '../../lib/tags/board';
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
  useEffect(() => {
    if (!adding || members) return;
    let live = true;
    void (async () => { const r = await roundsApi.loadMembers(); if (live && r.data) setMembers(r.data); })();
    return () => { live = false; };
  }, [adding, members]);
  const waiting = nightWaiting(n);
  const free = nightFree(n);
  const inIds = new Set(n.players.map((p) => p.id).filter(Boolean));
  const hostName = n.host.nickname?.trim() || n.host.name;
  return (
    <div className={`cs-round nr-night${n.me_in ? ' is-in' : ''}${n.closed ? ' is-closed' : ''}`}>
      <div className="cs-main">
        <b>{n.title}{n.me_in && !n.closed && <span className="cs-flag">CHECKED IN</span>}{n.closed && <span className="cs-flag nr-flag-closed">CLOSED</span>}</b>
        <span>{n.host_me ? 'Your night' : `${hostName}'s night`} · {slotLabel(n.starts_at, n.course)}</span>
        {n.note && <span className="cs-note">“{n.note}”</span>}
        {n.closed ? (
          <span className="td-hint">{n.swaps.length ? `${n.swaps.map((s) => `${s.pool_name}: ${SWAP_WORD[s.status]}`).join(' · ')}. Confirm your card in MY ROUNDS.` : 'Closed. No tag set had two holders in the field, so nothing swapped.'}</span>
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
      </div>
      <div className="cs-acts">
        {n.open && !n.me_in && <button className="td-btn cta" onClick={() => void run(tagApi.nightCheckin(token, n.id, true), `Checked in: ${n.title}.`)}>CHECK IN</button>}
        {n.open && n.me_in && !n.my_card && <Link className="td-btn cta" to={cardLink('night', n.id)}>START THE CARD</Link>}
        {n.my_card && <Link className="td-btn quiet" to={`/rounds/${n.my_card}`}>YOUR CARD ›</Link>}
        {n.open && n.me_in && !n.my_card && !n.host_me && <button className="td-btn quiet" onClick={() => void run(tagApi.nightCheckin(token, n.id, false), 'Checked out.')}>CHECK OUT</button>}
        {n.host_me && !n.closed && <button className="td-btn quiet" onClick={() => setAdding((a) => !a)}>{adding ? 'DONE ADDING' : '+ PLAYERS / GUESTS'}</button>}
        {n.host_me && !n.closed && n.cards > 0 && (
          <button className="td-btn quiet" onClick={() => {
            const left = waiting.length ? ` ${waiting.map(nm).join(', ')} ${waiting.length === 1 ? "isn't" : "aren't"} on a card and will sit out the swap.` : '';
            if (window.confirm(`Close ${n.title} and put the tags up?${left}`)) void run(tagApi.nightClose(token, n.id), 'Closed. The swaps are up; everyone confirms their card in MY ROUNDS.');
          }}>CLOSE THE NIGHT</button>
        )}
        {n.host_me && !n.closed && n.cards === 0 && (
          <button className="td-btn quiet" onClick={() => { if (window.confirm(`Call off ${n.title}? It's posted on the Board.`)) void run(tagApi.nightCancel(token, n.id), 'Called off.'); }}>CALL IT OFF</button>
        )}
        {!n.closed && n.open && free.length === 0 && n.players.length > 0 && <span className="td-hint">Everyone's on a card.</span>}
      </div>
    </div>
  );
}

function NightForm({ token, now, onSend, onCancel }: { token: string; now: number; onSend: (p: Promise<{ error?: unknown }>) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState('Glow League');
  const [when, setWhen] = useState('');
  const [course, setCourse] = useState('');
  const [note, setNote] = useState('');
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
    await onSend(tagApi.nightCreate(token, title.trim(), new Date(when).toISOString(), course, note.trim()));
    setBusy(false);
  };
  return (
    <div className="cr-slot cr-form cs-form">
      <label className="td-field">NAME<input className="td-input" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="td-field">STARTS<input className="td-input" type="datetime-local" value={when} min={toLocalInput(now - 2 * 3600e3)} max={toLocalInput(now + 30 * 86_400_000)} onChange={(e) => setWhen(e.target.value)} /></label>
      <label className="td-field">COURSE
        <select className="td-input" value={course} onChange={(e) => setCourse(e.target.value)}>
          <option value="">{lib?.length ? 'Pick a course' : 'Loading courses…'}</option>
          {(lib ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.city ? ` · ${c.city}` : ''}</option>)}
        </select>
      </label>
      <label className="td-field">NOTE (OPTIONAL)<input className="td-input" maxLength={200} placeholder="Bring glow discs and a headlamp" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <p className="td-hint">You're checked in as host. Check-in opens 3 hours before the start; you can add members and guests by hand. Every tag set swaps across the field when the last card is in, or when you hit CLOSE THE NIGHT. It closes itself 12 hours after the start.</p>
      {err && <div className="td-warn" role="alert">{err}</div>}
      <div className="td-row">
        <button className="td-btn cta" disabled={busy} onClick={() => void send()}>{busy ? 'POSTING…' : 'POST THE NIGHT'}</button>
        <button className="td-btn quiet" onClick={onCancel}>CANCEL</button>
      </div>
    </div>
  );
}
