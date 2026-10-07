/**
 * My Tag → MATCHUPS: your profile (days free + up to 3 favorite courses, one profile for every set) and the
 * Matchmaker's best 3 opponents per set with why, one tap to challenge. Scoring lives in the database (_tag_pairs).
 */
import { useCallback, useEffect, useState } from 'react';
import * as tagApi from '../../lib/tags/api';
import { DAYS, MAX_COURSES, daysSummary, hasDay, pickReasons, toggleDay, type MatchupSet, type Profile } from '../../lib/tags/board';
import { display, tagMessage } from '../../lib/tags/tags';
import { JumpIns } from './ChallengeRounds';
import { CasualRounds } from './CasualRounds';
import type { Holding, RosterEntry } from '../../lib/tags/api';
import type { CasualRound } from '../../lib/tags/board';
import type { ChallengeRound } from '../../lib/tags/board';
import { useNow } from '../../lib/tags/useHeat';
import './board.css';

type Act = (p: Promise<{ error?: unknown }>, ok?: string) => Promise<boolean>;

export function Matchups({ token, act, rev, rounds, casuals, meId, holdings, rosters }: {
  token: string; act: Act; rev: number; rounds: ChallengeRound[];
  casuals: CasualRound[]; meId: string; holdings: Holding[]; rosters: Record<string, RosterEntry[]>;
}) {
  const now = useNow();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sets, setSets] = useState<MatchupSet[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const [p, m] = await Promise.all([tagApi.profileGet(token), tagApi.matchups(token)]);
    if (p.error || m.error) return setErr(tagMessage(p.error ?? m.error));
    setErr(''); setProfile(p.data ?? null); setSets(m.data ?? []);
  }, [token]);
  useEffect(() => { void (async () => { await load(); })(); }, [load, rev]);

  if (err) return <div className="td-warn" role="alert">{err}</div>;
  if (!profile || !sets) return <p className="td-empty">Loading matchups…</p>;
  const open = editing || !profile.saved;
  const names = Object.fromEntries(profile.library.map((c) => [c.id, c.name]));

  return (
    <div className="mu">
      <CasualRounds token={token} meId={meId} holdings={holdings} rosters={rosters} rounds={casuals} act={act} now={now} />
      <JumpIns rounds={rounds} token={token} act={act} now={now} />
      {open
        ? <ProfileForm token={token} profile={profile} first={!profile.saved} onDone={async () => { setEditing(false); await load(); }} onCancel={profile.saved ? () => setEditing(false) : undefined} />
        : (
          <section className="td-panel mu-me">
            <div className="td-row"><h2>When and where you play</h2><div style={{ flex: 1 }} /><button className="td-btn quiet" onClick={() => setEditing(true)}>EDIT</button></div>
            <p><b>Free:</b> {daysSummary(profile.am, profile.pm) || 'not set'}</p>
            <p><b>Favorite courses:</b> {profile.courses.map((id) => names[id]).filter(Boolean).join(', ') || 'not set'}</p>
          </section>
        )}

      {!sets.length && <div className="td-warn soft">Challenges aren't on for your tag sets yet. When your league TD switches them on, your best matchups show up here.</div>}
      {sets.map((s) => (
        <section key={s.pool_id} className="td-panel mu-set">
          <h2>{s.pool_name} · you're #{s.number}</h2>
          {s.open && <p className="td-hint">You've got a challenge going. One at a time: finish it (TAGS tab) before calling out the next one.</p>}
          {!s.picks.length && <p className="td-hint">{s.number === 1 ? "You're on top. Nobody to challenge; everyone's coming for you." : 'Nobody to challenge right now (you called them all out this week).'}</p>}
          {s.picks.map((p, i) => (
            <div key={p.member_id} className={`mu-pick${i === 0 ? ' is-best' : ''}`}>
              <div className="mu-pick-main">
                <b>{i === 0 && <span className="mu-best">BEST MATCH</span>}#{p.number} {display(p)}</b>
                <div className="mu-why">{pickReasons(p).map((r) => <span key={r}>{r}</span>)}</div>
              </div>
              <button className="td-btn cta" disabled={s.open} onClick={() => {
                if (!window.confirm(`Challenge ${display(p)} (#${p.number})? They get 48 hours to answer.`)) return;
                void act(tagApi.challenge(token, s.pool_id, p.member_id), `Challenge sent to ${display(p)}.`).then((ok) => { if (ok) void load(); });
              }}>CHALLENGE</button>
            </div>
          ))}
          <p className="td-hint mu-foot">Picks favor shared days, shared courses, how close you are and how long they've sat on their tag. Every Monday the Matchmaker posts the week's hottest matchups to the Board.</p>
        </section>
      ))}
    </div>
  );
}

function ProfileForm({ token, profile, first, onDone, onCancel }: { token: string; profile: Profile; first: boolean; onDone: () => Promise<void>; onCancel?: () => void }) {
  const [am, setAm] = useState(profile.am);
  const [pm, setPm] = useState(profile.pm);
  const [courses, setCourses] = useState<string[]>(profile.courses);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const names = Object.fromEntries(profile.library.map((c) => [c.id, c.name]));
  const save = async () => {
    setBusy(true); setErr('');
    const r = await tagApi.profileSave(token, am, pm, courses);
    setBusy(false);
    if (r.error) return setErr(tagMessage(r.error));
    await onDone();
  };
  return (
    <section className="td-panel mu-form">
      <h2>{first ? 'Get matched up' : 'When and where you play'}</h2>
      {first && <p className="td-hint">Tell the club when you can play and where you like to throw. The Matchmaker uses it to find you fights. Same for every tag set you hold.</p>}
      <div className="mu-days" role="group" aria-label="Days you can play">
        <span />
        {DAYS.map((d) => <span key={d} className="mu-dh">{d}</span>)}
        {([['AM', am, setAm], ['PM', pm, setPm]] as const).map(([label, mask, set]) => (
          <div key={label} className="mu-drow">
            <span className="mu-dl">{label}</span>
            {DAYS.map((d, i) => (
              <button key={d} type="button" className={`mu-day${hasDay(mask, i) ? ' on' : ''}`} aria-pressed={hasDay(mask, i)} aria-label={`${d} ${label}`}
                onClick={() => set(toggleDay(mask, i))}>{hasDay(mask, i) ? '✓' : ''}</button>
            ))}
          </div>
        ))}
      </div>
      <div className="mu-courses">
        <span className="td-label">FAVORITE COURSES (UP TO {MAX_COURSES})</span>
        <div className="td-chips">
          {courses.map((id) => <button key={id} type="button" className="td-chip" aria-pressed="true" onClick={() => setCourses(courses.filter((c) => c !== id))}>{names[id] ?? 'Course'} ×</button>)}
        </div>
        {courses.length < MAX_COURSES && (
          <select className="td-input" value="" onChange={(e) => { const v = e.target.value; if (v) setCourses([...courses, v]); }} aria-label="Add a favorite course">
            <option value="">+ Add a course</option>
            {profile.library.filter((c) => !courses.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}{c.city ? ` · ${c.city}` : ''}</option>)}
          </select>
        )}
      </div>
      {err && <div className="td-warn" role="alert">{err}</div>}
      <div className="td-row">
        <button className="td-btn cta" disabled={busy} onClick={() => void save()}>{busy ? 'SAVING…' : 'SAVE'}</button>
        {onCancel && <button className="td-btn quiet" onClick={onCancel}>CANCEL</button>}
      </div>
    </section>
  );
}
