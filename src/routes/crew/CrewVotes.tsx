import { useEffect, useState } from 'react';
import * as crewApi from '../../lib/crew/api';
import { MAX_COMMENT, ballotBars, isImageFile, statusLabel, type Ballot } from '../../lib/votes/votes';

/** Crew → VOTE: one pick + optional comment per ballot, changeable while open. Totals show after you vote (or once it closes). */
export default function CrewVotes({ token, ballots, act }: {
  token: string; ballots: Ballot[]; act: (p: Promise<{ error?: unknown }>, ok?: string) => Promise<boolean>;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const fileKey = ballots.flatMap((b) => b.options.map((o) => o.file)).filter((f) => f && isImageFile(f)).map((f) => f!.id).sort().join('|');
  useEffect(() => {
    let gone = false;
    void (async () => {
      for (const id of fileKey ? fileKey.split('|') : []) {
        if (gone) return;
        const r = await crewApi.designFileUrl(token, id);
        if (r.data) setUrls((u) => (u[id] ? u : { ...u, [id]: r.data! }));
      }
    })();
    return () => { gone = true; };
  }, [token, fileKey]);

  if (!ballots.length) return <div className="td-empty">Nothing to vote on right now.</div>;
  return <>{ballots.map((b) => <BallotCard key={b.id} token={token} b={b} urls={urls} act={act} />)}</>;
}

function BallotCard({ token, b, urls, act }: { token: string; b: Ballot; urls: Record<string, string>; act: (p: Promise<{ error?: unknown }>, ok?: string) => Promise<boolean> }) {
  const [pick, setPick] = useState<string | null>(b.mine?.option_id ?? null);
  const [comment, setComment] = useState(b.mine?.comment ?? '');
  const [busy, setBusy] = useState(false);
  const bars = ballotBars(b);
  const changed = pick !== (b.mine?.option_id ?? null) || comment.trim() !== (b.mine?.comment ?? '');
  const winner = b.options.find((o) => o.id === b.winner_option_id);

  const submit = async () => {
    if (!pick) return;
    setBusy(true);
    await act(crewApi.vote(token, b.id, pick, comment.trim().slice(0, MAX_COMMENT)), b.mine ? 'Vote changed.' : 'Vote in! Here\'s how it\'s looking.');
    setBusy(false);
  };

  return (
    <section className={`td-panel td-poll${b.open ? '' : ' is-closed'}`}>
      <h2>{b.title}</h2>
      {b.question && <p>{b.question}</p>}
      <span className="td-hint">{b.open ? statusLabel({ closed_at: null, closes_at: b.closes_at }) : 'Voting closed'}
        {b.total != null ? ` · ${b.total} vote${b.total === 1 ? '' : 's'}` : ''}</span>
      {!b.open && winner && <div className="td-ok">🏆 Winner: <b>{winner.title}</b></div>}
      {b.open && !b.mine && <span className="td-hint">Tap the one you want, add a comment if you like, then lock it in. Totals show up after you vote.</span>}
      <div className="td-vote-grid">
        {b.options.map((o) => {
          const img = o.file && urls[o.file.id];
          const isMine = b.mine?.option_id === o.id;
          return (
            <button key={o.id} type="button" className={`td-vote-opt${o.id === b.winner_option_id && !b.open ? ' is-winner' : ''}${isMine ? ' is-mine' : ''}`}
              aria-pressed={pick === o.id} disabled={!b.open || busy} onClick={() => setPick(o.id)}>
              <div className="td-thumb">{img ? <img src={img} alt={o.title} /> : <span>{o.file && isImageFile(o.file) ? 'LOADING…' : 'NO IMAGE'}</span>}</div>
              <b>{o.title}{isMine ? ' · your pick' : ''}</b>
              {o.notes && <span className="td-hint">{o.notes}</span>}
              {o.votes != null && <>
                <div className="td-bar" aria-hidden="true"><span style={{ width: `${bars.pct[o.id] ?? 0}%` }} /></div>
                <span className="td-hint">{o.votes} vote{o.votes === 1 ? '' : 's'} · {bars.pct[o.id] ?? 0}%{bars.leaders.includes(o.id) && b.open ? ' · leading' : ''}</span>
              </>}
            </button>
          );
        })}
      </div>
      {b.open && <>
        <textarea className="td-input" rows={2} maxLength={MAX_COMMENT} aria-label="Comment (optional)" placeholder="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
        <div className="td-row">
          <button className="td-btn cta" disabled={!pick || !changed || busy} onClick={() => void submit()}>
            {busy ? 'SAVING…' : b.mine ? 'CHANGE MY VOTE' : 'LOCK IN MY VOTE'}</button>
          {b.mine && !changed && <span className="td-hint">✓ Voted. You can change it until voting closes.</span>}
        </div>
      </>}
    </section>
  );
}
