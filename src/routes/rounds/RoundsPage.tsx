/**
 * /rounds (Boner Rounds) and /rounds/:id. Public list of saved casual rounds. On a round, a member on it
 * (recognized by the My Tag link this phone remembers) can confirm/dispute, put tags on the line, or void their own.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import * as api from '../../lib/rounds/api';
import type { Round, RoundMe } from '../../lib/rounds/api';
import { ME_KEY, confirmState, fmtToPar, roundMessage, toParClass } from '../../lib/rounds/rounds';
import { niceDate } from '../../lib/leagues/leagues';
import { Banner, Button, SectionHeading } from '../../components/ui';
import { RoundsLive } from './LiveRounds';
import { supabase } from '../../lib/supabase';
import './rounds.css';

const readMe = () => { try { return localStorage.getItem(ME_KEY); } catch { return null; } };

function useMe() {
  const [me, setMe] = useState<RoundMe | null>(null);
  const token = readMe();
  const load = useCallback(async () => {
    if (!token) return;
    const r = await api.roundMe(token);
    if (r.data) setMe(r.data);
  }, [token]);
  useEffect(() => { void (async () => { await load(); })(); }, [load]);
  return { me, token, reload: load };
}

export function RoundsList() {
  const [rounds, setRounds] = useState<Round[] | null>(null);
  const [err, setErr] = useState('');
  const { me } = useMe();
  useEffect(() => {
    void (async () => {
      const r = await api.loadRounds(40);
      if (r.error || !r.data) setErr(roundMessage(r.error)); else setRounds(r.data);
    })();
  }, []);
  return (
    <section className="sec">
      <div className="sec-inner br">
        <SectionHeading kicker="Casual rounds, kept honest" title="Boner Rounds" size="l" as="h1" />
        <div className="row">
          <Button to="/scorecard" size="lg">Open the scorecard</Button>
          <Button to="/tags" variant="outline">Tag boards</Button>
        </div>
        <p className="lead">Keep score on the scorecard, save it here with your My Tag link, and put your tags on the line if you want. Everyone on the round confirms from their own link.</p>
      </div>
      <RoundsLive />
      <div className="sec-inner br">
        {me && me.to_confirm.length > 0 && <Banner tone="warn">{me.to_confirm.length} round{me.to_confirm.length === 1 ? '' : 's'} waiting on your OK below.</Banner>}
        {err && <Banner tone="error">{err}</Banner>}
        {!rounds && !err && <p className="br-empty">Loading…</p>}
        {rounds && !rounds.length && <p className="br-empty">No rounds yet. Go play one.</p>}
        <div className="br-list">
          {rounds?.map((r) => <RoundCard key={r.id} r={r} meId={me?.me.id ?? null} link />)}
        </div>
      </div>
    </section>
  );
}

function RoundCard({ r, meId, link }: { r: Round; meId: string | null; link?: boolean }) {
  const cs = confirmState(r.players);
  const par = r.pars.reduce((a, b) => a + b, 0);
  const best = Math.min(...r.players.filter((p) => p.dnf_after == null).map((p) => p.strokes));
  const head = (
    <div className="br-head">
      <b>{r.course}</b>
      <span>{niceDate(r.played_on)} · {r.pars.length} holes · par {par}</span>
    </div>
  );
  return (
    <article className="br-card">
      {link ? <Link to={`/rounds/${r.id}`} className="br-headlink">{head}</Link> : head}
      <ol className="br-players">
        {r.players.map((p) => (
          <li key={p.seq} className={`${p.strokes === best ? 'is-win' : ''}${p.member_id && p.member_id === meId ? ' is-me' : ''}`}>
            <span className="br-name">{p.name}{p.nickname ? <small> “{p.nickname}”</small> : null}{!p.member_id && <small> guest</small>}</span>
            <span className="br-mark" aria-label={p.member_id ? (p.confirmed ? 'confirmed' : p.disputed ? 'disputed' : 'not confirmed yet') : undefined}>
              {p.member_id ? (p.confirmed ? '✓' : p.disputed ? '✗' : '…') : ''}</span>
            {p.dnf_after != null ? <span className="br-tp" title={`Pulled out after ${p.dnf_after}`}>DNF {p.dnf_after}</span> : <span className={`br-tp ${toParClass(p.to_par)}`}>{fmtToPar(p.to_par)}</span>}
            <span className="br-str">{p.strokes}</span>
          </li>
        ))}
      </ol>
      <div className="br-foot">
        <span className={`br-chip ${cs.kind}`}>{cs.kind === 'confirmed' ? 'Confirmed' : cs.kind === 'disputed' ? 'Disputed' : `Waiting on ${cs.waiting.join(', ')}`}</span>
        {r.exchanges.map((x) => (
          <span key={x.id} className={`br-chip tag ${x.status}`}>{x.pool_name}: {x.status === 'applied' ? 'tags swapped' : x.status === 'disputed' ? 'tag swap disputed' : `tags on the line (${x.waiting_on} to confirm)`}</span>
        ))}
        {r.totals_only && <span className="br-chip">Totals only</span>}
      </div>
    </article>
  );
}

export function RoundDetail() {
  const { id = '' } = useParams();
  const [qs] = useSearchParams();
  const [r, setR] = useState<Round | null | undefined>(undefined);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(qs.get('saved') ? 'Saved. It\'s on Boner Rounds now.' : '');
  const [busy, setBusy] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const { me, token, reload } = useMe();

  const load = useCallback(async () => {
    const x = await api.loadRound(id);
    if (x.error) return setErr(roundMessage(x.error));
    setR(x.data ?? null);
  }, [id]);
  useEffect(() => { void (async () => { await load(); })(); }, [load]);

  const run = async (p: Promise<{ error?: unknown }>, msg: string) => {
    setBusy(true);
    const x = await p;
    setBusy(false);
    if (x.error) { setErr(roundMessage(x.error)); return false; }
    setErr(''); setOk(msg);
    await Promise.all([load(), reload()]);
    return true;
  };

  if (r === undefined) return <section className="sec"><div className="sec-inner br"><p className="br-empty">{err || 'Loading…'}</p></div></section>;
  if (r === null) return <section className="sec"><div className="sec-inner br"><Banner tone="warn">That round isn't here. It may have been voided.</Banner><Button to="/rounds">All rounds</Button></div></section>;

  const meId = me?.me.id ?? null;
  const mine = r.players.find((p) => p.member_id && p.member_id === meId) ?? null;
  const nameOf = (mid: string) => r.players.find((p) => p.member_id === mid)?.name ?? '?';

  return (
    <section className="sec">
      <div className="sec-inner br">
        <Link to="/rounds" className="br-back">‹ Boner Rounds</Link>
        {ok && <Banner tone="success">{ok}</Banner>}
        {err && <Banner tone="error">{err}</Banner>}
        <RoundCard r={r} meId={meId} />

        {r.players[0]?.scores && (
          <div className="br-tablewrap">
            <table className="sc-table">
              <tbody>
                <tr><th>Hole</th>{r.pars.map((_, i) => <th key={i}>{r.hole_labels?.[i] ?? i + 1}</th>)}<th>Tot</th></tr>
                <tr><th>Par</th>{r.pars.map((p, i) => <td key={i}>{p}</td>)}<td>{r.pars.reduce((a, b) => a + b, 0)}</td></tr>
                {r.players.map((p) => (
                  <tr key={p.seq}><th>{p.name}</th>{r.pars.map((pp, i) => { const s = p.scores?.[i]; return <td key={i} className={s == null ? '' : toParClass(s - pp)}>{s ?? ''}</td>; })}<td><b>{p.strokes}</b></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {r.note && <p className="br-note">{r.note}</p>}

        <VouchBox roundId={r.id} onDone={async (msg) => { setOk(msg); setErr(''); await load(); }} onErr={setErr} />

        {r.exchanges.filter((x) => x.status === 'applied' && x.moves).map((x) => (
          <div key={x.id} className="br-panel">
            <b>{x.pool_name}</b>
            <ul className="br-moves">{x.moves!.map((m) => <li key={m.member_id}>{nameOf(m.member_id)}: {m.tag_before === m.tag_after ? `keeps #${m.tag_after}` : `#${m.tag_before} → #${m.tag_after}`}</li>)}</ul>
            <Link to={`/tags/${x.pool}`}>See the {x.pool_name} board ›</Link>
          </div>
        ))}

        {mine && !mine.confirmed && !mine.disputed && (
          <div className="br-panel">
            <b>Is this right?</b>
            <p>Check your score. Confirm if it's right{r.exchanges.some((x) => x.status === 'pending') ? '. That also confirms the tag swap waiting on this round' : ''}. Wrong? Dispute it and the saver or a league TD sorts it out.</p>
            <div className="row">
              <button className="br-btn cta" disabled={busy} onClick={() => void run(api.confirmRound(token!, r.id, true), 'Confirmed.')}>Confirm</button>
              <button className="br-btn" disabled={busy} onClick={() => void run(api.confirmRound(token!, r.id, false), 'Disputed.')}>Dispute</button>
            </div>
          </div>
        )}

        {mine && r.created_by === meId && !r.exchanges.some((x) => x.status === 'applied') && (
          <div className="row">
            {voiding
              ? <><span className="br-danger">Void this round? It leaves Boner Rounds and any tags waiting on it come off the line.</span>
                  <button className="br-btn danger" disabled={busy} onClick={() => void run(api.voidRound(token!, r.id), 'Voided.').then((x) => { if (x) setR(null); })}>Void it</button>
                  <button className="br-btn" onClick={() => setVoiding(false)}>Keep it</button></>
              : <button className="br-link" onClick={() => setVoiding(true)}>Void this round</button>}
          </div>
        )}
        {!me && <p className="br-hint">On this round? Open your My Tag link on this phone once, then come back here to confirm.</p>}
      </div>
    </section>
  );
}

/**
 * Signed-in league admins only (td_round_vouch_options decides): put a saved round's tags on the line past the rules
 * (2-player Early Access, after the tee-off lock). Everyone on it still confirms on My Tag.
 */
