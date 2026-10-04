/**
 * EARLY ACCESS tab: approve "That's me" requests, bonus tickets (bug bounty), the full standings, the secret awards
 * and the raffle draw. Every action is a td_ea_* RPC checked by can_td(event). Ticket math lives in the database.
 */
import { useCallback, useEffect, useState } from 'react';
import * as ea from '../../lib/early/api';
import { earlyMessage, earlyPath, rulesText, windowState, type EaStanding, type EaTd } from '../../lib/early/early';
import { niceDate } from '../../lib/leagues/leagues';

const POLL_MS = 20_000; // new requests show up without a reload

export default function EarlyPanel({ eventId, slug, eventName }: { eventId: string; slug: string; eventName: string }) {
  const [d, setD] = useState<EaTd | null>(null);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const r = await ea.tdGet(eventId);
    if (r.error || !r.data) return setErr(earlyMessage(r.error));
    setD(r.data);
  }, [eventId]);
  useEffect(() => {
    void (async () => { await load(); })();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t); }, [toast]);

  const run = async (key: string, p: () => Promise<{ error?: unknown }>, ok?: string) => {
    setBusy(key);
    const r = await p();
    setBusy('');
    if (r.error) { setErr(earlyMessage(r.error)); return false; }
    setErr(''); if (ok) setToast(ok);
    await load();
    return true;
  };

  if (!d) return <main className="td-main">{err ? <div className="td-warn" role="alert">{err}</div> : <p className="td-empty">Loading…</p>}</main>;

  if (!d.on) {
    return (
      <main className="td-main">
        {err && <div className="td-warn" role="alert">{err}</div>}
        <section className="td-panel">
          <h2>Early access</h2>
          <p className="td-hint">Give registrants an early tag set to field-test the Scorecard and tags before the event, with a raffle for playing.
            They claim their name on a public page, you approve, and their phone becomes their My Tag. Rounds earn tickets when at least 3 registrants
            play together and everyone confirms (max 2 a week), plus 1 per new partner. The window closes the day before the event.</p>
          <button className="td-btn cta" disabled={busy === 'start'} onClick={() => void run('start', () => ea.tdStart(eventId), 'Early access is on.')}>START EARLY ACCESS</button>
        </section>
      </main>
    );
  }

  const claims = d.claims ?? [], linked = d.linked ?? [], standings = d.standings ?? [], draws = d.draws ?? [];
  const win = windowState(d.today ?? '', d.opens_on ?? '', d.closes_on ?? '');
  const page = earlyPath(slug);

  return (
    <main className="td-main td-ea">
      {toast && <div className="td-ok" role="status">{toast}</div>}
      {err && <div className="td-warn" role="alert">{err} <button className="td-btn quiet" onClick={() => setErr('')}>OK</button></div>}

      <section className="td-panel">
        <div className="td-row">
          <h2 style={{ flex: 1 }}>{eventName} Early Access</h2>
          <a className="td-btn" href={page} target="_blank" rel="noreferrer">PUBLIC PAGE ↗</a>
          <a className="td-btn quiet" href={`/tags/${d.pool}`} target="_blank" rel="noreferrer">TAG BOARD ↗</a>
        </div>
        <p className="td-hint">
          <b>{linked.length}</b> of {d.players} registrants joined · window {niceDate(d.opens_on ?? '')} – {niceDate(d.closes_on ?? '')}
          {' '}({win === 'open' ? 'open' : win === 'before' ? 'not open yet' : 'closed'}). Share the public page link with registrants.
        </p>
      </section>

      <section className="td-panel">
        <h2>Requests{claims.length > 0 && <span className="td-badge">{claims.length}</span>}</h2>
        {!claims.length && <p className="td-hint">Nobody waiting.</p>}
        {claims.map((c) => (
          <div key={c.id} className="td-ea-claim">
            <div className="td-ea-claim-who">
              <b>{c.player}</b>{c.nickname && <span> "{c.nickname}"</span>}
              <span className="td-hint"> · {c.via === 'mytag' ? `from ${c.member ? `${c.member.name}'s` : 'a'} My Tag` : 'from the public page'} · {niceDate(c.created_at.slice(0, 10))}</span>
            </div>
            {c.via === 'page' && c.member && (
              <div className="td-warn soft">Matches club member <b>{c.member.name}</b>. Approving hands this phone their existing My Tag link. Only approve if you know it's them.</div>
            )}
            {c.via === 'mytag' && c.member && c.member.name.toLowerCase() !== c.player.toLowerCase() && (
              <div className="td-warn soft">Different names: My Tag <b>{c.member.name}</b> is claiming registrant <b>{c.player}</b>. Make sure that's the same person.</div>
            )}
            {c.others > 0 && <div className="td-warn">⚠ {c.others} other {c.others === 1 ? 'request' : 'requests'} for this name. Approve the right one; the rest get declined.</div>}
            <div className="td-row">
              <button className="td-btn cta" disabled={!!busy} onClick={() => void run(`a${c.id}`, async () => {
                const r = await ea.tdApprove(c.id, null);
                if (r.data) setToast(`${c.player} is in with tag #${r.data.number}.`);
                return r;
              })}>APPROVE</button>
              <button className="td-btn quiet" disabled={!!busy} onClick={() => void run(`d${c.id}`, () => ea.tdDecline(c.id), 'Declined.')}>DECLINE</button>
            </div>
          </div>
        ))}
      </section>

      <Standings rows={standings} />

      <Bonus d={d} eventId={eventId} busy={busy} run={run} />

      <Awards d={d} />

      <section className="td-panel">
        <h2>Raffle draw</h2>
        <p className="td-hint">At the players meeting. Picks by ticket weight among players who haven't won yet. Opens after the window closes.</p>
        <div className="td-row">
          <button className="td-btn cta" disabled={win !== 'closed' || !!busy} onClick={() => void run('draw', async () => {
            const r = await ea.tdDraw(eventId);
            if (r.data) setToast(`Winner: ${r.data.name} (${r.data.tickets} of ${r.data.total} tickets)`);
            return r;
          })}>{win === 'closed' ? 'DRAW A WINNER' : `DRAW OPENS AFTER ${niceDate(d.closes_on ?? '').toUpperCase()}`}</button>
        </div>
        {draws.length > 0 && (
          <ol className="td-ea-winners">
            {draws.map((w) => (
              <li key={w.id}>
                <b>{w.name}</b>{w.nickname && <span> "{w.nickname}"</span>} <span className="td-hint">({w.tickets} tickets)</span>
                <button className="td-btn quiet" disabled={!!busy} onClick={() => { if (window.confirm(`Void ${w.name}'s win (not here, re-draw)? They go back in the hat.`)) void run(`v${w.id}`, () => ea.tdDrawVoid(w.id), 'Voided. Draw again.'); }}>VOID</button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="td-panel">
        <h2>Joined</h2>
        {!linked.length && <p className="td-hint">Nobody yet.</p>}
        {linked.length > 0 && (
          <table className="td-table">
            <thead><tr><th>Registrant</th><th>Club member</th><th>Tag</th><th /></tr></thead>
            <tbody>
              {linked.map((l) => (
                <tr key={l.claim_id}>
                  <td>{l.player}</td>
                  <td>{l.member}{l.nickname ? ` "${l.nickname}"` : ''}</td>
                  <td>{l.tag ? `#${l.tag}` : '–'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="td-btn quiet" disabled={!!busy} onClick={() => {
                      if (window.confirm(`Unlink ${l.player} from ${l.member}? Their early access tag goes back as available and their tickets stop counting.`)) {
                        void run(`r${l.claim_id}`, () => ea.tdRemove(l.claim_id), 'Unlinked.');
                      }
                    }}>REMOVE</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <Settings d={d} eventId={eventId} busy={busy} run={run} />
    </main>
  );
}

type Run = (key: string, p: () => Promise<{ error?: unknown }>, ok?: string) => Promise<boolean>;

function Standings({ rows }: { rows: EaStanding[] }) {
  return (
    <section className="td-panel">
      <h2>Standings</h2>
      <p className="td-hint">Players see only their own breakdown (My Tag). The public board shows ticket totals.</p>
      {!rows.length ? <p className="td-hint">Nobody yet.</p> : (
        <div className="td-gridwrap">
          <table className="td-table">
            <thead><tr><th>Player</th><th>Tag</th><th>Rounds</th><th>Round tix</th><th>Partners</th><th>Bonus</th><th>Tickets</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.member_id}>
                  <td>{r.name}{r.nickname ? ` "${r.nickname}"` : ''}</td>
                  <td>{r.tag ? `#${r.tag}` : '–'}</td><td>{r.rounds}</td><td>{r.round_tickets}</td><td>{r.partners}</td><td>{r.bonus}</td>
                  <td><b>{r.tickets}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Bonus({ d, eventId, busy, run }: { d: EaTd; eventId: string; busy: string; run: Run }) {
  const [member, setMember] = useState('');
  const [n, setN] = useState(1);
  const [reason, setReason] = useState('');
  const linked = d.linked ?? [];
  return (
    <section className="td-panel">
      <h2>Bonus tickets</h2>
      <p className="td-hint">Bug bounty: someone reports a real bug, give them tickets with what they found. Logged with your email.</p>
      <form className="td-row" onSubmit={(e) => {
        e.preventDefault();
        void run('bonus', () => ea.tdBonus(eventId, member, n, reason), 'Bonus added.').then((ok) => { if (ok) { setReason(''); setN(1); } });
      }}>
        <select className="td-select" aria-label="Player" value={member} onChange={(e) => setMember(e.target.value)}>
          <option value="">Pick a player…</option>
          {linked.map((l) => <option key={l.member_id} value={l.member_id}>{l.member}</option>)}
        </select>
        <select className="td-select" aria-label="Tickets" value={n} onChange={(e) => setN(Number(e.target.value))}>
          {[1, 2, 3, 4, 5].map((x) => <option key={x} value={x}>{x} {x === 1 ? 'ticket' : 'tickets'}</option>)}
        </select>
        <input className="td-input" style={{ flex: 1, minWidth: 200 }} placeholder="What they found" maxLength={120} value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="td-btn cta" type="submit" disabled={!member || !reason.trim() || busy === 'bonus'}>+ ADD</button>
      </form>
      {(d.bonus ?? []).length > 0 && (
        <table className="td-table">
          <tbody>
            {(d.bonus ?? []).map((b) => (
              <tr key={b.id}>
                <td>{b.name}</td><td>+{b.tickets}</td><td>{b.reason}</td><td className="td-hint">{niceDate(b.at.slice(0, 10))}</td>
                <td style={{ textAlign: 'right' }}><button className="td-btn quiet" disabled={!!busy} onClick={() => void run(`bv${b.id}`, () => ea.tdBonusVoid(b.id), 'Bonus voided.')}>VOID</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Awards({ d }: { d: EaTd }) {
  const a = d.awards ?? { iron: [], collector: [], climb: [] };
  const list = (rows: EaStanding[], line: (r: EaStanding) => string) =>
    rows.length ? <ol className="td-ea-award">{rows.map((r) => <li key={r.member_id}><b>{r.name}</b> <span>{line(r)}</span></li>)}</ol> : <p className="td-hint">Nobody yet.</p>;
  return (
    <section className="td-panel td-ea-secret">
      <h2>Secret awards</h2>
      <p className="td-hint">🤫 Don't show players. Revealed on stage at the Jewel. Same verified rounds as the raffle, no weekly cap.</p>
      <div className="td-grid">
        <div><div className="td-label">IRON BONES · MOST ROUNDS</div>{list(a.iron, (r) => `${r.rounds} rounds`)}</div>
        <div><div className="td-label">BONE COLLECTOR · MOST PARTNERS</div>{list(a.collector, (r) => `${r.partners} different players`)}</div>
        <div><div className="td-label">BIGGEST CLIMB</div>{list(a.climb, (r) => `#${r.start_tag} → #${r.tag}`)}</div>
        <div><div className="td-label">BEST BUG FIND</div><p className="td-hint">Your call: pick from the bonus list above.</p></div>
      </div>
    </section>
  );
}

function Settings({ d, eventId, busy, run }: { d: EaTd; eventId: string; busy: string; run: Run }) {
  const [opens, setOpens] = useState(d.opens_on ?? '');
  const [closes, setCloses] = useState(d.closes_on ?? '');
  const [min, setMin] = useState(d.min_players ?? 3);
  const [cap, setCap] = useState(d.weekly_cap ?? 2);
  const [max, setMax] = useState(d.max_players ? String(d.max_players) : '');
  const maxN = max.trim() === '' ? null : Math.round(Number(max));
  const maxOk = maxN === null || (Number.isFinite(maxN) && maxN >= 1 && maxN <= 500);
  return (
    <section className="td-panel">
      <h2>Rules</h2>
      <ol className="td-hint" style={{ margin: 0, paddingLeft: 18 }}>{rulesText(d.min_players ?? 3, d.weekly_cap ?? 2).map((r) => <li key={r}>{r}</li>)}</ol>
      <div className="td-row">
        <label className="td-ea-field"><span className="td-label">OPENS</span><input className="td-input" type="date" value={opens} onChange={(e) => setOpens(e.target.value)} /></label>
        <label className="td-ea-field"><span className="td-label">CLOSES</span><input className="td-input" type="date" value={closes} onChange={(e) => setCloses(e.target.value)} /></label>
        <label className="td-ea-field"><span className="td-label">JEWEL PLAYERS / ROUND</span>
          <select className="td-select" value={min} onChange={(e) => setMin(Number(e.target.value))}>{[2, 3, 4, 5, 6, 7, 8].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
        <label className="td-ea-field"><span className="td-label">ROUNDS / WEEK</span>
          <select className="td-select" value={cap} onChange={(e) => setCap(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6, 7].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
        <button className="td-btn" disabled={busy === 'set'} onClick={() => void run('set', () => ea.tdSettings(eventId, opens, closes, min, cap), 'Saved.')}>SAVE RULES</button>
      </div>
      <p className="td-hint">Changing these re-counts everyone's tickets right away.</p>
      <div className="td-row">
        <label className="td-ea-field"><span className="td-label">SPOTS (FIRST N REGISTRANTS)</span>
          <input className="td-input" inputMode="numeric" value={max} placeholder="Everyone" onChange={(e) => setMax(e.target.value.replace(/[^0-9]/g, ''))} /></label>
        <button className="td-btn" disabled={busy === 'max' || !maxOk || maxN === (d.max_players ?? null)}
          onClick={() => void run('max', () => ea.tdSetMax(eventId, maxN), maxN ? `First ${maxN} registrants only.` : 'Open to every registrant.')}>SAVE SPOTS</button>
      </div>
      <p className="td-hint">By registration order (the Disc Golf Scene import). {d.max_players ? `${Math.min(d.players ?? 0, d.max_players)} of ${d.max_players} taken${(d.players ?? 0) > d.max_players ? `, ${(d.players ?? 0) - d.max_players} past the limit` : ''}.` : 'Blank = every registrant.'} If someone ahead drops out, the next one moves in.</p>
    </section>
  );
}
