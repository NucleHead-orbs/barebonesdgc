/**
 * Winners Circle math (pure, deterministic). Locked 2026-09-29.
 *
 * Pool per division  = players × entry fee × payback% + share of added cash.
 *   Added cash (raffle etc.) is spread by field size over divisions WITHOUT a fixed added amount;
 *   divisions with a fixed amount get exactly that. Cents left from the split go to the biggest field.
 * Who places         = finished every round (official: signed/paper only; live: all holes in) and not DNF/DQ/NS.
 * Ties (PDGA)        = tied players split the combined % of the spots they cover. A tie across the
 *                      cash line splits the last paid spots among ALL tied. Tie for 1st: the recorded
 *                      playoff winner takes 1st; the rest of that tie split 2nd and down.
 * Rounding           = cash to whole $, credit to $1 or $5, always DOWN. The leftover is reported, never hidden.
 * Default tables     = pros (cash) pay ≈40% of the field, ams (credit) ≈1/3; weights (n−i+1)^1.5.
 */
import type { LbRow } from '../jewel/leaderboard';

export type Currency = 'cash' | 'credit';
export type FinishStatus = 'dnf' | 'dq' | 'ns';
export type Mode = 'official' | 'live';

export interface DivisionConfig {
  div: string;
  currency: Currency;
  entryFee: number;
  paybackPct: number;          // 0–100
  addedOverride: number | null; // fixed added $ for this division, or null = share of the spread
  paidPlaces: number | null;   // null = default for field size
  pcts: number[] | null;       // null = default table
}
export interface PrizeSettings { addedTotal: number; creditRound: 1 | 5; creditLabel: string }

export const isPro = (div: string) => /^[MF]P/.test(div.toUpperCase());
export const defaultConfig = (div: string): DivisionConfig => ({
  div, currency: isPro(div) ? 'cash' : 'credit', entryFee: 0, paybackPct: 100, addedOverride: null, paidPlaces: null, pcts: null,
});

export const cents = (n: number) => Math.round(n * 100) / 100;

export function defaultPaid(field: number, currency: Currency): number {
  if (field <= 0) return 0;
  return Math.min(field, Math.max(1, Math.ceil(field * (currency === 'cash' ? 0.4 : 1 / 3))));
}

/** Top-heavy table summing to exactly 100.0 (one decimal); rounding goes to 1st. */
export function defaultPcts(paid: number): number[] {
  if (paid <= 0) return [];
  const w = Array.from({ length: paid }, (_, i) => (paid - i) ** 1.5);
  const sum = w.reduce((a, b) => a + b, 0);
  const p = w.map((x) => Math.round((x / sum) * 1000) / 10);
  p[0] = Math.round((100 - p.slice(1).reduce((a, b) => a + b, 0)) * 10) / 10;
  return p;
}

export const effectivePaid = (c: DivisionConfig, field: number) =>
  Math.min(Math.max(0, c.paidPlaces ?? defaultPaid(field, c.currency)), Math.max(field, 0));
export const effectivePcts = (c: DivisionConfig, paid: number): number[] => {
  const base = c.pcts && c.pcts.length ? c.pcts : defaultPcts(paid);
  return Array.from({ length: paid }, (_, i) => base[i] ?? 0);
};

export interface PoolLine { div: string; players: number; entryPart: number; added: number; total: number }
export interface PoolResult { lines: PoolLine[]; spread: number; overBy: number }

export function pools(configs: DivisionConfig[], counts: Record<string, number>, addedTotal: number): PoolResult {
  const fixed = configs.filter((c) => c.addedOverride != null).reduce((a, c) => a + (c.addedOverride ?? 0), 0);
  const spread = Math.max(0, cents(addedTotal - fixed));
  const shareable = configs.filter((c) => c.addedOverride == null && (counts[c.div] ?? 0) > 0);
  const field = shareable.reduce((a, c) => a + counts[c.div], 0);
  const added: Record<string, number> = {};
  let given = 0;
  for (const c of shareable) { added[c.div] = Math.floor((spread * counts[c.div] / field) * 100 + 1e-9) / 100; given = cents(given + added[c.div]); }
  if (shareable.length && cents(spread - given) > 0) {
    const big = [...shareable].sort((a, b) => counts[b.div] - counts[a.div])[0];
    added[big.div] = cents(added[big.div] + spread - given);
  }
  const lines = configs.map((c) => {
    const players = counts[c.div] ?? 0;
    const entryPart = cents(players * c.entryFee * c.paybackPct / 100);
    const a = c.addedOverride != null ? c.addedOverride : added[c.div] ?? 0;
    return { div: c.div, players, entryPart, added: cents(a), total: cents(entryPart + a) };
  });
  return { lines, spread, overBy: Math.max(0, cents(fixed - addedTotal)) };
}

