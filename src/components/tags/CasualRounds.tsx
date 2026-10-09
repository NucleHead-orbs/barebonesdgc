/**
 * MATCHUPS → Casual rounds (migration 20261112): invite anyone in your tag set to a round, no matter how far apart on the
 * board. Up to 6 on the card; open seats for anyone in the set. Nothing is on the line until the scorer ticks tags at
 * tee-off on the Scorecard.
 */
import { useEffect, useState } from 'react';
import * as tagApi from '../../lib/tags/api';
import type { Holding, RosterEntry } from '../../lib/tags/api';
import { CARD_MAX, MAX_INVITED, casualAction, casualIn, casualMessage, seatsLeft, slotLabel, toLocalInput, type CasualRound, type LibCourseLite, type RoundPerson } from '../../lib/tags/board';
import { Link } from 'react-router-dom';
import { cardLink, cardTime } from '../../lib/rounds/fromRound';
import { display, tagMessage } from '../../lib/tags/tags';
import './board.css';

type Act = (p: Promise<{ error?: unknown }>, ok?: string) => Promise<boolean>;
const who = (p: RoundPerson) => `${display(p)}${p.number ? ` (#${p.number})` : ''}`;
const msg = (e: unknown) => casualMessage(e) ?? tagMessage(e);

export function CasualRounds({ token, meId, holdings, rosters, rounds, act, now }: {
  token: string; meId: string; holdings: Holding[]; rosters: Record<string, RosterEntry[]>; rounds: CasualRound[]; act: Act; now: number;
}) {
  const [making, setMaking] = useState(false);
  const [err, setErr] = useState('');
  const run = async (p: Promise<{ error?: unknown }>, ok: string) => {
    const r = await p;
    if (r.error) { setErr(msg(r.error)); return false; }
    setErr('');
    return act(Promise.resolve({}), ok);
  };
  if (!holdings.length) return null;
  return (
    <section className="td-panel cs">
      <div className="td-row">
        <h2>Casual rounds</h2>
        <div style={{ flex: 1 }} />
        {!making && <button className="td-btn cta" onClick={() => setMaking(true)}>+ INVITE A ROUND</button>}
      </div>
      <p className="td-hint">Invite anyone in your tag set, any spot on the board. Up to {CARD_MAX} on the card; open seats go to whoever jumps in first. No tags are on the line unless the scorer puts them on at tee-off.</p>
      {making && <CasualForm token={token} meId={meId} holdings={holdings} rosters={rosters} now={now} onCancel={() => setMaking(false)}
        onSend={async (p) => { if (await run(p, 'Invite sent. It\'s on the Board too.')) setMaking(false); }} />}
      {err && <div className="td-warn" role="alert">{err} <button className="td-btn quiet" onClick={() => setErr('')}>OK</button></div>}
      {!rounds.length && !making && <p className="td-hint">No casual rounds coming up in your sets.</p>}
      {rounds.map((r) => {
        const a = casualAction(r);
        const left = seatsLeft(r);
        const asked = r.players.filter((p) => p.status === 'invited');
        const out = r.players.filter((p) => p.status === 'out');
        return (
          <div key={r.id} className={`cs-round${r.mine === 'in' ? ' is-in' : ''}${r.mine === 'invited' ? ' is-asked' : ''}`}>
            <div className="cs-main">
              <b>{r.host_me ? 'Your round' : `${who(r.host)}'s round`}{r.mine === 'invited' && <span className="cs-flag">YOU'RE INVITED</span>}</b>
              <span>{r.pool_name} · {slotLabel(r.tee_at, r.course)}</span>
              {r.note && <span className="cs-note">“{r.note}”</span>}
              <span className="td-hint">In ({casualIn(r).length}/{CARD_MAX}): {casualIn(r).map(who).join(', ')}{asked.length ? ` · Invited: ${asked.map((p) => display(p)).join(', ')}` : ''}{out.length ? ` · Can't: ${out.map((p) => display(p)).join(', ')}` : ''}</span>
              <span className="td-hint">{!r.open ? 'Teed off.' : left ? `${left} seat${left === 1 ? '' : 's'} open` : 'Card full'}</span>
            </div>
            <div className="cs-acts">
              {a === 'join' && <button className="td-btn cta" onClick={() => void run(tagApi.casualAnswer(token, r.id, true), `You're in: ${slotLabel(r.tee_at, r.course)}.`)}>{r.mine === 'invited' || r.mine === 'out' ? "I'M IN" : 'JUMP IN'}</button>}
              {a === 'join' && r.mine === 'invited' && <button className="td-btn quiet" onClick={() => void run(tagApi.casualAnswer(token, r.id, false), "Got it. You're out.")}>CAN'T MAKE IT</button>}
              {a === 'leave' && <button className="td-btn quiet" onClick={() => { if (window.confirm('Drop out? Your seat opens for someone else.')) void run(tagApi.casualAnswer(token, r.id, false), 'You dropped out.'); }}>DROP OUT</button>}
              {a === 'host' && <button className="td-btn quiet" onClick={() => { if (window.confirm('Call off this round? Everyone sees it on the Board.')) void run(tagApi.casualCancel(token, r.id), 'Round called off.'); }}>CALL IT OFF</button>}
              {a === 'full' && <span className="td-hint">Full</span>}
              {(r.mine === 'in' || r.host_me) && cardTime(r.tee_at, now) && <Link className="td-btn cta" to={cardLink('casual', r.id)}>START THE CARD</Link>}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function CasualForm({ token, meId, holdings, rosters, now, onSend, onCancel }: {
  token: string; meId: string; holdings: Holding[]; rosters: Record<string, RosterEntry[]>; now: number;
  onSend: (p: Promise<{ error?: unknown }>) => Promise<void>; onCancel: () => void;
}) {
  const [pool, setPool] = useState(holdings[0].pool);
  const [when, setWhen] = useState('');
  const [course, setCourse] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [lib, setLib] = useState<LibCourseLite[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => { const r = await tagApi.profileGet(token); if (!live) return; if (r.data) setLib(r.data.library); else setErr(tagMessage(r.error)); })();
    return () => { live = false; };
  }, [token]);
  const holding = holdings.find((h) => h.pool === pool) ?? holdings[0];
  const roster = (rosters[holding.pool] ?? []).filter((r) => r.member_id !== meId);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_INVITED ? p : [...p, id]));
  const send = async () => {
    if (!when || !course) return setErr('Pick a time and a course.');
    setBusy(true); setErr('');
    await onSend(tagApi.casualCreate(token, holding.pool_id, new Date(when).toISOString(), course, picked, note.trim()));
    setBusy(false);
  };
  return (
    <div className="cr-slot cr-form cs-form">
      {holdings.length > 1 && (
        <div className="td-chips" role="group" aria-label="Tag set">
          {holdings.map((h) => <button key={h.pool} type="button" className="td-chip" aria-pressed={h.pool === pool} onClick={() => { setPool(h.pool); setPicked([]); }}>{h.pool_name} · #{h.number}</button>)}
        </div>
      )}
      <label className="td-field">WHEN<input className="td-input" type="datetime-local" value={when} min={toLocalInput(now + 15 * 60_000)} max={toLocalInput(now + 30 * 86_400_000)} onChange={(e) => setWhen(e.target.value)} /></label>
      <label className="td-field">COURSE
        <select className="td-input" value={course} onChange={(e) => setCourse(e.target.value)}>
          <option value="">{lib?.length ? 'Pick a course' : 'Loading courses…'}</option>
          {(lib ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.city ? ` · ${c.city}` : ''}</option>)}
        </select>
      </label>
      <div className="td-label">INVITE (UP TO {MAX_INVITED}, OPTIONAL) · {picked.length} PICKED</div>
      <div className="td-chips cs-roster">
        {roster.map((r) => (
          <button key={r.member_id} type="button" className="td-chip" aria-pressed={picked.includes(r.member_id)} disabled={!picked.includes(r.member_id) && picked.length >= MAX_INVITED}
            onClick={() => toggle(r.member_id)}>#{r.number} {display(r)}</button>
        ))}
      </div>
      <p className="td-hint">Invited players get an @ ping. Anyone else in {holding.pool_name} can grab an open seat.</p>
      <label className="td-field">NOTE (OPTIONAL)<input className="td-input" maxLength={200} placeholder="Loser buys tacos" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      {err && <div className="td-warn" role="alert">{err}</div>}
      <div className="td-row">
        <button className="td-btn cta" disabled={busy} onClick={() => void send()}>{busy ? 'SENDING…' : 'SEND INVITE'}</button>
        <button className="td-btn quiet" onClick={onCancel}>CANCEL</button>
      </div>
    </div>
  );
}
