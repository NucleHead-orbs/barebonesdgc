import { useMemo, useState } from 'react';
import { rankDivision, divisionsPresent, onCourse, toPar, parTone, type LbRow, type Mode } from '../lib/jewel/leaderboard';

/**
 * Division leaderboard (Official / Live), shared by /jewel and every /e/<slug> event page.
 * Ranking rules live in lib/jewel/leaderboard.ts; this only lays them out.
 * One-round events drop the R1/R2 columns and show the total alone.
 */
export default function Leaderboard({ board, rounds, empty }: { board: LbRow[]; rounds: 1 | 2; empty: string }) {
  const [mode, setMode] = useState<Mode>('live');
  const [div, setDiv] = useState<string>('All');
  const divs = useMemo(() => divisionsPresent(board), [board]);
  const live = onCourse(board);
  const shown = div === 'All' ? divs : divs.filter((d) => d === div);
  const two = rounds === 2;

  return (
    <>
      <div className="jw-row">
        <h2 className="jw-h2">Leaderboard</h2>
        <span className="jw-live">{live ? `● LIVE · ${live} ON COURSE` : `${board.length} REGISTERED`}</span>
      </div>
      <div className="jw-row">
        <div className="jw-seg">
          {(['official', 'live'] as Mode[]).map((m) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m === 'official' ? 'OFFICIAL' : 'LIVE'}</button>
          ))}
        </div>
        <span className="jw-note" style={{ flex: 1, minWidth: 160 }}>
          {mode === 'official' ? 'Only signed & submitted cards count.' : 'Showing live, unsigned scores: unofficial until the card signs off.'}
        </span>
      </div>
      {divs.length > 1 && (
        <div className="jw-chips" role="group" aria-label="Division">
          {['All', ...divs].map((d) => <button key={d} className="jw-chip" aria-pressed={div === d} onClick={() => setDiv(d)}>{d}</button>)}
        </div>
      )}
      {!divs.length && <div className="jw-banner">{empty}</div>}
      {shown.map((d) => {
        const ranked = rankDivision(board.filter((r) => r.div_code === d), mode);
        return (
          <section key={d} className="jw-div" aria-label={`${d} leaderboard`}>
            <div className="jw-div-head"><b>{d}</b><span>{ranked.length} player{ranked.length === 1 ? '' : 's'}</span></div>
            <div className={`jw-grid hdr${two ? '' : ' one'}`}><span>POS</span><span>PLAYER</span>{two && <><span className="num">R1</span><span className="num">R2</span></>}<span className="num">TOT</span></div>
            {ranked.map((p) => (
              <div key={p.id} className={`jw-grid${two ? '' : ' one'}`}>
                <span className={`jw-pos${p.first ? ' first' : ''}`}>{p.pos}</span>
                <span className="jw-name"><b>{p.name}</b><span>{two ? p.status : p.status.replace(/^R1 · /, '').replace(/^R1 ✓/, '✓')}</span></span>
                {two && <><span className={`num ${parTone(p.r1)}`}>{toPar(p.r1)}</span><span className={`num ${parTone(p.r2)}`}>{toPar(p.r2)}</span></>}
                <span className={`num tot ${parTone(p.total)}`}>{toPar(p.total)}</span>
              </div>
            ))}
          </section>
        );
      })}
    </>
  );
}
