/** Site chrome: MasterLayout (club), JewelLayout (event skin), shared Footer. */
import { Suspense, useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { CLUB, EVENT } from '../lib/jewel/content';
import { useTheme } from '../lib/theme';
import { YOUTUBE_CHANNEL } from '../lib/gallery/gallery';
import { Button } from './ui';
import './site.css';

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

export function MasterLayout() {
  useTheme(null);
  return (
    <div className="site">
      <ScrollTop />
      <header className="mh">
        <div className="mh-row">
          <Link to="/" className="mh-brand" aria-label="Bare Bones Disc Golf Club home">
            {CLUB.art.skeleton && <img src={CLUB.art.skeleton} alt="" width={52} height={52} />}
            <span className="mh-word"><b>Bare Bones</b><span>Disc Golf Club</span></span>
          </Link>
          <nav className="mh-nav" aria-label="Main">
            <NavLink to="/" end>Home</NavLink>
            <NavLink to="/jewel-xi">Jewel XI</NavLink>
            <NavLink to="/gallery">Gallery</NavLink>
            <NavLink to="/music">Music</NavLink>
            <NavLink to="/sponsors">Sponsors</NavLink>
          </nav>
          <Button href={EVENT.registerUrl} external size="sm">Register</Button>
        </div>
      </header>
      <main className="site-main"><Suspense fallback={null}><Outlet /></Suspense></main>
      <Footer />
    </div>
  );
}

export function JewelLayout() {
  useTheme('jewel-xi');
  return (
    <div className="site">
      <ScrollTop />
      <header className="jh">
        <div className="jh-row">
          <Link to="/" aria-label="Bare Bones Disc Golf Club home"><img src="/assets/wordmark-bare-bones-cut.png" alt="Bare Bones" width={132} height={56} /></Link>
          <div className="jh-title">
            <b>{EVENT.title}</b>
            <span>{EVENT.subtitle}</span>
          </div>
          <Link to="/" className="jh-home">‹ Club home</Link>
        </div>
        <nav className="jh-tabs" aria-label="Jewel XI">
          <NavLink to="/jewel-xi" end>Overview</NavLink>
          <NavLink to="/jewel-xi/course">Course</NavLink>
          <Link to="/jewel">Live Scores ↗</Link>
          <NavLink to="/jewel-xi/sponsors">Sponsors</NavLink>
        </nav>
      </header>
      <main className="site-main"><Suspense fallback={null}><Outlet /></Suspense></main>
      <Footer jewel />
    </div>
  );
}

export function Footer({ jewel }: { jewel?: boolean }) {
  return (
    <footer className="ft">
      <div className="ft-row">
        <div className="ft-tag">{EVENT.tagline}.</div>
        <nav className="ft-links" aria-label="Footer">
          {CLUB.facebookUrl && <a href={CLUB.facebookUrl} target="_blank" rel="noreferrer">Facebook group</a>}
          <a href={YOUTUBE_CHANNEL} target="_blank" rel="noreferrer">YouTube</a>
          <a href={EVENT.registerUrl} target="_blank" rel="noreferrer">Disc Golf Scene</a>
          <Link to="/td" className="ft-muted">TD login</Link>
        </nav>
        <div className="ft-small">{CLUB.name} · {CLUB.place}{jewel ? ' · Jewel XI presented by Innova' : ''}</div>
      </div>
    </footer>
  );
}
