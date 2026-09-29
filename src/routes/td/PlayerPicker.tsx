import { useMemo, useState } from 'react';
import type { ExistingPlayer } from '../../lib/td/builder';

/** Type-to-find, tap-to-add player picker (TD side). Picked players show as removable chips. */
export function PlayerPicker({ players, picked, max, exclude = [], onChange, placeholder }: {
  players: ExistingPlayer[]; picked: string[]; max: number; exclude?: string[];
  onChange: (ids: string[]) => void; placeholder: string;
}) {
  const [q, setQ] = useState('');
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const query = q.trim().toLowerCase();
  const hits = query
    ? players.filter((p) => p.name.toLowerCase().includes(query) && !picked.includes(p.id) && !exclude.includes(p.id)).slice(0, 8)
    : [];
  const full = picked.length >= max;
  return (
    <div className="td-picker">
      {picked.length > 0 && (
        <div className="td-chips">
          {picked.map((id) => (
            <span key={id} className="td-divpick"><b>{byId.get(id)?.name ?? '?'}</b>
              <button type="button" aria-label={`Remove ${byId.get(id)?.name ?? ''}`} onClick={() => onChange(picked.filter((x) => x !== id))}>×</button>
            </span>
          ))}
        </div>
      )}
      <input className="td-input" value={q} disabled={full} placeholder={full ? `That's the max (${max}).` : placeholder}
        onChange={(e) => setQ(e.target.value)} aria-label="Find a player" />
      {hits.length > 0 && (
        <div className="td-picker-hits">
          {hits.map((p) => (
            <button type="button" key={p.id} onClick={() => { onChange([...picked, p.id]); setQ(''); }}>
              {p.name} <span className="td-hint">{p.div_code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
