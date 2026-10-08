/** The G-MODE switch in the My Tag and Scorecard headers. Presentational: the page owns useGMode. */
import './gmode.css';

export function GModeToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" className="gm-toggle" aria-pressed={on} onClick={() => onChange(!on)}
      title={on ? 'Back to dark mode' : 'G-Mode (Grandpa mode): lights on, bigger print'}>
      <svg viewBox="0 0 34 16" aria-hidden="true">
        <circle cx="8.5" cy="9" r="5.5" /><circle cx="25.5" cy="9" r="5.5" />
        <path d="M14 8.2c1.8-1.6 4.2-1.6 6 0M3 7.5 1 4.5M31 7.5l2-3" />
      </svg>
      <span>G-MODE</span>
      <span className="gm-sr">{on ? ' on' : ' off'} (Grandpa mode, light)</span>
    </button>
  );
}