function VouchBox({ roundId, onDone, onErr }: { roundId: string; onDone: (msg: string) => Promise<void>; onErr: (m: string) => void }) {
  const [opts, setOpts] = useState<api.VouchOption[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
      const r = await api.vouchOptions(roundId);
      if (live && r.data) setOpts(r.data);
    })();
    return () => { live = false; };
  }, [roundId]);
  if (!opts.length) return null;
  return (
    <div className="br-panel br-vouch">
      <b>League admin: put tags on the line</b>
      <p>You know everyone on this card, so you can vouch for it even though it skipped the tags (2-player Early Access, or tags picked after tee-off). Everyone with a tag on it confirms on My Tag and the tags swap, same as always.</p>
      {opts.map((o) => (
        <div key={o.pool_id} className="row">
          <span><b>{o.name}</b>: {o.holders.map((h) => `${h.nickname || h.name} #${h.number}`).join(', ')}</span>
          <button className="br-btn cta" disabled={busy} onClick={() => {
            if (!window.confirm(`Put ${o.name} tags on the line for this round? Everyone on it confirms on My Tag, then the tags swap.`)) return;
            setBusy(true);
            void api.vouch(roundId, o.pool_id).then(async (r) => {
              setBusy(false);
              if (r.error) return onErr(roundMessage(r.error));
              setOpts((x) => x.filter((y) => y.pool_id !== o.pool_id));
              await onDone(`${o.name} tags are on the line. Everyone on it confirms on My Tag.`);
            });
          }}>VOUCH: TAGS ON THE LINE</button>
        </div>
      ))}
    </div>
  );
}
