/** The reaction overlay: a burst of the reaction falling across the screen + who sent it. Never blocks taps. */
import { useEffect } from 'react';
import { particles, reactionLine, reactionOf, type LiveReaction } from '../../lib/rounds/live';

export function LiveFx({ r, onDone }: { r: LiveReaction | undefined; onDone: () => void }) {
  useEffect(() => { if (!r) return; const t = window.setTimeout(onDone, 2600); return () => window.clearTimeout(t); }, [r, onDone]);
  if (!r) return null;
  const x = reactionOf(r.kind);
  return (
    <div className={`lfx lfx-${x.tone}`} aria-live="polite">
      {particles(r.id).map((p, i) => (
        <span key={i} className="lfx-p" style={{ left: `${p.x}%`, animationDelay: `${p.delay}ms`, fontSize: p.size }}>{x.glyph}</span>
      ))}
      <div className="lfx-banner"><span className="lfx-glyph">{x.glyph}</span>{reactionLine(r)}</div>
    </div>
  );
}
