/** Gallery (/gallery): the club archive. Source of truth: gallery_items (approved rows only). Design: canvas board Gallery.dc.html. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CLUB } from '../../lib/jewel/content';
import { Button, Chip, SectionHeading, Skeleton, Banner } from '../../components/ui';
import { useLoad } from '../../lib/useLoad';
import { imageUrl, loadPublic } from '../../lib/gallery/api';
import {
  FILTERS, YOUTUBE_CHANNEL, groupForPage, jewelRail, youtubeEmbed, youtubeThumb, youtubeWatch,
  type Filter, type GalleryItem,
} from '../../lib/gallery/gallery';
import '../../components/gallery.css';
import './gallery-page.css';

const load = async () => { const r = await loadPublic(); if (r.error) throw r.error; return r.data ?? []; };
const label = (i: GalleryItem) => [i.event_label, i.year].filter(Boolean).join(' · ');

export default function GalleryPage() {
  const { data, error } = useLoad(load);
  const [f, setF] = useState<Filter>('all');
  const [box, setBox] = useState<{ list: GalleryItem[]; at: number } | null>(null);
  const g = useMemo(() => groupForPage(data ?? []), [data]);
  const rail = useMemo(() => jewelRail(g.jewels), [g.jewels]);
  const has: Record<Filter, boolean> = {
    all: true, jewel: g.jewels.length > 0, meme: g.memes.length > 0, photo: g.photos.length > 0,
    video: g.videos.length > 0, event: g.events.length > 0,
  };
  const show = (k: Exclude<Filter, 'all'>) => has[k] && (f === 'all' || f === k);
  const open = (list: GalleryItem[], at: number) => setBox({ list, at });
  const empty = data && !data.length;

  return (
    <>
      <section className="sec gp-hero">
        <div className="sec-inner">
          <div className="kick">The Archive · Mesa, AZ · 2015–now</div>
          <SectionHeading title="Gallery" size="xl" as="h1" />
          <div className="hand">A decade of bad decisions. Framed.</div>
          <p className="lead">Memes, fliers, shirts, videos and a pile of dumb pictures from every Jewel, league night and Pop Up we ever threw. All in one place, finally.</p>
          {data && !empty && (
            <div className="row" role="group" aria-label="Filter the gallery">
              {FILTERS.filter((c) => has[c.id]).map((c) => <Chip key={c.id} active={f === c.id} onClick={() => setF(c.id)}>{c.label}</Chip>)}
            </div>
          )}
        </div>
      </section>

      {error && <section className="sec"><div className="sec-inner"><Banner tone="error">The gallery didn't load. Refresh to try again.</Banner></div></section>}
      {!data && !error && <section className="sec"><div className="sec-inner"><Skeleton h={220} n={2} /></div></section>}
      {empty && (
        <section className="sec"><div className="sec-inner">
          <Banner>We're still digging it all out of the shoebox. Videos are up on YouTube now.</Banner>
          <div><Button href={YOUTUBE_CHANNEL} external>Watch on YouTube ↗</Button></div>
        </div></section>
      )}

      {show('jewel') && (
        <section className="sec"><div className="sec-inner">
          <SectionHeading kicker={`The Jewel · 2016–${rail[rail.length - 1].year}`} title="Every Jewel" aside={`${rail[rail.length - 1].roman} and counting`} />
          <div className="gp-rail">
            {rail.map((s) => s.cover ? (
              <button key={s.no} type="button" className="gp-jewel" onClick={() => open(s.items, 0)} aria-label={`The Jewel ${s.roman}, ${s.year}${s.items.length > 1 ? `, ${s.items.length} pieces` : ''}`}>
                <img src={imageUrl(s.cover.storage_path!)} alt="" loading="lazy" />
                <span className="gp-jewel-no">{s.roman}</span>
                <span className="gp-jewel-meta">{s.year}{s.cover.caption ? ` · ${s.cover.caption}` : ''}</span>
              </button>
            ) : (
              <div key={s.no} className="gp-jewel gp-jewel-missing">
                <span className="gp-jewel-no">{s.roman}</span>
                <span className="gp-jewel-meta">{s.year} · still in a box somewhere</span>
              </div>
            ))}
          </div>
        </div></section>
      )}

      {show('meme') && (
        <section className="sec"><div className="sec-inner">
          <SectionHeading kicker="Certified dank" title="The Meme Wall" aside={`${g.memes.length} memes · tap to enlarge`} />
          <div className="gp-wall">
            {g.memes.map((m, i) => (
              <button key={m.id} type="button" className="gp-tile" onClick={() => open(g.memes, i)} aria-label={`View: ${m.title}`}>
                <img src={imageUrl(m.storage_path!)} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </div></section>
      )}

      {show('photo') && (
        <section className="sec"><div className="sec-inner">
          <SectionHeading kicker="Evidence" title="The Crew, Over the Years" aside={`${g.photos.length} photos`} />
          <div className="gp-grid">
            {g.photos.map((p, i) => (
              <figure key={p.id}>
                <button type="button" className="gp-tile gp-square" onClick={() => open(g.photos, i)} aria-label={`View: ${p.title}`}>
                  <img src={imageUrl(p.storage_path!)} alt="" loading="lazy" />
                </button>
                <figcaption>{p.caption || label(p) || p.title}</figcaption>
              </figure>
            ))}
          </div>
        </div></section>
      )}

      {show('video') && (
        <section className="sec"><div className="sec-inner">
          <SectionHeading kicker="Roll the tape · @barebonesdiscgolfclub" title="Videos" aside={<a href={YOUTUBE_CHANNEL} target="_blank" rel="noreferrer">Watch on YouTube ↗</a>} />
          <div className="gp-grid gp-videos">{g.videos.map((v) => <VideoTile key={v.id} v={v} />)}</div>
        </div></section>
      )}

      {show('event') && (
        <section className="sec"><div className="sec-inner">
          <SectionHeading kicker="Past shenanigans" title="Events & Fliers" />
          <div className="gp-grid">
            {g.events.map((e, i) => (
              <figure key={e.id}>
                <button type="button" className="gp-tile" onClick={() => open(g.events, i)} aria-label={`View: ${e.title}`}>
                  <img src={imageUrl(e.storage_path!)} alt="" loading="lazy" />
                </button>
                <figcaption><b>{e.event_label || e.title}</b>{(e.caption || e.year) && <span>{e.caption || e.year}</span>}</figcaption>
              </figure>
            ))}
          </div>
        </div></section>
      )}

      {data && CLUB.facebookUrl && (
        <section className="sec"><div className="sec-inner">
          <div className="gp-dirt">
            <h2 className="ds-display ds-display-m">Got dirt we missed?</h2>
            <p>Old pics, clips, memes of your buddy shanking one into the lake. Post it in the group and we'll hang it on the wall.</p>
            <div><Button href={CLUB.facebookUrl} external variant="outline">Send it to the group ↗</Button></div>
          </div>
        </div></section>
      )}

      <Lightbox box={box} onClose={() => setBox(null)} onMove={(at) => setBox((b) => (b ? { ...b, at } : b))} />
    </>
  );
}

/** Thumbnail first (no YouTube cookies until someone taps), then the privacy-enhanced player in place. */
function VideoTile({ v }: { v: GalleryItem }) {
  const [on, setOn] = useState(false);
  const id = v.youtube_id!;
  return (
    <figure>
      <div className="gp-video">
        {on ? (
          <iframe src={youtubeEmbed(id)} title={v.title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
        ) : (
          <button type="button" className="gp-play" onClick={() => setOn(true)} aria-label={`Play: ${v.title}`}>
            <img src={youtubeThumb(id)} alt="" loading="lazy" />
            <span className="gp-play-btn" aria-hidden>▶</span>
          </button>
        )}
      </div>
      <figcaption>
        <b>{v.title}</b>
        <span>{label(v) ? `${label(v)} · ` : ''}<a href={youtubeWatch(id)} target="_blank" rel="noreferrer">YouTube ↗</a></span>
      </figcaption>
    </figure>
  );
}

function Lightbox({ box, onClose, onMove }: { box: { list: GalleryItem[]; at: number } | null; onClose: () => void; onMove: (at: number) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (box && !d.open) d.showModal();
    if (!box && d.open) d.close();
  }, [box]);
  const n = box?.list.length ?? 0;
  const step = useCallback((k: number) => { if (box && n > 1) onMove((box.at + k + n) % n); }, [box, n, onMove]);
  const it = box?.list[box.at];
  return (
    <dialog ref={ref} className="gal-dlg gp-dlg" onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) ref.current?.close(); }}
      onKeyDown={(e) => { if (e.key === 'ArrowRight') step(1); if (e.key === 'ArrowLeft') step(-1); }}>
      {it?.storage_path && <img src={imageUrl(it.storage_path)} alt={it.title} />}
      {it && <div className="gp-cap">{it.title}{it.caption ? ` · ${it.caption}` : ''}{n > 1 ? <span> {box!.at + 1} / {n}</span> : null}</div>}
      {n > 1 && <>
        <button type="button" className="gp-nav gp-prev" onClick={() => step(-1)} aria-label="Previous">‹</button>
        <button type="button" className="gp-nav gp-next" onClick={() => step(1)} aria-label="Next">›</button>
      </>}
      <button type="button" className="gal-x" onClick={() => ref.current?.close()} aria-label="Close">×</button>
    </dialog>
  );
}
