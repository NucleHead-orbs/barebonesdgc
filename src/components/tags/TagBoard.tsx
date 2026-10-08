/**
 * My Tag → BOARD: one message board per tag set (pick the set up top). Players' messages, the house's news posts
 * (challenges, results with their roast, explosions, the weekly Matchmaker), reactions and @mentions. Reads tag_board_read every few seconds.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as tagApi from '../../lib/tags/api';
import { REACTIONS, applyMention, mentionAt, mentionParts, mentionPicks, mergeLines, newsTone, threads, THREAD_PEEK, whoLine, type MentionPerson, type ReactionKind, type Reactions } from '../../lib/tags/board';
import type { ChatLine, HeatRow } from '../../lib/tags/heat';
import type { RosterEntry } from '../../lib/tags/api';
import { readSeen, writeSeen } from '../../lib/tags/useHeat';
import { display, tagMessage } from '../../lib/tags/tags';
import './board.css';

const POLL = 6000;

export function ReactionIcon({ kind }: { kind: ReactionKind }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`rx-ico rx-${kind}`}>
      {kind === 'skull' && <><path d="M12 3C7 3 4 6.5 4 10.5c0 2.6 1.3 4.3 3 5V19a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3.5c1.7-.7 3-2.4 3-5C20 6.5 17 3 12 3Z" fill="#f6efdc" stroke="#1b1424" strokeWidth="1.6" /><circle cx="9" cy="11" r="2.1" fill="#1b1424" /><circle cx="15" cy="11" r="2.1" fill="#1b1424" /><path d="M10 17.5v2.3M12 17.5v2.3M14 17.5v2.3" stroke="#1b1424" strokeWidth="1.3" /></>}
      {kind === 'fire' && <path d="M12 2.5c.5 3.2 4.8 5 4.8 10.2A4.8 4.8 0 0 1 12 21.5a4.8 4.8 0 0 1-4.8-4.8c0-2.4 1.4-3.7 2.3-5 .3 1.6 1.1 2.4 1.9 2.6C10.6 11 10.6 6 12 2.5Z" fill="#ff7a1f" stroke="#7a1d00" strokeWidth="1.3" strokeLinejoin="round" />}
      {kind === 'trash' && <><path d="M5 6.5h14M9.5 6.5V4.5h5v2M7 6.5l1 13.5h8l1-13.5" fill="#9aa3ad" stroke="#2b2f36" strokeWidth="1.6" strokeLinejoin="round" /><path d="M10.5 10v7M13.5 10v7" stroke="#2b2f36" strokeWidth="1.4" /></>}
      {kind === 'flex' && <path d="M5 20c-.8-3.6.2-7.6 3-10.4L9.6 4h3.3l-.6 3.3-1.8 2.9c1.6-.9 3.6-1 5.3 0 2.5 1.4 3.5 4.5 2.2 7-.9 1.8-2.8 2.8-4.8 2.8H5Z" fill="#ffb23d" stroke="#6b3a00" strokeWidth="1.4" strokeLinejoin="round" />}
    </svg>
  );
}

export function TagBoard({ token, meId, rows, names, pool, onPool, unread, seenKey, onSeen, rosters, focusId }: {
  token: string; meId: string; rows: HeatRow[] | null; names: Record<string, string>;
  pool: string | null; onPool: (pool: string) => void; unread: Record<string, number>;
  seenKey: (pool: string) => string; onSeen: (pool: string) => void;
  /** who holds a tag in each set (by set slug): who can be @mentioned */
  rosters: Record<string, RosterEntry[]>;
  /** a message to scroll to (from the @ bell) */
  focusId?: number | null;
}) {
  const sets = (rows ?? []).filter((r) => r.chat);
  if (!rows) return <p className="td-empty">Loading the board…</p>;
  if (!sets.length) return <div className="td-warn soft">No board for your tag sets yet. Your league TD switches it on in BAG TAGS → Heat.</div>;
  const cur = sets.find((r) => r.pool === pool) ?? sets[0];
  return (
    <section className="bd">
      {sets.length > 1 && (
        <div className="bd-sets" role="tablist" aria-label="Tag set">
          {sets.map((r) => (
            <button key={r.pool} role="tab" aria-selected={r.pool === cur.pool} className={`bd-set${r.pool === cur.pool ? ' on' : ''}`} onClick={() => onPool(r.pool)}>
              {names[r.pool] ?? r.pool} <span>#{r.number}</span>
              {r.pool !== cur.pool && (unread[r.pool] ?? 0) > 0 && <b className="bd-dot">{unread[r.pool]}</b>}
            </button>
          ))}
        </div>
      )}
      <BoardFeed key={cur.pool_id} token={token} meId={meId} poolId={cur.pool_id} name={names[cur.pool] ?? cur.pool}
        seenKey={seenKey(cur.pool)} onSeen={() => onSeen(cur.pool)} focusId={focusId ?? null}
        people={(rosters[cur.pool] ?? []).map((r) => ({ id: r.member_id, label: display(r), number: r.number }))} />
    </section>
  );
}