export interface Finisher { id: string; name: string; total: number }
export interface Standings { ranked: Finisher[]; unfinished: Array<{ id: string; name: string }>; out: Array<{ id: string; name: string; status: FinishStatus }> }

export function standings(rows: LbRow[], rounds: 1 | 2, status: Record<string, FinishStatus | undefined>, mode: Mode): Standings {
  const done = (holes: number, official: boolean, of: number) => of > 0 && holes >= of && (mode === 'live' || official);
  const res: Standings = { ranked: [], unfinished: [], out: [] };
  for (const r of rows) {
    const st = status[r.player_id];
    if (st) { res.out.push({ id: r.player_id, name: r.name, status: st }); continue; }
    const ok = done(r.r1_holes, r.r1_official, r.hole_count) && (rounds === 1 || done(r.r2_holes, r.r2_official, r.hole_count));
    if (!ok) { res.unfinished.push({ id: r.player_id, name: r.name }); continue; }
    res.ranked.push({ id: r.player_id, name: r.name, total: (r.r1_to_par ?? 0) + (rounds === 2 ? r.r2_to_par ?? 0 : 0) });
  }
  res.ranked.sort((a, b) => a.total - b.total || a.name.localeCompare(b.name));
  res.unfinished.sort((a, b) => a.name.localeCompare(b.name));
  res.out.sort((a, b) => a.name.localeCompare(b.name));
  return res;
}

export interface PrizeRow extends Finisher { place: string; pos: number; amount: number; share: number }
export interface Payout { rows: PrizeRow[]; paid: number; pool: number; awarded: number; leftover: number; needsPlayoff: boolean; pctTotal: number }

export function payout(ranked: Finisher[], pool: number, pcts: number[], currency: Currency, creditRound: 1 | 5, playoffWinner?: string | null): Payout {
  const paid = pcts.length;
  const groups: Finisher[][] = [];
  for (const f of ranked) {
    const g = groups[groups.length - 1];
    if (g && g[0].total === f.total) g.push(f); else groups.push([f]);
  }
  const tieForFirst = (groups[0]?.length ?? 0) > 1;
  const winner = tieForFirst && playoffWinner ? groups[0].find((f) => f.id === playoffWinner) : undefined;
  if (winner) groups.splice(0, 1, [winner], groups[0].filter((f) => f.id !== winner.id));
  const unit = currency === 'cash' ? 1 : creditRound;
  const rows: PrizeRow[] = [];
  let pos = 1;
  for (const g of groups) {
    const covered = Array.from({ length: g.length }, (_, i) => pos + i).filter((p) => p <= paid);
    const share = covered.reduce((a, p) => a + pcts[p - 1], 0) / 100 * pool / g.length;
    const amount = Math.floor(share / unit + 1e-9) * unit;
    const place = g.length > 1 ? `T${pos}` : String(pos);
    for (const f of g) rows.push({ ...f, place, pos, share: cents(share), amount });
    pos += g.length;
  }
  const awarded = rows.reduce((a, r) => a + r.amount, 0);
  const pctTotal = Math.round(pcts.reduce((a, b) => a + b, 0) * 10) / 10;
  const handedOut = ranked.length ? pool * Math.min(pctTotal, 100) / 100 : 0;
  return { rows, paid, pool, awarded, leftover: cents(handedOut - awarded), needsPlayoff: tieForFirst && !winner, pctTotal };
}

export const money = (n: number, currency: Currency, label = 'credit') =>
  currency === 'cash' ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : `${n.toLocaleString('en-US')} ${label}`;
