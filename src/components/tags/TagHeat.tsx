/**
 * My Tag: the heat for each tag set this player holds (migration 20261028). Time bomb fuse on a top-5 tag, challenges
 * (send up to 5 spots up; accept or decline what comes in), the decline count, and the set's group chat.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as tagApi from '../../lib/tags/api';
import { DROP_PLACES, FREE_DECLINES, declineNote, timeLeft, type ChatLine, type HeatChallenge, type HeatRow } from '../../lib/tags/heat';
import { readSeen, writeSeen, type HeatFocus } from '../../lib/tags/useHeat';
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

export function TagHeat({ rows, token, names, act, focus, seenKey, onSeen }: {
  rows: HeatRow[] | null; token: string; names: Record<string, string>; act: Act;
  focus: HeatFocus | null; seenKey: (pool: string) => string; onSeen: (pool: string, id: number) => void;
}) {
  const now = useNow();
  if (!rows) return null;
  const on = rows.filter((r) => r.bombs || r.challenges || r.chat);
  if (!on.length) return null;
  return <>{on.map((r) => <HeatCard key={r.pool_id} row={r} name={names[r.pool] ?? r.pool} token={token} now={now} act={act}
    focus={focus?.pool === r.pool ? focus : null} seenKey={seenKey(r.pool)} onSeen={(id) => onSeen(r.pool, id)} />)}</>;
}

function HeatCard({ row, name, token, now, act, focus, seenKey, onSeen }: {
  row: HeatRow; name: string; token: string; now: number; act: Act; focus: HeatFocus | null; seenKey: string; onSeen: (id: number) => void;
}) {
  const [picking, setPicking] = useState(false);
  const card = useRef<HTMLElement>(null);
  const chFocus = focus?.kind === 'challenge' ? focus.n : 0;
  useEffect(() => { if (chFocus) card.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [chFocus]);
  const fuse = row.bombs && row.top5 ? timeLeft(row.fuse_at, now) : null;
  const incoming = row.list.filter((c) => !c.mine && c.status === 'open');
  const outgoing = row.list.filter((c) => c.mine && c.status === 'open');
  const accepted = row.list.filter((c) => c.status === 'accepted');
  const done = row.list.filter((c) => !['open', 'accepted'].includes(c.status)).slice(0, 4);
  const busy = outgoing.length > 0 || accepted.some((c) => c.mine);

  return (
    <section className="td-panel ht-card" ref={card}>
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

      {row.chat && <Chat token={token} poolId={row.pool_id} seenKey={seenKey} lastId={row.last_chat ?? 0} openN={focus?.kind === 'chat' ? focus.n : 0} onSeen={onSeen} />}
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
function Chat({ token, poolId, seenKey, lastId, openN, onSeen }: {
  token: string; poolId: string; seenKey: string; lastId: number; openN: number; onSeen: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState(() => readSeen(seenKey));
  const after = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const seenCb = useRef(onSeen);
  useEffect(() => { seenCb.current = onSeen; }, [onSeen]);
  const [openedFor, setOpenedFor] = useState(0);
  if (openN && openN !== openedFor) { setOpenedFor(openN); setOpen(true); }  // the header's chat icon opens it
  useEffect(() => {
    if (openN) window.setTimeout(() => wrap.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }, [openN]);
  const unread = !open && lastId > seen;

  const pull = useCallback(async () => {
    const r = await tagApi.chatRead(token, poolId, after.current);
    if (r.error) { setErr(tagMessage(r.error)); return; }
    const got = r.data ?? [];
    if (got.length) {
      after.current = got[got.length - 1].id;
      setLines((l) => [...l, ...got].slice(-200));
      setSeen(after.current); writeSeen(seenKey, after.current); seenCb.current(after.current);
      window.setTimeout(() => box.current?.scrollTo({ top: box.current.scrollHeight }), 30);
    }
  }, [token, poolId, seenKey]);

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

  if (!open) return <div ref={wrap}><button className={`td-btn${unread ? ' cta' : ''}`} onClick={() => setOpen(true)}>GROUP CHAT{unread ? ' · NEW' : ''}</button></div>;
  return (
    <div className="ht-chat" ref={wrap}>
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

/** My Tag header: one icon for new chat messages, one for challenges waiting on you. Tap = jump there. */
export function HeatBell({ rows, unread, onChat, onChallenge }: {
  rows: HeatRow[] | null; unread: Record<string, number>; onChat: (pool: string) => void; onChallenge: (pool: string) => void;
}) {
  if (!rows) return null;
  const chats = rows.filter((r) => r.chat);
  const ch = rows.filter((r) => r.challenges);
  if (!chats.length && !ch.length) return null;
  const chatN = chats.reduce((a, r) => a + (unread[r.pool] ?? 0), 0);
  const chatPool = chats.find((r) => (unread[r.pool] ?? 0) > 0)?.pool ?? chats[0]?.pool;
  const incoming = (r: HeatRow) => r.list.filter((c) => !c.mine && c.status === 'open').length;
  const chN = ch.reduce((a, r) => a + incoming(r), 0);
  const chPool = ch.find((r) => incoming(r) > 0)?.pool ?? ch[0]?.pool;
  return (
    <div className="ht-bell">
      {chatPool && (
        <button type="button" className={`ht-icon${chatN ? ' is-on' : ''}`} onClick={() => onChat(chatPool)}
          aria-label={chatN ? `${chatN} new chat message${chatN === 1 ? '' : 's'}` : 'Group chat'}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4.5 3.5V17H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><circle cx="8.5" cy="11" r="1.3" fill="currentColor" /><circle cx="12" cy="11" r="1.3" fill="currentColor" /><circle cx="15.5" cy="11" r="1.3" fill="currentColor" /></svg>
          {chatN > 0 && <b>{chatN > 99 ? '99+' : chatN}</b>}
        </button>
      )}
      {chPool && (
        <button type="button" className={`ht-icon${chN ? ' is-on is-hot' : ''}`} onClick={() => onChallenge(chPool)}
          aria-label={chN ? `${chN} challenge${chN === 1 ? '' : 's'} waiting on you` : 'Challenges'}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3l7 7M4 3h4M4 3v4M20 3l-7 7M20 3h-4M20 3v4M8.5 14.5 4 19m0 0 2 2m-2-2-1.5-1.5M15.5 14.5 20 19m0 0-2 2m2-2 1.5-1.5M7 12l5 5M17 12l-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {chN > 0 && <b>{chN}</b>}
        </button>
      )}
    </div>
  );
}
