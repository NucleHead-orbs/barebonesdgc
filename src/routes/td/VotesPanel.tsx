import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../../lib/td/api';
import { rpcError } from '../../lib/td/builder';
import type { CrewMember } from '../../lib/crew/crew';
import { DESIGN_CATEGORIES, designCategoryLabel, isImage, latest, type DesignAsset } from '../../lib/prep/prep';
import { MAX_COMMENT, announcement, fromLocalInput, isOpen, isPastLocal, notVoted, statusLabel, tally, toLocalInput, type Poll } from '../../lib/votes/votes';

/**
 * PREP → VOTES: the crew + TDs pick between designs. One pick + optional comment, changeable until it closes.
 * Crew see totals only after they vote; TDs see every vote with names here.
 */
export default function VotesPanel({ eventId, email, assets, creditLabel, onToast }: {
  eventId: string; email: string; assets: DesignAsset[]; creditLabel: string | null; onToast: (s: string) => void;
}) {
  const [polls, setPolls] = useState<Poll[] | null>(null);
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [err, setErr] = useState('');
  const [making, setMaking] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [p, c] = await Promise.all([api.loadPolls(eventId), api.loadCrew(eventId)]);
    if (p.error || !p.data) return setErr(rpcError(p.error).message);
    setPolls(p.data);
    if (c.data) setCrew(c.data.crew);
  }, [eventId]);
  useEffect(() => { void (async () => { await load(); })(); }, [load]);

  const thumbKey = useMemo(() => assets.map(latest).filter((f) => f && isImage(f)).map((f) => f!.path).join('|'), [assets]);
  useEffect(() => {
    void (async () => {
      const r = await api.signedUrls(thumbKey ? thumbKey.split('|') : []);
      if (r.data) setThumbs(r.data);
    })();
  }, [thumbKey]);
  const thumbOf = (assetId: string) => { const a = assets.find((x) => x.id === assetId); const f = a && latest(a); return f ? thumbs[f.path] : undefined; };

  if (!polls) return err ? <div className="td-warn" role="alert">{err}</div> : <p className="td-empty">Loading…</p>;
  const fail = (what: string) => (e: unknown) => setErr(`${what}: ${rpcError(e).message}`);
  const replace = (p: Poll) => setPolls((ps) => (ps ?? []).map((x) => (x.id === p.id ? p : x)));
  const live = crew.filter((c) => !c.revoked_at);

  return (
    <>
      {err && <div className="td-warn" role="alert">{err} <button className="td-btn quiet" onClick={() => setErr('')}>DISMISS</button></div>}
      <section className="td-panel">
        <div className="td-row">
          <h2 style={{ flex: 1 }}>Design votes</h2>
          {!making && <button className="td-btn cta" disabled={assets.length < 2} onClick={() => setMaking(true)}>NEW VOTE</button>}
        </div>
        <span className="td-hint">Put 2 or more designs on a ballot. Crew vote from the VOTE tab on their link; TDs vote here. One pick each plus an optional comment, changeable until you close it. Crew see totals only after they vote; you see who picked what.</span>
        {assets.length < 2 && <div className="td-warn soft">Add at least 2 designs (with an image) on DESIGNS first.</div>}
        {making && <NewPoll eventId={eventId} email={email} assets={assets} creditLabel={creditLabel} thumbOf={thumbOf}
          onCancel={() => setMaking(false)} onError={fail('New vote')}
          onMade={(p, announced) => { setPolls((ps) => [p, ...(ps ?? [])]); setMaking(false); onToast(`Vote is live${announced ? ' and the crew got an announcement' : ''}.`); }} />}
      </section>
      {!polls.length && !making && <div className="td-empty">No votes yet.</div>}
      {polls.map((p) => <PollCard key={p.id} p={p} email={email} assets={assets} crew={crew} live={live} thumbOf={thumbOf}
        onChange={replace} onError={fail(p.title)} onToast={onToast}
        onDeleted={() => setPolls((ps) => (ps ?? []).filter((x) => x.id !== p.id))} />)}
    </>
  );
}

