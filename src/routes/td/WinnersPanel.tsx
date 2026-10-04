import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../../lib/td/api';
import { loadBoard, loadTeamBoard } from '../../lib/jewel/api';
import { onlyRound, type LbRow, type TeamRow } from '../../lib/jewel/leaderboard';
import { toPar } from '../../lib/jewel/leaderboard';
import { rpcError, type ExistingPlayer } from '../../lib/td/builder';
import { defaultPcts, money, type DivisionConfig, type FinishStatus, type Mode, type PrizeSettings } from '../../lib/prizes/payout';
import { computeTeamWinners, computeWinners, defaultTeamConfig, teamPayload, toPayload, type DivisionResult, type TeamPayoutConfig, type TeamResult } from '../../lib/prizes/winners';
import { hasDoubles, roundFormat } from '../../lib/td/setup';
import { raffleTotals } from '../../lib/crew/crew';
import LeagueWeek from './LeagueWeek';

const REFRESH_MS = 30_000;
const STATUS: Array<[FinishStatus, string]> = [['dnf', 'DNF'], ['dq', 'DQ'], ['ns', 'NO-SHOW']];
const n = (v: string) => (v.trim() === '' ? 0 : Math.max(0, Number(v) || 0));

/**
 * Winners Circle workbench. Every number is computed live from: fees + tables (division_payouts),
 * the added/raffle total (event_prize), scores (leaderboard), DNF/DQ/NS and playoff winners.
 * Nothing is public until POST RESULTS, which freezes a snapshot for /e/<slug>/winners.
 */
