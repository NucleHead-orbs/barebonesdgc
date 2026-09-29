import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { requestError } from '../../lib/td/requests';
import type { EventConfig } from '../../lib/td/setup';
import { useTheme } from '../../lib/theme';
import '../jewel/jewel.css';

type Pub = Pick<EventConfig, 'id' | 'slug' | 'name' | 'club_name' | 'skin' | 'palette' | 'archived'>;
interface P { id: string; name: string; div_code: string }
const MAX = 4;

/**
 * /e/<slug>/request: the table QR. A player picks themselves and 1–4 people they want on their card.
 * No login: the server checks every name is registered for this event and caps pending requests.
 * Nothing about other people's requests is ever shown here.
 */
export default function RequestPage() {
  const { slug = '' } = useParams();
  const [ev, setEv] = useState<Pub | null>(null);
  const [players, setPlayers] = useState<P[]>([]);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [me, setMe] = useState<P | null>(null);
  const [want, setWant] = useState<P[]>([]);
  const [q, setQ] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'' | 'submitted' | 'duplicate'>('');
  useTheme(ev?.skin === 'jewel-xi' ? 'jewel-xi' : 'event', ev?.palette ?? null);

  useEffect(() => {
    void (async () => {
      const r = await supabase.from('events').select('id, slug, name, club_name, skin, palette, archived').eq('slug', slug).maybeSingle();
      if (r.error) return setError('No signal. Reload to try again.');
      if (!r.data) return setMissing(true);
      setEv(r.data as Pub);
      const p = await supabase.from('players').select('id, name, div_code').eq('event_id', (r.data as Pub).id).order('name');
      if (p.error) return setError('No signal. Reload to try again.');
      setPlayers((p.data ?? []) as P[]);
    })();
  }, [slug]);

  const query = q.trim().toLowerCase();
  const hits = useMemo(() => (query
    ? players.filter((p) => p.name.toLowerCase().includes(query) && p.id !== me?.id && !want.some((w) => w.id === p.id)).slice(0, 8)
    : []), [players, query, me, want]);

  const send = async () => {
    if (!ev || !me || !want.length) return;
    setBusy(true); setError('');
    const r = await supabase.rpc('submit_card_request', { p_event_id: ev.id, p_requester: me.id, p_partners: want.map((w) => w.id), p_note: note.trim() || null });
    setBusy(false);
    if (r.error) return setError(requestError(r.error.message));
    setDone(r.data as 'submitted' | 'duplicate');
  };
  const reset = () => { setMe(null); setWant([]); setQ(''); setNote(''); setDone(''); setError(''); };

  if (missing) return <Page><h2 className="jw-h2">Event not found</h2><p className="jw-note">Check the QR with your TD.</p></Page>;
  if (!ev) return <Page>{error ? <div className="jw-error" role="alert">{error}</div> : <p className="jw-note">Loading…</p>}</Page>;
  if (ev.archived) return <Page title={ev.name}><div className="jw-banner">Requests are closed for this event.</div></Page>;

  if (done) {
    return (
      <Page title={ev.name}>
        <h2 className="jw-h2">Got it!</h2>
        <div className="jw-banner">
          {done === 'duplicate' ? 'You already sent that one. ' : ''}The TD has your request: <b>{me?.name}</b> with <b>{want.map((w) => w.name).join(', ')}</b>.
          No need to say anything at the table.
        </div>
        <p className="jw-note">Requests aren't guaranteed. The TD balances everyone's cards.</p>
        <button className="jw-cta" onClick={reset}>SEND ANOTHER</button>
        <Link className="jw-note" to={`/e/${ev.slug}`} style={{ color: 'var(--accent-a)' }}>Live leaderboard ›</Link>
      </Page>
    );
  }

  return (
    <Page title={ev.name}>
      <h2 className="jw-h2">Card request</h2>
      <p className="jw-note">Want to play with someone? Tell the TD here instead of in line.</p>
      {error && <div className="jw-error" role="alert">{error}</div>}

      {!me ? (
        <>
          <div className="jw-step">1 · Who are you?</div>
          <input className="jw-input" autoFocus value={q} placeholder="Start typing your name…" onChange={(e) => setQ(e.target.value)} aria-label="Your name" />
          <div className="jw-pick">
            {hits.map((p) => <button key={p.id} onClick={() => { setMe(p); setQ(''); }}>{p.name} <span>{p.div_code}</span></button>)}
          </div>
          {query && !hits.length && <p className="jw-note">Not on the list? Check in at the table first, then scan again.</p>}
        </>
      ) : (
        <>
          <div className="jw-step">You: <b>{me.name}</b> <button className="jw-linkbtn" onClick={() => { setMe(null); setWant([]); }}>not you?</button></div>
          <div className="jw-step">2 · Who do you want on your card? (up to {MAX})</div>
          {want.length > 0 && (
            <div className="jw-chips" style={{ flexWrap: 'wrap' }}>
              {want.map((w) => <button key={w.id} className="jw-chip" aria-pressed="true" onClick={() => setWant(want.filter((x) => x.id !== w.id))}>{w.name} ×</button>)}
            </div>
          )}
          {want.length < MAX && (
            <>
              <input className="jw-input" value={q} placeholder="Type their name…" onChange={(e) => setQ(e.target.value)} aria-label="Who you want to play with" />
              <div className="jw-pick">
                {hits.map((p) => <button key={p.id} onClick={() => { setWant([...want, p]); setQ(''); }}>{p.name} <span>{p.div_code}</span></button>)}
              </div>
              {query && !hits.length && <p className="jw-note">Not registered yet? Put their name in the note below.</p>}
            </>
          )}
          <input className="jw-input" value={note} maxLength={140} placeholder="Note for the TD (optional)" onChange={(e) => setNote(e.target.value)} aria-label="Note" />
          <button className="jw-cta" onClick={() => void send()} disabled={busy || !want.length}>{busy ? 'SENDING…' : 'SEND TO THE TD'}</button>
        </>
      )}
    </Page>
  );
}

function Page({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="jw">
      {title && <header className="jw-head"><div><h1>{title}</h1><div className="jw-sub">CARD REQUEST</div></div></header>}
      <main className="jw-body" style={{ paddingBottom: 40 }}>{children}</main>
    </div>
  );
}
