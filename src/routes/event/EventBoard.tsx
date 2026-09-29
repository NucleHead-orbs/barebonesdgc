import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Leaderboard from '../../components/Leaderboard';
import { supabase } from '../../lib/supabase';
import { loadBoard } from '../../lib/jewel/api';
import type { LbRow } from '../../lib/jewel/leaderboard';
import { coursePar, dateRange, type EventConfig, type HoleRow } from '../../lib/td/setup';
import { useTheme } from '../../lib/theme';
import '../jewel/jewel.css';

const REFRESH_MS = 30_000;
type Pub = Pick<EventConfig, 'id' | 'slug' | 'name' | 'club_name' | 'starts_on' | 'ends_on' | 'skin' | 'palette' | 'rounds'>;

/** /e/<slug>: public live leaderboard + course for any event built in /td. Public-read data only. */
export default function EventBoard() {
  const { slug = '' } = useParams();
  const [ev, setEv] = useState<Pub | null>(null);
  const [holes, setHoles] = useState<HoleRow[]>([]);
  const [board, setBoard] = useState<LbRow[] | null>(null);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  useTheme(ev?.skin === 'jewel-xi' ? 'jewel-xi' : 'event', ev?.palette ?? null);

  const refresh = useCallback(async (id: string) => {
    try {
      setBoard(await loadBoard(id));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    let id = '';
    void (async () => {
      const r = await supabase.from('events').select('id, slug, name, club_name, starts_on, ends_on, skin, palette, rounds').eq('slug', slug).maybeSingle();
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
        {ev && board && <Leaderboard board={board} rounds={ev.rounds} empty="No players yet." />}
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
        {ev && <a className="jw-note" href={`/e/${ev.slug}/request`} style={{ color: 'var(--accent-a)' }}>Want to play with someone? Send a card request ›</a>}
      </main>
    </div>
  );
}
