import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import * as tagApi from '../../lib/tags/api';
import type { AdminMember, Match } from '../../lib/tags/api';
import * as tdApi from '../../lib/td/api';
import { loadBoard as loadLeaderboard } from '../../lib/jewel/api';
import { standings } from '../../lib/prizes/payout';
import type { EventConfig } from '../../lib/td/setup';
import { display, matchMembers, myTagUrl, parseScore, swap, tagMessage, tagPageUrl, tagSources, type Tag, type TagPool, type TagSource } from '../../lib/tags/tags';
import { onlyRound, type LbRow } from '../../lib/jewel/leaderboard';
import { localDate, niceDate } from '../../lib/leagues/leagues';
import RoomBox from './RoomBox';
import './tags-panel.css';

/**
 * Bag tags admin (league TDs for their pool; super admin for all). Issue tags, hand out My Tag links,
 * settle rounds, record league nights from the scorecard, undo the last round.
 */
export default function TagsPanel({ admin, onBack }: { admin: boolean; onBack: () => void }) {
  const [pools, setPools] = useState<TagPool[] | null>(null);
  const [poolId, setPoolId] = useState('');
  const [tags, setTags] = useState<Tag[]>([]);
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const pool = pools?.find((p) => p.id === poolId) ?? null;

  useEffect(() => { void (async () => {
    const r = await tagApi.myPools();
    if (r.error) return setErr(tagMessage(r.error));
    setPools(r.data!); if (r.data!.length) setPoolId(r.data![0].id);
  })(); }, []);

  const reload = useCallback(async () => {
    if (!pool) return;
    const [t, m, x] = await Promise.all([tagApi.poolTags(pool.id), tagApi.adminMembers(), tagApi.adminMatches(pool)]);
    const e = t.error ?? m.error ?? x.error;
    if (e) return setErr(tagMessage(e));
    setTags(t.data!); setMembers(m.data!); setMatches(x.data!);
  }, [pool]);
  useEffect(() => { void (async () => { await reload(); })(); }, [reload]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t); }, [toast]);

  const act = useCallback(async (p: Promise<{ error?: unknown }>, ok?: string) => {
    const r = await p;
    if (r.error) { setErr(tagMessage(r.error)); return false; }
    setErr(''); if (ok) setToast(ok);
    await reload();
    return true;
  }, [reload]);

  const byId = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m])), [members]);
  const held = tags.filter((t) => t.status === 'held');
  const open = matches.filter((m) => m.status === 'pending' || m.status === 'disputed');
  const ctx: Ctx = { pool: pool!, tags, held, members, byId, act, setToast, setErr };

  return (
    <div className="td-main">
      <div className="td-row">
        <button className="td-btn" onClick={onBack}>‹ BACK TO EVENTS</button>
        <div className="td-title">Bag Tags</div>
        {pool && <>
          <div className="td-stat"><b>{held.length}</b><span>TAGS OUT</span></div>
          <div className="td-stat"><b style={{ color: open.length ? 'var(--gold)' : '#fff' }}>{open.length}</b><span>ROUNDS OPEN</span></div>
        </>}
        <div style={{ flex: 1 }} />
        {pool && <a className="td-btn cyan" href={`/tags/${pool.slug}`} target="_blank" rel="noreferrer">VIEW BOARD</a>}
      </div>
      {pools && pools.length > 1 && (
        <div className="td-chips" role="group" aria-label="League">
          {pools.map((p) => <button key={p.id} className="td-chip" aria-pressed={p.id === poolId} onClick={() => setPoolId(p.id)}>{p.name}</button>)}
        </div>
      )}
      {toast && <div className="td-ok" role="status">{toast}</div>}
      {err && <div className="td-warn" role="alert">⚠ {err} <button className="td-btn quiet" onClick={() => setErr('')}>OK</button></div>}
      {pools && !pools.length && <div className="td-warn soft">This account doesn't run any league's tags yet. Ask the super admin to add your email to a league.</div>}
      {pool && (
        <>
          <div className="td-hint">One numbered set per league. Best score on a round takes the lowest number on it; ties keep their order. Players log casual rounds from their <b>My Tag</b> link and confirm each other; league nights you record here from the scorecard.</div>
          {open.length > 0 && <OpenRounds rounds={open} act={act} />}
          <RoomBox key={pool.id} pool={pool} members={members} held={held} onTags={reload} />
          <IssueTag {...ctx} />
          <TagList {...ctx} />
          <RecordRound {...ctx} />
          <History matches={matches.filter((m) => m.status === 'applied').slice(0, 10)} act={act} poolId={pool.id} />
          <People {...ctx} />
          {admin && <PoolAdmins poolId={pool.id} poolName={pool.name} />}
        </>
      )}
    </div>
  );
}

