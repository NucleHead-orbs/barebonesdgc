/**
 * League week (top of WINNERS on a league): hand out the league's weekly award (Lazy Boner Safety Vest) and load the
 * group photo. Singles week: one player. Dubs week: the winning team (both partners; a Cali alone).
 * Both show on the league's vest page (/leagues/<slug>/vest). Rules: migrations 20261023 (league_week) + 20261025 (league_vest).
 */
import { useEffect, useRef, useState } from 'react';
import type { ExistingPlayer } from '../../lib/td/builder';
import { teamName, type LbRow, type TeamRow } from '../../lib/jewel/leaderboard';
import { teamLeader, weekLeader } from '../../lib/leagues/leagues';
import { clearGroupPhoto, loadWeekState, photoUrl, setVest, uploadGroupPhoto, type WeekState } from '../../lib/leagues/api';

const why = (e: unknown): string => {
  const m = e instanceof Error ? e.message : String((e as { message?: string } | null)?.message ?? e);
  if (/forbidden/.test(m)) return 'Only this week\'s TDs can do that.';
  if (/unknown_player/.test(m)) return 'That player isn\'t in this week anymore. Refresh and pick again.';
  if (/too_many_holders/.test(m)) return 'Two people at most (a dubs team).';
  if (/vest_note_too_long/.test(m)) return 'Keep the shout-out to one line (120 characters).';
  if (/row-level security|Unauthorized|403/i.test(m)) return 'Upload refused: you\'re not a TD of this week.';
  if (/mime|payload too large|413/i.test(m)) return 'That photo won\'t upload. Use a JPG or PNG under 8 MB.';
  return m;
};

const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
/** What the picker shows for the saved holders: singles = the player; dubs = their team. */
const pickFor = (s: WeekState, doubles: boolean) => (doubles
  ? s.teams.find((t) => same([t.player_a, t.player_b].filter(Boolean) as string[], s.holders))?.id ?? ''
  : s.holders[0] ?? '');

