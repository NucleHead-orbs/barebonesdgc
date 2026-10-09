/** SKIN button for a screen header + the sheet that picks one. Any number per page; they share one value (lib/skins). */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SKINS, skinOf, useSkin, type Skin, type SkinId } from '../../lib/skins';
import './skins.css';

export function SkinPicker() {
  const { skin } = useSkin();
  const [open, setOpen] = useState(false);
  const k = skinOf(skin);
  return (
    <>
      <button type="button" className="sk-btn" aria-haspopup="dialog" onClick={() => setOpen(true)} title={`Skin: ${k.name}`}>
        <span className="sk-dots" aria-hidden="true">{[k.mini[2], k.mini[4], k.mini[1]].map((c, i) => <i key={i} style={{ background: c }} />)}</span>
        <span>SKIN</span><span className="sk-sr">: {k.name}. Change skin</span>
      </button>
      {open && createPortal(<SkinSheet onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

export function Mini({ s }: { s: Skin }) {
  const [band, rule, card, ink, btn] = s.mini;
  return (
    <span className="sk-mini" aria-hidden="true" style={{ background: card }}>
      <span className="b" style={{ background: band }} /><span className="r" style={{ background: rule }} />
      <span className="c" style={{ background: card, boxShadow: `inset 0 0 0 1px ${ink}33` }} />
      <span className="l" style={{ background: ink, color: ink }} /><span className="a" style={{ background: btn }} />
    </span>
  );
}

function SkinSheet({ onClose }: { onClose: () => void }) {
  const { skin, pick, dflt, pickSkin } = useSkin();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const choose = (id: SkinId | null) => { pickSkin(id); onClose(); };
  const club = dflt ? skinOf(dflt.skin) : null;
  return (
    <div className="sk-scrim" onClick={onClose}>
      <div className="sk-sheet" role="dialog" aria-modal="true" aria-labelledby="sk-title" onClick={(e) => e.stopPropagation()}>
        <div className="sk-sheet-head"><h2 id="sk-title">Pick a skin</h2><button type="button" className="sk-x" onClick={onClose} aria-label="Close">×</button></div>
        <div role="radiogroup" aria-labelledby="sk-title" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {SKINS.map((s) => (
            <button key={s.id} ref={skin === s.id ? first : undefined} type="button" role="radio" aria-checked={skin === s.id} className="sk-opt" onClick={() => choose(s.id)}>
              <Mini s={s} />
              <span><b>{s.name}{!pick && dflt?.skin === s.id ? ' · club pick' : ''}</b><small>{s.blurb}</small></span>
              <span className="sk-check" aria-hidden="true">{skin === s.id ? '✓' : ''}</span>
            </button>
          ))}
        </div>
        {pick
          ? <button type="button" className="td-link sc-link" onClick={() => choose(null)}>Follow the club pick instead ({club ? club.name : 'Night Card'})</button>
          : <p className="sk-default">Following the club pick. Choose one above to keep it on this phone.</p>}
      </div>
    </div>
  );
}
