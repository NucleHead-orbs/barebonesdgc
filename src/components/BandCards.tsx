import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { cardUrl, loadBand, type BandMember } from '../lib/band/band';
import './band.css';

/** One character card: tilts toward the pointer with a holo shine (transform only; off for reduced motion). */
function Card({ m, i }: { m: BandMember; i: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current; if (!el || e.pointerType === 'touch') return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    el.style.setProperty('--rx', `${(0.5 - y) * 14}deg`); el.style.setProperty('--ry', `${(x - 0.5) * 16}deg`);
    el.style.setProperty('--mx', `${x * 100}%`); el.style.setProperty('--my', `${y * 100}%`);
  };
  const leave = () => { const el = ref.current; if (!el) return; el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); };
  const url = cardUrl(m.card);
  return (
    <li className="band-item" style={{ animationDelay: `${i * 90}ms` }}>
      <div ref={ref} className="band-card" onPointerMove={move} onPointerLeave={leave}>
        {url ? <img src={url} alt={`${m.name}${m.role ? `, ${m.role}` : ''}: character card`} loading={i < 3 ? 'eager' : 'lazy'} width={800} height={1099} />
          : <div className="band-blank"><b>{m.name}</b><span>Card coming soon</span></div>}
        <i className="band-shine" aria-hidden="true" />
      </div>
      <div className="band-cap"><b>{m.name}</b>{m.role && <span>{m.role}</span>}</div>
    </li>
  );
}

/** The public lineup: visible members in order. */
export function BandCards() {
  const [band, setBand] = useState<BandMember[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void loadBand().then((r) => { if (!live) return; if (r.error) setFailed(true); else setBand(r.data ?? []); });
    return () => { live = false; };
  }, []);
  if (failed) return <p className="band-note">The band is tuning up. Check back in a minute.</p>;
  if (!band) return <p className="band-note">Loading the lineup…</p>;
  if (!band.length) return <p className="band-note">Lineup announced soon.</p>;
  return <ol className="band-grid">{band.map((m, i) => <Card key={m.id} m={m} i={i} />)}</ol>;
}