export default function WinnersPanel({ setup, players, onPlayers }: {
  setup: api.EventSetup; players: ExistingPlayer[]; onPlayers: (p: ExistingPlayer[]) => void;
}) {
  const ev = setup.event;
  const [prize, setPrize] = useState<api.PrizeSetup | null>(null);
  const [board, setBoard] = useState<LbRow[]>([]);
  const [teamRows, setTeamRows] = useState<TeamRow[]>([]);
  const [mode, setMode] = useState<Mode>('official');
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [addedText, setAddedText] = useState('');
  const [raffle, setRaffle] = useState<number | null>(null);

  const refreshBoard = useCallback(async () => {
    try { const [b, t] = await Promise.all([loadBoard(ev.id), loadTeamBoard(ev.id)]); setBoard(b); setTeamRows(t); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [ev.id]);

  useEffect(() => {
    void (async () => {
      const r = await api.loadPrizeSetup(ev.id);
      if (r.error || !r.data) return setErr(rpcError(r.error).message);
      setPrize(r.data);
      setAddedText(String(r.data.settings.addedTotal || ''));
      const rs = await api.loadRaffle(ev.id);
      if (rs.data && rs.data.length) setRaffle(raffleTotals(rs.data).total);
      await refreshBoard();
    })();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void refreshBoard(); }, REFRESH_MS);
    return () => window.clearInterval(t);
  }, [ev.id, refreshBoard]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t); }, [toast]);

  // Mixed formats (locked 2026-09-30): divisions are paid from the singles round only; each doubles round is its own team pool.
  const mixed = hasDoubles(ev);
  const roundsList = ev.rounds === 2 ? [1, 2] as const : [1] as const;
  const singles = roundsList.filter((r) => roundFormat(ev, r) === 'singles');
  const dubsRounds = roundsList.filter((r) => roundFormat(ev, r) === 'doubles');
  const w = useMemo(() => prize && computeWinners({
    divOrder: mixed && !singles.length ? [] : setup.divisions.map((d) => d.code), players,
    board: mixed && singles.length ? onlyRound(board, singles[singles.length - 1]) : board, configs: prize.configs, settings: prize.settings,
    playoffs: prize.playoffs, rounds: mixed ? 1 : ev.rounds, mode,
  }), [prize, setup.divisions, players, board, ev.rounds, mode, mixed, singles]);
  const teamResults = useMemo(() => (prize ? dubsRounds.map((r) => computeTeamWinners(teamRows.filter((t) => t.round === r), prize.teamConfigs[r] ?? defaultTeamConfig(r), prize.settings.creditRound, mode)) : []),
    [prize, dubsRounds, teamRows, mode]);

  if (!prize || !w) return <main className="td-main">{err ? <div className="td-warn" role="alert">{err}</div> : <p className="td-empty">Loading…</p>}</main>;

  const label = prize.settings.creditLabel;
  const base = toPayload(ev.name, label, mode, w);
  const payload = { ...base, divisions: [...teamResults.map((t) => teamPayload(t, label)).filter((d) => d.rows.length), ...base.divisions] };
  const teamSum = (f: (t: TeamResult) => number) => Math.round(teamResults.reduce((a, t) => a + f(t), 0) * 100) / 100;
  const totals = {
    pool: w.totals.pool + teamSum((t) => t.pool.total),
    cash: w.totals.cash + teamSum((t) => (t.config.currency === 'cash' ? t.result.awarded : 0)),
    credit: w.totals.credit + teamSum((t) => (t.config.currency === 'credit' ? t.result.awarded : 0)),
    leftover: w.totals.leftover + teamSum((t) => t.leftover),
  };
  const posted = prize.post;
  const changed = posted ? JSON.stringify(posted.payload) !== JSON.stringify(payload) : true;

  const saveSettings = async (s: PrizeSettings) => {
    setPrize({ ...prize, settings: s });
    const r = await api.savePrizeSettings(ev.id, s);
    if (r.error) setErr(rpcError(r.error).message);
  };
  const saveTeamConfig = async (c: TeamPayoutConfig) => {
    setPrize((p) => (p ? { ...p, teamConfigs: { ...p.teamConfigs, [c.round]: c } } : p));
    const r = await api.saveRoundPayout(ev.id, c);
    if (r.error) setErr(`Doubles R${c.round}: ${rpcError(r.error).message}`);
  };
  const saveConfig = async (c: DivisionConfig) => {
    setPrize((p) => (p ? { ...p, configs: { ...p.configs, [c.div]: c } } : p));
    const r = await api.saveDivisionPayout(ev.id, c);
    if (r.error) setErr(`${c.div}: ${rpcError(r.error).message}`);
  };
  const setStatus = async (p: ExistingPlayer, st: FinishStatus | null) => {
    onPlayers(players.map((x) => (x.id === p.id ? { ...x, finish_status: st } : x)));
    const r = await api.setFinishStatus(p.id, st);
    if (r.error) setErr(`${p.name}: ${rpcError(r.error).message}`);
  };
  const setPlayoff = async (div: string, id: string | null) => {
    setPrize((p) => {
      if (!p) return p;
      const next = { ...p.playoffs };
      if (id) next[div] = id; else delete next[div];
      return { ...p, playoffs: next };
    });
    const r = await api.setPlayoffWinner(ev.id, div, id);
    if (r.error) setErr(rpcError(r.error).message);
  };
  const post = async () => {
    const open = w.divisions.filter((d) => d.result.needsPlayoff).map((d) => d.config.div);
    if (open.length && !window.confirm(`${open.join(', ')}: tie for 1st with no playoff winner picked. Post anyway (they'll show as tied)?`)) return;
    setBusy(true); setErr('');
    const r = await api.postWinners(ev.id, payload);
    setBusy(false);
    if (r.error || !r.data) return setErr(rpcError(r.error).message);
    setPrize({ ...prize, post: { payload, posted_at: r.data } });
    setToast('Posted. The public Winners page now shows these results.');
  };
  const commitAdded = () => {
    const v = Math.round(n(addedText) * 100) / 100;
    if (v !== prize.settings.addedTotal) void saveSettings({ ...prize.settings, addedTotal: v });
  };

  return (
    <main className="td-main">
      {toast && <div className="td-ok" role="status">{toast}</div>}
      {err && <div className="td-warn" role="alert">{err} <button className="td-btn quiet" onClick={() => setErr('')}>DISMISS</button></div>}
      <div className="td-row">
        <h2 className="td-h2">Winners Circle</h2>
        <div className="td-seg">
          {(['official', 'live'] as Mode[]).map((m) => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m === 'official' ? 'OFFICIAL' : 'LIVE PREVIEW'}</button>)}
        </div>
        <div style={{ flex: 1 }} />
        <span className="td-hint">{posted ? `Posted ${new Date(posted.posted_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${changed ? ' · changes not posted' : ' · up to date'}` : 'Not posted yet'}</span>
        <a className="td-btn quiet" href={`/e/${ev.slug}/winners`} target="_blank" rel="noreferrer">PUBLIC PAGE ↗</a>
        <button className="td-btn cta" onClick={() => void post()} disabled={busy || (!changed && !!posted)}>{busy ? 'POSTING…' : 'POST RESULTS'}</button>
      </div>
      {ev.kind === 'league' && <LeagueWeek eventId={ev.id} players={players} board={board} teamRows={teamRows} doubles={roundFormat(ev, 1) === 'doubles'} />}
      {mode === 'live' && <div className="td-warn soft">Live preview counts unsigned scores. Post from OFFICIAL once cards are signed.</div>}

      <section className="td-panel td-money">
        <label className="td-field">
          <span className="td-label">ADDED CASH / RAFFLE TOTAL</span>
          <input className="td-input td-big" aria-label="Added cash or raffle total" inputMode="decimal" value={addedText} placeholder="0"
            onChange={(e) => setAddedText(e.target.value.replace(/[^0-9.]/g, ''))} onBlur={commitAdded}
            onKeyDown={(e) => { if (e.key === 'Enter') { commitAdded(); (e.target as HTMLInputElement).blur(); } }} />
          <span className="td-hint">Spread across divisions by field size (except fixed ones). Update it as raffle sales come in.</span>
          {raffle != null && raffle !== prize.settings.addedTotal && (
            <span className="td-hint">Raffle sales logged by the crew: <b>${raffle.toLocaleString()}</b>{' '}
              <button className="td-btn quiet" onClick={() => { setAddedText(String(raffle)); void saveSettings({ ...prize.settings, addedTotal: raffle }); }}>USE ${raffle.toLocaleString()}</button>
            </span>
          )}
        </label>
        <label className="td-field">
          <span className="td-label">AM PRIZE NAME</span>
          <input className="td-input" aria-label="Am prize name" defaultValue={label} maxLength={24} onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== label) void saveSettings({ ...prize.settings, creditLabel: e.target.value.trim() }); }} />
        </label>
        <div className="td-field">
          <span className="td-label">{label.toUpperCase()} ROUND TO</span>
          <div className="td-seg">{([1, 5] as const).map((r) => <button key={r} aria-pressed={prize.settings.creditRound === r} onClick={() => void saveSettings({ ...prize.settings, creditRound: r })}>${r}</button>)}</div>
        </div>
        <div className="td-counts">
          <Stat v={`$${totals.pool.toLocaleString()}`} k="TOTAL POOL" />
          <Stat v={`$${totals.cash.toLocaleString()}`} k="CASH OUT" color="var(--under)" />
          <Stat v={totals.credit.toLocaleString()} k={label.toUpperCase()} color="var(--cyan)" />
          <Stat v={`$${totals.leftover.toLocaleString()}`} k="LEFTOVER" color={totals.leftover ? 'var(--gold)' : '#fff'} />
        </div>
        {w.overBy > 0 && <div className="td-warn">Fixed division amounts add up to ${w.overBy} more than the added total.</div>}
      </section>

      {mixed && <div className="td-hint">{singles.length ? `Divisions are paid from Round ${singles[singles.length - 1]} (singles). ` : 'No singles round, so no division payouts. '}Each doubles round is its own team pool, and every prize is split between partners.</div>}
      {teamResults.map((t) => <TeamCard key={t.config.round} t={t} label={label} onConfig={(c) => void saveTeamConfig(c)} />)}
      {!w.divisions.length && !teamResults.length && <div className="td-empty">No players yet.</div>}
      {w.divisions.map((d) => (
        <DivisionCard key={d.config.div} d={d} label={label} players={players}
          onConfig={(c) => void saveConfig(c)} onStatus={(p, st) => void setStatus(p, st)} onPlayoff={(id) => void setPlayoff(d.config.div, id)}
          playoffWinner={prize.playoffs[d.config.div] ?? null} />
      ))}
    </main>
  );
}

