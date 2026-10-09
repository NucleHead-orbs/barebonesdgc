/** My Tag → MY ROUNDS: my Scorecard cards (full hole-by-hole card, tap to open) and tag rounds. Rules: migration 20261117. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as tagApi from '../../lib/tags/api';
import * as roundsApi from '../../lib/rounds/api';
import { holeCounts, myPlace, ordinal, tagMove, type MyCardRound, type MyRound, type MyTagRound } from '../../lib/tags/myRounds';
import { fmtToPar, toParClass } from '../../lib/rounds/rounds';
import { niceDate } from '../../lib/leagues/leagues';
import { display, tagMessage } from '../../lib/tags/tags';

type Act = (p: Promise<{ error?: unknown }>, ok?: string) => Promise<boolean>;
/** A Scorecard card I'm on that I haven't confirmed (or disputed) yet. */
const waitsOnMe = (r: MyRound, meId: string) => r.kind === 'card' && r.players.some((p) => p.member_id === meId && !p.confirmed && !p.disputed);

export function MyRounds({ token, meId, rev, act, focus }: { token: string; meId: string; rev: number; act: Act; focus?: string | null }) {
  const [rounds, setRounds] = useState<MyRound[] | null>(null);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(focus ? `card-${focus}` : null);

  const load = useCallback(async (offset: number) => {
    setBusy(true);
    const r = await tagApi.myRounds(token, offset);
    setBusy(false);
    if (r.error) return setErr(tagMessage(r.error));
    setErr(''); setMore(r.data!.more);
    setRounds((cur) => (offset ? [...(cur ?? []), ...r.data!.rounds] : r.data!.rounds));
  }, [token]);
  useEffect(() => { void (async () => { await load(0); })(); }, [load, rev]);
  const waiting = (rounds ?? []).filter((r) => waitsOnMe(r, meId));
  const done = (rounds ?? []).filter((r) => !waitsOnMe(r, meId));
  // a confirm alert deep-links here: bring that card into view once it's loaded
  const focused = useRef(false);
  useEffect(() => {
    if (!focus || focused.current || !rounds?.some((r) => r.id === focus)) return;
    focused.current = true;
    document.getElementById(`mr-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focus, rounds]);

  return (
    <section className="mr">
      <div className="mr-head">
        <b>My Rounds</b>
        <span className="td-hint">Every Scorecard round you were on (tap one for the full card) and every tag round that counted.</span>
      </div>
      {err && <div className="td-warn" role="alert">{err}</div>}
      {rounds === null && !err && <p className="td-hint">Loading…</p>}
      {rounds?.length === 0 && (
        <div className="td-warn soft">No rounds yet. Keep score on the Scorecard and save it with your My Tag link: it shows up here.</div>
      )}
      {waiting.length > 0 && (
        <div className="mr-wait">
          <b>Waiting on your OK</b>
          <span className="td-hint">Someone saved a card you played. Check your scores, then CONFIRM. Wrong? DISPUTE and the scorer or a league TD sorts it out.</span>
        </div>
      )}
      {[...waiting, ...done].map((r) => (
        <RoundRow key={`${r.kind}-${r.id}`} r={r} meId={meId} open={open === `${r.kind}-${r.id}` || waitsOnMe(r, meId)} needsOk={waitsOnMe(r, meId)}
          onToggle={() => setOpen((o) => (o === `${r.kind}-${r.id}` ? null : `${r.kind}-${r.id}`))}
          onConfirm={(ok) => void act(roundsApi.confirmRound(token, r.id, ok), ok ? 'Confirmed. Thanks.' : 'Disputed. The scorer or a league TD will sort it out.')} />
      ))}
      {more && <button className="td-btn quiet" disabled={busy} onClick={() => void load(rounds?.length ?? 0)}>{busy ? 'LOADING…' : 'OLDER ROUNDS'}</button>}
    </section>
  );
}

function RoundRow({ r, meId, open, needsOk, onToggle, onConfirm }: { r: MyRound; meId: string; open: boolean; needsOk: boolean; onToggle: () => void; onConfirm: (ok: boolean) => void }) {
  const place = myPlace(r, meId);
  const meCard = r.kind === 'card' ? r.players.find((p) => p.member_id === meId) : null;
  const meTag = r.kind === 'tag' ? r.players.find((p) => p.member_id === meId) : null;
  const moves = r.kind === 'card'
    ? r.tags.filter((t) => t.status === 'applied').map((t) => `${t.pool_name} ${tagMove(t.before, t.after)}`)
    : meTag ? [`${r.pool_name} ${tagMove(meTag.before, meTag.after)}`] : [];
  const waiting = r.kind === 'card' ? r.tags.filter((t) => t.status !== 'applied') : [];
  const counts = r.kind === 'card' && meCard ? holeCounts(r.pars, meCard.scores) : null;
  return (
    <article id={`mr-${r.id}`} className={`mr-round${open ? ' is-open' : ''}${needsOk ? ' is-wait' : ''}`}>
      <button type="button" className="mr-sum" aria-expanded={open} onClick={onToggle}>
        <span className="mr-l">
          <b>{r.course ?? 'Tag round'}</b>
          <small>{niceDate(r.played_on)} · {r.kind === 'card' ? `${r.pars.length} holes · par ${r.pars.reduce((a, b) => a + b, 0)}` : `${r.pool_name} tag round`}</small>
          <span className="mr-chips">
            {needsOk && <span className="mr-chip wait">CONFIRM YOUR SCORE</span>}
            {meCard?.disputed && <span className="mr-chip">You disputed</span>}
            {place && <span className={`mr-chip${place.place === 1 ? ' win' : ''}`}>{place.tied ? 'T-' : ''}{ordinal(place.place)} of {place.of}</span>}
            {moves.filter((m) => !m.endsWith(' ')).map((m) => <span key={m} className="mr-chip tag">{m}</span>)}
            {waiting.map((t) => <span key={t.pool_name} className="mr-chip">{t.pool_name}: {t.status === 'disputed' ? 'disputed' : 'tags waiting'}</span>)}
            {counts && counts.under > 0 && <span className="mr-chip under">{counts.under} under</span>}
          </span>
        </span>
        <span className="mr-r">
          {meCard && <><b className={toParClass(meCard.to_par)}>{fmtToPar(meCard.to_par)}</b><small>{meCard.strokes}</small></>}
          {meTag && <b>{meTag.score}</b>}
          <i aria-hidden="true">{open ? '–' : '+'}</i>
        </span>
      </button>
      {open && (r.kind === 'card' ? <CardDetail r={r} meId={meId} /> : <TagDetail r={r} meId={meId} />)}
      {open && needsOk && (
        <div className="td-row mr-confirm">
          <button className="td-btn cta" onClick={() => onConfirm(true)}>CONFIRM</button>
          <button className="td-btn quiet" onClick={() => { if (window.confirm('Dispute this card? The scorer or a league TD sorts it out.')) onConfirm(false); }}>DISPUTE</button>
        </div>
      )}
    </article>
  );
}

function CardDetail({ r, meId }: { r: MyCardRound; meId: string }) {
  const hasHoles = !r.totals_only && r.players.some((p) => p.scores);
  return (
    <div className="mr-detail">
      {hasHoles ? (
        <div className="mr-tablewrap">
          <table className="mr-table">
            <tbody>
              <tr><th>Hole</th>{r.pars.map((_, i) => <th key={i}>{r.hole_labels?.[i] ?? i + 1}</th>)}<th>Tot</th><th>±</th></tr>
              <tr className="mr-par"><th>Par</th>{r.pars.map((p, i) => <td key={i}>{p}</td>)}<td>{r.pars.reduce((a, b) => a + b, 0)}</td><td /></tr>
              {r.players.map((p, k) => (
                <tr key={k} className={p.member_id === meId ? 'is-me' : undefined}>
                  <th>{display(p)}{p.guest ? <small> guest</small> : null}</th>
                  {r.pars.map((pp, i) => { const s = p.scores?.[i]; return <td key={i} className={s == null ? '' : toParClass(s - pp)}>{s ?? ''}</td>; })}
                  <td><b>{p.strokes}</b></td>
                  <td className={p.dnf_after != null ? '' : toParClass(p.to_par)}>{p.dnf_after != null ? `DNF ${p.dnf_after}` : fmtToPar(p.to_par)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ol className="mr-players">
          {r.players.map((p, k) => (
            <li key={k} className={p.member_id === meId ? 'is-me' : undefined}><span>{display(p)}{p.guest ? <small> guest</small> : null}</span>
              <b className={toParClass(p.to_par)}>{fmtToPar(p.to_par)}</b><span>{p.strokes}</span></li>
          ))}
        </ol>
      )}
      {r.note && <p className="td-hint">“{r.note}”</p>}
      <Link className="mr-link" to={`/rounds/${r.id}`}>Open on Boner Rounds ›</Link>
    </div>
  );
}

function TagDetail({ r, meId }: { r: MyTagRound; meId: string }) {
  return (
    <div className="mr-detail">
      <ol className="mr-players">
        {r.players.map((p) => (
          <li key={p.member_id} className={p.member_id === meId ? 'is-me' : undefined}>
            <span>{display(p)}</span><b>{p.score}</b><span>{tagMove(p.before, p.after)}</span>
          </li>
        ))}
      </ol>
      <p className="td-hint">{r.source === 'event' ? 'Recorded by the league TD from an event.' : 'Logged as a manual tag round (totals only, no card).'}</p>
    </div>
  );
}
