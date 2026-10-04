/** A league's bag tag as a card you can flip: number side first, tap for the art side. Art + animations live in the SVGs. */
import { useState } from 'react';
import type { TagArt } from '../lib/tags/tags';
import './digital-tag.css';

export function DigitalTag({ art, number, label }: { art: TagArt; number: number; label: string }) {
  const [flipped, setFlipped] = useState(false);
  const digits = String(number).length;
  const pos = {
    left: `${art.cx * 100}%`, top: `${art.cy * 100}%`,
    ...(art.numSize ? { fontSize: `${digits >= 3 ? art.numSize * 0.68 : art.numSize}cqw` } : {}),
  };
  return (
    <button type="button" className={`dt${art.shape === 'square' ? ' dt-sq' : ''}`} aria-pressed={flipped} onClick={() => setFlipped(!flipped)}
      aria-label={`${label} tag #${number}. Tap to flip.`}>
      <span className="dt-stage">
        <span className={`dt-card${flipped ? ' is-flipped' : ''}`}>
          <span className="dt-face dt-num">
            <img src={art.back} alt="" draggable={false} />
            {art.numFill
              ? <>
                  <b className={`dt-n dt-n${Math.min(digits, 3)}`} aria-hidden="true" style={{ ...pos, color: art.numStroke ?? '#000', WebkitTextStroke: `2.6cqw ${art.numStroke ?? '#000'}` }}>{number}</b>
                  <b className={`dt-n dt-n${Math.min(digits, 3)} dt-nfill`} style={{ ...pos, backgroundImage: art.numFill }}>{number}</b>
                </>
              : <b className={`dt-n dt-n${Math.min(digits, 3)}`} style={{
                  ...pos, color: art.numColor,
                  ...(art.numStroke ? { WebkitTextStroke: `2.6cqw ${art.numStroke}`, paintOrder: 'stroke fill' } : {}),
                }}>{number}</b>}
          </span>
          <span className="dt-face dt-art"><img src={art.front} alt="" draggable={false} /></span>
        </span>
      </span>
    </button>
  );
}
