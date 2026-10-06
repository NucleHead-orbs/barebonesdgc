/**
 * "Put it on your home screen" cards (scorecard setup screen; My Tag from its button), and the one-time
 * connect step inside the iPhone app (home-screen apps on iPhone don't share Safari's memory).
 */
import { useState } from 'react';
import { HIDE_DAYS, INSTALL_KEY, type App, hiddenUntil, hideFor, platformOf, showInstall, tagLinkFor, type Platform } from '../../lib/rounds/install';
import { isStandalone, useInstallPrompt } from '../../lib/rounds/useInstall';
import './rounds.css';

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

function ShareIcon() {
  return (
    <svg className="ic-share" viewBox="0 0 20 24" width="16" height="19" aria-hidden="true">
      <path d="M10 2v13M5.5 6.5 10 2l4.5 4.5M6 10H3v12h14V10h-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const COPY: Record<App, { icon: string; title: string; pitch: string; look: string }> = {
  scorecard: { icon: '/assets/app/scorecard-180.png', title: 'Make it an app', pitch: 'One tap from your home screen to a fresh card. Fastest way to start a casual round.', look: 'Look for the glowing skull.' },
  mytag: { icon: '/assets/app/mytag-180.png', title: 'My Tag on your home screen', pitch: 'Your tags, the Board and your matchups one tap away. It\'s your private link, so it only lives on your phone.', look: 'Look for the glowing tag.' },
};

/**
 * Scorecard: shows itself on the setup screen (Not now hides it for a while).
 * My Tag: opened from a button, so `onClose` closes it instead of remembering anything.
 */
export function InstallCard({ app, token, force, onClose }: { app: App; token: string | null; force: boolean; onClose?: () => void }) {
  const [platform] = useState<Platform>(() => platformOf(navigator.userAgent, navigator.maxTouchPoints, navigator.platform));
  const [standalone] = useState(isStandalone);
  const [until, setUntil] = useState(() => hiddenUntil(read(INSTALL_KEY)));
  const [now] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [done, setDone] = useState(false);
  const prompt = useInstallPrompt();
  // Chrome's real install only exists where the page carries a manifest (the scorecard)
  const canPrompt = app === 'scorecard' && prompt.canPrompt;
  if (done || !showInstall({ standalone, platform, canPrompt, hiddenUntil: until, now, force })) return null;
  const c = COPY[app];

  const notNow = () => { const t = hideFor(Date.now()); write(INSTALL_KEY, String(t)); setUntil(t); };
  const copy = async () => {
    if (!token) return;
    try { await navigator.clipboard.writeText(tagLinkFor(location.origin, token)); setCopied(true); } catch { setCopied(false); }
  };

  return (
    <section className={`sc-panel sc-install is-${app}`} aria-label={c.title}>
      <div className="sc-install-head">
        <img src={c.icon} alt="" width="56" height="56" />
        <div><h2>{c.title}</h2>
          <p className="sc-hint">{c.pitch}</p></div>
      </div>

      {canPrompt ? (
        <button className="sc-btn cta big" onClick={() => void prompt.install().then((ok) => { if (ok) setDone(true); })}>Install the scorecard</button>
      ) : platform === 'ios' ? (
        <ol className="sc-steps">
          {app === 'scorecard' && token && <li><b>Copy your link first.</b> The app keeps its own memory, so you paste it once inside.
            <button className="sc-btn" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy my link'}</button></li>}
          <li>Tap <b>Share</b> <ShareIcon /> in Safari's bottom bar (on newer iPhones it's under the <b>•••</b> button).</li>
          <li>Swipe the list up or tap <b>View More</b>, then tap <b>Add to Home Screen</b>.</li>
          <li>Tap <b>Add</b>. {c.look}</li>
        </ol>
      ) : (
        <ol className="sc-steps">
          <li>Tap your browser's menu (<b>⋮</b>, top right).</li>
          <li>Tap <b>Add to Home screen</b> (or <b>Install app</b>), then <b>Add</b>.</li>
        </ol>
      )}
      {onClose
        ? <button className="sc-link sc-install-later" onClick={onClose}>Close</button>
        : <button className="sc-link sc-install-later" onClick={notNow}>Not now (hides for {HIDE_DAYS} days)</button>}
    </section>
  );
}

/** Inside the home-screen app with no My Tag link yet: connect once. */
export function AppConnect({ onConnect }: { onConnect: (link: string) => void }) {
  const [standalone] = useState(isStandalone);
  const [typing, setTyping] = useState(false);
  const [link, setLink] = useState('');
  if (!standalone) return null;
  const paste = async () => {
    try { const t = await navigator.clipboard.readText(); if (t.trim()) return onConnect(t); } catch { /* no clipboard: type it */ }
    setTyping(true);
  };
  return (
    <section className="sc-panel sc-install">
      <h2>Welcome to the app</h2>
      <p className="sc-hint">Connect your My Tag link once so this app can save rounds as you. Copied it already? Tap below.</p>
      <button className="sc-btn cta big" onClick={() => void paste()}>Paste my link</button>
      {typing && (
        <form className="sc-row" onSubmit={(e) => { e.preventDefault(); onConnect(link); }}>
          <input id="sc-app-link" className="sc-input" placeholder="barebonesdiscgolf.club/tag/…" value={link} onChange={(e) => setLink(e.target.value)} />
          <button className="sc-btn" disabled={!link.trim()}>Connect</button>
        </form>
      )}
      <p className="sc-hint">No link handy? Keep score anyway. You can connect when you save.</p>
    </section>
  );
}
