/** Write-ups (course descriptions): blank line = new paragraph, **double stars** = bold. No HTML. */
import { boldParts } from '../lib/text';

export function Prose({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className}>
      {text.split(/\n\s*\n/).map((para, i) => (
        <p key={i}>{para.split('\n').map((line, j) => (
          <span key={j}>{j > 0 && <br />}{boldParts(line).map((b, k) => (b.bold ? <b key={k}>{b.text}</b> : <span key={k}>{b.text}</span>))}</span>
        ))}</p>
      ))}
    </div>
  );
}
