/**
 * Winners workbench: stitches pools + standings + payouts for every division (pure).
 * Field size = registered players in the division (they paid the entry), whatever their finish.
 */
import { teamName, type LbRow, type TeamRow } from '../jewel/leaderboard';
import {
  cents, defaultConfig, effectivePaid, effectivePcts, money, payout, pools, standings,
  type Currency, type DivisionConfig, type FinishStatus, type Mode, type Payout, type PoolLine, type PrizeSettings, type Standings,
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

// ---------- doubles: one team pool per doubles round (locked 2026-09-30) ----------
/** round_payouts row. entryFee is per PLAYER (a team puts in 2 fees, a Cali 1). Added cash is a fixed amount for this pool. */
export interface TeamPayoutConfig { round: 1 | 2; currency: Currency; entryFee: number; paybackPct: number; addedOverride: number | null; paidPlaces: number | null; pcts: number[] | null }
export const defaultTeamConfig = (round: 1 | 2): TeamPayoutConfig => ({ round, currency: 'cash', entryFee: 0, paybackPct: 100, addedOverride: null, paidPlaces: null, pcts: null });

export interface TeamResult {
  config: TeamPayoutConfig; teams: number; players: number; pool: { entryPart: number; added: number; total: number };
  paid: number; pcts: number[]; result: Payout; each: Record<string, number>; members: Record<string, number>;
  unfinished: string[]; leftover: number;
}

/** Rank finished teams, pay the pool with the division rules (ties split, rounding down), then split each prize between partners. */
/** The playoffs row for a doubles round's pool (migration 20261127): winner = the winning team's captain. */
export const teamPlayoffKey = (round: 1 | 2) => `TEAMS-R${round}`;

export function computeTeamWinners(rows: TeamRow[], config: TeamPayoutConfig, creditRound: 1 | 5, mode: Mode, playoffCaptain?: string | null): TeamResult {
  const members: Record<string, number> = Object.fromEntries(rows.map((t) => [t.team_id, t.b_name ? 2 : 1]));
  const players = rows.reduce((a, t) => a + members[t.team_id], 0);
  const entryPart = cents(players * config.entryFee * config.paybackPct / 100);
  const added = cents(config.addedOverride ?? 0);
  const pool = { entryPart, added, total: cents(entryPart + added) };
  const done = (t: TeamRow) => t.hole_count > 0 && t.holes_played >= t.hole_count && (mode === 'live' || t.official);
  const ranked = rows.filter(done).map((t) => ({ id: t.team_id, name: teamName(t), total: t.to_par ?? 0 }))
    .sort((a, b) => a.total - b.total || a.name.localeCompare(b.name));
  const asDiv: DivisionConfig = { div: 'DUBS', currency: config.currency, entryFee: config.entryFee, paybackPct: config.paybackPct, addedOverride: config.addedOverride, paidPlaces: config.paidPlaces, pcts: config.pcts };
  const paid = effectivePaid(asDiv, rows.length);
  const pcts = effectivePcts(asDiv, paid);
  const playoffTeam = playoffCaptain ? rows.find((t) => t.player_a === playoffCaptain)?.team_id ?? null : null;
  const result = payout(ranked, pool.total, pcts, config.currency, creditRound, playoffTeam);
  const unit = config.currency === 'cash' ? 1 : creditRound;
  const each: Record<string, number> = {};
  let splitLeft = 0;
  for (const r of result.rows) {
    const m = members[r.id] ?? 1;
    each[r.id] = Math.floor(r.amount / m / unit + 1e-9) * unit;
    splitLeft = cents(splitLeft + r.amount - each[r.id] * m);
  }
  return {
    config, teams: rows.length, players, pool, paid, pcts, result, each, members,
    unfinished: rows.filter((t) => !done(t)).map(teamName).sort(), leftover: cents(result.leftover + splitLeft),
  };
}

/** Public rows for a doubles pool: the prize per team, and what each partner gets. */
export function teamPayload(r: TeamResult, creditLabel: string) {
  return {
    div: `DUBS · R${r.config.round}`, currency: r.config.currency,
    rows: r.result.rows.filter((x) => x.amount > 0).map((x) => ({
      place: x.place, total: x.total, amount: x.amount,
      name: (r.members[x.id] ?? 1) > 1 ? `${x.name} · ${money(r.each[x.id], r.config.currency, creditLabel)} each` : x.name,
    })),
  };
}
