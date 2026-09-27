/**
 * Event building blocks shared by the club site (/jewel-xi/*, /sponsors) and the scoring app (/jewel).
 * One course guide, one sponsor panel: same components, same Supabase data, everywhere.
 */
import { useMemo, useState } from 'react';
import { useLoad } from '../lib/useLoad';
import { loadHoles, loadPublicSponsors, type Hole, type PublicSponsor } from '../lib/jewel/api';
import { Banner, Card, HoleRing, NarratorQuote, Skeleton } from './ui';
import './event.css';

/** "The Setlist": 20-hole accordion from the holes table. One row open at a time; hole 1 open by default. */
export function CourseGuide({ sponsors: given }: { sponsors?: PublicSponsor[] }) {
  const holes = useLoad(loadHoles);
  const spons = useLoad(loadPublicSponsors);
  const [open, setOpen] = useState<number | null>(1);
  const byHole = useMemo(() => {
    const m = new Map<number, PublicSponsor[]>();
    for (const s of given ?? spons.data ?? []) if (s.hole) m.set(s.hole, [...(m.get(s.hole) ?? []), s]);
    return m;
  }, [given, spons.data]);

  if (holes.error) return <Banner tone="error">{holes.error}</Banner>;
  if (!holes.data) return <div className="ev-holes"><Skeleton h={60} n={6} /></div>;
  return (
    <div className="ev-holes">
      {holes.data.map((h: Hole) => {
        const isOpen = open === h.n;
        const s = byHole.get(h.n) ?? [];
        return (
          <div key={h.n} className="ev-hole" data-open={isOpen}>
            <button type="button" aria-expanded={isOpen} aria-controls={`hole-${h.n}`} onClick={() => setOpen(isOpen ? null : h.n)}>
              <HoleRing n={h.n} par={h.par} />
              <span className="ev-hole-meta">
                <b>Par {h.par}{h.dist_ft ? ` · ${h.dist_ft} ft` : ''}</b>
                {h.ob && <span>{h.ob}</span>}
              </span>
              <span className="ev-pm" aria-hidden>{isOpen ? '−' : '+'}</span>
            </button>
            {isOpen && (
              <div className="ev-hole-body" id={`hole-${h.n}`}>
                {h.quote && <NarratorQuote hole={h.n}>{h.quote}</NarratorQuote>}
                {h.rules.map((r) => <div key={r} className="ev-rule">{r}</div>)}
                {s.length > 0 && <div className="ev-hole-spon">Hole sponsor: {s.map((x) => x.name).join(' · ')}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A logo on a white chip, or a dashed name slot. Never a fake logo. */
function SponsorMark({ s }: { s: PublicSponsor }) {
  return s.logo_url
    ? <span className="ev-logo"><img src={s.logo_url} alt={s.name} loading="lazy" /></span>
    : <span className="ev-logo ev-logo-pending">{s.name}</span>;
}

export function SponsorPanel({ title = 'Our Sponsors', sub, tagline, sponsors: given }: {
  title?: string; sub?: string; tagline?: string; sponsors?: PublicSponsor[];
}) {
  const loaded = useLoad(loadPublicSponsors);
  const list = given ?? loaded.data;
  return (
    <section className="ev-spanel" aria-label={title}>
      <h2>{title}</h2>
      {sub && <div className="ev-spanel-sub">{sub}</div>}
      {loaded.error && !given ? <div>{loaded.error}</div>
        : !list ? <div>Loading sponsors…</div>
        : list.length ? <div className="ev-logos">{list.map((s) => <SponsorMark key={s.id} s={s} />)}</div>
        : <div>Sponsor lineup coming soon.</div>}
      {tagline && <div className="ev-tagline">{tagline}</div>}
    </section>
  );
}

/** Per-sponsor cards for the Sponsors pages. Header = tier. */
export function SponsorGrid() {
  const { data, error } = useLoad(loadPublicSponsors);
  if (error) return <Banner tone="error">{error}</Banner>;
  if (!data) return <div className="ev-sgrid"><Skeleton h={150} n={3} /></div>;
  if (!data.length) return <Banner>Sponsors will show up here as they're confirmed.</Banner>;
  return (
    <div className="ev-sgrid">
      {data.map((s) => (
        <Card key={s.id} title={s.tier || 'Sponsor'} aside={s.hole ? `Hole ${s.hole}` : undefined}>
          <div className="ev-scard">
            <SponsorMark s={s} />
            <b>{s.name}</b>
            {!s.logo_url && <span className="ev-meta">Logo pending</span>}
          </div>
        </Card>
      ))}
    </div>
  );
}
