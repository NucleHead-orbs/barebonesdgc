/**
 * My Tag: LEADERBOARD pop-up next to each tag (bug squasher 2026-10-09, Will Mercer: "see who currently has what tags").
 * Source: the roster tag_me already returns (every holder in the set, by number). No extra request.
 */
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { RosterEntry } from '../../lib/tags/api';
import { display } from '../../lib/tags/tags';

export function TagLeaderboard({ poolName, poolSlug, roster, meId, onClose }: {
  poolName: string; poolSlug: string; roster: RosterEntry[]; meId: string; onClose: () => void;
}) {
  const me = useRef<HTMLLIElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeBtn.current?.focus();
    me.current?.scrollIntoView({ block: 'center' });
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', esc); document.body.style.overflow = ''; };
  }, [onClose]);
  const rows = roster.slice().sort((a, b) => a.number - b.number);
  return (
    <div className="lb-wrap" role="presentation" onClick={onClose}>
      <div className="lb" role="dialog" aria-modal="true" aria-label={`${poolName} leaderboard`} onClick={(e) => e.stopPropagation()}>
        <header className="lb-head">
          <div><b>{poolName}</b><span>{rows.length} tags out · lowest number on top</span></div>
          <button ref={closeBtn} type="button" className="lb-x" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <ol className="lb-list">
          {rows.map((r) => (
            <li key={r.member_id} ref={r.member_id === meId ? me : undefined} className={`${r.member_id === meId ? 'is-me' : ''}${r.number === 1 ? ' is-top' : ''}`}>
              <span className="lb-num">#{r.number}</span>
              <span className="lb-name">{display(r)}</span>
              {r.member_id === meId && <span className="lb-you">YOU</span>}
            </li>
          ))}
        </ol>
        <Link className="lb-more" to={`/tags/${poolSlug}`}>Full board, fuses and tag history ›</Link>
      </div>
    </div>
  );
}
