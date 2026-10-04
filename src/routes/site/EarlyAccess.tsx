/**
 * /jewel-xi/early-access: registrants claim their spot ("That's me"), a TD approves, this phone gets its My Tag link.
 * Shows the rules and the public raffle board (ticket totals only). Everything is an ea_* RPC.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as ea from '../../lib/early/api';
import { claimKey, daysLeft, earlyMessage, rulesText, spots, windowState, type EaClaimStatus, type EaPublic } from '../../lib/early/early';
import { ME_KEY } from '../../lib/rounds/rounds';
import { niceDate } from '../../lib/leagues/leagues';
import { Banner, Button, Card, SectionHeading, Skeleton } from '../../components/ui';
import './early.css';

const POLL_MS = 20_000;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode: the page still works this visit */ } };

export default function EarlyAccess({ slug = 'jewel-xi-2026' }: { slug?: string }) {
  const [data, setData] = useState<EaPublic | null>(null);
  const [fatal, setFatal] = useState('');
  const [secret, setSecret] = useState<string | null>(() => read(claimKey(slug)));
  const [status, setStatus] = useState<EaClaimStatus | null>(null);
  const [myTag] = useState<string | null>(() => read(ME_KEY));
  const [mineSent, setMineSent] = useState(false);

  const load = useCallback(async () => {
    const r = await ea.loadPublic(slug);
    if (r.error || !r.data) { setFatal(earlyMessage(r.error)); return; }
    setData(r.data); setFatal('');
  }, [slug]);
  const check = useCallback(async () => {
    if (!secret) { setStatus(null); return; }
    const r = await ea.claimStatus(secret);
    if (r.error || !r.data) { write(claimKey(slug), null); setSecret(null); setStatus(null); return; }
    setStatus(r.data);
    if (r.data.status === 'approved' && r.data.token) write(ME_KEY, r.data.token);
  }, [secret, slug]);

  useEffect(() => { void (async () => { await load(); })(); }, [load]);
  useEffect(() => {
    void (async () => { await check(); })();
    if (!secret) return;
    const tick = () => { if (document.visibilityState === 'visible') void check(); };
    const t = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);   // back on the tab: check right away
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [check, secret]);

  const forget = () => { write(claimKey(slug), null); setSecret(null); setStatus(null); };

  if (fatal) return <Page><Banner tone="error">{fatal}</Banner></Page>;
  if (!data) return <Page><Skeleton h={120} n={3} /></Page>;

  const win = windowState(data.today, data.opens_on, data.closes_on);
  const joined = data.roster.filter((r) => r.joined).length;
  const sp = spots(data.max_players, data.registered ?? data.roster.length);
  const inCount = data.roster.filter((r) => r.eligible !== false).length;

  return (
    <Page aside={`${joined} of ${inCount} joined`}>
      <p className="ea-lead">
        Registered for {data.event.name}? Get your bag tag early, play rounds with other Jewel players on the Scorecard, and stack raffle
        tickets for the players meeting. You're also our test pilots: if something breaks, tell us. That's worth tickets too.
      </p>
      {win === 'open' && <Banner tone="success">Open now · {daysLeft(data.today, data.closes_on)} days left (closes {niceDate(data.closes_on)})</Banner>}
      {sp && win !== 'closed' && (sp.left > 0
        ? <Banner tone="warn">The first {sp.max} registrants get in. <b>{sp.left} {sp.left === 1 ? 'spot' : 'spots'} left</b>: register for {data.event.name} to grab one.</Banner>
        : <Banner>All {sp.max} early access spots went to the first {sp.max} registrants.</Banner>)}
      {win === 'before' && <Banner>Opens {niceDate(data.opens_on)}.</Banner>}
      {win === 'closed' && <Banner tone="warn">Early access is closed. Winners are drawn at the players meeting.</Banner>}

      <div className="ea-grid">
        <div className="ea-col">
          {status ? <ClaimState s={status} onForget={forget} />
            : mineSent ? <Card title="Request sent"><p className="ea-p">A TD will approve it. Your early access tag shows up on your <Link to={`/tag/${myTag}`}>My Tag</Link>.</p></Card>
            : win === 'open' ? <ClaimForm data={data} myTag={myTag} onSecret={(s) => { write(claimKey(slug), s); setSecret(s); }} onMine={() => { setMineSent(true); void load(); }} />
            : null}
          <Card title="How it works">
            <ol className="ea-rules">{rulesText(data.min_players, data.weekly_cap).map((r) => <li key={r}>{r}</li>)}</ol>
            <div className="ea-actions">
              <Button to="/scorecard" variant="outline">Open the Scorecard</Button>
              <Button to={`/tags/${data.pool}`} variant="ghost">Early access tag board ›</Button>
            </div>
          </Card>
        </div>

        <div className="ea-col">
          {data.winners.length > 0 && (
            <Card title="Winners" tone="hit">
              <ol className="ea-winners">{data.winners.map((w) => <li key={w.at}>{w.nickname ? `${w.name} "${w.nickname}"` : w.name}</li>)}</ol>
            </Card>
          )}
          <Card title="Raffle board" aside={data.standings.length ? `${data.standings.reduce((s, r) => s + r.tickets, 0)} tickets out` : undefined}>
            {data.standings.length === 0 ? <p className="ea-p ea-muted">Nobody's in yet. Be first: first in gets tag #1.</p> : (
              <table className="ea-board">
                <thead><tr><th>Player</th><th>Tag</th><th className="ea-num">Tickets</th></tr></thead>
                <tbody>
                  {data.standings.map((r) => (
                    <tr key={r.name}>
                      <td>{r.name}{r.nickname ? <span className="ea-nick"> "{r.nickname}"</span> : null}</td>
                      <td>{r.tag ? `#${r.tag}` : '–'}</td>
                      <td className="ea-num">{r.tickets}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}

/** /e/:slug/early-access for events other than Jewel XI. */
export function EarlyAccessBySlug() {
  const { slug = '' } = useParams();
  return <EarlyAccess slug={slug} />;
}

function Page({ aside, children }: { aside?: string; children: ReactNode }) {
  return (
    <section className="sec">
      <div className="sec-inner ea">
        <SectionHeading kicker="The Jewel XI World Tour" title="Early Access" size="l" as="h1" aside={aside ?? 'Tag league + raffle'} />
        {children}
      </div>
    </section>
  );
}

function ClaimState({ s, onForget }: { s: EaClaimStatus; onForget: () => void }) {
  if (s.status === 'approved' && s.token) {
    return (
      <Card title={`You're in, ${s.name}!`} tone="hit">
        <p className="ea-p">This is your My Tag: your tags, rounds to confirm, and your raffle tickets. Bookmark it or add it to your home screen. Don't share the link.</p>
        <div className="ea-actions"><Button to={`/tag/${s.token}`}>Open my tag</Button><Button to="/scorecard" variant="outline">Scorecard</Button></div>
      </Card>
    );
  }
  if (s.status === 'pending') {
    return (
      <Card title="Waiting on a TD">
        <p className="ea-p">You asked to join as <b>{s.name}</b>. A TD approves it, then this page turns into your My Tag link. Leave it open or come back on this phone.</p>
        <button type="button" className="ea-link" onClick={onForget}>Wrong name? Start over</button>
      </Card>
    );
  }
  return (
    <Card title="Not approved" tone="bad">
      <p className="ea-p">The request for <b>{s.name}</b> wasn't approved. If that's you, catch a TD.</p>
      <Button variant="outline" onClick={onForget}>Pick again</Button>
    </Card>
  );
}

function ClaimForm({ data, myTag, onSecret, onMine }: { data: EaPublic; myTag: string | null; onSecret: (s: string) => void; onMine: () => void }) {
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<string | null>(null);
  const [nick, setNick] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t.length < 2 ? [] : data.roster.filter((r) => r.name.toLowerCase().includes(t)).slice(0, 8);
  }, [q, data.roster]);
  const chosen = data.roster.find((r) => r.player_id === pick) ?? null;

  const send = async () => {
    if (!chosen) return;
    setBusy(true); setErr('');
    if (myTag) {
      const r = await ea.claimMine(myTag, data.event.slug, chosen.player_id);
      setBusy(false);
      if (r.error) return setErr(earlyMessage(r.error));
      onMine();
    } else {
      const r = await ea.claim(data.event.slug, chosen.player_id, nick);
      setBusy(false);
      if (r.error || !r.data) return setErr(earlyMessage(r.error));
      onSecret(r.data);
    }
  };

  return (
    <Card title="Join">
      <label className="ea-label" htmlFor="ea-q">Find your name (as you registered)</label>
      <input id="ea-q" className="ea-input" placeholder="Start typing…" value={q} autoComplete="off"
        onChange={(e) => { setQ(e.target.value); setPick(null); }} />
      {list.length > 0 && !chosen && (
        <div className="ea-names" role="list">
          {list.map((r) => (
            <button key={r.player_id} type="button" role="listitem" className="ea-name" disabled={r.joined || r.eligible === false} onClick={() => setPick(r.player_id)}>
              {r.name}{r.joined ? <span> · joined ✓</span> : r.eligible === false ? <span> · past the first {data.max_players}</span> : null}
            </button>
          ))}
        </div>
      )}
      {q.trim().length >= 2 && list.length === 0 && <p className="ea-p ea-muted">No match. Use the name you registered with on Disc Golf Scene.</p>}
      {chosen && (
        <div className="ea-confirm">
          <p className="ea-p">Joining as <b>{chosen.name}</b>{myTag ? ' with your My Tag' : ''}.</p>
          {!myTag && (
            <>
              <label className="ea-label" htmlFor="ea-nick">Nickname (optional)</label>
              <input id="ea-nick" className="ea-input" maxLength={40} value={nick} onChange={(e) => setNick(e.target.value)} />
            </>
          )}
          <div className="ea-actions">
            <Button onClick={() => void send()} disabled={busy}>{busy ? 'Sending…' : "That's me"}</Button>
            <Button variant="ghost" onClick={() => setPick(null)}>Not me</Button>
          </div>
        </div>
      )}
      {err && <Banner tone="error">{err}</Banner>}
      <p className="ea-p ea-muted">A TD checks every request, so nobody can grab your spot. No email or phone needed.</p>
    </Card>
  );
}

