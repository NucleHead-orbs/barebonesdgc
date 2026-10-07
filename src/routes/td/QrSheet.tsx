import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { cardUrl, type PublishedCard } from '../../lib/td/builder';

/** Where printed codes point. Set VITE_PUBLIC_ORIGIN so codes printed from a dev machine still hit the live site. */
const publicOrigin = (): string =>
  (import.meta.env.VITE_PUBLIC_ORIGIN as string | undefined)?.trim() || window.location.origin;

/** One code per published card, pointing at /c/<token>. Tokens come from td_publish_round. */
export default function QrSheet({ round, eventName, cards, names, onBack, wave = null, slug = null }: {
  round: 1 | 2; eventName: string; cards: PublishedCard[]; names: Record<string, string>; onBack: () => void;
  /** two-wave events print one wave at a time */
  wave?: 'AM' | 'PM' | null;
  /** the event's slug: its live leaderboard is printed on the DVD insert */
  slug?: string | null;
}) {
  const origin = publicOrigin();
  const courseUrl = slug ? `${origin.replace(/\/$/, '')}/e/${slug}` : null;
  // 'dvd' = one card per DVD case front sleeve (5.25 x 7.25 in), two per landscape letter page, cut on the line
  const [layout, setLayout] = useState<'sheet' | 'dvd'>('dvd');
  const [svgs, setSvgs] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    Promise.all(cards.map(async (c) => [c.token, await QRCode.toString(cardUrl(origin, c.token), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })] as const))
      .then((pairs) => { if (live) setSvgs(Object.fromEntries(pairs)); })
      .catch((e: unknown) => { if (live) setError(`Could not draw QR codes: ${String(e)}`); });
    return () => { live = false; };
  }, [cards, origin]);

  const local = /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(origin);
  const missing = cards.filter((c) => !c.token).length;

  return (
    <div className="td-qr">
      <div className="td-row td-noprint">
        <button className="td-btn" onClick={onBack}>‹ BACK TO CARDS</button>
        <div className="td-title">QR Sheet · R{round}{wave ? ` · ${wave} wave` : ''}</div>
        <div className="td-seg cyan">
          <button aria-pressed={layout === 'dvd'} onClick={() => setLayout('dvd')}>DVD CASE INSERTS</button>
          <button aria-pressed={layout === 'sheet'} onClick={() => setLayout('sheet')}>CODE SHEET</button>
        </div>
        <div style={{ flex: 1 }} />
        <button className="td-btn cta" onClick={() => window.print()} disabled={!cards.length || missing > 0}>PRINT</button>
      </div>
      <div className="td-hint td-noprint">{cards.length} cards · codes open {origin}/c/… · a code belongs to its slot (e.g. AM 7B), so it keeps working if you regenerate and republish.
        {layout === 'dvd' ? ' DVD inserts: print landscape at 100% (no "fit to page"), 2 per page, cut on the dashed line, slide into the clear front sleeve. Course guide + map go inside the case.' : ''}</div>
      {local && <div className="td-warn td-noprint">These codes point at {origin}, which phones on the course can't reach. Set VITE_PUBLIC_ORIGIN (the live site address) before printing.</div>}
      {missing > 0 && <div className="td-warn td-noprint">{missing} card(s) came back without a token. Republish before printing.</div>}
      {error && <div className="td-warn td-noprint">{error}</div>}
      {layout === 'dvd' ? <>
        <style>{'@media print { @page { size: letter landscape; margin: 0.25in; } }'}</style>
        <div className="td-dvd-grid">
          {cards.map((c) => (
            <div className="td-dvd" key={`${c.wave}-${c.label}`}>
              <div className="ev">{eventName}</div>
              <div className="hole">HOLE {c.label}</div>
              <div className="meta">Round {round}{c.wave === 'AM' && !cards.some((x) => x.wave === 'PM') && !wave ? '' : ` · ${c.wave} wave`} · start on hole {c.start_hole}</div>
              {svgs[c.token] ? <div className="qr" dangerouslySetInnerHTML={{ __html: svgs[c.token] }} /> : <div className="qr" />}
              <div className="scan">SCAN TO KEEP SCORE</div>
              <ol className="steps">
                <li>Point your camera at the code, tap the link.</li>
                <li>Tap a number to score each player, then <b>NEXT HOLE</b>.</li>
                <li>Passing the phone? Tap <b>HAND THE CARD OFF</b>.</li>
                <li>Last hole: everyone signs, then <b>SUBMIT CARD</b>.</li>
              </ol>
              <div className="names">{c.players.map((id) => names[id] ?? '?').join(' · ')}</div>
              <div className="url">{courseUrl ? `Live scores: ${courseUrl.replace(/^https?:\/\//, '')}` : cardUrl(origin, c.token)}</div>
            </div>
          ))}
        </div>
      </> : (
        <div className="td-qr-grid">
        {cards.map((c) => (
          <div className="td-qr-card" key={`${c.wave}-${c.label}`}>
            <div className="start">{eventName}</div>
            <div className="lbl">{c.wave === 'AM' && !cards.some((x) => x.wave === 'PM') ? '' : `${c.wave} · `}Hole {c.label}</div>
            <div className="start">R{round} · start on hole {c.start_hole}</div>
            {svgs[c.token] ? <div dangerouslySetInnerHTML={{ __html: svgs[c.token] }} style={{ width: '100%', display: 'flex', justifyContent: 'center' }} /> : <div style={{ height: 190 }} />}
            <div className="names">{c.players.map((id) => names[id] ?? '?').join(' · ')}</div>
            <div className="url">{cardUrl(origin, c.token)}</div>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
