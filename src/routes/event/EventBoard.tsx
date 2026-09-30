import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Leaderboard from '../../components/Leaderboard';
import { supabase } from '../../lib/supabase';
import { loadBoard, loadTeamBoard } from '../../lib/jewel/api';
import TeamBoard from '../../components/TeamBoard';
import { onlyRound, type LbRow, type TeamRow } from '../../lib/jewel/leaderboard';
import { coursePar, dateRange, hasDoubles, roundFormat, type EventConfig, type HoleRow } from '../../lib/td/setup';
import { useTheme } from '../../lib/theme';
import '../jewel/jewel.css';

const REFRESH_MS = 30_000;
type Pub = Pick<EventConfig, 'id' | 'slug' | 'name' | 'club_name' | 'starts_on' | 'ends_on' | 'skin' | 'palette' | 'rounds' | 'r1_format' | 'r2_format' | 'dubs_style'>;

/** /e/<slug>: public live leaderboard + course for any event built in /td. Public-read data only. */
export default function EventBoard() {
  const { slug = '' } = useParams();
  const [ev, setEv] = useState<Pub | null>(null);
  const [holes, setHoles] = useState<HoleRow[]>([]);
  const [board, setBoard] = useState<LbRow[] | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [pick, setPick] = useState<1 | 2 | null>(null);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  useTheme(ev?.skin === 'jewel-xi' ? 'jewel-xi' : 'event', ev?.palette ?? null);

  const refresh = useCallback(async (id: string) => {
    try {
      const [b, t] = await Promise.all([loadBoard(id), loadTeamBoard(id)]);
      setBoard(b); setTeams(t);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    let id = '';
    void (async () => {
      const r = await supabase.from('events').select('id, slug, name, club_name, starts_on, ends_on, skin, palette, rounds, r1_format, r2_format, dubs_style').eq('slug', slug).maybeSingle();
      if (r.error) return setError("Couldn't load this event. Check your signal and reload.");
      if (!r.data) return setMissing(true);
      const e = r.data as Pub;
      id = e.id;
      setEv(e);
      const h = await supabase.from('holes').select('n, par, dist_ft, ob').eq('event_id', e.id).order('n');
      if (h.data) setHoles(h.data as HoleRow[]);
      await refresh(e.id);
    })();
    const tick = () => { if (id && document.visibilityState === 'visible') void refresh(id); };
    const t = window.setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [slug, refresh]);

  if (missing) {
    return <div className="jw"><main className="jw-body"><h2 className="jw-h2">Event not found</h2><p className="jw-note">Check the link with your TD.</p></main></div>;
  }

  return (
    <div className="jw">
      <header className="jw-head">
        <div>
          <h1>{ev?.name ?? 'Loading…'}</h1>
          {ev && <div className="jw-sub">{[ev.club_name, dateRange(ev)].filter(Boolean).join(' · ').toUpperCase()}</div>}
        </div>
      </header>
      <main className="jw-body" style={{ paddingBottom: 32 }}>
        {error && <div className="jw-error" role="alert">{error}</div>}
        {ev && !board && !error && <p className="jw-note">Loading…</p>}
        {ev && board && !hasDoubles(ev) && <Leaderboard board={board} rounds={ev.rounds} empty="No players yet." />}
        {ev && board && hasDoubles(ev) && (() => {
          // Mixed formats: every round is its own board (never summed). Default = the round being played.
          const rounds = ev.rounds === 2 ? [1, 2] as const : [1] as const;
          const started2 = ev.rounds === 2 && (board.some((r) => r.r2_holes > 0) || teams.some((t) => t.round === 2 && t.holes_played > 0));
          const r = pick ?? (started2 ? 2 : 1);
          const label = (n: 1 | 2) => `ROUND ${n} · ${roundFormat(ev, n) === 'doubles' ? 'DUBS' : 'SINGLES'}`;
          return (
            <>
              {rounds.length > 1 && (
                <div className="jw-seg" role="tablist" aria-label="Round">
                  {rounds.map((n) => <button key={n} role="tab" aria-pressed={r === n} onClick={() => setPick(n)}>{label(n)}</button>)}
                </div>
              )}
              {roundFormat(ev, r) === 'doubles'
                ? <TeamBoard rows={teams.filter((t) => t.round === r)} title={`Round ${r} · Doubles`} style={ev.dubs_style} />
                : <Leaderboard board={onlyRound(board, r)} rounds={1} empty="No players yet." />}
            </>
          );
        })()}
        {holes.length > 0 && (
          <section className="jw-div" aria-label="Course">
            <div className="jw-div-head"><b>COURSE</b><span>{holes.length} holes · par {coursePar(holes)}</span></div>
            {holes.map((h) => (
              <div key={h.n} className="jw-grid one">
                <span className="jw-pos">{h.n}</span>
                <span className="jw-name"><b>Par {h.par}{h.dist_ft ? ` · ${h.dist_ft} ft` : ''}</b>{h.ob && <span>{h.ob}</span>}</span>
                <span />
              </div>
            ))}
          </section>
        )}
        <p className="jw-note">Scores update every 30 seconds. Players score by scanning the QR code on their card.</p>
        {ev && <a className="jw-note" href={`/e/${ev.slug}/winners`} style={{ color: 'var(--accent-a)' }}>Winners Circle ›</a>}
        {ev && <a className="jw-note" href={`/e/${ev.slug}/request`} style={{ color: 'var(--accent-a)' }}>Want to play with someone? Send a card request ›</a>}
      </main>
    </div>
  );
}
