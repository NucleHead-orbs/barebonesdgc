import { useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { isTd } from '../../lib/td/builder';
import CardBuilder from './CardBuilder';
import './td.css';

/**
 * /td gate. Email + password via Supabase Auth. A signed-in account without
 * app_metadata.role = 'td' is signed straight back out. (The database enforces
 * the same rule on every TD write; this only keeps non-TDs off the screen.)
 */
export default function TdRoute() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const accept = (s: Session | null) => {
      if (s && !isTd(s.user)) {
        setNotice(`${s.user.email ?? 'That account'} is not a TD account. Ask the TD to grant access.`);
        void supabase.auth.signOut();
        return setSession(null);
      }
      setSession(s);
    };
    supabase.auth.getSession().then(({ data }) => accept(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => accept(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <div className="td"><p className="td-empty">Loading…</p></div>;
  if (!session || !isTd(session.user)) return <Login notice={notice} onTry={() => setNotice('')} />;
  return <CardBuilder email={session.user.email ?? ''} onSignOut={() => void supabase.auth.signOut()} />;
}

function Login({ notice, onTry }: { notice: string; onTry: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(''); onTry();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(/invalid/i.test(error.message) ? 'Wrong email or password.' : error.message);
  };

  return (
    <div className="td">
      <div className="td-login">
        <img src="/assets/wordmark-bare-bones-cut.png" alt="Bare Bones" width={132} height={56} style={{ objectFit: 'contain' }} />
        <h1>TD Control</h1>
        <div className="td-sub">JEWEL XI · CARD BUILDER</div>
        {notice && <div className="td-warn" role="alert">{notice}</div>}
        {error && <div className="td-warn" role="alert">{error}</div>}
        <form onSubmit={submit}>
          <label>EMAIL<input className="td-input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>PASSWORD<input className="td-input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button className="td-generate fresh" type="submit" disabled={busy}>{busy ? 'SIGNING IN…' : 'SIGN IN'}</button>
        </form>
      </div>
    </div>
  );
}
