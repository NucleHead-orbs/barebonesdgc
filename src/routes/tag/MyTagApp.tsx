/** /tag/:token: one player's bag tags. Log a round, confirm or dispute rounds you're on. Everything is a tag_* RPC checked against the link. */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import * as tagApi from '../../lib/tags/api';
import * as roundsApi from '../../lib/rounds/api';
import { ME_KEY } from '../../lib/rounds/rounds';
import type { Match, TagHome } from '../../lib/tags/api';
import { TAG_ART, display, parseScore, swap, tagMessage } from '../../lib/tags/tags';
import { DigitalTag } from '../../components/DigitalTag';
import { EarlyMyTag } from '../../components/early/EarlyMyTag';
import { HeatBell, TagHeat } from '../../components/tags/TagHeat';
import { TagBoard } from '../../components/tags/TagBoard';
import { Matchups } from '../../components/tags/Matchups';
import { MyRounds } from '../../components/tags/MyRounds';
import { PhoneAlerts } from '../../components/tags/PhoneAlerts';
import { TagLeaderboard } from '../../components/tags/TagLeaderboard';
import { asTab, type MyTagTab } from '../../lib/tags/board';
import { chatSeenKey, readSeen, useCasuals, useHeat, useMentions, useRounds, welcomeSeen, type HeatFocus } from '../../lib/tags/useHeat';
import { localDate, niceDate } from '../../lib/leagues/leagues';
import { useTheme } from '../../lib/theme';
import { NewVersionNote } from '../../components/dev/DevReports';
import { WelcomeTour } from '../../components/tags/WelcomeTour';
import { InstallCard } from '../rounds/InstallCard';
import { isStandalone, myTagHead, useAppHead } from '../../lib/rounds/useInstall';
import { platformOf } from '../../lib/rounds/install';
import { useSkinApply } from '../../lib/skins';
import { SkinPicker } from '../../components/skins/SkinPicker';
import '../td/td.css';
import './mytag.css';

const POLL_MS = 30_000;

