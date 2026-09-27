import { Link } from 'react-router-dom';
import { EVENT } from '../lib/jewel/content';
import './jewel/jewel.css';

/** barebonesdiscgolf.club landing. The full club site comes later; today it points at the Jewel. */
export default function Home() {
  return (
    <main className="hm">
      <img src="/assets/wordmark-bare-bones-cut.png" alt="Bare Bones Disc Golf" width={240} height={102} />
      <h1>{EVENT.title}</h1>
      <div className="jw-sub">{EVENT.subtitle}</div>
      <p className="jw-note">{EVENT.venue}</p>
      <Link className="jw-cta" to="/jewel">ENTER THE JEWEL XI</Link>
      <a className="jw-cta" style={{ background: 'transparent', border: '2px solid var(--cyan)', color: 'var(--cyan)' }}
        href={EVENT.registerUrl} target="_blank" rel="noreferrer">REGISTER ON DISC GOLF SCENE</a>
      <Link className="ghost" to="/jewel#course">THE SETLIST · COURSE GUIDE</Link>
      <p className="jw-tagline" style={{ fontFamily: 'var(--font-quote)', fontSize: 20 }}>{EVENT.tagline}</p>
    </main>
  );
}
