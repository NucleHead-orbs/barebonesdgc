/**
 * My Tag → BOARD: one message board per tag set (pick the set up top). Players' messages, the house's news posts
 * (challenges, results, explosions, the weekly Matchmaker) and reactions. Reads tag_board_read every few seconds.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as tagApi from '../../lib/tags/api';
import { REACTIONS, mergeLines, newsTone, whoLine, type ReactionKind, type Reactions } from '../../lib/tags/board';
import type { ChatLine, HeatRow } from '../../lib/tags/heat';
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

export function TagBoard({ token, meId, rows, names, pool, onPool, unread, seenKey, onSeen }: {
  token: string; meId: string; rows: HeatRow[] | null; names: Record<string, string>;
  pool: string | null; onPool: (pool: string) => void; unread: Record<string, number>;
  seenKey: (pool: string) => string; onSeen: (pool: string) => void;
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
        seenKey={seenKey(cur.pool)} onSeen={() => onSeen(cur.pool)} />
    </section>
  );
}

function BoardFeed({ token, meId, poolId, name, seenKey, onSeen }: { token: string; meId: string; poolId: string; name: string; seenKey: string; onSeen: () => void }) {
  const [lines, setLines] = useState<ChatLine[] | null>(null);
  const [rx, setRx] = useState<Record<string, Reactions>>({});
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [firstNew] = useState(() => readSeen(seenKey));
  const [who, setWho] = useState<{ id: number; kind: ReactionKind } | null>(null); // whose names are showing (tap a count)
  const after = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // follow new lines only while scrolled to the bottom
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
      if (stick.current) window.setTimeout(() => box.current?.scrollTo({ top: box.current.scrollHeight }), 30);
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
    setText(''); stick.current = true; await pull();
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

  return (
    <div className="bd-feed">
      <div className="bd-head"><b>{name} Board</b><span className="td-hint">Everyone holding a tag in this set. Challenges, results and explosions post here on their own.</span></div>
      <div className="bd-lines" ref={box} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
        {lines === null && <p className="td-hint">Loading…</p>}
        {lines?.length === 0 && <p className="td-hint">Quiet in here. Talk some trash, set up a round.</p>}
        {lines?.map((l, i) => {
          const r = rx[l.id];
          const mine = l.member_id === meId;
          const news = l.kind === 'system';
          const tone = news ? newsTone(l.event) : null;
          const newMark = firstNew > 0 && l.id > firstNew && (i === 0 || lines[i - 1].id <= firstNew);
          return (
            <div key={l.id}>
              {newMark && <div className="bd-new"><span>NEW</span></div>}
              <article className={`bd-line${news ? ` is-news t-${tone!.tone}` : ''}${mine ? ' is-mine' : ''}`}>
                <header>
                  {news ? <b className="bd-tag">{tone!.label}</b>
                    : <b>{l.name ? display({ name: l.name, nickname: l.nickname }) : 'Former member'}{l.number ? <span> #{l.number}</span> : null}</b>}
                  <time>{new Date(l.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</time>
                </header>
                <p>{l.body}</p>
                <div className="bd-rx">
                  {REACTIONS.map((x) => {
                    const n = r?.counts[x.kind] ?? 0;
                    const on = r?.mine.includes(x.kind) ?? false;
                    const showing = who?.id === l.id && who.kind === x.kind;
                    return (
                      <span key={x.kind} className={`bd-rxw${on ? ' on' : ''}${n ? ' has' : ''}`}>
                        <button type="button" className="bd-rxb" aria-pressed={on} aria-label={on ? `Remove ${x.label}` : x.label} title={x.label}
                          onClick={() => void react(l.id, x.kind)}><ReactionIcon kind={x.kind} /></button>
                        {n > 0 && <button type="button" className={`bd-rxn${showing ? ' open' : ''}`} aria-expanded={showing} aria-label={`${n} ${x.label}: who?`}
                          onClick={() => setWho(showing ? null : { id: l.id, kind: x.kind })}>{n}</button>}
                      </span>
                    );
                  })}
                </div>
                {who?.id === l.id && (r?.who?.[who.kind]?.length ?? 0) > 0 && (
                  <p className="bd-who" role="status"><ReactionIcon kind={who.kind} /> {whoLine(r!.who![who.kind]!)}</p>
                )}
              </article>
            </div>
          );
        })}
      </div>
      <form className="bd-send" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <input className="td-input" value={text} maxLength={500} placeholder="Say something…" onChange={(e) => setText(e.target.value)} aria-label="Message" />
        <button className="td-btn cta" type="submit" disabled={busy || !text.trim()}>SEND</button>
      </form>
      {err && <div className="td-warn" role="alert">{err} <button className="td-btn quiet" onClick={() => setErr('')}>OK</button></div>}
    </div>
  );
}