export default function MyTagApp() {
  const { token = '' } = useParams();
  const [home, setHome] = useState<TagHome | null>(null);
  const [fatal, setFatal] = useState('');
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [rev, setRev] = useState(0);
  const [toConfirm, setToConfirm] = useState<Array<{ id: string; course: string; played_on: string }>>([]);
  useTheme('event', 'bone');
  useSkinApply();
  useAppHead(myTagHead(token));
  /** Home-screen buttons: phones only, and never inside the home-screen app itself. */
  const [canAdd] = useState(() => platformOf(navigator.userAgent, navigator.maxTouchPoints, navigator.platform) !== 'other' && !isStandalone());
  const [addTag, setAddTag] = useState(false);
  const [leaders, setLeaders] = useState<string | null>(null); // LEADERBOARD pop-up: which set
  const closeLeaders = useCallback(() => setLeaders(null), []);
  const heatRows = useHeat(token, rev);
  const rounds = useRounds(token, rev);
  const mentions = useMentions(token, rev);
  const casuals = useCasuals(token, rev);
  // a phone alert opens ?tab=board&pool=<set>&chat=<id>: land on that message
  const [focusChat, setFocusChat] = useState<number | null>(() => Number(new URLSearchParams(window.location.search).get('chat')) || null);
  const [focus, setFocus] = useState<HeatFocus | null>(null);
  const [params, setParams] = useSearchParams();
  const tab = asTab(params.get('tab'));
  const go = useCallback((t: MyTagTab) => { setParams(t === 'tags' ? {} : { tab: t }, { replace: true }); window.scrollTo(0, 0); }, [setParams]);
  // a confirm alert opens ?tab=rounds&round=<id>: open that card
  const [focusRound] = useState<string | null>(() => new URLSearchParams(window.location.search).get('round'));
  const [boardPool, setBoardPool] = useState<string | null>(() => new URLSearchParams(window.location.search).get('pool'));
  const [tour, setTour] = useState<boolean | null>(null); // null = not decided yet (decided once we know who this is)
  const [unread, setUnread] = useState<Record<string, number>>({});
  const meIdForSeen = home?.me.id ?? '';
  const seenKey = useCallback((pool: string) => chatSeenKey(pool, meIdForSeen), [meIdForSeen]);
  // unread chat per set: messages from others newer than the last one this member saw here
  useEffect(() => {
    if (!heatRows || !meIdForSeen) return;
    let live = true;
    void (async () => {
      const next: Record<string, number> = {};
      for (const r of heatRows) {
        if (!r.chat || !r.last_chat) continue;
        const seen = readSeen(chatSeenKey(r.pool, meIdForSeen));
        if (r.last_chat <= seen) continue;
        const got = await tagApi.chatRead(token, r.pool_id, seen);
        next[r.pool] = (got.data ?? []).filter((l) => l.member_id !== meIdForSeen).length;
      }
      if (live) setUnread(next);
    })();
    return () => { live = false; };
  }, [heatRows, token, meIdForSeen]);
  const onSeen = useCallback((pool: string) => setUnread((u) => (u[pool] ? { ...u, [pool]: 0 } : u)), []);
  // @mentions this phone hasn't seen: newer than the last Board line read in that set (re-checked as the Board is read)
  const atMe = useMemo(() => (meIdForSeen ? mentions.filter((m) => m.chat_id > readSeen(chatSeenKey(m.pool, meIdForSeen))) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unread changes whenever a Board read moves the seen marker
    [mentions, meIdForSeen, unread]);

  const load = useCallback(async () => {
    const r = await tagApi.me(token);
    if (r.error || !r.data) { const m = tagMessage(r.error); if (/link/.test(m)) setFatal(m); else setErr(m); return; }
    setHome(r.data); setFatal('');
    try { localStorage.setItem(ME_KEY, token); } catch { /* not remembered; the scorecard asks for the link instead */ }
    const rm = await roundsApi.roundMe(token);
    if (rm.data) setToConfirm(rm.data.to_confirm);
    setRev((n) => n + 1);
  }, [token]);
  useEffect(() => {
    void (async () => { await load(); })();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t); }, [toast]);

  const act = useCallback(async (p: Promise<{ error?: unknown }>, ok?: string) => {
    const r = await p;
    if (r.error) { setErr(tagMessage(r.error)); return false; }
    setErr(''); if (ok) setToast(ok);
    await load();
    return true;
  }, [load]);

  if (fatal) return <div className="td"><main className="td-main mt-app"><div className="td-warn" role="alert">{fatal}</div></main></div>;
  if (!home) return <div className="td"><main className="td-main mt-app"><p className="td-empty">{err || 'Loading your tags…'}</p></main></div>;

  const meId = home.me.id;
  const showTour = tour ?? !welcomeSeen(meId);
  const needsMe = home.open.filter((m) => m.status === 'pending' && !m.expired && !m.players.find((p) => p.member_id === meId)?.confirmed);
  // Scorecard cards confirm on the card in MY ROUNDS (that confirms their tag swaps too); manual tag rounds confirm here
  const tagNeeds = needsMe.filter((m) => !m.round_id);
  const waitingOk = tagNeeds.length + toConfirm.length;
  const waiting = home.open.filter((m) => !needsMe.includes(m));
  const names = Object.fromEntries(home.holdings.map((h) => [h.pool, h.pool_name]));

  return (
    <div className="td">
      <header className="td-top">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <div className="td-title">My Tag</div>
          <div className="td-sub">BARE BONES BAG TAGS · {display(home.me).toUpperCase()}</div>
        </div>
        <div className="mt-headtools">
          <SkinPicker />
          <HeatBell rows={heatRows} unread={unread} atMe={atMe}
            onMention={(m) => { setBoardPool(m.pool); setFocusChat(m.chat_id); go('board'); }}
            onChat={(pool) => { setBoardPool(pool); go('board'); }}
            onChallenge={(pool) => { go('tags'); setFocus((f) => ({ kind: 'challenge', pool, n: (f?.n ?? 0) + 1 })); }} />
        </div>
      </header>
      <nav className="td-tabs mt-tabs" aria-label="My Tag">
        {([['tags', 'MY TAGS'], ['board', 'BOARD'], ['matchups', 'MATCHUPS'], ['rounds', 'MY ROUNDS']] as Array<[MyTagTab, string]>).map(([t, label]) => {
          const n = t === 'board' ? Object.values(unread).reduce((a, b) => a + b, 0) : t === 'matchups' ? casuals.filter((c) => c.open && c.mine === 'invited').length : t === 'rounds' ? waitingOk : 0;
          return <button key={t} aria-current={tab === t ? 'page' : undefined} onClick={() => go(t)}>{label}{n > 0 && <b>{n > 99 ? '99+' : n}</b>}</button>;
        })}
      </nav>
      <main className="td-main mt-app">
        <NewVersionNote />
        {toast && <div className="td-ok" role="status">{toast}</div>}
        {err && <div className="td-warn" role="alert">{err} <button className="td-btn quiet" onClick={() => setErr('')}>OK</button></div>}

        {!home.holdings.length && <div className="td-warn soft">You don't hold a tag right now. Ask your league TD to issue you one.</div>}
        {tab === 'board' && <TagBoard token={token} meId={meId} rows={heatRows} names={names} pool={boardPool} onPool={setBoardPool}
          unread={unread} seenKey={seenKey} onSeen={onSeen} rosters={home.rosters} focusId={focusChat} />}
        {tab === 'matchups' && <Matchups token={token} act={act} rev={rev} rounds={rounds} casuals={casuals} meId={meId} holdings={home.holdings} rosters={home.rosters} />}
        {tab === 'rounds' && <>
        {tagNeeds.length > 0 && (
          <section className="td-panel mt-needs">
            <h2>Confirm {tagNeeds.length === 1 ? 'this round' : 'these rounds'}</h2>
            <p className="td-hint">Check the scores. <b>Confirm</b> if they're right. When everyone confirms, the tags swap. Wrong? <b>Dispute</b> and your league TD settles it.</p>
            {tagNeeds.map((m) => (
              <RoundCard key={m.id} m={m} meId={meId} preview>
                <div className="td-row">
                  <button className="td-btn cta" onClick={() => void act(tagApi.confirm(token, m.id, true), 'Confirmed.')}>CONFIRM</button>
                  <button className="td-btn quiet" onClick={() => void act(tagApi.confirm(token, m.id, false), 'Disputed. Your league TD will sort it out.')}>DISPUTE</button>
                </div>
              </RoundCard>
            ))}
          </section>
        )}

        <MyRounds token={token} meId={meId} rev={rev} act={act} focus={focusRound} />
        </>}
        {tab === 'tags' && <>
        <div className="mt-tags">
          {home.holdings.map((h) => TAG_ART[h.pool] ? (
            <div key={h.pool} className="mt-dtag">
              <DigitalTag art={TAG_ART[h.pool]} number={h.number} label={h.pool_name} />
              <div className="mt-dtag-meta">
                <b>{h.pool_name} #{h.number}</b>
                <span>of {h.held}{h.moved_at ? ` · won ${niceDate(h.moved_at.slice(0, 10))}` : ''} · tap to flip</span>
                <Link to={`/tags/${h.pool}/${h.number}`}>Tag history ›</Link>
                <button type="button" className="td-btn quiet mt-lbbtn" onClick={() => setLeaders(h.pool)}>LEADERBOARD</button>
              </div>
            </div>
          ) : (
            <div key={h.pool} className="mt-tagwrap">
              <Link to={`/tags/${h.pool}/${h.number}`} className={`mt-tag${h.number === 1 ? ' is-top' : ''}`}>
                <span className="mt-tag-pool">{h.pool_name}</span>
                <span className="mt-tag-num">#{h.number}</span>
                <span className="mt-tag-meta">of {h.held}{h.moved_at ? ` · won ${niceDate(h.moved_at.slice(0, 10))}` : ''}</span>
              </Link>
              <button type="button" className="td-btn quiet mt-lbbtn" onClick={() => setLeaders(h.pool)}>LEADERBOARD</button>
            </div>
          ))}
        </div>
        {leaders && home.rosters[leaders] && (
          <TagLeaderboard poolName={names[leaders] ?? leaders} poolSlug={leaders} roster={home.rosters[leaders]} meId={meId} onClose={closeLeaders} />
        )}

        <TagHeat rows={heatRows} rounds={rounds} token={token} names={names} act={act} focus={focus} onMatchups={() => go('matchups')} />

        <EarlyMyTag token={token} rev={rev} />

        {waitingOk > 0 && (
          <section className="td-panel mt-needs">
            <h2>{waitingOk === 1 ? 'A round is' : `${waitingOk} rounds are`} waiting on your OK</h2>
            <p className="td-hint">Check your score and confirm it in MY ROUNDS. Tags swap once everyone on the card confirms.</p>
            <button className="td-btn cta" onClick={() => go('rounds')}>CONFIRM IN MY ROUNDS</button>
          </section>
        )}

        <div className="td-row">
          <Link className="td-btn cyan" to="/scorecard">OPEN THE SCORECARD</Link>
          <Link className="td-btn quiet" to="/rounds">BONER ROUNDS</Link>
        </div>
        {canAdd && (
          <div className="td-row mt-add">
            <Link className="td-btn cta" to="/scorecard?install=1">ADD SCORECARD TO HOME SCREEN</Link>
            <button className="td-btn cta" aria-expanded={addTag} onClick={() => setAddTag((x) => !x)}>ADD MY TAG TO HOME SCREEN</button>
          </div>
        )}
        {canAdd && addTag && <InstallCard app="mytag" token={null} force onClose={() => setAddTag(false)} />}

        <PhoneAlerts token={token} onInstall={() => { setAddTag(true); requestAnimationFrame(() => document.querySelector('.mt-add')?.scrollIntoView({ behavior: 'smooth', block: 'center' })); }} />

        {home.holdings.length > 0 && <LogRound home={home} token={token} act={act} />}

        {waiting.length > 0 && (
          <section className="td-panel">
            <h2>Waiting</h2>
            {waiting.map((m) => {
              const others = m.players.filter((p) => !p.confirmed && !p.disputed).map((p) => p.name);
              const canWithdraw = m.mine && m.status === 'pending' && m.players.every((p) => p.member_id === meId || !p.confirmed);
              return (
                <RoundCard key={m.id} m={m} meId={meId} preview={m.status === 'pending' && !m.expired}>
                  <div className="td-hint">
                    {m.status === 'disputed' ? 'Disputed. Your league TD will settle it.'
                      : m.expired ? 'Expired: nobody confirmed within 7 days. Log it again if it still counts.'
                      : `Waiting on ${others.join(', ')}. Send them a nudge.`}
                  </div>
                  {canWithdraw && !m.expired && <button className="td-btn quiet" style={{ alignSelf: 'flex-start' }} onClick={() => void act(tagApi.withdraw(token, m.id), 'Withdrawn.')}>WITHDRAW</button>}
                </RoundCard>
              );
            })}
          </section>
        )}

        {home.recent.length > 0 && (
          <section className="td-panel">
            <h2>Your rounds</h2>
            {home.recent.map((m) => <RoundCard key={m.id} m={m} meId={meId} />)}
          </section>
        )}

        </>}

        <p className="td-hint mt-foot"><button className="td-btn quiet" onClick={() => setTour(true)}>HOW IT WORKS</button></p>
        <p className="td-hint mt-foot">This page is yours: bookmark it or add it to your home screen. Don't share the link. Lost it? Your league TD can send a new one. <Link to="/tags">See the boards ›</Link></p>
      </main>
      {showTour && <WelcomeTour memberId={meId} first={(home.me.nickname || home.me.name).split(/\s+/)[0]} tag={home.holdings[0] ? `#${home.holdings[0].number} in ${home.holdings[0].pool_name}` : null} onClose={() => setTour(false)} />}
    </div>
  );
}

type Act = (p: Promise<{ error?: unknown }>, ok?: string) => Promise<boolean>;

function RoundCard({ m, meId, preview, children }: { m: Match; meId: string; preview?: boolean; children?: ReactNode }) {
  const moves = useMemo(() => {
    if (m.status === 'applied') return new Map(m.players.map((p) => [p.member_id, [p.tag_before, p.tag_after] as const]));
    if (!preview) return null;
    const s = swap(m.players.map((p) => ({ id: p.member_id, score: p.score, tag: p.tag_now ?? null })));
    return new Map(s.map((p) => [p.id, [p.before, p.after] as const]));
  }, [m, preview]);
  return (
    <article className="mt-round">
      <div className="mt-round-head">
        <b>{m.pool_name}</b>
        <span>{[niceDate(m.played_on), m.source === 'event' ? 'League night' : null, m.course].filter(Boolean).join(' · ')}</span>
      </div>
      <table className="mt-round-table">
        <tbody>
          {m.players.map((p) => {
            const mv = moves?.get(p.member_id);
            return (
              <tr key={p.member_id} className={p.member_id === meId ? 'is-me' : undefined}>
                <td>{p.name}{m.status !== 'applied' && (p.confirmed ? ' ✓' : p.disputed ? ' ✗' : '')}</td>
                <td className="mt-num">{p.score}</td>
                <td className="mt-num">{mv && mv[0] !== null ? (mv[0] === mv[1] ? `#${mv[0]}` : `#${mv[0]} → #${mv[1]}`) : '–'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {children}
    </article>
  );
}

function LogRound({ home, token, act }: { home: TagHome; token: string; act: Act }) {
  const [open, setOpen] = useState(false);
  const [pool, setPool] = useState(home.holdings[0].pool);
  const [picked, setPicked] = useState<string[]>([]);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [course, setCourse] = useState('');
  const [day, setDay] = useState(localDate());
  const [busy, setBusy] = useState(false);
  const holding = home.holdings.find((h) => h.pool === pool) ?? home.holdings[0];
  const roster = home.rosters[holding.pool] ?? [];
  const meId = home.me.id;
  const players = [meId, ...picked];
  const rows = players.map((id) => ({ id, score: parseScore(scores[id] ?? ''), tag: roster.find((r) => r.member_id === id)?.number ?? null }));
  const ready = picked.length >= 1 && rows.every((r) => r.score !== null);
  const preview = ready ? swap(rows.map((r) => ({ id: r.id, score: r.score as number, tag: r.tag }))) : [];
  const nameOf = (id: string) => (id === meId ? 'You' : roster.find((r) => r.member_id === id)?.name ?? '?');

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 9 ? p : [...p, id]));
  const reset = () => { setPicked([]); setScores({}); setCourse(''); setDay(localDate()); setOpen(false); };
  const submit = async () => {
    setBusy(true);
    const ok = await act(tagApi.log(token, holding.pool_id, rows.map((r) => ({ member_id: r.id, score: r.score as number })), course, day),
      'Logged. It counts once everyone confirms from their My Tag link.');
    setBusy(false);
    if (ok) reset();
  };

  if (!open) return <button className="td-btn quiet mt-log-open" onClick={() => setOpen(true)}>+ MANUAL TAG ROUND SUBMISSION</button>;
  return (
    <section className="td-panel">
      <h2>Manual tag round submission</h2>
      {home.holdings.length > 1 && (
        <div className="td-chips" role="group" aria-label="League">
          {home.holdings.map((h) => (
            <button key={h.pool} className="td-chip" aria-pressed={h.pool === pool} onClick={() => { setPool(h.pool); setPicked([]); setScores({}); }}>{h.pool_name} · #{h.number}</button>
          ))}
        </div>
      )}
      <div className="td-label">WHO PLAYED (UP TO 9 MORE)</div>
      <div className="td-chips mt-roster">
        {roster.filter((r) => r.member_id !== meId).map((r) => (
          <button key={r.member_id} className="td-chip" aria-pressed={picked.includes(r.member_id)} onClick={() => toggle(r.member_id)}>#{r.number} {r.name}</button>
        ))}
        {roster.length <= 1 && <span className="td-hint">Nobody else has a tag in {holding.pool_name} yet.</span>}
      </div>
      {picked.length > 0 && (
        <>
          <div className="td-label">TOTAL STROKES (LOWER WINS)</div>
          <div className="mt-scores">
            {players.map((id) => (
              <label key={id} className="mt-score">
                <span>{nameOf(id)}</span>
                <input className="td-input" inputMode="numeric" pattern="-?[0-9]*" maxLength={4} value={scores[id] ?? ''} aria-label={`${nameOf(id)} score`}
                  onChange={(e) => setScores({ ...scores, [id]: e.target.value })} />
              </label>
            ))}
          </div>
          <div className="td-row">
            <input className="td-input" style={{ flex: 1, minWidth: 160 }} placeholder="Course (optional)" maxLength={80} value={course} onChange={(e) => setCourse(e.target.value)} />
            <input className="td-input" type="date" aria-label="Date played" value={day} max={localDate()} onChange={(e) => setDay(e.target.value)} />
          </div>
          {ready && (
            <div className="mt-preview">
              <div className="td-label">IF EVERYONE CONFIRMS</div>
              {preview.slice().sort((a, b) => (a.after ?? 0) - (b.after ?? 0)).map((p) => (
                <div key={p.id} className="mt-preview-row"><span>{nameOf(p.id)}</span><b>{p.before === p.after ? `keeps #${p.after}` : `#${p.before} → #${p.after}`}</b></div>
              ))}
            </div>
          )}
        </>
      )}
      <div className="td-row">
        <button className="td-btn cta" disabled={!ready || busy} onClick={() => void submit()}>SEND FOR CONFIRMATION</button>
        <button className="td-btn quiet" onClick={reset}>CANCEL</button>
      </div>
    </section>
  );
}
