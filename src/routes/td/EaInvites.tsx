/**
 * EARLY ACCESS → Invites: early access for people who aren't registrants (td_ea_invite). Type a name, tap INVITE: they get
 * a tag right away (no claim, no approval). Send the link by text (TEXT IT opens your messages), copy it, or print a card
 * with a big QR code they scan with their phone camera.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import * as ea from '../../lib/early/api';
import { inviteText, smsHref, type EaLinked, type EaMatch } from '../../lib/early/early';
import { myTagUrl } from '../../lib/tags/tags';

type Run = (key: string, p: () => Promise<{ error?: unknown }>, ok?: string) => Promise<boolean>;
interface Invitee { name: string; nickname: string | null; tag: number | null; token: string }

export function EaInvites({ eventId, eventName, linked, busy, run }: { eventId: string; eventName: string; linked: EaLinked[]; busy: string; run: Run }) {
  const [name, setName] = useState('');
  const [nick, setNick] = useState('');
  const [open, setOpen] = useState<string | null>(null); // token whose send box is open
  const invites: Invitee[] = linked.filter((l) => l.via === 'invite' && l.token).map((l) => ({ name: l.member, nickname: l.nickname, tag: l.tag, token: l.token! }));
  // members who already look like this name: pick them so one person keeps one link (migration 20261119)
  const [matches, setMatches] = useState<EaMatch[]>([]);
  useEffect(() => {
    const q = name.trim();
    let live = true;
    const t = window.setTimeout(() => { void (async () => {
      const r = q.length >= 2 ? await ea.tdInviteMatches(eventId, q) : { data: [] as EaMatch[] };
      if (live) setMatches(r.data ?? []);
    })(); }, 250);
    return () => { live = false; window.clearTimeout(t); };
  }, [name, eventId]);
  const inviteMember = async (m: EaMatch) => {
    let token = '';
    const ok = await run('invite', async () => { const r = await ea.tdInviteMember(eventId, m.id); if (r.data) token = r.data.token; return r; },
      `${m.name} is in, on the same link as their other tags. Send them their link.`);
    if (ok) { setName(''); setNick(''); setMatches([]); setOpen(token); }
  };

  const invite = async () => {
    let token = '';
    const ok = await run('invite', async () => { const r = await ea.tdInvite(eventId, name.trim(), nick.trim()); if (r.data) token = r.data.token; return r; }, `${name.trim()} is in. Send them their link.`);
    if (ok) { setName(''); setNick(''); setOpen(token); }
  };

  return (
    <section className="td-panel">
      <h2>Invites{invites.length > 0 && <span className="td-badge">{invites.length}</span>}</h2>
      <p className="td-hint">Early access for people who aren't registered (supporters, helpers). They get a tag right away, earn tickets and count as Jewel players. They don't use up registrant spots.</p>
      <form className="td-row ea-inv-form" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void invite(); }}>
        <input className="td-input" placeholder="Full name (Greg Wood)" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label="Name" />
        <input className="td-input" placeholder="Nickname (optional)" value={nick} maxLength={40} onChange={(e) => setNick(e.target.value)} aria-label="Nickname" />
        <button className={`td-btn ${matches.some((m) => !m.joined) ? 'quiet' : 'cta'}`} type="submit" disabled={!name.trim() || busy === 'invite'}>
          {busy === 'invite' ? 'INVITING…' : matches.length ? 'NEW PERSON' : 'INVITE'}</button>
      </form>
      {matches.length > 0 && (
        <div className="ea-match" role="status">
          <b>Already have a tag? Pick them so they keep one link for every set:</b>
          {matches.map((m) => (
            <div key={m.id} className="td-row ea-match-row">
              <span style={{ flex: 1, minWidth: 0 }}><b>{m.name}</b>{m.nickname ? ` "${m.nickname}"` : ''}
                <small className="td-hint"> · {m.tags.length ? m.tags.join(', ') : 'no tags yet'}</small></span>
              {m.joined ? <span className="td-hint">ALREADY IN</span>
                : <button className="td-btn cta" disabled={busy === 'invite'} onClick={() => void inviteMember(m)}>INVITE {m.name.split(/\s+/)[0].toUpperCase()}</button>}
            </div>
          ))}
          <span className="td-hint">Not them? Tap NEW PERSON.</span>
        </div>
      )}
      {invites.map((i) => (
        <div key={i.token} className="ea-inv">
          <div className="td-row">
            <b style={{ flex: 1 }}>{i.name}{i.nickname ? ` "${i.nickname}"` : ''}{i.tag ? ` · #${i.tag}` : ''}</b>
            <button className="td-btn quiet" onClick={() => setOpen(open === i.token ? null : i.token)}>{open === i.token ? 'CLOSE' : 'SEND LINK'}</button>
          </div>
          {open === i.token && <SendBox who={i} eventName={eventName} />}
        </div>
      ))}
    </section>
  );
}

function SendBox({ who, eventName }: { who: Invitee; eventName: string }) {
  const url = myTagUrl(window.location.origin, who.token);
  const text = inviteText(who.name, eventName, url);
  const [qr, setQr] = useState('');
  const [printing, setPrinting] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { void QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(setQr); }, [url]);
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    const t = window.setTimeout(() => window.print(), 50);
    return () => { window.clearTimeout(t); window.removeEventListener('afterprint', done); };
  }, [printing]);
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { window.prompt(`Copy ${who.name}'s link:`, url); } };
  return (
    <div className="tp-link">
      <div className="td-crew-qr" dangerouslySetInnerHTML={{ __html: qr }} aria-label={`QR code for ${who.name}'s link`} />
      <div className="tp-link-body">
        <span className="td-hint">Text it from your phone, or print the card and hand it over. The link is theirs: whoever has it plays as them.</span>
        <code className="tp-url">{url}</code>
        <div className="td-row">
          <a className="td-btn cta" href={smsHref(text)}>TEXT IT</a>
          <button className="td-btn cyan" onClick={() => void copy()}>{copied ? 'COPIED' : 'COPY LINK'}</button>
          <button className="td-btn" onClick={() => setPrinting(true)}>PRINT CARD</button>
        </div>
        <details><summary className="td-hint">What the text says</summary><p className="ea-inv-text">{text}</p></details>
      </div>
      {printing && createPortal(<InviteCard who={who} eventName={eventName} qr={qr} url={url} />, document.body)}
    </div>
  );
}

/** The printed card: one page, big type, one QR, three steps. Only visible when printing. */
function InviteCard({ who, eventName, qr, url }: { who: Invitee; eventName: string; qr: string; url: string }) {
  const first = who.name.trim().split(/\s+/)[0];
  return (
    <div className="ea-print">
      <div className="ea-card">
        <div className="ea-card-kick">BARE BONES DISC GOLF · {eventName.toUpperCase()} EARLY ACCESS</div>
        <h1>{first}, you're in.</h1>
        <p className="ea-card-tag">Your bag tag{who.tag ? <> is <b>#{who.tag}</b></> : ''}.</p>
        <div className="ea-card-qr" dangerouslySetInnerHTML={{ __html: qr }} />
        <ol>
          <li>Open your phone's <b>camera</b> and point it at the square.</li>
          <li>Tap the link that pops up. That's your tag.</li>
          <li>Save it: on iPhone tap <b>Share</b> then <b>Add to Home Screen</b>. On Android tap <b>⋮</b> then <b>Add to Home screen</b>.</li>
        </ol>
        <p className="ea-card-foot">This link is yours. Don't share it. Lost it? Ask Mike.<br /><span>{url}</span></p>
      </div>
    </div>
  );
}