function NewPoll({ eventId, email, assets, creditLabel, thumbOf, onCancel, onError, onMade }: {
  eventId: string; email: string; assets: DesignAsset[]; creditLabel: string | null; thumbOf: (id: string) => string | undefined;
  onCancel: () => void; onError: (e: unknown) => void; onMade: (p: Poll, announced: boolean) => void;
}) {
  const hasTrophies = assets.some((a) => a.category === 'trophies');
  const [cat, setCat] = useState<string>(hasTrophies ? 'trophies' : 'all');
  const [title, setTitle] = useState(hasTrophies ? '1st place trophy' : '');
  const [question, setQuestion] = useState(hasTrophies ? 'Which one should the division winners take home?' : '');
  const [closes, setCloses] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [announce, setAnnounce] = useState(true);
  const [busy, setBusy] = useState(false);
  const shown = assets.filter((a) => cat === 'all' || a.category === cat);
  const cats = DESIGN_CATEGORIES.filter((c) => assets.some((a) => a.category === c));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const ok = title.trim() && picked.length >= 2 && !isPastLocal(closes);

  const make = async () => {
    if (!ok) return;
    setBusy(true);
    const meta = { title: title.trim().slice(0, 80), question: question.trim().slice(0, 300) || null, closes_at: fromLocalInput(closes) };
    const r = await api.createPoll(eventId, meta, picked, email);
    if (r.error || !r.data) { setBusy(false); return onError(r.error); }
    let announced = false;
    if (announce) {
      const a = await api.postAnnouncement(eventId, { ...announcement(meta), roles: [], pinned: true }, email);
      if (a.error) onError(a.error); else announced = true;
    }
    setBusy(false);
    onMade(r.data, announced);
  };

  return (
    <form className="td-vote-new" onSubmit={(e) => { e.preventDefault(); void make(); }}>
      <div className="td-row">
        <input className="td-input" style={{ flex: '1 1 220px' }} aria-label="Vote title" placeholder="Title (e.g. 1st place trophy)" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
        <label className="td-inline"><span className="td-hint">Closes (optional)</span>
          <input className="td-input" type="datetime-local" aria-label="Voting closes" value={closes} onChange={(e) => setCloses(e.target.value)} /></label>
      </div>
      <input className="td-input" aria-label="Question for the crew" placeholder="Question for the crew (optional)" maxLength={300} value={question} onChange={(e) => setQuestion(e.target.value)} />
      <div className="td-chips" role="group" aria-label="Filter designs">
        <button type="button" className="td-chip" aria-pressed={cat === 'all'} onClick={() => setCat('all')}>ALL</button>
        {cats.map((c) => <button type="button" key={c} className="td-chip" aria-pressed={cat === c} onClick={() => setCat(c)}>{designCategoryLabel(c, creditLabel).toUpperCase()}</button>)}
      </div>
      <div className="td-vote-pick">
        {shown.map((a) => {
          const t = thumbOf(a.id);
          const n = picked.indexOf(a.id);
          return (
            <button type="button" key={a.id} className="td-vote-opt" aria-pressed={n >= 0} onClick={() => toggle(a.id)}>
              <div className="td-thumb">{t ? <img src={t} alt="" loading="lazy" /> : <span>{latest(a) ? 'FILE' : 'NO FILE'}</span>}</div>
              <b>{n >= 0 ? `${n + 1}. ` : ''}{a.title}</b>
            </button>
          );
        })}
      </div>
      {isPastLocal(closes) && <div className="td-warn soft">That closing time is already past.</div>}
      {picked.some((id) => !thumbOf(id)) && <div className="td-warn soft">A picked design has no image yet, so the crew will only see its name. Upload one on DESIGNS.</div>}
      <label className="td-inline"><input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} /> Post a pinned announcement to all crew</label>
      <div className="td-row">
        <button className="td-btn cta" disabled={!ok || busy}>{busy ? 'STARTING…' : `START VOTE (${picked.length} DESIGNS)`}</button>
        <button type="button" className="td-btn quiet" onClick={onCancel}>CANCEL</button>
        {picked.length < 2 && <span className="td-hint">Pick at least 2. The order you tap is the ballot order.</span>}
      </div>
    </form>
  );
}

