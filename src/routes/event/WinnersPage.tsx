import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { toPar } from '../../lib/jewel/leaderboard';
import { money } from '../../lib/prizes/payout';
import type { WinnersPayload } from '../../lib/td/api';
import type { EventConfig } from '../../lib/td/setup';
import { useTheme } from '../../lib/theme';
import '../jewel/jewel.css';

type Pub = Pick<EventConfig, 'id' | 'slug' | 'name' | 'club_name' | 'skin' | 'palette'>;
const REFRESH_MS = 60_000;

/** /e/<slug>/winners: exactly what the TD last posted (winners_posts), never a live calculation. */
export default function WinnersPage() {
  const { slug = '' } = useParams();
  const [ev, setEv] = useState<Pub | null>(null);
  const [post, setPost] = useState<{ payload: WinnersPayload; posted_at: string } | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  useTheme(ev?.skin === 'jewel-xi' ? 'jewel-xi' : 'event', ev?.palette ?? null);

  useEffect(() => {
    let id = '';
    const load = async () => {
      if (!id) {
        const r = await supabase.from('events').select('id, slug, name, club_name, skin, palette').eq('slug', slug).maybeSingle();
        if (r.error) return setError('No signal. Reload to try again.');
        if (!r.data) return setMissing(true);
        setEv(r.data as Pub);
        id = (r.data as Pub).id;
      }
      const w = await supabase.from('winners_posts').select('payload, posted_at').eq('event_id', id).maybeSingle();
      if (w.error) return setError('No signal. Reload to try again.');
      setPost((w.data as typeof post) ?? null);
    };
    void load();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, REFRESH_MS);
    return () => window.clearInterval(t);
  }, [slug]);

  if (missing) return <div className="jw"><main className="jw-body"><h2 className="jw-h2">Event not found</h2></main></div>;
  const p = post?.payload;
  return (
    <div className="jw">
      <header className="jw-head">
        <div>
          <h1>{ev?.name ?? 'Loading…'}</h1>
          <div className="jw-sub">WINNERS CIRCLE{ev?.club_name ? ` · ${ev.club_name.toUpperCase()}` : ''}</div>
        </div>
      </header>
      <main className="jw-body" style={{ paddingBottom: 40 }}>
        {error && <div className="jw-error" role="alert">{error}</div>}
        {ev && post === null && <div className="jw-banner">Results aren't posted yet. Check back after the last cards come in.</div>}
        {p && (
          <>
            <p className="jw-note">Posted {new Date(post!.posted_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
              {p.mode === 'live' ? ' · preliminary (unsigned scores)' : ''}</p>
            {p.divisions.map((d) => (
              <section key={d.div} className="jw-div" aria-label={`${d.div} winners`}>
                <div className="jw-div-head"><b>{d.div}</b><span>{d.currency === 'cash' ? 'Cash' : p.credit_label}</span></div>
                {d.rows.map((r, i) => (
                  <div key={i} className="jw-grid win">
                    <span className={`jw-pos${r.place === '1' || r.place === 'T1' ? ' first' : ''}`}>{r.place}</span>
                    <span className="jw-name"><b>{r.name}</b><span>{toPar(r.total)}</span></span>
                    <span className="num tot">{money(r.amount, d.currency, p.credit_label)}</span>
                  </div>
                ))}
              </section>
            ))}
            {!p.divisions.length && <div className="jw-banner">No prizes posted.</div>}
          </>
        )}
        {ev && <Link className="jw-note" to={`/e/${ev.slug}`} style={{ color: 'var(--accent-a)' }}>Leaderboard ›</Link>}
      </main>
    </div>
  );
}
