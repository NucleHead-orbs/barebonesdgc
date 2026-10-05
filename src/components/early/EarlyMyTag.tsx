/** My Tag: early access status and this player's own raffle tickets (with the breakdown only they and the TDs see). */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as ea from '../../lib/early/api';
import { daysLeft, earlyPath, tickets, type EaMine } from '../../lib/early/early';
import { localDate, niceDate } from '../../lib/leagues/leagues';

export function EarlyMyTag({ token, rev }: { token: string; rev: number }) {
  const [rows, setRows] = useState<EaMine[]>([]);
  useEffect(() => {
    let live = true;
    void (async () => { const r = await ea.mine(token); if (live && r.data) setRows(r.data); })();
    return () => { live = false; };
  }, [token, rev]);
  if (!rows.length) return null;
  const today = localDate();
  return (
    <>
      {rows.map((x) => (
        <section key={x.slug} className="td-panel mt-ea">
          <h2>{x.name} Early Access</h2>
          {x.status === 'approved' && x.me ? (
            <>
              <div className="mt-ea-total"><b>{x.me.tickets}</b><span>raffle {x.me.tickets === 1 ? 'ticket' : 'tickets'}</span></div>
              <ul className="mt-ea-lines">
                <li><span>Counting rounds</span><b>{tickets(x.me.round_tickets)}</b></li>
                <li><span>New Jewel partners</span><b>{tickets(x.me.partners)}</b></li>
                {x.me.bonus > 0 && <li><span>Bonus</span><b>{tickets(x.me.bonus)}</b></li>}
              </ul>
              <p className="td-hint">
                Rounds count when you save them on the Scorecard with at least {x.min_players} Jewel players and everyone confirms, or with 2 when it's an accepted challenge (tags on the line). Up to {x.weekly_cap} a week.
                {today <= x.closes_on ? ` ${daysLeft(today, x.closes_on)} days left (closes ${niceDate(x.closes_on)}).` : ' Closed: winners are drawn at the players meeting.'}
              </p>
              <Link className="td-btn quiet" to={earlyPath(x.slug)}>RULES & RAFFLE BOARD ›</Link>
            </>
          ) : x.status === 'pending' ? (
            <p className="td-hint">Your request to join is waiting on a TD. Your early access tag shows up here once they approve it.</p>
          ) : (
            <>
              <p className="td-hint">Registered for {x.name}? Join early access: get a tag in the early set and stack raffle tickets for the players meeting.</p>
              <Link className="td-btn cta" to={earlyPath(x.slug)}>JOIN EARLY ACCESS</Link>
            </>
          )}
        </section>
      ))}
    </>
  );
}