type Act = (p: Promise<{ error?: unknown }>, ok?: string) => Promise<boolean>;
interface Ctx {
  pool: TagPool; tags: Tag[]; held: Tag[]; members: AdminMember[]; byId: Record<string, AdminMember>;
  act: Act; setToast: (s: string) => void; setErr: (s: string) => void;
}

function RoundTable({ m }: { m: Match }) {
  return (
    <table className="tp-table">
      <tbody>
        {m.players.map((p) => {
          const after = m.status === 'applied' ? p.tag_after : null;
          return (
            <tr key={p.member_id}>
              <td>{p.name}{m.status !== 'applied' ? (p.confirmed ? ' ✓' : p.disputed ? ' ✗ disputed' : ' · waiting') : ''}</td>
              <td className="tp-num">{p.score}</td>
              <td className="tp-num">{m.status === 'applied' ? (p.tag_before === null ? '–' : p.tag_before === after ? `#${after}` : `#${p.tag_before} → #${after}`) : ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function OpenRounds({ rounds, act }: { rounds: Match[]; act: Act }) {
  return (
    <section className="td-panel">
      <h2>Rounds waiting</h2>
      <div className="td-hint">Players confirm their own rounds. Step in when one is <b>disputed</b> or stuck. APPLY swaps the tags they hold right now; VOID drops it.</div>
      {rounds.map((m) => (
        <article key={m.id} className={`tp-round${m.status === 'disputed' ? ' is-bad' : ''}`}>
          <div className="td-row"><b>{m.status === 'disputed' ? 'DISPUTED' : m.expired ? 'EXPIRED' : 'PENDING'}</b>
            <span className="td-hint">{[niceDate(m.played_on), m.course].filter(Boolean).join(' · ')}</span></div>
          <RoundTable m={m} />
          <div className="td-row">
            <button className="td-btn cta" onClick={() => void act(tagApi.resolve(m.id, true), 'Applied. Tags swapped.')}>APPLY</button>
            <button className="td-btn quiet" onClick={() => void act(tagApi.resolve(m.id, false), 'Voided.')}>VOID</button>
          </div>
        </article>
      ))}
    </section>
  );
}

function LinkBox({ m, onDone }: { m: AdminMember; onDone?: () => void }) {
  const url = myTagUrl(window.location.origin, m.token);
  const [qr, setQr] = useState('');
  useEffect(() => { void QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(setQr); }, [url]);
  const copy = async () => { try { await navigator.clipboard.writeText(url); } catch { window.prompt(`Copy ${m.name}'s link:`, url); } };
  return (
    <div className="tp-link">
      <div className="td-crew-qr" dangerouslySetInnerHTML={{ __html: qr }} aria-label={`QR code for ${m.name}'s My Tag link`} />
      <div className="tp-link-body">
        <b>{m.name}'s My Tag link</b>
        <span className="td-hint">Have them scan it and save it to their home screen. It's private: whoever has it can log and confirm rounds as them.</span>
        <code className="tp-url">{url}</code>
        <div className="td-row">
          <button className="td-btn cyan" onClick={() => void copy()}>COPY LINK</button>
          {onDone && <button className="td-btn quiet" onClick={onDone}>DONE</button>}
        </div>
      </div>
    </div>
  );
}

function IssueTag({ pool, held, tags, members, byId, act }: Ctx) {
  const [name, setName] = useState('');
  const [nick, setNick] = useState('');
  const [num, setNum] = useState('');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const existing = members.find((m) => m.name.trim().toLowerCase() === name.trim().toLowerCase()) ?? null;
  const hasTag = existing && held.some((t) => t.holder_id === existing.id);
  const next = (tags.reduce((a, t) => Math.max(a, t.number), 0) || 0) + 1;
  const free = tags.filter((t) => t.status !== 'held').map((t) => t.number);
  const n = num.trim() ? Number(num) : null;
  const go = async () => {
    setBusy(true);
    const r = await tagApi.issue(pool.id, existing ? { member: existing.id, number: n } : { name, nickname: nick, number: n });
    setBusy(false);
    if (r.error) return void act(Promise.resolve(r));
    await act(Promise.resolve({}), `Tag #${r.data!.number} issued to ${existing?.name ?? name.trim()}.`);
    setShown(r.data!.member_id); setName(''); setNick(''); setNum('');
  };
  const who = shown ? byId[shown] : null;
  return (
    <section className="td-panel">
      <h2>Issue a tag</h2>
      <div className="td-hint">Collect the buy-in first. New tags go to the bottom (next is <b>#{next}</b>). Type a number only to hand back a freed tag{free.length ? ` (free: ${free.map((f) => `#${f}`).join(', ')})` : ''}, or to load someone's existing physical tag.</div>
      <div className="td-row">
        <input className="td-input" list="tp-people" style={{ flex: 2, minWidth: 180 }} placeholder="Player name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <datalist id="tp-people">{members.map((m) => <option key={m.id} value={m.name} />)}</datalist>
        {!existing && <input className="td-input" style={{ flex: 1, minWidth: 120 }} placeholder="Nickname (optional)" value={nick} maxLength={40} onChange={(e) => setNick(e.target.value)} />}
        <input className="td-input" style={{ width: 100 }} inputMode="numeric" placeholder={`#${next}`} aria-label="Tag number (blank = next)" value={num} onChange={(e) => setNum(e.target.value.replace(/[^0-9]/g, ''))} />
        <button className="td-btn cta" disabled={!name.trim() || busy || !!hasTag} onClick={() => void go()}>ISSUE TAG</button>
      </div>
      {existing && <div className="td-hint">{hasTag ? `${existing.name} already has a tag in ${pool.name}.` : `${existing.name} is already in the roster (other league). Same person, new tag here.`}</div>}
      {who && <LinkBox m={who} onDone={() => setShown(null)} />}
    </section>
  );
}

function TagList({ pool, tags, byId, act }: Ctx) {
  const [link, setLink] = useState<string | null>(null);
  const [sure, setSure] = useState<string | null>(null);
  const out = tags.filter((t) => t.status === 'held');
  const off = tags.filter((t) => t.status !== 'held');
  return (
    <section className="td-panel">
      <h2>{pool.name} tags</h2>
      {!out.length && <div className="td-empty">No tags out yet. Issue the first one above.</div>}
      <div className="tp-tags">
        {out.map((t) => {
          const m = t.holder_id ? byId[t.holder_id] : null;
          const k = `${t.number}`;
          return (
            <div key={t.number} className="tp-tag">
              <span className="tp-tag-num">#{t.number}</span>
              <span className="tp-tag-who"><b>{m ? display(m) : '?'}</b>
                <span className="td-hint">{m?.last_seen_at ? `Opened My Tag ${niceDate(m.last_seen_at.slice(0, 10))}` : 'Never opened My Tag'}{t.moves ? ` · moved ${t.moves}×` : ''}</span></span>
              <div className="td-row tp-tag-actions">
                {m && <button className="td-btn quiet" onClick={() => setLink(link === m.id ? null : m.id)}>{link === m.id ? 'HIDE LINK' : 'MY TAG LINK'}</button>}
                <a className="td-btn quiet" href={tagPageUrl(window.location.origin, pool.slug, t.number)} target="_blank" rel="noreferrer">TAG PAGE</a>
                {sure === k ? (
                  <>
                    <button className="td-btn quiet" onClick={() => { setSure(null); void act(tagApi.release(pool.id, t.number, false), `#${t.number} is free.`); }}>FREE IT</button>
                    <button className="td-btn quiet" onClick={() => { setSure(null); void act(tagApi.release(pool.id, t.number, true), `#${t.number} retired.`); }}>RETIRE IT</button>
                    <button className="td-btn quiet" onClick={() => setSure(null)}>KEEP</button>
                  </>
                ) : <button className="td-btn quiet" onClick={() => setSure(k)}>TAKE BACK</button>}
              </div>
              {m && link === m.id && <LinkBox m={m} />}
            </div>
          );
        })}
      </div>
      {off.length > 0 && <div className="td-hint">Not in play: {off.map((t) => `#${t.number} (${t.status})`).join(', ')}. Issue one by typing its number above.</div>}
    </section>
  );
}

interface Row { key: string; name: string; score: number | null; member_id: string | null }

function RecordRound({ pool, held, members, act }: Ctx) {
  const [mode, setMode] = useState<'event' | 'hand'>('event');
  const [events, setEvents] = useState<EventConfig[]>([]);
  const [eventId, setEventId] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [left, setLeft] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [course, setCourse] = useState('');
  const [day, setDay] = useState(localDate());
  const [busy, setBusy] = useState(false);
  const [src, setSrc] = useState<TagSource | null>(null);
  const [loaded, setLoaded] = useState<{ ev: EventConfig; board: LbRow[]; status: Parameters<typeof standings>[2] } | null>(null);
  // other tag sets on the same card (e.g. Golden Boners): proposed from these results, pending until their holders confirm
  const [others, setOthers] = useState<Array<{ pool: TagPool; tags: Tag[] }>>([]);
  const [propose, setPropose] = useState<string[]>([]);
  useEffect(() => { void (async () => {
    const ps = await tagApi.loadPools();
    if (!ps.data) return;
    const rest = ps.data.filter((p) => p.id !== pool.id);
    const ts = await Promise.all(rest.map((p) => tagApi.poolTags(p.id)));
    setOthers(rest.map((p, i) => ({ pool: p, tags: (ts[i].data ?? []).filter((t) => t.status === 'held') })));
  })(); }, [pool.id]);
  const tagOf = useCallback((id: string | null) => (id ? held.find((t) => t.holder_id === id)?.number ?? null : null), [held]);

  useEffect(() => { void (async () => {
    const r = await tdApi.myEvents();
    if (r.data) setEvents(r.data.filter((e) => !e.archived).sort((a, b) => b.starts_on.localeCompare(a.starts_on)));
  })(); }, []);

  const loadEvent = async (id: string) => {
    setEventId(id); setRows([]); setLeft([]);
    const ev = events.find((e) => e.id === id);
    if (!ev) return;
    setLoading(true);
    try {
      const [board, pl] = await Promise.all([loadLeaderboard(id), tdApi.loadPlayers(id)]);
      if (pl.error) throw pl.error;
      const status = Object.fromEntries((pl.data ?? []).filter((p) => p.finish_status).map((p) => [p.id, p.finish_status!]));
      const first = tagSources(ev).dflt;
      setLoaded({ ev, board, status }); setSrc(first);
      fill(board, ev, status, first);
      setDay(ev.starts_on);
    } catch (e) { act(Promise.resolve({ error: e })); }
    setLoading(false);
  };

  // Tags record from singles rounds only (a Pop Up's dubs round never moves tags).
  function fill(board: LbRow[], ev: EventConfig, status: Parameters<typeof standings>[2], from: TagSource | null) {
    if (from === null) { setRows([]); setLeft([]); return; }
    const st = from === 'total' ? standings(board, ev.rounds === 2 ? 2 : 1, status, 'official') : standings(onlyRound(board, from), 1, status, 'official');
    const matched = matchMembers(st.ranked.map((f) => ({ key: f.id, name: f.name, score: f.total })), members);
    setRows(matched.map((r) => ({ key: r.key, name: r.name, score: r.score, member_id: r.member_id })));
    setLeft([...st.unfinished.map((u) => u.name), ...st.out.map((o) => `${o.name} (${o.status.toUpperCase()})`)]);
  }
  const srcOpts = loaded ? tagSources(loaded.ev) : null;

  const holders = rows.filter((r) => r.member_id && tagOf(r.member_id) !== null && r.score !== null);
  const pv = swap(holders.map((r) => ({ id: r.member_id!, score: r.score!, tag: tagOf(r.member_id) })));
  const pvById = new Map(pv.map((p) => [p.id, p]));
  const dup = new Set(holders.map((r) => r.member_id).filter((id, i, a) => a.indexOf(id) !== i));

  const otherSets = mode === 'event' ? others.map((o) => ({ ...o, rows: rows.filter((r) => r.member_id && r.score !== null && o.tags.some((t) => t.holder_id === r.member_id)) }))
    .filter((o) => o.rows.length >= 2) : [];
  const chosen = otherSets.filter((o) => propose.includes(o.pool.id));

  const submit = async () => {
    setBusy(true);
    const notes: string[] = [];
    let ok = true;
    if (holders.length >= 2) {
      ok = await act(tagApi.record(pool.id, mode === 'event' ? eventId : null, holders.map((r) => ({ member_id: r.member_id!, score: r.score! })), course, day),
        `Recorded. ${pv.filter((p) => p.before !== p.after).length} tags moved.`);
      if (ok) notes.push(`${pool.name}: ${pv.filter((p) => p.before !== p.after).length} tags moved`);
    }
    for (const o of chosen) {
      if (!ok) break;
      const r = await act(tagApi.propose(o.pool.id, eventId, o.rows.map((x) => ({ member_id: x.member_id!, score: x.score! })), course, day));
      if (r) notes.push(`${o.pool.name}: on the line, waiting on ${o.rows.length} holders to confirm`);
      ok = ok && r;
    }
    if (notes.length) await act(Promise.resolve({}), notes.join(' · ') + '.');
    setBusy(false);
    if (ok) { setRows([]); setEventId(''); setLeft([]); setCourse(''); setPropose([]); }
  };

  const addHand = (id: string) => { if (!id || rows.some((r) => r.member_id === id)) return; const m = members.find((x) => x.id === id)!; setRows([...rows, { key: id, name: m.name, score: null, member_id: id }]); };

  return (
    <section className="td-panel">
      <h2>Record a round</h2>
      <div className="td-chips" role="group" aria-label="Where from">
        <button className="td-chip" aria-pressed={mode === 'event'} onClick={() => { setMode('event'); setRows([]); setEventId(''); }}>FROM THE SCORECARD</button>
        <button className="td-chip" aria-pressed={mode === 'hand'} onClick={() => { setMode('hand'); setRows([]); setEventId(''); setLeft([]); }}>BY HAND</button>
      </div>
      {mode === 'event' ? (
        <>
          <div className="td-hint">Pick the league night. Everyone who finished (signed/submitted cards or paper totals) and holds a {pool.name} tag trades tags by total. Names match the tag roster automatically; fix any that didn't. Each event counts once.</div>
          <select className="td-select" value={eventId} onChange={(e) => void loadEvent(e.target.value)}>
            <option value="">Pick an event…</option>
            {events.map((e) => <option key={e.id} value={e.id}>{e.name} · {niceDate(e.starts_on)}</option>)}
          </select>
          {loaded && eventId && srcOpts && srcOpts.options.length === 0 && <div className="td-warn soft">That event has no singles round (doubles only), so it can't move tags.</div>}
          {loaded && eventId && srcOpts && srcOpts.options.length > 1 && (
            <select className="td-select" aria-label="Which round counts" value={String(src)}
              onChange={(e) => { const v = (e.target.value === 'total' ? 'total' : Number(e.target.value)) as TagSource; setSrc(v); fill(loaded.board, loaded.ev, loaded.status, v); }}>
              {srcOpts.options.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}
            </select>
          )}
          {loaded && eventId && srcOpts && srcOpts.options.length === 1 && <div className="td-hint">Counting {srcOpts.options[0][1]}. Doubles rounds never move tags.</div>}
          {loading && <div className="td-empty">Loading scores…</div>}
          {eventId && !loading && !rows.length && <div className="td-empty">Nobody has an official finished round in that event yet.</div>}
        </>
      ) : (
        <>
          <div className="td-hint">For a round someone texted in. It applies right away, no confirmations. Scores are total strokes; lower wins.</div>
          <select className="td-select" value="" onChange={(e) => addHand(e.target.value)}>
            <option value="">Add a tag holder…</option>
            {held.filter((t) => t.holder_id && !rows.some((r) => r.member_id === t.holder_id)).map((t) => {
              const m = members.find((x) => x.id === t.holder_id);
              return m ? <option key={t.number} value={m.id}>#{t.number} {m.name}</option> : null;
            })}
          </select>
          <div className="td-row">
            <input className="td-input" style={{ flex: 1, minWidth: 160 }} placeholder="Course (optional)" value={course} maxLength={80} onChange={(e) => setCourse(e.target.value)} />
            <input className="td-input" type="date" aria-label="Date played" value={day} onChange={(e) => setDay(e.target.value)} />
          </div>
        </>
      )}
      {rows.length > 0 && (
        <table className="tp-table">
          <thead><tr><th>Player</th><th>Tag holder</th><th className="tp-num">Score</th><th className="tp-num">Tag</th></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const p = r.member_id ? pvById.get(r.member_id) : null;
              return (
                <tr key={r.key} className={p ? undefined : 'is-off'}>
                  <td>{r.name}</td>
                  <td>
                    {mode === 'event' ? (
                      <select className="td-select" value={r.member_id ?? ''} aria-label={`Tag holder for ${r.name}`}
                        onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, member_id: e.target.value || null } : x)))}>
                        <option value="">Not a member</option>
                        {held.map((t) => { const m = members.find((x) => x.id === t.holder_id); return m ? <option key={t.number} value={m.id}>#{t.number} {m.name}</option> : null; })}
                        {members.filter((m) => !held.some((t) => t.holder_id === m.id)).map((m) => <option key={m.id} value={m.id}>{m.name} (no {pool.name} tag)</option>)}
                      </select>
                    ) : <button className="td-btn quiet" onClick={() => setRows(rows.filter((_, j) => j !== i))}>REMOVE</button>}
                  </td>
                  <td className="tp-num">
                    {mode === 'event' ? r.score : (
                      <input className="td-input" style={{ width: 70, textAlign: 'center' }} inputMode="numeric" aria-label={`${r.name} score`} value={r.score ?? ''}
                        onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, score: parseScore(e.target.value) } : x)))} />
                    )}
                  </td>
                  <td className="tp-num">{p ? (p.before === p.after ? `keeps #${p.after}` : `#${p.before} → #${p.after}`) : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {left.length > 0 && <div className="td-hint">Not counted (no official finish): {left.join(', ')}.</div>}
      {dup.size > 0 && <div className="td-warn">One tag holder is picked twice. Fix it before recording.</div>}
      {otherSets.length > 0 && (
        <div className="tp-others">
          <div className="td-label">OTHER TAG SETS ON THIS CARD</div>
          {otherSets.map((o) => (
            <label key={o.pool.id} className="td-inline">
              <input type="checkbox" checked={propose.includes(o.pool.id)} onChange={(e) => { const c = e.target.checked; setPropose((x) => (c ? [...x, o.pool.id] : x.filter((y) => y !== o.pool.id))); }} />
              <span><b>{o.pool.name}</b>: {o.rows.map((r) => `${r.name} #${o.tags.find((t) => t.holder_id === r.member_id)?.number}`).join(', ')}</span>
            </label>
          ))}
          <span className="td-hint">Checked sets go on the line from these scores as pending. Each holder confirms from their My Tag link, and it swaps on the last one. Each set counts once per event.</span>
        </div>
      )}
      {rows.length > 0 && (
        <div className="td-row">
          <button className="td-btn cta" disabled={(holders.length < 2 && !chosen.length) || dup.size > 0 || busy || (mode === 'event' && !eventId)} onClick={() => void submit()}>
            {holders.length >= 2 ? `RECORD · ${holders.length} TAG HOLDERS` : 'PUT ON THE LINE'}{chosen.length ? ` + ${chosen.map((o) => o.pool.name).join(' + ')}` : ''}
          </button>
          {holders.length < 2 && !chosen.length && <span className="td-hint">Needs at least 2 tag holders with scores.</span>}
        </div>
      )}
    </section>
  );
}

function History({ matches, act, poolId }: { matches: Match[]; act: Act; poolId: string }) {
  const [sure, setSure] = useState(false);
  if (!matches.length) return null;
  return (
    <section className="td-panel">
      <div className="td-row"><h2>Latest rounds</h2><div style={{ flex: 1 }} />
        {sure ? <>
          <button className="td-btn quiet" onClick={() => { setSure(false); void act(tagApi.undo(poolId), 'Last round undone. Tags are back.'); }}>YES, UNDO IT</button>
          <button className="td-btn quiet" onClick={() => setSure(false)}>KEEP</button>
        </> : <button className="td-btn quiet" onClick={() => setSure(true)}>UNDO LAST ROUND</button>}
      </div>
      {matches.map((m) => (
        <article key={m.id} className="tp-round">
          <div className="td-row"><b>{m.source === 'event' ? 'League night' : 'Tag round'}</b><span className="td-hint">{[niceDate(m.played_on), m.course].filter(Boolean).join(' · ')}</span></div>
          <RoundTable m={m} />
        </article>
      ))}
    </section>
  );
}

function People({ members, held, act }: Ctx) {
  const [openId, setOpenId] = useState<string | null>(null);
  const holders = new Set(held.map((t) => t.holder_id));
  const list = members.filter((m) => holders.has(m.id));
  if (!list.length) return null;
  return (
    <details className="td-panel">
      <summary><b>People in this league</b> · names, nicknames, links</summary>
      {list.map((m) => (
        <div key={m.id} className="tp-person">
          <input className="td-input" aria-label="Name" defaultValue={m.name} key={`n${m.id}${m.name}`} maxLength={60}
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== m.name) void act(tagApi.updateMember(m.id, v, m.nickname ?? ''), 'Saved.'); }} />
          <input className="td-input" aria-label="Nickname" placeholder="Nickname" defaultValue={m.nickname ?? ''} key={`k${m.id}${m.nickname}`} maxLength={40}
            onBlur={(e) => { const v = e.target.value.trim(); if (v !== (m.nickname ?? '')) void act(tagApi.updateMember(m.id, m.name, v), 'Saved.'); }} />
          {openId === m.id ? (
            <>
              <button className="td-btn quiet" onClick={() => { setOpenId(null); void act(tagApi.newLink(m.id), `New link for ${m.name}. The old one no longer works.`); }}>YES, NEW LINK</button>
              <button className="td-btn quiet" onClick={() => setOpenId(null)}>KEEP</button>
            </>
          ) : <button className="td-btn quiet" title="Lost phone or shared link" onClick={() => setOpenId(m.id)}>NEW LINK</button>}
        </div>
      ))}
    </details>
  );
}

function PoolAdmins({ poolId, poolName }: { poolId: string; poolName: string }) {
  const [emails, setEmails] = useState<string[]>([]);
  const [add, setAdd] = useState('');
  const [err, setErr] = useState('');
  const load = useCallback(async () => { const r = await tagApi.poolAdmins(poolId); if (r.data) setEmails(r.data); }, [poolId]);
  useEffect(() => { void (async () => { await load(); })(); }, [load]);
  const run = async (p: Promise<{ error?: unknown }>) => { const r = await p; if (r.error) setErr(tagMessage(r.error)); else { setErr(''); setAdd(''); await load(); } };
  return (
    <details className="td-panel">
      <summary><b>Who runs {poolName} tags</b> · super admin only</summary>
      <div className="td-hint">These emails (once confirmed) can issue tags, settle rounds and record league nights for {poolName}. To record a league night they also need to be a TD of that event.</div>
      {err && <div className="td-warn">{err}</div>}
      {emails.map((e) => (
        <div key={e} className="td-row"><span style={{ flex: 1 }}>{e}</span><button className="td-btn quiet" onClick={() => void run(tagApi.removePoolAdmin(poolId, e))}>REMOVE</button></div>
      ))}
      <div className="td-row">
        <input className="td-input" style={{ flex: 1 }} type="email" placeholder="league TD email" value={add} onChange={(e) => setAdd(e.target.value)} />
        <button className="td-btn cta" disabled={!/^\S+@\S+\.\S+$/.test(add.trim())} onClick={() => void run(tagApi.addPoolAdmin(poolId, add))}>ADD</button>
      </div>
    </details>
  );
}