export default function LeagueWeek({ eventId, players, board, teamRows, doubles }: {
  eventId: string; players: ExistingPlayer[]; board: LbRow[]; teamRows: TeamRow[]; doubles: boolean;
}) {
  const [st, setSt] = useState<WeekState | null>(null);
  const [pick, setPick] = useState(''); // singles: a player id; dubs: a team id
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'' | 'vest' | 'photo'>('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    loadWeekState(eventId).then((s) => {
      if (!live) return;
      setSt(s); setPick(pickFor(s, doubles)); setNote(s.vest_note ?? '');
    }, (e: unknown) => live && setErr(why(e)));
    return () => { live = false; };
  }, [eventId, doubles]);
  useEffect(() => { if (!ok) return; const t = setTimeout(() => setOk(''), 4000); return () => clearTimeout(t); }, [ok]);

  if (!st) return err ? <div className="td-warn" role="alert">{err}</div> : null;
  const award = st.award ?? 'Weekly award';
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? '?';
  const teamLabel = (t: WeekState['teams'][number]) => (t.player_b ? `${name(t.player_a)} & ${name(t.player_b)}` : `${name(t.player_a)} (Cali)`);
  const idsFor = (v: string): string[] => {
    if (!v) return [];
    if (!doubles) return [v];
    const t = st.teams.find((x) => x.id === v);
    return t ? [t.player_a, t.player_b].filter(Boolean) as string[] : [];
  };
  const sorted = [...players].sort((a, b) => a.name.localeCompare(b.name));
  const leaderId = doubles ? teamLeader(teamRows.filter((t) => t.round === 1)) : weekLeader(board);
  const leaderLabel = !leaderId ? null : doubles
    ? (() => { const r = teamRows.find((t) => t.team_id === leaderId); return r ? teamName(r) : null; })()
    : players.find((p) => p.id === leaderId)?.name ?? null;
  const holders = st.holders.map(name);
  const chosen = idsFor(pick);
  const dirty = !same(chosen, st.holders) || (chosen.length > 0 && note.trim() !== (st.vest_note ?? ''));
  const anyScores = doubles ? teamRows.some((t) => t.to_par !== null) : board.some((r) => r.r1_to_par !== null);

  const saveVest = async () => {
    setBusy('vest'); setErr('');
    try {
      await setVest(eventId, chosen, note);
      setSt({ ...st, holders: chosen, vest_note: chosen.length ? note.trim() || null : null });
      if (!chosen.length) setNote('');
      setOk(chosen.length ? `${chosen.map(name).join(' & ')} ${chosen.length > 1 ? 'get' : 'gets'} the ${award}.` : `${award} taken back.`);
    } catch (e) { setErr(why(e)); }
    setBusy('');
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    setBusy('photo'); setErr('');
    try { const path = await uploadGroupPhoto(eventId, f); setSt({ ...st, group_photo: path }); setOk('Group photo is up.'); } catch (e) { setErr(why(e)); }
    setBusy('');
    if (file.current) file.current.value = '';
  };
  const removePhoto = async () => {
    if (!window.confirm('Take the group photo off this week?')) return;
    setBusy('photo'); setErr('');
    try { await clearGroupPhoto(eventId); setSt({ ...st, group_photo: null }); } catch (e) { setErr(why(e)); }
    setBusy('');
  };

  return (
    <section className="td-panel lw-panel">
      <div className="td-row">
        <h2 className="td-h2">League week</h2>
        <div style={{ flex: 1 }} />
        {st.league_slug && <a className="td-btn quiet" href={`/leagues/${st.league_slug}/vest`} target="_blank" rel="noreferrer">VEST PAGE ↗</a>}
      </div>
      {err && <div className="td-warn" role="alert">{err}</div>}
      {ok && <div className="td-ok" role="status">{ok}</div>}

      <div className="lw-grid">
        <div className="lw-block">
          <div className="td-label">{award.toUpperCase()}{doubles ? ' · DUBS: THE WINNING TEAM' : ''}</div>
          <p className="td-hint">{holders.length ? <>Wearing it this week: <b>{holders.join(' & ')}</b></> : 'Not awarded yet.'}</p>
          {leaderId && leaderLabel && leaderId !== pick && (
            <button className="td-btn quiet" onClick={() => setPick(leaderId)}>LEADER: {leaderLabel.toUpperCase()} · PICK</button>
          )}
          {!leaderId && anyScores && <p className="td-hint">Tied for low: pick the {doubles ? 'team' : 'winner'}.</p>}
          {doubles && !st.teams.length && <p className="td-hint">No teams drawn for this week yet.</p>}
          <select className="td-select" value={pick} onChange={(e) => setPick(e.target.value)} aria-label={`${award} goes to`}>
            <option value="">Nobody yet</option>
            {doubles
              ? st.teams.map((t) => <option key={t.id} value={t.id}>{teamLabel(t)}</option>)
              : sorted.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {pick && <input className="td-input" value={note} maxLength={120} placeholder="Shout-out (optional)" onChange={(e) => setNote(e.target.value)} aria-label="Shout-out" />}
          <div><button className="td-btn cta" onClick={() => void saveVest()} disabled={busy !== '' || !dirty}>{busy === 'vest' ? 'SAVING…' : pick ? 'AWARD IT' : 'SAVE'}</button></div>
        </div>

        <div className="lw-block">
          <div className="td-label">GROUP PHOTO</div>
          {st.group_photo
            ? <img className="lw-photo" src={photoUrl(st.group_photo)} alt="This week's group photo" />
            : <p className="td-hint">Snap the crew after the round and load it here. It goes on the vest page with this week.</p>}
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files?.[0])} />
          <div className="td-row">
            <button className="td-btn" onClick={() => file.current?.click()} disabled={busy !== ''}>{busy === 'photo' ? 'UPLOADING…' : st.group_photo ? 'REPLACE PHOTO' : 'LOAD PHOTO'}</button>
            {st.group_photo && <button className="td-btn quiet" onClick={() => void removePhoto()} disabled={busy !== ''}>REMOVE</button>}
          </div>
        </div>
      </div>
    </section>
  );
}
