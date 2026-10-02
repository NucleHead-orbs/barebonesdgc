import { useState } from 'react';
import * as crewApi from '../../lib/crew/api';
import type { CrewHome } from '../../lib/crew/api';
import { cell, myShifts, shifts } from '../../lib/crew/stations';

/** Crew → STATIONS: your shifts first, then every shift's stations. Open spots can be claimed; your own claims dropped. */
export default function CrewStations({ token, home, act }: {
  token: string; home: CrewHome; act: (p: Promise<{ error?: unknown }>, ok?: string) => Promise<boolean>;
}) {
  const sh = shifts(home.event.starts_on, home.event.ends_on);
  const stations = home.stations ?? [];
  const slots = home.slots ?? [];
  const mine = myShifts(home.me.id, stations, sh, slots);
  const [only, setOnly] = useState<'open' | 'all'>('all');
  if (!stations.length) return <div className="td-empty">The TD hasn't set up stations yet.</div>;
  return (
    <>
      <section className="td-panel">
        <h2>Your shifts</h2>
        {!mine.length && <p className="td-hint">You're not on a station yet. Claim an open spot below, or the TD will place you.</p>}
        <ul className="td-checklist">
          {mine.map(({ slot, shift, station }) => (
            <li key={slot.id}>
              <span><b>{shift.label}</b> · {station}{slot.claimed ? <span className="td-hint"> · you claimed this</span> : null}</span>
              {slot.claimed && <button className="td-btn quiet" onClick={() => { if (window.confirm(`Drop ${station} ${shift.label}?`)) void act(crewApi.dropSlot(token, slot.id), 'Dropped.'); }}>DROP</button>}
            </li>
          ))}
        </ul>
      </section>
      <div className="td-seg">
        <button aria-pressed={only === 'all'} onClick={() => setOnly('all')}>EVERYTHING</button>
        <button aria-pressed={only === 'open'} onClick={() => setOnly('open')}>OPEN SPOTS</button>
      </div>
      {sh.map((t) => {
        const cells = stations.map((s) => cell({ ...s, needs: s.needs ?? [] }, t, slots)).filter((c) => c.need > 0 || c.slots.length);
        const shown = only === 'open' ? cells.filter((c) => c.short > 0) : cells;
        if (!shown.length) return null;
        return (
          <section key={t.key} className="td-panel">
            <h2>{t.label}</h2>
            <ul className="td-checklist">
              {shown.map((c) => {
                const here = c.slots.some((x) => x.crew_id === home.me.id);
                return (
                  <li key={c.station.id} className={c.short ? 'is-short' : 'is-in'}>
                    <span>
                      <b>{c.station.name}</b> <span className="td-hint">{c.slots.length}/{c.need}</span><br />
                      <span className="td-hint">{c.slots.map((x) => (x.crew_id === home.me.id ? 'You' : x.name ?? '?')).join(', ') || 'Nobody yet'}</span>
                    </span>
                    {c.short > 0 && !here && <button className="td-btn cta" onClick={() => void act(crewApi.claimSlot(token, c.station.id, t.day, t.half), `You're on ${c.station.name}, ${t.label}.`)}>CLAIM</button>}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}