function PollCard({ p, email, assets, crew, live, thumbOf, onChange, onError, onToast, onDeleted }: {
  p: Poll; email: string; assets: DesignAsset[]; crew: CrewMember[]; live: CrewMember[]; thumbOf: (id: string) => string | undefined;
  onChange: (p: Poll) => void; onError: (e: unknown) => void; onToast: (s: string) => void; onDeleted: () => void;
}) {
  const open = isOpen(p);
  const t = tally(p, (id) => { const c = crew.find((x) => x.id === id); return c ? `${c.name}${c.revoked_at ? ' (link revoked)' : ''}` : undefined; });
  const mine = p.votes.find((v) => v.td_email === email.toLowerCase());
  const [comment, setComment] = useState(mine?.comment ?? '');
  const [busy, setBusy] = useState(false);
  const waiting = notVoted(p, live);
  const titleOf = (assetId: string) => assets.find((a) => a.id === assetId)?.title ?? 'Deleted design';
  const offBallot = assets.filter((a) => !p.options.some((o) => o.asset_id === a.id));

  const run = async (f: () => Promise<{ data?: Poll; error?: unknown }>, ok?: string) => {
    setBusy(true);
    const r = await f();
    setBusy(false);
    if (r.error || !r.data) { onError(r.error); return false; }
    onChange(r.data); if (ok) onToast(ok);
    return true;
  };
  const vote = (optionId: string) => run(() => api.tdVote(p.id, optionId, comment.trim().slice(0, MAX_COMMENT)), mine ? 'Vote changed.' : 'Vote in.');
  const close = () => run(() => api.updatePoll(p.id, { closed_at: new Date().toISOString(), winner_option_id: p.winner_option_id ?? (t.leaders.length === 1 ? t.leaders[0] : null) }),
    t.leaders.length === 1 ? `Closed. Winner: ${titleOf(p.options.find((o) => o.id === t.leaders[0])!.asset_id)}.` : 'Closed. It\'s a tie (or no votes), so pick the winner below.');
  const reopen = () => run(() => api.updatePoll(p.id, { closed_at: null, closes_at: p.closes_at && new Date(p.closes_at) <= new Date() ? null : p.closes_at }), 'Voting is open again.');
  const setDeadline = (v: string) => {
    const iso = fromLocalInput(v);
    if (iso && new Date(iso) <= new Date()) return onError(new Error('Pick a closing time in the future, or CLOSE VOTING now.'));
    void run(() => api.updatePoll(p.id, { closes_at: iso }), iso ? 'Deadline saved.' : 'Deadline removed.');
  };
  const remove = async () => {
    if (!window.confirm(`Delete "${p.title}"${p.votes.length ? ` and its ${p.votes.length} vote${p.votes.length === 1 ? '' : 's'}` : ''}? The designs stay.`)) return;
    const r = await api.deletePoll(p.id);
    if (r.error) return onError(r.error);
    onDeleted();
  };
  const announce = async () => {
    const r = await api.postAnnouncement(p.event_id, { ...announcement(p), roles: [], pinned: true }, email);
    if (r.error) return onError(r.error);
    onToast('Announcement posted to all crew.');
  };

  return (
    <section className={`td-panel td-poll${open ? '' : ' is-closed'}`}>
      <div className="td-row">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{p.title}</h2>
          <span className="td-hint">{statusLabel(p)} · {t.total} vote{t.total === 1 ? '' : 's'} · {live.length - waiting.length}/{live.length} crew voted</span>
        </div>
        {open ? <button className="td-btn cyan" disabled={busy} onClick={() => void close()}>CLOSE VOTING</button>
          : <button className="td-btn quiet" disabled={busy} onClick={() => void reopen()}>REOPEN</button>}
      </div>
      {p.question && <p>{p.question}</p>}

      <div className="td-vote-grid">
        {t.rows.map((r) => {
          const winner = p.winner_option_id === r.option.id;
          const lead = t.leaders.includes(r.option.id);
          const img = thumbOf(r.option.asset_id);
          return (
            <article key={r.option.id} className={`td-vote-opt is-static${winner ? ' is-winner' : ''}${mine?.option_id === r.option.id ? ' is-mine' : ''}`}>
              <div className="td-thumb">{img ? <img src={img} alt={titleOf(r.option.asset_id)} loading="lazy" /> : <span>NO IMAGE</span>}</div>
              <div className="td-row">
                <b style={{ flex: 1 }}>{winner ? '🏆 ' : ''}{titleOf(r.option.asset_id)}</b>
                <span className="td-hint">{r.count} · {r.pct}%{lead && !winner && t.total ? ' · leading' : ''}</span>
              </div>
              <div className="td-bar" aria-hidden="true"><span style={{ width: `${r.pct}%` }} /></div>
              {r.voters.length > 0 && (
                <ul className="td-voters">
                  {r.voters.map((v, i) => <li key={i}><b>{v.name}</b>{v.td ? <span className="td-hint"> TD</span> : null}{v.comment ? <span>: “{v.comment}”</span> : null}</li>)}
                </ul>
              )}
              <div className="td-row">
                {open && <button className={`td-btn ${mine?.option_id === r.option.id ? 'cyan' : 'quiet'}`} disabled={busy} onClick={() => void vote(r.option.id)}>
                  {mine?.option_id === r.option.id ? (comment.trim() !== (mine.comment ?? '') ? 'SAVE COMMENT' : 'MY VOTE ✓') : 'VOTE THIS'}</button>}
                {!open && !winner && <button className="td-btn quiet" disabled={busy} onClick={() => void run(() => api.updatePoll(p.id, { winner_option_id: r.option.id }), `Winner: ${titleOf(r.option.asset_id)}.`)}>MAKE WINNER</button>}
                {r.count === 0 && p.options.length > 2 && <button className="td-link danger" disabled={busy} onClick={() => void run(() => api.removePollOption(p.id, r.option.id), 'Taken off the ballot.')}>Remove</button>}
              </div>
            </article>
          );
        })}
      </div>

      {open && (
        <label className="td-inline" style={{ alignItems: 'flex-start' }}>
          <span className="td-hint" style={{ whiteSpace: 'nowrap' }}>Your comment</span>
          <input className="td-input" style={{ flex: 1 }} aria-label="Your comment (optional)" maxLength={MAX_COMMENT} placeholder="Optional, saved with your vote" value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
      )}
      {waiting.length > 0 && <span className="td-hint">Haven't voted: {waiting.map((c) => c.name).join(', ')}</span>}
      {!open && !p.winner_option_id && <div className="td-warn soft">No winner yet. Tap MAKE WINNER on one of the designs.</div>}

      <details className="td-help-sec">
        <summary><b>Edit this vote</b></summary>
        <div className="td-row">
          <label className="td-inline"><span className="td-hint">Closes</span>
            <input className="td-input" type="datetime-local" aria-label="Voting closes" defaultValue={toLocalInput(p.closes_at)} onBlur={(e) => { if (fromLocalInput(e.target.value) !== p.closes_at) setDeadline(e.target.value); }} /></label>
          {offBallot.length > 0 && (
            <select className="td-select" aria-label="Add a design to the ballot" value="" disabled={busy}
              onChange={(e) => { const id = e.target.value; if (id) void run(() => api.addPollOption(p.id, id, Math.max(-1, ...p.options.map((o) => o.sort)) + 1), 'Added to the ballot.'); }}>
              <option value="">+ Add a design…</option>
              {offBallot.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
            </select>
          )}
          {open && <button className="td-btn quiet" onClick={() => void announce()}>ANNOUNCE TO CREW</button>}
          <div style={{ flex: 1 }} />
          <button className="td-link danger" onClick={() => void remove()}>Delete vote</button>
        </div>
        <span className="td-hint">Designs with votes can't come off the ballot. Removing a design with no votes is fine.</span>
      </details>
    </section>
  );
}
