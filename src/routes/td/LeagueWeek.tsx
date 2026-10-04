/**
 * League week (top of WINNERS on a league): hand out the league's weekly award (Lazy Boner Safety Vest) and load the
 * group photo. Both show on the vest wall at /leagues. Rules live in migration 20261023 (league_week).
 */
import { useEffect, useRef, useState } from 'react';
import type { ExistingPlayer } from '../../lib/td/builder';
import type { LbRow } from '../../lib/jewel/leaderboard';
import { weekLeader } from '../../lib/leagues/leagues';
import { clearGroupPhoto, loadWeekState, photoUrl, setVest, uploadGroupPhoto, type WeekState } from '../../lib/leagues/api';

const why = (e: unknown): string => {
  const m = e instanceof Error ? e.message : String((e as { message?: string } | null)?.message ?? e);
  if (/forbidden/.test(m)) return 'Only this week\'s TDs can do that.';
  if (/unknown_player/.test(m)) return 'That player isn\'t in this week anymore. Refresh and pick again.';
  if (/vest_note_too_long/.test(m)) return 'Keep the shout-out to one line (120 characters).';
  if (/row-level security|Unauthorized|403/i.test(m)) return 'Upload refused: you\'re not a TD of this week.';
  if (/mime|payload too large|413/i.test(m)) return 'That photo won\'t upload. Use a JPG or PNG under 8 MB.';
  return m;
};

export default function LeagueWeek({ eventId, players, board }: { eventId: string; players: ExistingPlayer[]; board: LbRow[] }) {
  const [st, setSt] = useState<WeekState | null>(null);
  const [pick, setPick] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'' | 'vest' | 'photo'>('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    loadWeekState(eventId).then((s) => {
      if (!live) return;
      setSt(s); setPick(s.vest_player_id ?? ''); setNote(s.vest_note ?? '');
    }, (e: unknown) => live && setErr(why(e)));
    return () => { live = false; };
  }, [eventId]);
  useEffect(() => { if (!ok) return; const t = setTimeout(() => setOk(''), 4000); return () => clearTimeout(t); }, [ok]);

  if (!st) return err ? <div className="td-warn" role="alert">{err}</div> : null;
  const award = st.award ?? 'Weekly award';
  const sorted = [...players].sort((a, b) => a.name.localeCompare(b.name));
  const leaderId = weekLeader(board);
  const leader = leaderId ? players.find((p) => p.id === leaderId) : undefined;
  const holder = st.vest_player_id ? players.find((p) => p.id === st.vest_player_id) : undefined;
  const dirty = pick !== (st.vest_player_id ?? '') || (pick !== '' && note.trim() !== (st.vest_note ?? ''));

  const saveVest = async () => {
    setBusy('vest'); setErr('');
    try {
      await setVest(eventId, pick || null, note);
      setSt({ ...st, vest_player_id: pick || null, vest_note: pick ? note.trim() || null : null });
      if (!pick) setNote('');
      setOk(pick ? `${players.find((p) => p.id === pick)?.name ?? 'They'} gets the ${award}.` : `${award} taken back.`);
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
        <a className="td-btn quiet" href="/leagues#vest-wall" target="_blank" rel="noreferrer">VEST WALL ↗</a>
      </div>
      {err && <div className="td-warn" role="alert">{err}</div>}
      {ok && <div className="td-ok" role="status">{ok}</div>}

      <div className="lw-grid">
        <div className="lw-block">
          <div className="td-label">{award.toUpperCase()}</div>
          <p className="td-hint">{holder ? <>Wearing it this week: <b>{holder.name}</b></> : 'Not awarded yet.'}</p>
          {leader && leader.id !== pick && (
            <button className="td-btn quiet" onClick={() => setPick(leader.id)}>LEADER: {leader.name.toUpperCase()} · PICK</button>
          )}
          {!leader && board.some((r) => r.r1_to_par !== null) && <p className="td-hint">Tied for low (or no scores in): pick the winner.</p>}
          <select className="td-select" value={pick} onChange={(e) => setPick(e.target.value)} aria-label={`${award} goes to`}>
            <option value="">Nobody yet</option>
            {sorted.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {pick && <input className="td-input" value={note} maxLength={120} placeholder="Shout-out (optional)" onChange={(e) => setNote(e.target.value)} aria-label="Shout-out" />}
          <div><button className="td-btn cta" onClick={() => void saveVest()} disabled={busy !== '' || !dirty}>{busy === 'vest' ? 'SAVING…' : pick ? 'AWARD IT' : 'SAVE'}</button></div>
        </div>

        <div className="lw-block">
          <div className="td-label">GROUP PHOTO</div>
          {st.group_photo
            ? <img className="lw-photo" src={photoUrl(st.group_photo)} alt="This week's group photo" />
            : <p className="td-hint">Snap the crew after the round and load it here. It goes on the vest wall with this week.</p>}
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
