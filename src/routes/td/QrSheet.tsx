import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { cardUrl, type PublishedCard } from '../../lib/td/builder';

/** Where printed codes point. Set VITE_PUBLIC_ORIGIN so codes printed from a dev machine still hit the live site. */
const publicOrigin = (): string =>
  (import.meta.env.VITE_PUBLIC_ORIGIN as string | undefined)?.trim() || window.location.origin;

/** One code per published card, pointing at /c/<token>. Tokens come from td_publish_round. */
export default function QrSheet({ round, cards, names, onBack }: {
  round: 1 | 2; cards: PublishedCard[]; names: Record<string, string>; onBack: () => void;
}) {
  const origin = publicOrigin();
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
        <button className="td-btn" onClick={onBack}>‹ BACK TO BUILDER</button>
        <div className="td-title">QR Sheet · R{round}</div>
        <div style={{ flex: 1 }} />
        <button className="td-btn cta" onClick={() => window.print()} disabled={!cards.length || missing > 0}>PRINT</button>
      </div>
      <div className="td-hint td-noprint">{cards.length} cards · codes open {origin}/c/… · a code belongs to its slot (e.g. AM 7B), so it keeps working if you regenerate and republish.</div>
      {local && <div className="td-warn td-noprint">These codes point at {origin}, which phones on the course can't reach. Set VITE_PUBLIC_ORIGIN (e.g. https://barebonesdiscgolf.club) before printing.</div>}
      {missing > 0 && <div className="td-warn td-noprint">{missing} card(s) came back without a token. Republish before printing.</div>}
      {error && <div className="td-warn td-noprint">{error}</div>}
      <div className="td-qr-grid">
        {cards.map((c) => (
          <div className="td-qr-card" key={`${c.wave}-${c.label}`}>
            <div className="lbl">{c.wave} · Hole {c.label}</div>
            <div className="start">R{round} · start on hole {c.start_hole}</div>
            {svgs[c.token] ? <div dangerouslySetInnerHTML={{ __html: svgs[c.token] }} style={{ width: '100%', display: 'flex', justifyContent: 'center' }} /> : <div style={{ height: 190 }} />}
            <div className="names">{c.players.map((id) => names[id] ?? '?').join(' · ')}</div>
            <div className="url">{cardUrl(origin, c.token)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
