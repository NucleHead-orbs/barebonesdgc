/** The skull's form: type, what happened, optional screenshot/photo, who (attached by the server when it knows). */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ME_KEY } from '../../lib/rounds/rounds';
import { latestRelease, submitReport } from '../../lib/dev/api';
import { BODY_MAX, KINDS, reportMessage, type ReportKind } from '../../lib/dev/releases';
import { SkullMascot } from './SkullMascot';

const NAME_KEY = 'bb-skull-name';
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } };
const PLACEHOLDER: Record<ReportKind, string> = {
  bug: 'What happened? What did you tap, what did you expect?',
  idea: 'What should it do?',
  feedback: 'Say it. Nicely or not.',
};
/** Survives closing the form by accident (fat thumbs). Cleared once sent. */
const kept = { kind: 'bug' as ReportKind, body: '' };

export default function SkullReport({ onClose }: { onClose: () => void }) {
  const { pathname } = useLocation();
  const [kind, setKind] = useState<ReportKind>(kept.kind);
  const [body, setBody] = useState(kept.body);
  const [name, setName] = useState(() => read(NAME_KEY) ?? '');
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [tdEmail, setTdEmail] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const token = pathname.match(/^\/tag\/([A-Za-z0-9_-]{20,})/)?.[1] ?? read(ME_KEY);

  useEffect(() => { kept.kind = kind; kept.body = body; }, [kind, body]);
  useEffect(() => {
    let live = true;
    void supabase.auth.getSession().then(({ data }) => { if (live) setTdEmail(data.session?.user.email ?? null); });
    void latestRelease().then((r) => { if (live) setVersion(r?.version ?? null); });
    textRef.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => { live = false; window.removeEventListener('keydown', esc); };
  }, [onClose]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => { if (!sent) return; const t = setTimeout(onClose, 2600); return () => clearTimeout(t); }, [sent, onClose]);

  const pick = (f: File | null) => {
    if (f && !f.type.startsWith('image/')) { setErr('That isn\'t a picture. Screenshots and photos only.'); return; }
    setErr(''); setPhoto(f); setPreview(f ? URL.createObjectURL(f) : null);
  };
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) { setErr('Tell the skull what happened first.'); textRef.current?.focus(); return; }
    setBusy(true); setErr('');
    const r = await submitReport({ kind, body, name: tdEmail || token ? '' : name, token, photo, version });
    setBusy(false);
    if (r.error) { setErr(reportMessage(r.error)); return; }
    if (name.trim()) write(NAME_KEY, name.trim());
    kept.body = ''; kept.kind = 'bug';
    setSent(true);
  };

  return (
    <div className="skr-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="skr" role="dialog" aria-modal="true" aria-labelledby="skr-title">
        <button type="button" className="skr-x" onClick={onClose} aria-label="Close">×</button>
        {sent ? (
          <div className="skr-done" role="status">
            <SkullMascot size={88} mood="happy" />
            <b>Got it.</b>
            <span>The squasher's on it. Fixes show up in the dev reports.</span>
          </div>
        ) : (
          <form onSubmit={send}>
            <div className="skr-head">
              <SkullMascot size={52} />
              <div><h2 id="skr-title">Tell the skull</h2><p>Bugs, ideas, love letters. Mike reads every one.</p></div>
            </div>
            <div className="skr-kinds" role="radiogroup" aria-label="What is it?">
              {KINDS.map((k) => (
                <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind} className={`skr-kind k-${k.kind}${kind === k.kind ? ' on' : ''}`} onClick={() => setKind(k.kind)}>
                  <b>{k.label}</b><span>{k.hint}</span>
                </button>
              ))}
            </div>
            <label className="skr-field">
              <span className="skr-label">{kind === 'bug' ? 'What broke' : kind === 'idea' ? 'Your idea' : 'Your feedback'}<i>{body.length}/{BODY_MAX}</i></span>
              <textarea ref={textRef} rows={5} maxLength={BODY_MAX} value={body} placeholder={PLACEHOLDER[kind]} onChange={(e) => setBody(e.target.value)} />
            </label>
            <div className="skr-photo">
              {preview ? (
                <div className="skr-thumb"><img src={preview} alt="Your attachment" /><button type="button" onClick={() => { pick(null); if (fileRef.current) fileRef.current.value = ''; }}>REMOVE</button></div>
              ) : (
                <button type="button" className="skr-add" onClick={() => fileRef.current?.click()}>+ Screenshot or photo <span>(optional)</span></button>
              )}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/*" hidden onChange={(e) => pick(e.target.files?.[0] ?? null)} />
            </div>
            {tdEmail ? <p className="skr-who">Sending as <b>{tdEmail}</b></p>
              : token ? <p className="skr-who">Sending as you (your My Tag name goes with it)</p>
              : <label className="skr-field"><span className="skr-label">Your name <i>optional</i></span><input value={name} maxLength={80} autoComplete="name" onChange={(e) => setName(e.target.value)} placeholder="So Mike knows who to thank" /></label>}
            <p className="skr-meta">Goes with it: this page ({document.title || pathname}), your device{version ? `, v${version}` : ''}.</p>
            {err && <div className="skr-err" role="alert">{err}</div>}
            <button type="submit" className="skr-send" disabled={busy}>{busy ? 'SENDING…' : 'SEND TO THE SKULL'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
