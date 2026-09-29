/**
 * Winners workbench: stitches pools + standings + payouts for every division (pure).
 * Field size = registered players in the division (they paid the entry), whatever their finish.
 */
import type { LbRow } from '../jewel/leaderboard';
import {
  defaultConfig, effectivePaid, effectivePcts, payout, pools, standings,
  type DivisionConfig, type FinishStatus, type Mode, type Payout, type PoolLine, type PrizeSettings, type Standings,
} from './payout';

export interface DivisionResult {
  config: DivisionConfig; pool: PoolLine; paid: number; pcts: number[]; standing: Standings; result: Payout;
}
export interface WinnersResult { divisions: DivisionResult[]; overBy: number; totals: { pool: number; cash: number; credit: number; leftover: number } }

export function computeWinners(input: {
  divOrder: string[];
  players: Array<{ id: string; div_code: string; finish_status?: FinishStatus | null }>;
  board: LbRow[];
  configs: Record<string, DivisionConfig>;
  settings: PrizeSettings;
  playoffs: Record<string, string>;
  rounds: 1 | 2;
  mode: Mode;
}): WinnersResult {
  const counts: Record<string, number> = {};
  for (const p of input.players) counts[p.div_code] = (counts[p.div_code] ?? 0) + 1;
  const divs = input.divOrder.filter((d) => (counts[d] ?? 0) > 0);
  const configs = divs.map((d) => input.configs[d] ?? defaultConfig(d));
  const pr = pools(configs, counts, input.settings.addedTotal);
  const status: Record<string, FinishStatus | undefined> = {};
  for (const p of input.players) if (p.finish_status) status[p.id] = p.finish_status;

  const divisions = configs.map((config, i) => {
    const paid = effectivePaid(config, counts[config.div]);
    const pcts = effectivePcts(config, paid);
    const standing = standings(input.board.filter((r) => r.div_code === config.div), input.rounds, status, input.mode);
    const result = payout(standing.ranked, pr.lines[i].total, pcts, config.currency, input.settings.creditRound, input.playoffs[config.div]);
    return { config, pool: pr.lines[i], paid, pcts, standing, result };
  });
  const sum = (f: (d: DivisionResult) => number) => Math.round(divisions.reduce((a, d) => a + f(d), 0) * 100) / 100;
  return {
    divisions,
    overBy: pr.overBy,
    totals: {
      pool: sum((d) => d.pool.total),
      cash: sum((d) => (d.config.currency === 'cash' ? d.result.awarded : 0)),
      credit: sum((d) => (d.config.currency === 'credit' ? d.result.awarded : 0)),
      leftover: sum((d) => d.result.leftover),
    },
  };
}

/** What the public page shows: only prize winners (amount > 0), in place order. */
export function toPayload(eventName: string, creditLabel: string, mode: Mode, w: WinnersResult) {
  return {
    event: eventName, credit_label: creditLabel, mode,
    divisions: w.divisions.map((d) => ({
      div: d.config.div, currency: d.config.currency,
      rows: d.result.rows.filter((r) => r.amount > 0).map((r) => ({ place: r.place, name: r.name, total: r.total, amount: r.amount })),
    })).filter((d) => d.rows.length),
  };
}
