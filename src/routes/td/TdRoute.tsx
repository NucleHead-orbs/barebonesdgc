import { useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { isTd } from '../../lib/td/builder';
import { useTheme } from '../../lib/theme';
import EventHub from './EventHub';
import { HelpButton } from './Help';
import { useSkinApply } from '../../lib/skins';
import { SkinPicker } from '../../components/skins/SkinPicker';
import './td.css';

/**
 * /td gate. Email + password via Supabase Auth. Any signed-in account gets in, but only sees
 * the events it's a TD for (the database decides: super admin = app_metadata.role 'td',
 * event TD = confirmed email listed in event_tds). No access is granted by signing up alone.
 */
export default function TdRoute() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useSkinApply(); // G-Mode covers the whole TD Builder: sign-in, events, every tab

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <div className="td"><p className="td-empty">Loading…</p></div>;
  if (!session) return <Login />;
  return <EventHub email={session.user.email ?? ''} admin={isTd(session.user)} onSignOut={() => void supabase.auth.signOut()} />;
}

function Login() {
  useTheme('event');
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(''); setNotice('');
    if (mode === 'in') {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) setError(/invalid/i.test(error.message) ? 'Wrong email or password.' : /confirm/i.test(error.message) ? 'Confirm your email first: open the link we sent you, then sign in.' : error.message);
    } else {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: `${window.location.origin}/td` } });
      if (error) setError(/registered|exists/i.test(error.message) ? 'That email already has an account. Sign in instead.' : error.message);
      else if (!data.session) { setNotice(`Check ${email.trim()} for a confirmation link, then come back and sign in.`); setMode('in'); }
    }
    setBusy(false);
  };

  return (
    <div className="td">
      <div className="td-login">
        <h1>TD Builder</h1>
        <div className="td-sub">CARDS · CHECK-IN · LIVE SCORING</div>
        <div className="td-row"><HelpButton start="start" /><SkinPicker /></div>
        {notice && <div className="td-warn soft" role="status">{notice}</div>}
        {error && <div className="td-warn" role="alert">{error}</div>}
        <form onSubmit={submit}>
          <label>EMAIL<input className="td-input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>PASSWORD<input className="td-input" type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} minLength={mode === 'up' ? 8 : undefined} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button className="td-generate fresh" type="submit" disabled={busy}>{busy ? 'ONE SEC…' : mode === 'in' ? 'SIGN IN' : 'CREATE ACCOUNT'}</button>
        </form>
        <button className="td-link" type="button" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(''); setNotice(''); }}>
          {mode === 'in' ? 'New TD? Create an account with the email your organizer added.' : 'Have an account? Sign in.'}
        </button>
      </div>
    </div>
  );
}
