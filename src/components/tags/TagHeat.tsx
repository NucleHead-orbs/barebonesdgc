/**
 * My Tag: the heat for each tag set this player holds (migration 20261028). Time bomb fuse on a top-5 tag, challenges
 * (send up to 5 spots up; accept or decline what comes in), the decline count, and the set's group chat.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as tagApi from '../../lib/tags/api';
import { DROP_PLACES, FREE_DECLINES, declineNote, timeLeft, type ChatLine, type HeatChallenge, type HeatRow } from '../../lib/tags/heat';
import { display, tagMessage } from '../../lib/tags/tags';
import { niceDate } from '../../lib/leagues/leagues';
import './heat.css';

type Act = (p: Promise<{ error?: unknown }>, ok?: string) => Promise<boolean>;

/** A clock that ticks once a minute (keeps countdowns honest without re-rendering every second). */
function useNow(stepMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), stepMs); return () => window.clearInterval(t); }, [stepMs]);
  return now;
}

export function TagHeat({ token, rev, names, act }: { token: string; rev: number; names: Record<string, string>; act: Act }) {
  const [rows, setRows] = useState<HeatRow[] | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => { const r = await tagApi.heat(token); if (live && r.data) setRows(r.data); })();
    return () => { live = false; };
  }, [token, rev]);
  const now = useNow();
  if (!rows) return null;
  const on = rows.filter((r) => r.bombs || r.challenges || r.chat);
  if (!on.length) return null;
  return <>{on.map((r) => <HeatCard key={r.pool_id} row={r} name={names[r.pool] ?? r.pool} token={token} now={now} act={act} />)}</>;
}

function HeatCard({ row, name, token, now, act }: { row: HeatRow; name: string; token: string; now: number; act: Act }) {
  const [picking, setPicking] = useState(false);
  const fuse = row.bombs && row.top5 ? timeLeft(row.fuse_at, now) : null;
  const incoming = row.list.filter((c) => !c.mine && c.status === 'open');
  const outgoing = row.list.filter((c) => c.mine && c.status === 'open');
  const accepted = row.list.filter((c) => c.status === 'accepted');
  const done = row.list.filter((c) => !['open', 'accepted'].includes(c.status)).slice(0, 4);
  const busy = outgoing.length > 0 || accepted.some((c) => c.mine);

  return (
    <section className="td-panel ht-card">
      <div className="td-row"><h2 className="td-h2">{name} · #{row.number}</h2></div>

      {fuse && (
        <div className={`ht-bomb${fuse.hot ? ' is-hot' : ''}`} role="status">
          <BombIcon />
          <div><b>Time bomb: {fuse.gone ? 'any minute now' : `${fuse.label} left`}</b>
            <span>Top-5 tags explode after 7 days without a tag round. Play one (or confirm one) to reset it. Boom = you go to the bottom.</span></div>
        </div>
      )}
      {row.bombs && !row.top5 && <p className="td-hint">The top 5 tags carry a 7-day time bomb. Get up there and keep playing.</p>}

      {row.challenges && (
        <>
          {incoming.map((c) => (
            <div key={c.id} className="ht-ch is-in">
              <div><b>{c.other ? display(c.other) : 'Someone'}{c.other?.number ? ` (#${c.other.number})` : ''} challenges you!</b>
                <span>Answer within {timeLeft(c.expires_at, now)?.label ?? '0m'}. Silence counts as a decline. {declineNote(row.declines)}</span></div>
              <div className="td-row">
                <button className="td-btn cta" onClick={() => void act(tagApi.respondChallenge(token, c.id, true), 'Accepted. Play a tag round together within 7 days.')}>ACCEPT</button>
                <button className="td-btn quiet" onClick={() => {
                  if (row.declines >= FREE_DECLINES && !window.confirm(`That's your 4th decline: you drop ${DROP_PLACES} spots. Decline anyway?`)) return;
                  void act(tagApi.respondChallenge(token, c.id, false), row.declines >= FREE_DECLINES ? `Declined. You dropped ${DROP_PLACES} spots.` : 'Declined.');
                }}>DECLINE</button>
              </div>
            </div>
          ))}
          {accepted.map((c) => (
            <div key={c.id} className="ht-ch is-on">
              <div><b>You vs {c.other ? display(c.other) : '?'}{c.other?.number ? ` (#${c.other.number})` : ''}: it's on</b>
                <span>Play a tag round together by {c.due_at ? niceDate(c.due_at.slice(0, 10)) : 'next week'} ({timeLeft(c.due_at, now)?.label ?? '0m'} left). Save it with tags on the line.</span></div>
              <Link className="td-btn cyan" to="/scorecard">OPEN THE SCORECARD</Link>
            </div>
          ))}
          {outgoing.map((c) => (
            <div key={c.id} className="ht-ch">
              <div><b>Waiting on {c.other ? display(c.other) : '?'}{c.other?.number ? ` (#${c.other.number})` : ''}</b>
                <span>They have {timeLeft(c.expires_at, now)?.label ?? '0m'} to answer.</span></div>
              <button className="td-btn quiet" onClick={() => void act(tagApi.cancelChallenge(token, c.id), 'Challenge cancelled.')}>CANCEL</button>
            </div>
          ))}
          <div className="ht-foot">
            <span className="td-hint">Declines: {row.declines} of {FREE_DECLINES} free. The 4th drops you {DROP_PLACES} spots, then the count starts over.</span>
            {!busy && row.targets.length > 0 && !picking && <button className="td-btn" onClick={() => setPicking(true)}>CHALLENGE SOMEONE</button>}
            {busy && <span className="td-hint">One challenge at a time.</span>}
            {!row.targets.length && <span className="td-hint">You're on top. Nobody to challenge; everyone's coming for you.</span>}
          </div>
          {picking && (
            <div className="ht-pick">
              <span className="td-label">UP TO 5 SPOTS ABOVE YOU</span>
              {row.targets.map((t) => (
                <button key={t.member_id} className="td-btn" onClick={() => {
                  if (!window.confirm(`Challenge ${display(t)} (#${t.number})? They get 48 hours to answer.`)) return;
                  void act(tagApi.challenge(token, row.pool_id, t.member_id), `Challenge sent to ${t.name}.`).then(() => setPicking(false));
                }}>#{t.number} {display(t)}</button>
              ))}
              <button className="td-btn quiet" onClick={() => setPicking(false)}>NEVER MIND</button>
            </div>
          )}
          {done.length > 0 && (
            <ul className="ht-done">{done.map((c) => <li key={c.id}>{doneLine(c)}</li>)}</ul>
          )}
        </>
      )}

      {row.chat && <Chat token={token} poolId={row.pool_id} pool={row.pool} lastId={row.last_chat ?? 0} />}
    </section>
  );
}