function BoardFeed({ token, meId, poolId, name, seenKey, onSeen, people, focusId }: {
  token: string; meId: string; poolId: string; name: string; seenKey: string; onSeen: () => void; people: MentionPerson[]; focusId: number | null;
}) {
  const [lines, setLines] = useState<ChatLine[] | null>(null);
  const [rx, setRx] = useState<Record<string, Reactions>>({});
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [firstNew] = useState(() => readSeen(seenKey));
  const [who, setWho] = useState<{ id: number; kind: ReactionKind } | null>(null); // whose names are showing (tap a count)
  const [caret, setCaret] = useState(0);
  const [replyTo, setReplyTo] = useState<ChatLine | null>(null);
  const [open, setOpen] = useState<Record<number, boolean>>({}); // long threads opened
  const input = useRef<HTMLInputElement>(null);
  const at = mentionAt(text, caret);
  const picks = at ? mentionPicks(people, at.query, meId) : [];
  const pick = (p: MentionPerson) => {
    if (!at) return;
    const next = applyMention(text, at, p.label);
    setText(next.text); setCaret(next.caret);
    requestAnimationFrame(() => { const el = input.current; if (el) { el.focus(); el.setSelectionRange(next.caret, next.caret); } });
  };
  // the @ bell: bring that message into view once it's loaded
  const focused = useRef<number | null>(null);
  useEffect(() => {
    if (!focusId || focused.current === focusId || !lines?.some((l) => l.id === focusId)) return;
    focused.current = focusId;
    document.getElementById(`bd-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusId, lines]);
  const after = useRef(0);
  const seenCb = useRef(onSeen);
  useEffect(() => { seenCb.current = onSeen; }, [onSeen]);

  const pull = useCallback(async () => {
    const r = await tagApi.boardRead(token, poolId, after.current);
    if (r.error || !r.data) { setErr(tagMessage(r.error)); return; }
    const got = r.data.lines;
    setRx(r.data.reactions);
    setLines((l) => mergeLines(l ?? [], got));
    if (got.length) {
      after.current = got[got.length - 1].id;
      writeSeen(seenKey, after.current); seenCb.current();
    }
  }, [token, poolId, seenKey]);

  useEffect(() => {
    void (async () => { await pull(); })();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void pull(); }, POLL);
    return () => window.clearInterval(t);
  }, [pull]);

  const send = async () => {
    const b = text.trim();
    if (!b) return;
    setBusy(true); setErr('');
    const r = await tagApi.chatPost(token, poolId, b);
    setBusy(false);
    if (r.error) return setErr(tagMessage(r.error));
    setText(''); await pull();
  };
  const react = async (id: number, kind: ReactionKind) => {
    const r = await tagApi.react(token, id, kind);
    if (r.error) return setErr(tagMessage(r.error));
    // show it right away; the next read brings the real tallies
    setRx((all) => {
      const cur = all[id] ?? { counts: {}, mine: [] };
      const on = r.data;
      const n = Math.max(0, (cur.counts[kind] ?? 0) + (on ? 1 : -1));
      return { ...all, [id]: { ...cur, counts: { ...cur.counts, [kind]: n }, mine: on ? [...cur.mine.filter((k) => k !== kind), kind] : cur.mine.filter((k) => k !== kind) } };
    });
  };

  const list = threads(lines ?? []);
  const sendReply = async (to: number, body: string, thread: number) => {
    const b = body.trim();
    if (!b) return false;
    setBusy(true); setErr('');
    const r = await tagApi.chatPost(token, poolId, b, to);
    setBusy(false);
    if (r.error) { setErr(tagMessage(r.error)); return false; }
    setReplyTo(null); setOpen((o) => ({ ...o, [thread]: true })); await pull();
    return true;
  };
  const lineProps = { meId, focusId, rx, who, setWho, react: (id: number, k: ReactionKind) => void react(id, k), onReply: (l: ChatLine) => setReplyTo(l) };
  return (
    <div className="bd-feed">
      <div className="bd-head"><b>{name} Board</b><span className="td-hint">Everyone holding a tag in this set. Challenges, results and explosions post here on their own.</span></div>
      <form className="bd-send" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <input ref={input} className="td-input" value={text} maxLength={500} placeholder="Say something… @ to call someone out" aria-label="Message"
          onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)} autoComplete="off" />
        <button className="td-btn cta" type="submit" disabled={busy || !text.trim()}>SEND</button>
      </form>
      {picks.length > 0 && (
        <div className="bd-at-picks" role="listbox" aria-label="Mention a player">
          {picks.map((p) => (
            <button key={p.id} type="button" role="option" aria-selected={false} className="bd-at-pick" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)}>
              @{p.label}{p.number ? <span> #{p.number}</span> : null}
            </button>
          ))}
        </div>
      )}
      <div className="bd-lines">
        {lines === null && <p className="td-hint">Loading…</p>}
        {lines?.length === 0 && <p className="td-hint">Quiet in here. Talk some trash, set up a round.</p>}
        {list.map((t, i) => {
          const key = t.root?.id ?? t.replies[0].id;
          // newest activity on top: a line under everything new since this phone last looked
          const newMark = firstNew > 0 && t.last <= firstNew && i > 0 && list[i - 1].last > firstNew;
          const all = open[key] || t.replies.length <= THREAD_PEEK || t.replies.some((r) => r.id === focusId);
          const shown = all ? t.replies : t.replies.slice(-THREAD_PEEK);
          const replying = replyTo && (replyTo.id === t.root?.id || t.replies.some((r) => r.id === replyTo.id));
          return (
            <div key={key} className="bd-thread">
              {newMark && <div className="bd-new"><span>NEW ABOVE</span></div>}
              {t.root ? <BoardLine l={t.root} {...lineProps} /> : <p className="bd-gone">Replying to a message that was taken down</p>}
              {t.replies.length > 0 && (
                <div className="bd-replies">
                  {!all && <button type="button" className="bd-more" onClick={() => setOpen((o) => ({ ...o, [key]: true }))}>VIEW ALL {t.replies.length} REPLIES</button>}
                  {shown.map((r) => <BoardLine key={r.id} l={r} {...lineProps} reply />)}
                </div>
              )}
              {replying && <ReplyBox to={replyTo!} busy={busy} onCancel={() => setReplyTo(null)} onSend={(b) => sendReply(replyTo!.id, b, key)} />}
            </div>
          );
        })}
      </div>
      {err && <div className="td-warn" role="alert">{err} <button className="td-btn quiet" onClick={() => setErr('')}>OK</button></div>}
    </div>
  );
}

type LineProps = {
  l: ChatLine; meId: string; focusId: number | null; rx: Record<string, Reactions>; reply?: boolean;
  who: { id: number; kind: ReactionKind } | null; setWho: (w: { id: number; kind: ReactionKind } | null) => void;
  react: (id: number, kind: ReactionKind) => void; onReply: (l: ChatLine) => void;
};

function BoardLine({ l, meId, focusId, rx, reply, who, setWho, react, onReply }: LineProps) {
  const r = rx[l.id];
  const mine = l.member_id === meId;
  const atMe = !!l.mentions?.some((m) => m.id === meId);
  const news = l.kind === 'system';
  const tone = news ? newsTone(l.event) : null;
  return (
    <article id={`bd-${l.id}`} className={`bd-line${reply ? ' is-reply' : ''}${news ? ` is-news t-${tone!.tone}` : ''}${mine ? ' is-mine' : ''}${atMe ? ' is-at-me' : ''}${l.id === focusId ? ' is-focus' : ''}`}>
      <header>
        {news ? <b className="bd-tag">{tone!.label}</b>
          : <b>{l.name ? display({ name: l.name, nickname: l.nickname }) : 'Former member'}{l.number ? <span> #{l.number}</span> : null}</b>}
        <time>{new Date(l.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</time>
      </header>
      <p>{l.mentions?.length
        ? mentionParts(l.body, l.mentions.map((m) => m.label)).map((x, j) => (x.at
          ? <b key={j} className={`bd-at${l.mentions!.some((m) => m.id === meId && x.text.slice(1).toLowerCase() === m.label.toLowerCase()) ? ' me' : ''}`}>{x.text}</b>
          : <span key={j}>{x.text}</span>))
        : l.body}</p>
      <div className="bd-rx">
        {REACTIONS.map((x) => {
          const n = r?.counts[x.kind] ?? 0;
          const on = r?.mine.includes(x.kind) ?? false;
          const showing = who?.id === l.id && who.kind === x.kind;
          return (
            <span key={x.kind} className={`bd-rxw${on ? ' on' : ''}${n ? ' has' : ''}`}>
              <button type="button" className="bd-rxb" aria-pressed={on} aria-label={on ? `Remove ${x.label}` : x.label} title={x.label}
                onClick={() => react(l.id, x.kind)}><ReactionIcon kind={x.kind} /></button>
              {n > 0 && <button type="button" className={`bd-rxn${showing ? ' open' : ''}`} aria-expanded={showing} aria-label={`${n} ${x.label}: who?`}
                onClick={() => setWho(showing ? null : { id: l.id, kind: x.kind })}>{n}</button>}
            </span>
          );
        })}
        <button type="button" className="bd-reply" onClick={() => onReply(l)}>REPLY</button>
      </div>
      {who?.id === l.id && (r?.who?.[who.kind]?.length ?? 0) > 0 && (
        <p className="bd-who" role="status"><ReactionIcon kind={who.kind} /> {whoLine(r!.who![who.kind]!)}</p>
      )}
    </article>
  );
}

function ReplyBox({ to, busy, onCancel, onSend }: { to: ChatLine; busy: boolean; onCancel: () => void; onSend: (body: string) => Promise<boolean> }) {
  const [text, setText] = useState('');
  const who = to.kind === 'system' ? 'the house' : to.name ? display({ name: to.name, nickname: to.nickname }) : 'them';
  return (
    <form className="bd-send bd-replybox" onSubmit={(e) => { e.preventDefault(); void onSend(text).then((ok) => { if (ok) setText(''); }); }}>
      <input className="td-input" autoFocus value={text} maxLength={500} placeholder={`Reply to ${who}…`} aria-label={`Reply to ${who}`}
        onChange={(e) => setText(e.target.value)} autoComplete="off" />
      <button className="td-btn cta" type="submit" disabled={busy || !text.trim()}>SEND</button>
      <button className="td-btn quiet" type="button" onClick={onCancel}>CANCEL</button>
    </form>
  );
}
