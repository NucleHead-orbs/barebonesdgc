/**
 * Challenge rounds (migration 20261103). SlotBox: the two players agree a time + course (the challenged picks first, the
 * other OKs or proposes another). JumpIns: locked rounds in your sets you can jump into (max 8, a card of 10; closes 2 h before tee).
 */
import { useEffect, useState } from 'react';
import * as tagApi from '../../lib/tags/api';
import { MAX_JUMP_INS, canDropOut, canJumpIn, roundStep, slotLabel, toLocalInput, type ChallengeRound, type LibCourseLite, type RoundPerson } from '../../lib/tags/board';
import { display, tagMessage } from '../../lib/tags/tags';
import './board.css';

type Act = (p: Promise<{ error?: unknown }>, ok?: string) => Promise<boolean>;
const who = (p: RoundPerson) => `${display(p)}${p.number ? ` (#${p.number})` : ''}`;
const closesLabel = (r: ChallengeRound) => (r.closes_at ? new Date(r.closes_at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '');

/** For the challenge pair, inside the accepted challenge on MY TAGS. */
export function SlotBox({ round, token, act, now }: { round: ChallengeRound; token: string; act: Act; now: number }) {
  const [editing, setEditing] = useState(false);
  const step = roundStep(round, now);
  const other = round.role === 'challenger' ? round.challenged : round.challenger;
  const slot = slotLabel(round.tee_at, round.course);
  const jumps = round.joins.length ? `Jumping in: ${round.joins.map(who).join(', ')}.` : 'No jump-ins yet.';
  if (editing || step === 'pick') {
    return <SlotForm round={round} token={token} act={act} now={now} first={step === 'pick'} onDone={() => setEditing(false)} onCancel={step === 'pick' ? undefined : () => setEditing(false)} />;
  }
  return (
    <div className="cr-slot">
      {step === 'wait_pick' && <p><b>Waiting on {who(other)} to pick a time and course.</b> The challenged player picks first.</p>}
      {step === 'ok' && (
        <>
          <p><b>{who(other)} picked {slot}.</b> OK it to lock it in and open {MAX_JUMP_INS} spots for jump-ins.</p>
          <div className="td-row">
            <button className="td-btn cta" onClick={() => void act(tagApi.okSlot(token, round.id), `Locked: ${slot}. Jump-ins are open.`)}>OK, LOCK IT IN</button>
            <button className="td-btn quiet" onClick={() => setEditing(true)}>PROPOSE ANOTHER</button>
          </div>
        </>
      )}
      {step === 'wait_ok' && (
        <>
          <p><b>You picked {slot}.</b> Waiting on {who(other)} to OK it.</p>
          <button className="td-btn quiet" onClick={() => setEditing(true)}>CHANGE IT</button>
        </>
      )}
      {step === 'open' && (
        <>
          <p><b>Locked: {slot}.</b> {jumps} Jump-ins close {closesLabel(round)}.</p>
          <button className="td-btn quiet" onClick={() => setEditing(true)}>MOVE IT</button>
        </>
      )}
      {step === 'closed' && <p><b>{slot}.</b> {jumps} The card is set. Save it on the Scorecard with tags on the line.</p>}
    </div>
  );
}

function SlotForm({ round, token, act, now, first, onDone, onCancel }: {
  round: ChallengeRound; token: string; act: Act; now: number; first: boolean; onDone: () => void; onCancel?: () => void;
}) {
  const min = toLocalInput(now + 2 * 3600_000 + 60_000);
  const max = round.due_at ? toLocalInput(new Date(round.due_at).getTime()) : undefined;
  const [when, setWhen] = useState(round.tee_at ? toLocalInput(new Date(round.tee_at).getTime()) : '');
  const [course, setCourse] = useState(round.course_id ?? '');
  const [lib, setLib] = useState<LibCourseLite[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => { const r = await tagApi.profileGet(token); if (!live) return; if (r.data) setLib(r.data.library); else setErr(tagMessage(r.error)); })();
    return () => { live = false; };
  }, [token]);
  const save = async () => {
    if (!when || !course) return setErr('Pick a time and a course.');
    setBusy(true); setErr('');
    const ok = await act(tagApi.setSlot(token, round.id, new Date(when).toISOString(), course), 'Sent. They OK it and it\'s locked.');
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <div className="cr-slot cr-form">
      <p><b>{first ? 'You were challenged: pick when and where.' : 'Propose a time and course.'}</b> The other player OKs it, then {MAX_JUMP_INS} spots open for jump-ins.</p>
      <label className="td-field">WHEN<input className="td-input" type="datetime-local" value={when} min={min} max={max} onChange={(e) => setWhen(e.target.value)} /></label>
      <label className="td-field">COURSE
        <select className="td-input" value={course} onChange={(e) => setCourse(e.target.value)}>
          <option value="">{lib?.length ? 'Pick a course' : 'Loading courses…'}</option>
          {(lib ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.city ? ` · ${c.city}` : ''}</option>)}
        </select>
      </label>
      {err && <div className="td-warn" role="alert">{err}</div>}
      <div className="td-row">
        <button className="td-btn cta" disabled={busy} onClick={() => void save()}>{busy ? 'SENDING…' : 'SEND IT'}</button>
        {onCancel && <button className="td-btn quiet" onClick={onCancel}>CANCEL</button>}
      </div>
    </div>
  );
}

/** MATCHUPS: locked challenge rounds in your sets you can jump into, and the ones you're in. */
export function JumpIns({ rounds, token, act, now }: { rounds: ChallengeRound[]; token: string; act: Act; now: number }) {
  const mine = rounds.filter((r) => r.role === 'joined');
  const open = rounds.filter((r) => r.role === null && roundStep(r, now) === 'open');
  if (!mine.length && !open.length) return null;
  return (
    <section className="td-panel cr-jump">
      <h2>Jump in</h2>
      <p className="td-hint">Locked challenge rounds in your tag sets. Up to {MAX_JUMP_INS} jump-ins each; your tag goes on the line too. Jump in until 2 hours before tee time; drop out any time before tee.</p>
      {[...mine, ...open].map((r) => {
        const spots = MAX_JUMP_INS - r.joins.length;
        return (
          <div key={r.id} className={`cr-round${r.role === 'joined' ? ' is-in' : ''}`}>
            <div className="cr-round-main">
              <b>{who(r.challenger)} vs {who(r.challenged)}</b>
              <span>{r.pool_name} · {slotLabel(r.tee_at, r.course)}</span>
              <span className="td-hint">{r.joins.length ? `In: ${r.joins.map(who).join(', ')}. ` : ''}{spots > 0 ? `${spots} spot${spots === 1 ? '' : 's'} left` : 'Card full'} · closes {closesLabel(r)}</span>
            </div>
            {r.role === 'joined'
              ? (canDropOut(r, now)
                ? <button className="td-btn quiet" onClick={() => { if (window.confirm('Drop out? Your spot opens for someone else.')) void act(tagApi.dropOut(token, r.id), 'You dropped out.'); }}>DROP OUT</button>
                : <span className="td-hint">You're in</span>)
              : <button className="td-btn cta" disabled={!canJumpIn(r, now)} onClick={() => {
                if (!window.confirm(`Jump into ${display(r.challenger)} vs ${display(r.challenged)}, ${slotLabel(r.tee_at, r.course)}? Your ${r.pool_name} tag goes on the line too.`)) return;
                void act(tagApi.jumpIn(token, r.id), "You're in. Show up, tags on the line.");
              }}>JUMP IN</button>}
          </div>
        );
      })}
    </section>
  );
}
