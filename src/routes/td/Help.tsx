import { useEffect, useState } from 'react';
import { HELP, boldParts } from '../../lib/td/help';

/** HELP button for the /td header. Opens the guide over the page; Esc or ✕ closes it. */
export function HelpButton({ start }: { start?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);
  return (
    <>
      <button className="td-btn quiet" onClick={() => setOpen(true)}>HELP</button>
      {open && <HelpPanel start={start} onClose={() => setOpen(false)} />}
    </>
  );
}

function HelpPanel({ start, onClose }: { start?: string; onClose: () => void }) {
  useEffect(() => { if (start) document.getElementById(`help-${start}`)?.scrollIntoView(); }, [start]);
  return (
    <div className="td-help" role="dialog" aria-modal="true" aria-label="TD help">
      <div className="td-help-inner">
        <div className="td-row">
          <h2 className="td-h2">How it works</h2>
          <div style={{ flex: 1 }} />
          <button className="td-btn" onClick={onClose} aria-label="Close help">✕ CLOSE</button>
        </div>
        <nav className="td-chips" aria-label="Help topics">
          {HELP.map((s) => (
            <button key={s.id} className="td-chip" onClick={() => document.getElementById(`help-${s.id}`)?.scrollIntoView({ behavior: 'smooth' })}>{s.title}</button>
          ))}
        </nav>
        {HELP.map((s) => (
          <section key={s.id} id={`help-${s.id}`} className="td-help-sec">
            <h3>{s.title}</h3>
            <ol>
              {s.steps.map((st, i) => (
                <li key={i}>{boldParts(st).map((p, j) => (p.bold ? <b key={j}>{p.text}</b> : <span key={j}>{p.text}</span>))}</li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