const Stat = ({ v, k, color = '#fff' }: { v: string | number; k: string; color?: string }) => (
  <div className="td-stat"><b style={{ color }}>{v}</b><span>{k}</span></div>
);

/** A number box that keeps what you type until you leave it, then commits once. */
function NumBox({ value, placeholder, onCommit, label, width = 90 }: {
  value: number | null; placeholder?: string; onCommit: (v: number | null) => void; label: string; width?: number;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setText(value == null ? '' : String(value)); }
  const commit = () => {
    const v = text.trim() === '' ? null : Math.max(0, Number(text) || 0);
    if (v !== value) onCommit(v);
  };
  return (
    <input className="td-input" style={{ width }} inputMode="decimal" aria-label={label} value={text} placeholder={placeholder}
      onChange={(e) => setText(e.target.value.replace(/[^0-9.]/g, ''))} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

function DivisionCard({ d, label, players, playoffWinner, onConfig, onStatus, onPlayoff }: {
  d: DivisionResult; label: string; players: ExistingPlayer[]; playoffWinner: string | null;
  onConfig: (c: DivisionConfig) => void; onStatus: (p: ExistingPlayer, st: FinishStatus | null) => void; onPlayoff: (id: string | null) => void;
}) {
  const c = d.config;
  const [open, setOpen] = useState(false);
  const byId = new Map(players.map((p) => [p.id, p]));
  const cur = c.currency;
  const tied = d.result.rows.filter((r) => r.pos === 1 || (playoffWinner && r.id === playoffWinner) || r.place === 'T2');
  const firstTie = d.result.rows.filter((r) => r.place === 'T1');
  const showPlayoff = d.result.needsPlayoff || !!playoffWinner;
  const pctOk = Math.abs(d.result.pctTotal - 100) < 0.05 || d.paid === 0;
  const setPct = (i: number, v: number | null) => {
    const next = [...d.pcts];
    next[i] = v ?? 0;
    onConfig({ ...c, pcts: next });
  };
  const statusRow = (id: string) => {
    const p = byId.get(id);
    if (!p) return null;
    return (
      <select className="td-select td-status" value={p.finish_status ?? ''} aria-label={`${p.name} finish status`}
        onChange={(e) => onStatus(p, (e.target.value || null) as FinishStatus | null)}>
        <option value="">finished</option>
        {STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    );
  };

  return (
    <section className={`td-panel td-windiv${cur === 'cash' ? ' is-cash' : ''}`}>
      <div className="td-row">
        <h2>{c.div}</h2>
        <span className="td-hint">{d.pool.players} players · pays {d.paid}</span>
        <div className="td-seg">
          {(['cash', 'credit'] as const).map((v) => <button key={v} aria-pressed={cur === v} onClick={() => onConfig({ ...c, currency: v })}>{v === 'cash' ? 'CASH' : label.toUpperCase()}</button>)}
        </div>
        <div style={{ flex: 1 }} />
        <div className="td-stat"><b style={{ color: 'var(--under)' }}>${d.pool.total.toLocaleString()}</b><span>POOL</span></div>
      </div>

      <div className="td-poolrow">
        <label>ENTRY $<NumBox label={`${c.div} entry fee`} value={c.entryFee} onCommit={(v) => onConfig({ ...c, entryFee: v ?? 0 })} /></label>
        <label>PAYBACK %<NumBox label={`${c.div} payback percent`} value={c.paybackPct} onCommit={(v) => onConfig({ ...c, paybackPct: Math.min(100, v ?? 0) })} width={70} /></label>
        <label>ADDED $<NumBox label={`${c.div} fixed added`} value={c.addedOverride} placeholder={`auto ${d.pool.added}`} onCommit={(v) => onConfig({ ...c, addedOverride: v })} /></label>
        <span className="td-hint">= ${d.pool.entryPart.toLocaleString()} entries + ${d.pool.added.toLocaleString()} added{c.addedOverride != null ? ' (fixed)' : ''}</span>
        <button className="td-link" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Edit'} payout table</button>
      </div>

      {open && (
        <div className="td-pcts">
          <label>PAID PLACES<NumBox label={`${c.div} paid places`} value={c.paidPlaces} placeholder={`auto ${d.paid}`} width={80}
            onCommit={(v) => onConfig({ ...c, paidPlaces: v == null ? null : Math.round(v), pcts: null })} /></label>
          <div className="td-pct-list">
            {d.pcts.map((p, i) => (
              <label key={i}>{i + 1}.<NumBox label={`${c.div} place ${i + 1} percent`} value={p} width={64} onCommit={(v) => setPct(i, v)} />%</label>
            ))}
          </div>
          <span className={pctOk ? 'td-hint' : 'td-req-warn'}>Total {d.result.pctTotal}%{pctOk ? '' : ' (should be 100%)'}</span>
          <button className="td-btn quiet" onClick={() => onConfig({ ...c, paidPlaces: null, pcts: null })}>RESET TO STANDARD</button>
          <span className="td-hint">Standard for {d.paid}: {defaultPcts(d.paid).join(' / ')}</span>
        </div>
      )}

      {showPlayoff && (
        <div className={d.result.needsPlayoff ? 'td-warn soft' : 'td-ok'}>
          {d.result.needsPlayoff ? 'Tie for 1st. Who won the playoff? ' : 'Playoff winner: '}
          <span className="td-chips" style={{ display: 'inline-flex' }}>
            {(d.result.needsPlayoff ? firstTie : tied.filter((r) => r.pos <= 2)).map((r) => (
              <button key={r.id} className="td-chip" aria-pressed={playoffWinner === r.id} onClick={() => onPlayoff(playoffWinner === r.id ? null : r.id)}>{r.name}</button>
            ))}
          </span>
        </div>
      )}

      <table className="td-table td-results">
        <thead><tr><th>PLACE</th><th>PLAYER</th><th>SCORE</th><th style={{ textAlign: 'right' }}>PRIZE</th><th /></tr></thead>
        <tbody>
          {d.result.rows.map((r) => (
            <tr key={r.id} className={r.amount > 0 ? 'is-paid' : ''}>
              <td>{r.place}</td><td>{r.name}{playoffWinner === r.id ? ' (playoff)' : ''}</td><td>{toPar(r.total)}</td>
              <td style={{ textAlign: 'right' }}>{r.amount > 0 ? money(r.amount, cur, label) : '–'}</td>
              <td>{statusRow(r.id)}</td>
            </tr>
          ))}
          {d.standing.out.map((o) => (
            <tr key={o.id} className="is-out"><td>{o.status.toUpperCase()}</td><td>{o.name}</td><td /><td /><td>{statusRow(o.id)}</td></tr>
          ))}
        </tbody>
      </table>
      {d.standing.unfinished.length > 0 && (
        <p className="td-hint">Not finished yet (not placed): {d.standing.unfinished.map((u) => u.name).join(', ')}. Mark DNF / no-show if they're done.</p>
      )}
      {d.standing.unfinished.map((u) => <span key={u.id} className="td-inline-status">{u.name}: {statusRow(u.id)}</span>)}
      {d.result.leftover > 0 && <p className="td-req-warn">Leftover {money(d.result.leftover, 'cash')} from rounding / unclaimed places.</p>}
    </section>
  );
}

function TeamCard({ t, label, onConfig }: { t: TeamResult; label: string; onConfig: (c: TeamPayoutConfig) => void }) {
  const c = t.config;
  const [open, setOpen] = useState(false);
  const cur = c.currency;
  const pctOk = Math.abs(t.result.pctTotal - 100) < 0.05 || t.paid === 0;
  const setPct = (i: number, v: number | null) => { const next = [...t.pcts]; next[i] = v ?? 0; onConfig({ ...c, pcts: next }); };
  return (
    <section className={`td-panel td-windiv${cur === 'cash' ? ' is-cash' : ''}`}>
      <div className="td-row">
        <h2>Doubles · Round {c.round}</h2>
        <span className="td-hint">{t.teams} teams · {t.players} players · pays {t.paid}</span>
        <div className="td-seg">
          {(['cash', 'credit'] as const).map((v) => <button key={v} aria-pressed={cur === v} onClick={() => onConfig({ ...c, currency: v })}>{v === 'cash' ? 'CASH' : label.toUpperCase()}</button>)}
        </div>
        <div style={{ flex: 1 }} />
        <div className="td-stat"><b style={{ color: 'var(--under)' }}>${t.pool.total.toLocaleString()}</b><span>POOL</span></div>
      </div>
      <div className="td-poolrow">
        <label>ENTRY $ / PLAYER<NumBox label={`Doubles round ${c.round} entry per player`} value={c.entryFee} onCommit={(v) => onConfig({ ...c, entryFee: v ?? 0 })} /></label>
        <label>PAYBACK %<NumBox label={`Doubles round ${c.round} payback percent`} value={c.paybackPct} onCommit={(v) => onConfig({ ...c, paybackPct: Math.min(100, v ?? 0) })} width={70} /></label>
        <label>ADDED $<NumBox label={`Doubles round ${c.round} added`} value={c.addedOverride} placeholder="0" onCommit={(v) => onConfig({ ...c, addedOverride: v })} /></label>
        <span className="td-hint">= ${t.pool.entryPart.toLocaleString()} entries + ${t.pool.added.toLocaleString()} added. The raffle/added total above goes to divisions; add team money here.</span>
        <button className="td-link" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Edit'} payout table</button>
      </div>
      {open && (
        <div className="td-pcts">
          <label>PAID PLACES<NumBox label={`Doubles round ${c.round} paid places`} value={c.paidPlaces} placeholder={`auto ${t.paid}`} width={80}
            onCommit={(v) => onConfig({ ...c, paidPlaces: v == null ? null : Math.round(v), pcts: null })} /></label>
          <div className="td-pct-list">
            {t.pcts.map((p, i) => <label key={i}>{i + 1}.<NumBox label={`Doubles place ${i + 1} percent`} value={p} width={64} onCommit={(v) => setPct(i, v)} />%</label>)}
          </div>
          <span className={pctOk ? 'td-hint' : 'td-req-warn'}>Total {t.result.pctTotal}%{pctOk ? '' : ' (should be 100%)'}</span>
          <button className="td-btn quiet" onClick={() => onConfig({ ...c, paidPlaces: null, pcts: null })}>RESET TO STANDARD</button>
        </div>
      )}
      {t.result.needsPlayoff && <div className="td-warn soft">Tie for 1st: those teams split 1st and 2nd. Settle it on the course first if you want a single winner.</div>}
      <table className="td-table td-results">
        <thead><tr><th>PLACE</th><th>TEAM</th><th>SCORE</th><th style={{ textAlign: 'right' }}>PRIZE</th><th style={{ textAlign: 'right' }}>EACH</th></tr></thead>
        <tbody>
          {t.result.rows.map((r) => (
            <tr key={r.id} className={r.amount > 0 ? 'is-paid' : ''}>
              <td>{r.place}</td><td>{r.name}</td><td>{toPar(r.total)}</td>
              <td style={{ textAlign: 'right' }}>{r.amount > 0 ? money(r.amount, cur, label) : '–'}</td>
              <td style={{ textAlign: 'right' }}>{r.amount > 0 ? money(t.each[r.id], cur, label) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {t.unfinished.length > 0 && <p className="td-hint">Not finished yet (not placed): {t.unfinished.join(', ')}.</p>}
      {t.leftover > 0 && <p className="td-req-warn">Leftover {money(t.leftover, 'cash')} from rounding, splitting prizes, or unclaimed places.</p>}
    </section>
  );
}
