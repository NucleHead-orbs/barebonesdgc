/** BAG TAGS > ROUNDS: every upcoming tag round in this set (challenge + casual), who's on it, ADD / REMOVE. Rules: migration 20261115. */
import { useCallback, useEffect, useState } from 'react';
import * as tagApi from '../../lib/tags/api';
import { CARD_MAX, slotLabel } from '../../lib/tags/board';
import { display, tagMessage, type Tag, type TagPool } from '../../lib/tags/tags';
import { addable, cardCount, cardFull, onCard, removable, ROLE_LABEL, roundState, tdRoundMessage, type TdRound, type TdRoundPlayer } from '../../lib/tags/tdRounds';

type Names = Record<string, { name: string; nickname: string | null }>;
const msg = (e: unknown) => tdRoundMessage(e) ?? tagMessage(e);

export default function RoundsBox({ pool, held, names }: { pool: TagPool; held: Tag[]; names: Names }) {
  const [rounds, setRounds] = useState<TdRound[] | null>(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState('');
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    const r = await tagApi.tdRounds(pool.id);
    if (r.error) return setErr(msg(r.error));
    setRounds(r.data!); setNow(Date.now()); setErr('');
  }, [pool.id]);
  useEffect(() => { void (async () => { await load(); })(); }, [load]);
  useEffect(() => { if (!ok) return; const t = setTimeout(() => setOk(''), 4000); return () => clearTimeout(t); }, [ok]);

  const run = async (key: string, p: Promise<{ error?: unknown }>, done: string) => {
    setBusy(key);
    const r = await p;
    setBusy('');
    if (r.error) { setErr(msg(r.error)); return; }
    setErr(''); setOk(done);
    await load();
  };
  const add = (r: TdRound, memberId: string) =>
    run(`${r.id}:add`, tagApi.tdRoundAdd(r.kind, r.id, memberId), `${names[memberId] ? display(names[memberId]) : 'Player'} is on ${r.title}. Posted to the Board.`);
  const remove = (r: TdRound, p: TdRoundPlayer) => {
    if (!window.confirm(`Take ${display(p)} off ${r.title}? It posts to the Board.`)) return;
    void run(`${r.id}:${p.id}`, tagApi.tdRoundRemove(r.kind, r.id, p.id), `${display(p)} is off ${r.title}.`);
  };

  return (
    <section className="td-panel">
      <div className="td-row">
        <h2 style={{ margin: 0 }}>Rounds</h2>
        <div style={{ flex: 1 }} />
        <button className="td-btn quiet" onClick={() => void load()}>REFRESH</button>
      </div>
      <p className="td-hint">Every challenge and casual round coming up in {pool.name} (and ones being played right now). ADD and REMOVE work any time, even after jump-ins close or past tee. Cards hold {CARD_MAX}. Every change posts to the Board and pings the player.</p>
      {ok && <div className="td-ok" role="status">{ok}</div>}
      {err && <div className="td-warn" role="alert">{err}</div>}
      {rounds && !rounds.length && <p className="td-hint">No rounds coming up.</p>}
      {rounds?.map((r) => <RoundCard key={`${r.kind}-${r.id}`} r={r} now={now} held={held} names={names} busy={busy} onAdd={add} onRemove={remove} />)}
    </section>
  );
}

function RoundCard({ r, now, held, names, busy, onAdd, onRemove }: {
  r: TdRound; now: number; held: Tag[]; names: Names; busy: string;
  onAdd: (r: TdRound, id: string) => Promise<void>; onRemove: (r: TdRound, p: TdRoundPlayer) => void;
}) {
  const [pick, setPick] = useState('');
  const options = addable(r, held, names);
  const full = cardFull(r);
  const playing = r.players.filter(onCard);
  const waiting = r.players.filter((p) => !onCard(p));
  return (
    <article className="tp-round">
      <div className="td-row">
        <b>{roundState(r, now)}</b>
        <span><b>{r.title}</b></span>
        <span className="td-hint">{r.tee_at ? slotLabel(r.tee_at, r.course) : 'No time picked yet'}</span>
        <div style={{ flex: 1 }} />
        <span className="td-hint">{cardCount(r)}/{CARD_MAX}</span>
      </div>
      {r.note && <div className="td-hint">"{r.note}"</div>}
      <table className="tp-table">
        <tbody>
          {[...playing, ...waiting].map((p) => (
            <tr key={p.id} style={onCard(p) ? undefined : { opacity: .55 }}>
              <td>{p.number ? `#${p.number} ` : ''}{display(p)}</td>
              <td className="td-hint">{ROLE_LABEL[p.role]}</td>
              <td className="tp-num">
                {removable(p) && <button className="td-btn quiet" disabled={!!busy} onClick={() => onRemove(r, p)}>{busy === `${r.id}:${p.id}` ? '…' : 'REMOVE'}</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="td-row">
        <select className="td-select" value={pick} onChange={(e) => setPick(e.target.value)} disabled={full || !options.length} aria-label={`Add a player to ${r.title}`}>
          <option value="">{full ? `Card's full (${CARD_MAX})` : options.length ? 'Add a player…' : 'Everyone in the set is on it'}</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <button className="td-btn cta" disabled={!pick || full || !!busy} onClick={() => { const id = pick; setPick(''); void onAdd(r, id); }}>
          {busy === `${r.id}:add` ? 'ADDING…' : 'ADD PLAYER'}
        </button>
      </div>
    </article>
  );
}
