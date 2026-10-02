/** Club website pages (design/club-website/README.md "Screens / Views"). */
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CLUB, EVENT, GALLERY, JEWEL_NEWS, JEWEL_OVERVIEW, JEWEL_TEASER, MUSIC, SCHEDULE, TOUR } from '../../lib/jewel/content';
import { fmtNewsDate, linkParts, registrationBanner, sortNews, type NewsPost } from '../../lib/jewel/news';
import { Tracks } from '../../components/Tracks';
import { Deck, MiniBar } from '../../components/music/Player';
import { usePlayer } from '../../components/music/usePlayer';
import { useLyrics } from '../../components/music/useLyrics';
import { Gallery } from '../../components/Gallery';
import { loadDivisions } from '../../lib/jewel/api';
import { Banner, Button, Card, Chip, InsetFrame, SectionHeading, TourList } from '../../components/ui';
import { CourseGuide, SponsorGrid, SponsorPanel } from '../../components/event';
import { useLoad } from '../../lib/useLoad';

/** 1. Home (master brand) */
export function Home() {
  return (
    <>
      <section className="hero">
        <div className="sec-inner two-col">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="kick">{CLUB.heroKicker}</div>
            <h1>{CLUB.heroLines[0]}<span className="hl">{CLUB.heroLines[1]}</span></h1>
            <p className="lead">{CLUB.heroBody}</p>
            <div className="row">
              <Button to="/jewel-xi" size="lg">Jewel XI · Nov 21–22</Button>
              {CLUB.facebookUrl && <Button href={CLUB.facebookUrl} external variant="outline" size="lg">Join the Facebook group</Button>}
            </div>
          </div>
          {CLUB.art.skeletonMoon && <img src={CLUB.art.skeletonMoon} alt="Bare Bones skeleton mascot" style={{ width: '100%', maxWidth: 440, justifySelf: 'center' }} />}
        </div>
      </section>

      <div data-theme="jewel-xi" style={{ background: 'var(--bg-page)' }}>
        <InsetFrame className="band">
          <div className="sec-inner two-col" style={{ alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <SectionHeading kicker={JEWEL_TEASER.kicker} title={JEWEL_TEASER.title} size="l" />
              <div className="hand">{JEWEL_TEASER.hand}</div>
              <p className="lead">{JEWEL_TEASER.body}</p>
              <div className="row">
                <Button href={EVENT.registerUrl} external>Register on Disc Golf Scene</Button>
                <Button to="/jewel-xi" variant="outline-accent">Tour info</Button>
              </div>
            </div>
            <TourList items={TOUR} />
          </div>
        </InsetFrame>
      </div>

      {CLUB.art.bonerNation && (
        <section className="sec">
          <div className="sec-inner two-col">
            <img src={CLUB.art.bonerNation} alt="Boner Nation: the skeleton pouring one out for the crew, names on the discs" loading="lazy" style={{ width: '100%', maxWidth: 520, borderRadius: 14, border: '4px solid var(--ink)', justifySelf: 'center' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <SectionHeading title="Boner Nation" size="l" />
              {CLUB.bonerNationCopy && <p className="lead">{CLUB.bonerNationCopy}</p>}
              <div><Button to="/sponsors" variant="outline">Sponsors & Fan Club</Button></div>
            </div>
          </div>
          <div className="sec-inner" style={{ marginTop: 32 }}><Gallery items={GALLERY} /></div>
        </section>
      )}

      <section className="sec">
        <div className="sec-inner"><SponsorPanel tagline={`${EVENT.tagline}.`} /></div>
      </section>
    </>
  );
}

/** 2. Jewel XI Overview */
export function JewelOverview() {
  const divs = useLoad(loadDivisions);
  const [sel, setSel] = useState<string | null>(null);
  const wave = divs.data?.find((d) => d.code === sel)?.wave_default;
  return (
    <>
      <InsetFrame className="jx-hero">
        <div className="sec-inner" style={{ gap: 16 }}>
          <div className="ds-kicker" style={{ fontSize: 12, letterSpacing: 3 }}>{JEWEL_OVERVIEW.kicker}</div>
          <h1>{JEWEL_OVERVIEW.titleLines[0]}<br />{JEWEL_OVERVIEW.titleLines[1]}</h1>
          <div className="jx-when">{JEWEL_OVERVIEW.when}</div>
          {JEWEL_OVERVIEW.venueAka.length > 0 && (
            <div className="jx-aka">a.k.a. {JEWEL_OVERVIEW.venueAka.map((v, i, a) => (
              <span key={v}>{i > 0 && i < a.length - 1 ? <s>{v}</s> : v}{i < a.length - 1 ? ' · ' : ''}</span>
            ))}</div>
          )}
          <div className="row">
            <Button href={EVENT.registerUrl} external size="lg">Register on Disc Golf Scene</Button>
            <Button to="/jewel-xi/course" variant="outline-accent" size="lg">The Setlist (course)</Button>
          </div>
        </div>
      </InsetFrame>

      <section className="sec">
        <div className="sec-inner">
          <Banner tone="warn">{registrationBanner(JEWEL_OVERVIEW)}</Banner>

          <News posts={JEWEL_NEWS} />

          <SectionHeading title="Schedule" />
          <div className="cards">
            {SCHEDULE.map((d) => (
              <Card key={d.day} title={d.day.split(' · ')[0]} aside={d.day.split(' · ')[1]}>
                <TourList items={d.rows.map((r) => ({ date: r.time, title: r.what }))} />
              </Card>
            ))}
          </div>

          <SectionHeading title="Divisions" size="s"
            aside={sel ? `${sel} · ${wave === 'PM' ? 'PM wave · 1:00' : 'AM wave · 9:00'}` : undefined} />
          {divs.error ? <Banner tone="error">{divs.error}</Banner> : (
            <div className="chips">
              {(divs.data ?? []).map((d) => <Chip key={d.code} active={sel === d.code} onClick={() => setSel(sel === d.code ? null : d.code)}>{d.code}</Chip>)}
            </div>
          )}

          <div className="two-col" style={{ marginTop: 16 }}>
            <img className="map" src="/assets/coursemap-thumb.png" alt="Course map, Stripe Show Golf Course" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <SectionHeading kicker="The Setlist" title="20 holes · par 62" />
              <div className="row">
                <Button to="/jewel-xi/course">Hole-by-hole guide</Button>
                <Button to="/jewel" variant="outline-accent">Live scores ↗</Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

const NEWS_ART = '/assets/jewel-xi/news';
const isShout = (t: string) => /[A-Z]/.test(t) && t === t.toUpperCase();

function NewsBody({ post }: { post: NewsPost }) {
  return (
    <div className="news-body">
      {post.body.map((para, i) => (
        <p key={i} className={isShout(para) ? 'news-shout' : undefined}>
          {para.split('\n').map((line, j) => (
            <span key={j}>{j > 0 && <br />}{linkParts(line).map((x, k) => ('to' in x ? <Link key={k} to={x.to}>{x.text}</Link> : <span key={k}>{x.text}</span>))}</span>
          ))}
        </p>
      ))}
    </div>
  );
}

/** Updates: the latest announcement in full (with its artwork), older ones folded. Source: JEWEL_NEWS in content.ts. */
function News({ posts }: { posts: NewsPost[] }) {
  const [latest, ...older] = sortNews(posts);
  if (!latest) return null;
  return (
    <>
      <SectionHeading title="Updates" aside={fmtNewsDate(latest.date)} />
      <article className="news two-col">
        {latest.art && (
          <a className="news-art" href={`${NEWS_ART}/${latest.id}.webp`} target="_blank" rel="noreferrer" aria-label="Open the full-size artwork">
            <img src={`${NEWS_ART}/${latest.id}.webp`} alt={latest.art.alt} loading="lazy" width={1254} height={1254} />
          </a>
        )}
        <div className="news-text">
          <NewsBody post={latest} />
        </div>
      </article>
      {older.map((p) => (
        <details key={p.id} className="news-old">
          <summary><b>{p.title}</b> <span>{fmtNewsDate(p.date)}</span></summary>
          {p.art && <a href={`${NEWS_ART}/${p.id}.webp`} target="_blank" rel="noreferrer"><img src={`${NEWS_ART}/${p.id}-thumb.webp`} alt={p.art.alt} loading="lazy" width={180} height={180} /></a>}
          <NewsBody post={p} />
        </details>
      ))}
    </>
  );
}

/** 3. Course guide */
export function JewelCourse() {
  return (
    <div className="narrow">
      <SectionHeading kicker="The Course Formally Known as Fiesta Lakes" title="The Setlist" aside="Par 62" as="h1" />
      <img className="map" src="/assets/coursemap-thumb.png" alt="Course map, Stripe Show Golf Course" />
      <CourseGuide />
    </div>
  );
}

/** 4. Sponsors (master at /sponsors, skinned at /jewel-xi/sponsors) */
export function Sponsors({ jewel }: { jewel?: boolean }) {
  return (
    <section className="sec">
      <div className="sec-inner">
        <SectionHeading title={jewel ? 'Sponsors' : 'Sponsors & Fan Club'} size="l" as="h1" />
        <SponsorPanel sub={jewel ? `Jewel XI presented by ${EVENT.presentedBy}` : undefined} tagline={`${EVENT.tagline}.`} />
        <SponsorGrid />
        <Card title="Fan Club">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}>
            <Banner>Sponsor tiers are being finalized. Hole sponsorships are open now on Disc Golf Scene.</Banner>
            <div><Button href={EVENT.registerUrl} external>Sponsor on Disc Golf Scene</Button></div>
          </div>
        </Card>
      </div>
    </section>
  );
}

/** 5. Music: songs by YT the Boneheaded Boy. One player for the page: EP straight into the singles. */
export function Music() {
  const queue = useMemo(() => MUSIC.releases.flatMap((r) => r.tracks.filter((t) => t.length).map((t) => ({
    slug: t.slug, title: t.title, release: r.title, src: `/music/${t.slug}.mp3`, cover: t.cover ?? `/music/${t.slug}.webp`, lyrics: t.lyrics ? `/music/${t.slug}.lyrics.json` : undefined,
  }))), []);
  const p = usePlayer(queue, MUSIC.artist);
  const deck = useRef<HTMLDivElement>(null);
  const lyrics = useLyrics(p.cur?.lyrics);
  const [showLyrics, setShowLyrics] = useState(() => { try { return localStorage.getItem('bb-lyrics') !== 'off'; } catch { return true; } });
  const toggleLyrics = () => setShowLyrics((v) => { try { localStorage.setItem('bb-lyrics', v ? 'off' : 'on'); } catch { /* private mode */ } return !v; });
  const pickSlug = (slug: string) => { const i = queue.findIndex((t) => t.slug === slug); if (i >= 0) p.choose(i); };
  return (
    <section className="sec">
      <div className="sec-inner" style={{ maxWidth: 860 }}>
        <SectionHeading kicker={MUSIC.artist} title="Music" size="l" as="h1" aside={`${queue.length} tracks`} />
        <div className="bhb">
          <img src={MUSIC.logo} alt="Boneheaded Boy Productions" width={160} height={174} />
          <div>
            <h2>{MUSIC.artist}</h2>
            <p>Songs for the Boners. Hit play and it rolls through the whole set, or catch the catalog on YouTube Music.</p>
            <Button href={MUSIC.youtubeMusic} external variant="cta">Listen on YouTube Music</Button>
          </div>
        </div>
        <div ref={deck}><Deck p={p} artist={MUSIC.artist} total={queue.length} lyrics={lyrics} showLyrics={showLyrics} onLyrics={toggleLyrics} /></div>
        {MUSIC.releases.map((r) => {
          const out = r.tracks.filter((t) => t.length).length, soon = r.tracks.length - out;
          return (
            <div key={r.title}>
              <div className="trk-rel">
                <div className="trk-rel-k">{r.kicker}</div>
                <h2>{r.title}</h2>
                <p>{r.tracks.length} tracks{soon ? ` · ${out} out now, ${soon} coming soon` : ''}</p>
              </div>
              <Tracks tracks={r.tracks} artist={MUSIC.artist} current={p.started ? p.cur?.slug : undefined} playing={p.playing} onPick={pickSlug} />
            </div>
          );
        })}
      </div>
      <MiniBar p={p} artist={MUSIC.artist} deck={deck} lyrics={showLyrics ? lyrics : null} />
    </section>
  );
}
