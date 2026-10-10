import { useState } from 'react';
import { rankTeams, toPar, parTone, type Mode, type TeamRow } from '../lib/jewel/leaderboard';

/** Doubles leaderboard: one pool of teams (Official / Live), same look as the division board. */
/** playoffCaptain: captain of the team that won a playoff for 1st (settles a T1). */
export default function TeamBoard({ rows, title, style, playoffCaptain }: { rows: TeamRow[]; title: string; style: string; playoffCaptain?: string | null }) {
  const [mode, setMode] = useState<Mode>('live');
  const ranked = rankTeams(rows, mode, playoffCaptain);
  const live = rows.filter((t) => t.holes_played > 0 && t.holes_played < t.hole_count && !t.official).length;
  return (
    <>
      <div className="jw-row">
        <h2 className="jw-h2">{title}</h2>
        <span className="jw-live">{live ? `● LIVE · ${live} TEAMS ON COURSE` : `${rows.length} TEAMS`}</span>
      </div>
      <div className="jw-row">
        <div className="jw-seg">
          {(['official', 'live'] as Mode[]).map((m) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m === 'official' ? 'OFFICIAL' : 'LIVE'}</button>
          ))}
        </div>
        <span className="jw-note" style={{ flex: 1, minWidth: 160 }}>Random draw doubles · {style}. {mode === 'official' ? 'Only signed & submitted cards count.' : 'Live, unsigned scores are unofficial.'}</span>
      </div>
      {!rows.length && <div className="jw-banner">Partners haven't been drawn yet.</div>}
      {rows.length > 0 && (
        <section className="jw-div" aria-label="Doubles leaderboard">
          <div className="jw-div-head"><b>DUBS</b><span>{rows.length} team{rows.length === 1 ? '' : 's'}</span></div>
          <div className="jw-grid hdr one"><span>POS</span><span>TEAM</span><span className="num">TOT</span></div>
          {ranked.map((t) => (
            <div key={t.id} className="jw-grid one">
              <span className={`jw-pos${t.first ? ' first' : ''}`}>{t.pos}</span>
              <span className="jw-name"><b>{t.name}</b><span>{t.status}</span></span>
              <span className={`num tot ${parTone(t.total)}`}>{toPar(t.total)}</span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
