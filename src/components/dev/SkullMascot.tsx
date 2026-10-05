/** The skull: Bare Bones' bug-hunting mascot (cream bone, glowing eyes, a little crack, bug antennae). Pure SVG. */
export function SkullMascot({ size = 48, mood = 'idle' }: { size?: number; mood?: 'idle' | 'happy' }) {
  return (
    <svg className={`skm skm-${mood}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <g className="skm-ant">
        <path d="M24 13 C21 6 16 4 12 5" fill="none" stroke="#9b86b8" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M40 13 C43 6 48 4 52 5" fill="none" stroke="#9b86b8" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="12" cy="5" r="3.2" fill="#c6ff3d" stroke="#1b1424" strokeWidth="1.6" />
        <circle cx="52" cy="5" r="3.2" fill="#c6ff3d" stroke="#1b1424" strokeWidth="1.6" />
      </g>
      <g className="skm-head">
        <path d="M32 10 C17 10 9 20 9 32 C9 39 12 43 17 45 L17 51 C17 54 19 56 22 56 L42 56 C45 56 47 54 47 51 L47 45 C52 43 55 39 55 32 C55 20 47 10 32 10 Z"
          fill="#f6efdc" stroke="#1b1424" strokeWidth="3" strokeLinejoin="round" />
        <path d="M44 15 L40 21 L44 24 L41 29" fill="none" stroke="#1b1424" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <ellipse cx="23" cy="33" rx="7" ry="7.5" fill="#1b1424" />
        <ellipse cx="41" cy="33" rx="7" ry="7.5" fill="#1b1424" />
        <g className="skm-eyes">
          <circle cx="24" cy="33" r="3" fill="#c6ff3d" />
          <circle cx="40" cy="33" r="3" fill="#c6ff3d" />
        </g>
        <path d="M29.5 44 L32 40 L34.5 44 Z" fill="#1b1424" />
        <path d="M22 49 L42 49 M27 46.5 L27 55 M32 46.5 L32 55 M37 46.5 L37 55" stroke="#1b1424" strokeWidth="2" strokeLinecap="round" />
      </g>
    </svg>
  );
}
