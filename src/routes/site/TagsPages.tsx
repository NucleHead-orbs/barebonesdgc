/** Bag tags, public side: /tags (board per league) and /tags/:pool/:n (one tag: the QR on a physical tag lands here). */
import { useCallback, useMemo } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { CLUB } from '../../lib/jewel/content';
import { Banner, Button, SectionHeading, Skeleton } from '../../components/ui';
import { useLoad } from '../../lib/useLoad';
import * as tagApi from '../../lib/tags/api';
import { display, type TagMember } from '../../lib/tags/tags';
import { niceDate } from '../../lib/leagues/leagues';
import './tags.css';

const unwrap = async <T,>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> => { const r = await p; if (r.error) throw r.error; return r.data as T; };
const when = (iso: string | null) => (iso ? niceDate(iso.slice(0, 10)) : '');

export function TagsBoard() {
  const { pool: slug } = useParams();
  const pools = useLoad(useCallback(() => unwrap(tagApi.loadPools()), []));
  const current = slug ?? pools.data?.[0]?.slug;
  const board = useLoad(useCallback(() => (current ? unwrap(tagApi.loadBoard(current)) : new Promise<never>(() => {})), [current]));

  return (
    <>
      <section className="hero">
        <div className="sec-inner" style={{ gap: 18 }}>
          <div className="kick">Bag Tags · one set per league</div>
          <h1>Bag<span className="hl">Tags</span></h1>
          <p className="lead tg-lead">#1 is the one to beat. Play anyone with a tag in the same league, lower score takes the better number. The board never loses a tag, even when your bag does.</p>
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
                {!board.data.tags.length && <Banner>No tags issued in {board.data.pool.name} yet. Ask your league TD for one.</Banner>}
                <ol className="tg-board">
                  {board.data.tags.map((t) => {
                    const m = t.holder_id ? board.data!.members[t.holder_id] : null;
                    return (
                      <li key={t.number}>
                        <Link to={`/tags/${board.data!.pool.slug}/${t.number}`} className={`tg-row${t.number === 1 ? ' tg-top' : ''}`}>
                          <span className="tg-num">#{t.number}</span>
                          <span className="tg-who"><b>{m ? display(m) : '?'}</b>
                            <span>{t.moved_at ? `Won ${when(t.moved_at)}` : `Issued ${when(t.issued_at)}`}{t.moves ? ` · moved ${t.moves}×` : ''}</span></span>
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
                  <li>Your league TD issues your tag. New tags start at the bottom.</li>
                  <li>Play anyone with a tag in the same league. League nights count once the TD records them from the scorecard.</li>
                  <li>Log the round from your <b>My Tag</b> link. Everyone on it confirms, then the tags swap.</li>
                  <li>Best score takes the lowest number. Ties keep the order they had.</li>
                </ol>
                {CLUB.facebookUrl && <Button href={CLUB.facebookUrl} external variant="outline" size="sm">Get a tag · ask the group ↗</Button>}
              </div>
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}

const KIND: Record<string, string> = { issued: 'Issued to', moved: 'Won by', released: 'Handed back by', retired: 'Retired from', undo: 'Given back to' };

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
              <div className="tg-big">#{n}</div>
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
