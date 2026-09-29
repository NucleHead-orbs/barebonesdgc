import { describe, expect, it } from 'vitest';
import type { LbRow } from '../jewel/leaderboard';
import { defaultConfig } from './payout';
import { computeWinners, toPayload } from './winners';

const row = (id: string, div: string, toPar: number, official = true, holes = 9): LbRow => ({
  player_id: id, name: id, div_code: div, div_sort: 1, r1_holes: holes, r1_to_par: toPar, r1_official: official,
  r2_holes: 0, r2_to_par: null, r2_official: false, hole_count: 9,
});

describe('computeWinners', () => {
  const players = [
    { id: 'p1', div_code: 'MPO' }, { id: 'p2', div_code: 'MPO' }, { id: 'p3', div_code: 'MPO', finish_status: 'dnf' as const },
    { id: 'a1', div_code: 'MA1' }, { id: 'a2', div_code: 'MA1' }, { id: 'a3', div_code: 'MA1' },
  ];
  const board = [row('p1', 'MPO', -4), row('p2', 'MPO', -2), row('p3', 'MPO', -9), row('a1', 'MA1', 1), row('a2', 'MA1', 1), row('a3', 'MA1', 3, false)];
  const base = {
    divOrder: ['MPO', 'FPO', 'MA1'], players, board, playoffs: {}, rounds: 1 as const, mode: 'official' as const,
    configs: { MPO: { ...defaultConfig('MPO'), entryFee: 50, paidPlaces: 2, pcts: [60, 40] }, MA1: { ...defaultConfig('MA1'), entryFee: 30, paybackPct: 50 } },
    settings: { addedTotal: 60, creditRound: 5 as const, creditLabel: 'Boner Bucks' },
  };

  it('skips empty divisions, builds pools from field size, pays places', () => {
    const w = computeWinners(base);
    expect(w.divisions.map((d) => d.config.div)).toEqual(['MPO', 'MA1']);
    const [mpo, ma1] = w.divisions;
    expect(mpo.pool).toEqual({ div: 'MPO', players: 3, entryPart: 150, added: 30, total: 180 });
    expect(mpo.result.rows.map((r) => [r.id, r.place, r.amount])).toEqual([['p1', '1', 108], ['p2', '2', 72]]);
    expect(mpo.standing.out.map((o) => o.id)).toEqual(['p3']); // DNF never places, even with the best score
    expect(ma1.pool.total).toBe(75); // 3 × 30 × 50% + 30 added
    expect(ma1.standing.unfinished.map((u) => u.id)).toEqual(['a3']); // not signed yet
    expect(ma1.result.rows.map((r) => [r.place, r.amount])).toEqual([['T1', 35], ['T1', 35]]); // 1 paid spot split two ways, $5 rounding
    expect(ma1.result.needsPlayoff).toBe(true);
  });

  it('a playoff winner takes 1st outright', () => {
    const w = computeWinners({ ...base, playoffs: { MA1: 'a2' } });
    expect(w.divisions[1].result.rows.map((r) => [r.id, r.place, r.amount])).toEqual([['a2', '1', 75], ['a1', '2', 0]]);
  });

  it('raising the raffle total re-spreads instantly', () => {
    const w = computeWinners({ ...base, settings: { ...base.settings, addedTotal: 600 } });
    expect(w.divisions.map((d) => d.pool.added)).toEqual([300, 300]);
    expect(w.totals.pool).toBe(150 + 45 + 600);
  });

  it('the public payload lists prize winners only', () => {
    const p = toPayload('League Night', 'Boner Bucks', 'official', computeWinners(base));
    expect(p.divisions.map((d) => [d.div, d.rows.length])).toEqual([['MPO', 2], ['MA1', 2]]);
    expect(p.divisions[0].rows[0]).toEqual({ place: '1', name: 'p1', total: -4, amount: 108 });
  });
});