function doneLine(c: HeatChallenge): string {
  const who = c.other ? c.other.name : '?';
  const s = { declined: 'declined', expired: 'ran out the clock', cancelled: 'cancelled', played: 'played it', lapsed: 'never played it' } as Record<string, string>;
  return c.mine ? `You challenged ${who}: ${c.status === 'declined' || c.status === 'expired' ? `they ${s[c.status]}` : s[c.status]}.`
    : `${who} challenged you: ${c.status === 'declined' ? 'you declined' : c.status === 'expired' ? 'you ran out the clock' : s[c.status]}.`;
}

const POLL_CHAT = 8000;
const seenKey = (pool: string) => `bb-chat-seen-${pool}`;
const readSeen = (pool: string) => { try { return Number(localStorage.getItem(seenKey(pool)) ?? 0); } catch { return 0; } };
const writeSeen = (pool: string, id: number) => { try { localStorage.setItem(seenKey(pool), String(id)); } catch { /* not remembered: badge may repeat */ } };

function Chat({ token, poolId, pool, lastId }: { token: string; poolId: string; pool: string; lastId: number }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState(() => readSeen(pool));
  const after = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const unread = !open && lastId > seen;

  const pull = useCallback(async () => {
    const r = await tagApi.chatRead(token, poolId, after.current);
    if (r.error) { setErr(tagMessage(r.error)); return; }
    const got = r.data ?? [];
    if (got.length) {
      after.current = got[got.length - 1].id;
      setLines((l) => [...l, ...got].slice(-200));
      setSeen(after.current); writeSeen(pool, after.current);
      window.setTimeout(() => box.current?.scrollTo({ top: box.current.scrollHeight }), 30);
    }
  }, [token, poolId, pool]);

  useEffect(() => {
    if (!open) return;
    void (async () => { await pull(); })();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void pull(); }, POLL_CHAT);
    return () => window.clearInterval(t);
  }, [open, pull]);

  const send = async () => {
    const b = text.trim();
    if (!b) return;
    setBusy(true); setErr('');
    const r = await tagApi.chatPost(token, poolId, b);
    setBusy(false);
    if (r.error) return setErr(tagMessage(r.error));
    setText(''); await pull();
  };

  if (!open) return <button className={`td-btn${unread ? ' cta' : ''}`} onClick={() => setOpen(true)}>GROUP CHAT{unread ? ' · NEW' : ''}</button>;
  return (
    <div className="ht-chat">
      <div className="td-row"><span className="td-label">GROUP CHAT · EVERYONE WITH A TAG IN THIS SET</span><div style={{ flex: 1 }} /><button className="td-btn quiet" onClick={() => setOpen(false)}>CLOSE</button></div>
      <div className="ht-lines" ref={box}>
        {!lines.length && <p className="td-hint">Quiet in here. Talk some trash, set up a round.</p>}
        {lines.map((l) => (
          <div key={l.id} className="ht-line">
            <b>{l.name ? display({ name: l.name, nickname: l.nickname }) : 'Former member'}{l.number ? <span> #{l.number}</span> : null}</b>
            <p>{l.body}</p>
            <time>{new Date(l.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</time>
          </div>
        ))}
      </div>
      <form className="ht-send" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <input className="td-input" value={text} maxLength={500} placeholder="Say something…" onChange={(e) => setText(e.target.value)} aria-label="Message" />
        <button className="td-btn cta" type="submit" disabled={busy || !text.trim()}>SEND</button>
      </form>
      {err && <div className="td-warn" role="alert">{err}</div>}
    </div>
  );
}

export function BombIcon({ small }: { small?: boolean }) {
  return (
    <svg className={`ht-bomb-ico${small ? ' sm' : ''}`} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="18" cy="24" r="12" fill="#14080f" stroke="#ff4f6e" strokeWidth="2.5" />
      <rect x="21" y="9" width="7" height="6" rx="1.5" transform="rotate(35 24 12)" fill="#14080f" stroke="#ff4f6e" strokeWidth="2" />
      <path d="M27 9 Q30 4 34 5" fill="none" stroke="#c9b48a" strokeWidth="2" />
      <circle className="ht-spark" cx="34.5" cy="5" r="3" fill="#ffd23a" />
    </svg>
  );
}
