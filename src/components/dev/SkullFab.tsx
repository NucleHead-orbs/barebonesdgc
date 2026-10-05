/**
 * The skull button: on every page. Tap it to send a bug, idea or feedback (the form loads only when tapped).
 * Phone apps (scorecards, My Tag, crew, live Jewel) get a small skull in the top-right corner so it never covers
 * scoring buttons or bottom tabs; everywhere else it floats bottom-left. html[data-skull] tells the CSS which.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { SkullMascot } from './SkullMascot';
import './skull.css';

const SkullReport = lazy(() => import('./SkullReport'));
const TOP = /^\/(c|tag|room|crew)\/|^\/(scorecard|jewel)(\/|$)/;

export default function SkullFab() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const top = TOP.test(pathname);
  useEffect(() => {
    document.documentElement.dataset.skull = top ? 'top' : 'float';
    return () => { delete document.documentElement.dataset.skull; };
  }, [top]);
  return (
    <>
      <button type="button" className={`skull-fab${top ? ' is-top' : ''}`} onClick={() => setOpen(true)}
        aria-label="Report a bug, an idea or feedback" title="Found a bug? Got an idea? Tell the skull.">
        <SkullMascot size={top ? 30 : 46} />
      </button>
      {open && <Suspense fallback={null}><SkullReport onClose={() => setOpen(false)} /></Suspense>}
    </>
  );
}
