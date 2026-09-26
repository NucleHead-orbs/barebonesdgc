import { useMemo, useState } from 'react';
import { parseDgsCsv, type Field, type Mapping } from '../../lib/import/dgs';
import { importDiff, type ExistingPlayer } from '../../lib/td/builder';
import type { ImportRow } from '../../lib/import/dgs';

const FIELDS: Array<[Field, string]> = [
  ['division', 'Division'], ['name', 'Name'], ['first', 'First name'], ['last', 'Last name'],
  ['pdga', 'PDGA#'], ['regDate', 'Registration date'], ['rating', 'Rating'],
];
const REASON: Record<string, string> = {
  footer: 'Totals footer', no_name: 'No name', sponsor_only: 'Sponsor only (SPON)', unknown_division: 'Unknown division',
};

/**
 * Review a DGS CSV before anything touches the database: column mapping (overridable),
 * skipped rows with reasons, blocking problems, and a new / changed / unchanged preview.
 * The file text lives only in memory and is dropped on import or cancel.
 */
export default function ImportReview({ fileName, text, divCodes, existing, busy, onImport, onCancel }: {
  fileName: string; text: string; divCodes: string[]; existing: ExistingPlayer[]; busy: boolean;
  onImport: (rows: ImportRow[]) => void; onCancel: () => void;
}) {
  const [override, setOverride] = useState<Mapping>({});
  const parsed = useMemo(() => parseDgsCsv(text, divCodes, override), [text, divCodes, override]);
  const diff = useMemo(() => importDiff(parsed.rows, existing), [parsed.rows, existing]);
  const nothingToDo = parsed.rows.length > 0 && diff.inserts.length === 0 && diff.updates.length === 0;

  return (
    <section className="td-panel" aria-label="Import review">
      <div className="td-row">
        <h2>Import review</h2>
        <span className="td-hint">{fileName} · {parsed.rows.length} players found</span>
      </div>

      <div className="td-group">
        <div className="td-label">COLUMN MAPPING</div>
        <div className="td-map">
          {FIELDS.map(([f, label]) => (
            <label key={f}>{label}
              <select className="td-select" value={parsed.mapping[f] ?? ''}
                onChange={(e) => setOverride((o) => ({ ...o, [f]: e.target.value }))}>
                <option value="">— not used —</option>
                {parsed.headers.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
          ))}
        </div>
        <div className="td-hint">Only these columns are read. Email, phone, address and payment columns never leave this file.</div>
      </div>

      {parsed.blocking.map((b) => <div key={b} className="td-warn" role="alert">⚠ {b}</div>)}

      {!parsed.blocking.length && (
        <div className="td-counts">
          <Stat v={diff.inserts.length} k="NEW" color="var(--under)" />
          <Stat v={diff.updates.length} k="CHANGED" color={diff.updates.length ? 'var(--gold)' : '#fff'} />
          <Stat v={diff.unchanged.length} k="UNCHANGED" color="#fff" />
          <Stat v={parsed.skipped.length} k="SKIPPED" color={parsed.skipped.length ? 'var(--over)' : '#fff'} />
        </div>
      )}

      {diff.updates.length > 0 && (
        <div className="td-group">
          <div className="td-label">CHANGES TO EXISTING PLAYERS</div>
          <table className="td-table"><thead><tr><th>Player</th><th>Division</th><th>What changes</th></tr></thead>
            <tbody>{diff.updates.map((u) => <tr key={u.row.name}><td>{u.row.name}</td><td>{u.row.div_code}</td><td>{u.fields.join(', ')}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      {parsed.skipped.length > 0 && (
        <div className="td-group">
          <div className="td-label">SKIPPED ROWS</div>
          <table className="td-table"><thead><tr><th>Line</th><th>Name</th><th>Reason</th></tr></thead>
            <tbody>{parsed.skipped.map((s) => (
              <tr key={s.line}><td>{s.line}</td><td>{s.name || '—'}</td><td>{REASON[s.reason]}{s.detail ? ` (“${s.detail}”)` : ''}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {nothingToDo && <div className="td-warn soft">Every player already matches the database. Importing changes nothing.</div>}

      <div className="td-actions">
        <button className="td-btn cta" disabled={busy || parsed.blocking.length > 0 || parsed.rows.length === 0}
          onClick={() => onImport(parsed.rows)}>
          {busy ? 'IMPORTING…' : nothingToDo ? 'IMPORT (NO CHANGES)' : `IMPORT ${diff.inserts.length + diff.updates.length} PLAYERS`}
        </button>
        <button className="td-btn" onClick={onCancel} disabled={busy}>CANCEL</button>
      </div>
    </section>
  );
}

const Stat = ({ v, k, color }: { v: number; k: string; color: string }) => (
  <div className="td-stat"><b style={{ color }}>{v}</b><span>{k}</span></div>
);
