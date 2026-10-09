/** Bag tags, public side: /tags (board per league) and /tags/:pool/:n (one tag: the QR on a physical tag lands here). */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { CLUB } from '../../lib/jewel/content';
import { Banner, Button, SectionHeading, Skeleton } from '../../components/ui';
import { useLoad } from '../../lib/useLoad';
import * as tagApi from '../../lib/tags/api';
import { TAG_ART, display, projectPending, type TagMember } from '../../lib/tags/tags';
import { DigitalTag } from '../../components/DigitalTag';
import { BombIcon } from '../../components/tags/TagHeat';
import { FREE_DECLINES, timeLeft } from '../../lib/tags/heat';
import '../../components/tags/heat.css';
import { niceDate } from '../../lib/leagues/leagues';
import './tags.css';

const unwrap = async <T,>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> => { const r = await p; if (r.error) throw r.error; return r.data as T; };
const when = (iso: string | null) => (iso ? niceDate(iso.slice(0, 10)) : '');

export function TagsBoard() {
  const { pool: slug } = useParams();
  const pools = useLoad(useCallback(() => unwrap(tagApi.loadPools()), []));
  const current = slug ?? pools.data?.[0]?.slug;
  const board = useLoad(useCallback(() => (current ? unwrap(tagApi.loadBoard(current)) : new Promise<never>(() => {})), [current]));
  const heatLoad = useLoad(useCallback(() => (current ? unwrap(tagApi.boardHeat(current)) : new Promise<never>(() => {})), [current]));
  const heat = heatLoad.data ?? null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(t); }, []);
  const fuseOf = (n: number) => heat?.fuses.find((f) => f.number === n) ?? null;

  return (
    <>
      <section className="hero">
        <div className="sec-inner" style={{ gap: 18 }}>
          <div className="kick">Bag Tags · one set per league, plus the Golden Boners</div>
          <h1>Bag<span className="hl">Tags</span></h1>
          <p className="lead tg-lead">#1 is the one to beat. Play anyone with a tag in the same set, lower score takes the better number. The board never loses a tag, even when your bag does.</p>
          {pools.data && (
            <nav className="chips" aria-label="Leagues">
              {pools.data.map((p) => (
                <NavLink key={p.slug} to={`/tags/${p.slug}`} className={() => 'ds-chip tg-chip'} aria-current={p.slug === current ? 'page' : undefined}
                  aria-pressed={p.slug === current}>{p.name}</NavLink>
              ))}
            </nav>
          )}
        </div>
      </section>

      <section className="sec">
        <div className="sec-inner tg-cols">
          <div className="tg-main">
            {board.error && <Banner tone="error">The tag board didn't load. Refresh to try again.</Banner>}
            {!board.data && !board.error && <Skeleton h={56} n={6} />}
            {board.data && (
              <>
                <SectionHeading kicker={board.data.pool.name} title="The Board" aside={`${board.data.tags.length} tags out`} />
                {board.data.pool.invite_only && (board.data.pool.slug === 'golden-boners'
                  ? <Banner>Invite only. Golden Boners are carried by the club admins and core members, for bragging rights. Same rules as every tag: beat a holder, take the better number.</Banner>
                  : board.data.pool.slug === 'jewel-xi-ea'
                  ? <Banner>Early access tags for the first 50 Jewel XI registrants. Registered? <Link to="/jewel-xi/early-access">Claim yours</Link>. Same rules as every tag: beat a holder, take the better number.</Banner>
                  : <Banner>Invite only. Same rules as every tag: beat a holder, take the better number.</Banner>)}
                {!board.data.tags.length && <Banner>No tags issued in {board.data.pool.name} yet.{board.data.pool.invite_only ? '' : ' Ask your league TD for one.'}</Banner>}
                {board.data.pending.some((p) => p.status === 'pending') && (
                  <Banner tone="warn">Includes {board.data.pending.filter((p) => p.status === 'pending').length} swap{board.data.pending.filter((p) => p.status === 'pending').length === 1 ? '' : 's'} waiting on confirmation. Rows marked <b>pending</b> move for real once everyone on the round confirms.</Banner>
                )}
                <ol className="tg-board">
                  {projectPending(board.data.tags, board.data.pending).map((row) => {
                    const t = board.data!.tags.find((x) => x.holder_id === row.holder_id)!;
                    const m = board.data!.members[row.holder_id] ?? null;
                    return (
                      <li key={row.holder_id}>
                        <Link to={`/tags/${board.data!.pool.slug}/${t.number}`} className={`tg-row${row.number === 1 ? ' tg-top' : ''}${row.was !== null ? ' tg-pending' : ''}`}>
                          <span className="tg-num">#{row.number}</span>
                          <span className="tg-who"><b>{m ? display(m) : '?'}</b>
                            <span>{row.was !== null
                              ? <><span className="tg-pend">pending</span> {row.was > row.number ? '▲' : '▼'} from #{row.was}</>
                              : row.swaps.length ? <><span className="tg-pend">on a pending round</span> {t.moved_at ? `· won ${when(t.moved_at)}` : ''}</>
                              : <>{t.moved_at ? `Won ${when(t.moved_at)}` : `Issued ${when(t.issued_at)}`}{t.moves ? ` · moved ${t.moves}×` : ''}</>}</span></span>
                          {(() => {
                            const f = fuseOf(t.number); const left = f ? timeLeft(f.fuse_at, now) : null;
                            const d = heat?.declines[String(t.number)] ?? 0;
                            return (left || d > 0) ? (
                              <span className="tg-heat">
                                {left && <span className={`tg-fuse${left.hot ? ' is-hot' : ''}`} title="Time bomb: no tag round in 7 days and this tag explodes to the bottom"><BombIcon small /> {left.gone ? 'boom soon' : left.label}</span>}
                                {d > 0 && <span className="tg-decl" title="Challenges declined. The 4th drops them 5 spots.">{d}/{FREE_DECLINES} declines</span>}
                              </span>
                            ) : null;
                          })()}
                          <span className="tg-go" aria-hidden>›</span>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
          </div>
          <aside className="tg-side">
            {heat && heat.live.length > 0 && (
              <>
                <SectionHeading kicker="Put up or shut up" title="Challenges" size="s" as="h3" />
                <ul className="tg-rounds">
                  {heat.live.map((c, i) => (
                    <li key={i} className="tg-round">
                      <div className="tg-round-head"><b>{c.from}{c.from_number ? ` #${c.from_number}` : ''} → {c.to}{c.to_number ? ` #${c.to_number}` : ''}</b></div>
                      <span className="tg-note">{c.status === 'open' ? `Waiting on ${c.to}: ${timeLeft(c.expires_at, now)?.label ?? '0m'} to answer.` : `Accepted. Playing by ${c.due_at ? niceDate(c.due_at.slice(0, 10)) : 'next week'}.`}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {heat && heat.drops.length > 0 && (
              <>
                <SectionHeading kicker="Kaboom" title="Explosions" size="s" as="h3" />
                <ul className="tg-rounds">
                  {heat.drops.map((d, i) => (
                    <li key={i} className="tg-round">
                      <div className="tg-round-head"><b>{d.name ?? '?'}</b><span>{niceDate(d.at.slice(0, 10))}</span></div>
                      <span className="tg-note">{d.kind === 'bomb' ? `Time bomb went off: #${d.from} → #${d.to}` : `4th declined challenge: #${d.from} → #${d.to}`}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {board.data && board.data.pending.length > 0 && (
              <>
                <SectionHeading kicker="Not official yet" title="Waiting on confirmation" size="s" as="h3" />
                <ul className="tg-rounds">
                  {board.data.pending.map((sw) => (
                    <li key={sw.id} className="tg-round">
                      <div className="tg-round-head"><b>{niceDate(sw.played_on)}</b><span>{[sw.status === 'disputed' ? 'Disputed' : 'Tag round', sw.course].filter(Boolean).join(' · ')}</span></div>
                      {sw.players.map((p) => {
                        const mm = board.data!.members[p.member_id];
                        return <div key={p.member_id} className="tg-round-row"><span>{mm ? mm.name : '?'}</span><span className="tg-score">{p.place === 1 ? '1st' : p.place === 2 ? '2nd' : p.place === 3 ? '3rd' : `${p.place}th`}</span>
                          <span className={p.confirmed ? 'tg-up' : p.disputed ? 'tg-down' : 'tg-same'}>{p.confirmed ? '✓ confirmed' : p.disputed ? '✗ disputed' : 'waiting'}</span></div>;
                      })}
                      {sw.round_id ? <Link to={`/rounds/${sw.round_id}`} className="tg-link">On it? Confirm the round ›</Link> : <span className="tg-note">Players confirm from their My Tag link.</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {board.data && board.data.recent.length > 0 && (
              <>
                <SectionHeading kicker="Fresh blood" title="Recent rounds" size="s" as="h3" />
                <ul className="tg-rounds">
                  {board.data.recent.map((m) => (
                    <li key={m.id} className="tg-round">
                      <div className="tg-round-head"><b>{niceDate(m.played_on)}</b><span>{[m.source === 'event' ? 'League night' : 'Tag round', m.course].filter(Boolean).join(' · ')}</span></div>
                      {m.players.filter((p) => p.tag_before !== null).map((p) => (
                        <div key={p.member_id} className="tg-round-row">
                          <span>{p.name}</span><span className="tg-score">{p.score}</span>
                          <span className={p.tag_after! < p.tag_before! ? 'tg-up' : p.tag_after! > p.tag_before! ? 'tg-down' : 'tg-same'}>
                            #{p.tag_before} → #{p.tag_after}
                          </span>
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="ds-card tg-how">
              <div className="ds-card-head"><span className="ds-card-title">How it works</span></div>
              <div className="ds-card-body">
                <ol>
                  <li>{board.data?.pool.invite_only ? `${board.data.pool.name} are invite only: an admin issues them.` : 'Your league TD issues your tag.'} New tags start at the bottom.</li>
                  <li>Play anyone with a tag in the same set. League nights count once the TD records them from the scorecard.</li>
                  <li>Log the round from your <b>My Tag</b> link. Everyone on it confirms, then the tags swap.</li>
                  <li>Best score takes the lowest number. Ties keep the order they had.</li>
                  {heat?.bombs && <li><b>Time bombs:</b> the top 5 tags explode after 7 days without a tag round. Boom: that holder goes to the bottom and everyone below moves up.</li>}
                  {heat?.challenges && <li><b>Challenges:</b> challenge anyone up to 5 spots above you from your My Tag. 3 declines are free; the 4th drops you 5 spots. 48 hours of silence counts as a decline.</li>}
                  {heat?.chat && <li><b>Group chat:</b> everyone with a tag in this set, on your My Tag.</li>}
                </ol>
                <Button to="/start" variant="outline" size="sm">New here? Start here</Button>
                {CLUB.facebookUrl && !board.data?.pool.invite_only && <Button href={CLUB.facebookUrl} external variant="outline" size="sm">Get a tag · ask the group ↗</Button>}
              </div>
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}

const KIND: Record<string, string> = { issued: 'Issued to', moved: 'Won by', released: 'Handed back by', retired: 'Retired from', undo: 'Given back to', bomb: 'Time bomb: now held by', penalty: 'Decline penalty: now held by' };

export function TagPage() {
  const { pool = '', number = '' } = useParams();
  const n = Number(number);
  const page = useLoad(useCallback(() => unwrap(tagApi.loadTagPage(pool, n)), [pool, n]));
  const name = (m: TagMember | null) => (m ? display(m) : 'nobody');
  const lines = useMemo(() => page.data?.history ?? [], [page.data]);

  return (
    <section className="sec">
      <div className="sec-inner tg-tag">
        <Link to={`/tags/${pool}`} className="tg-back">‹ {page.data?.pool.name ?? 'Tag'} board</Link>
        {page.error && <Banner tone="error">That tag doesn't exist.</Banner>}
        {!page.data && !page.error && <Skeleton h={160} />}
        {page.data && (
          <>
            <div className="tg-hero">
              {TAG_ART[pool] && page.data.tag?.status === 'held'
                ? <div className="tg-dtag"><DigitalTag art={TAG_ART[pool]} number={n} label={page.data.pool.name} /><span>tap to flip</span></div>
                : <div className="tg-big">#{n}</div>}
              <div>
                <div className="kick">{page.data.pool.name} bag tag</div>
                {page.data.tag?.status === 'held' && page.data.holder ? (
                  <h1 className="ds-display ds-display-l tg-holder">{display(page.data.holder)}</h1>
                ) : (
                  <h1 className="ds-display ds-display-l tg-holder">{page.data.tag?.status === 'retired' ? 'Retired' : page.data.tag ? 'Up for grabs' : 'Not issued yet'}</h1>
                )}
                {page.data.tag?.status === 'held' && page.data.holder && (
                  <p className="lead">Found this tag in the wild? It belongs to {page.data.holder.name}. The number stays theirs on the board either way. Tell the group and get it home.</p>
                )}
              </div>
            </div>
            {lines.length > 0 && (
              <>
                <SectionHeading title="Where it's been" size="s" as="h2" aside={`${page.data.tag?.moves ?? 0} move${page.data.tag?.moves === 1 ? '' : 's'}`} />
                <ol className="tg-hist">
                  {lines.map((h) => (
                    <li key={h.id}>
                      <span className="tg-hist-when">{when(h.at)}</span>
                      <span>{KIND[h.kind]} <b>{h.kind === 'released' || h.kind === 'retired' ? name(h.prev) : name(h.who)}</b>
                        {h.kind === 'moved' && h.prev ? <> from {h.prev.name}</> : null}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
