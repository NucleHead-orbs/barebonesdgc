/**
 * Leaderboard ranking. The database (leaderboard view) owns the numbers: to-par per round,
 * holes played, and whether a round is official (submitted card or TD paper total).
 * This file only decides what counts in each mode and how positions/ties display.
 *   Official: only official rounds count.  Live: any round with at least one hole counts.
 *   Positions are per division. Ties show "T3". Nobody counted yet shows "–" at the bottom.
 */
export interface LbRow {
  player_id: string; name: string; div_code: string; div_sort: number;
  r1_holes: number; r1_to_par: number | null; r1_official: boolean;
  r2_holes: number; r2_to_par: number | null; r2_official: boolean;
  hole_count: number;
}
export type Mode = 'official' | 'live';

export interface Ranked {
  id: string; name: string; div: string;
  pos: string; // '1', 'T3', '–'
  first: boolean;
  r1: number | null; r2: number | null; total: number | null;
  status: string;
}

const counts = (holes: number, official: boolean, mode: Mode) => holes > 0 && (mode === 'live' || official);

export function statusLine(r: LbRow): string {
  if (r.r2_holes > 0) return r.r2_official ? 'R2 ✓ signed' : `R2 · thru ${r.r2_holes} · unofficial`;
  if (r.r1_holes > 0) return r.r1_official ? 'R1 ✓ signed' : `R1 · thru ${r.r1_holes} · unofficial`;
  return 'Not started';
}

/**
 * A recorded playoff (playoffs table: the division's code, or 'TEAMS-R<round>' for a doubles pool) settles a tie for 1st:
 * the winner shows 1, the rest of that tie show 2 (T2 if more than one). Ignored unless the winner is in the tie for 1st.
 */
export function settlePlayoff<T extends { pos: string; first: boolean }>(ranked: T[], isWinner: (r: T) => boolean): T[] {
  const tie = ranked.filter((r) => r.pos === 'T1');
  if (tie.length < 2 || !tie.some(isWinner)) return ranked;
  const rest = tie.length - 1;
  const out = ranked.map((r) => (r.pos !== 'T1' ? r : isWinner(r) ? { ...r, pos: '1', first: true } : { ...r, pos: rest > 1 ? 'T2' : '2', first: false }));
  return [...out.filter((r) => r.pos === '1'), ...out.filter((r) => r.pos !== '1')];
}

export function rankDivision(rows: LbRow[], mode: Mode, playoffWinner?: string | null): Ranked[] {
  const scored = rows.map((r) => {
    const r1 = counts(r.r1_holes, r.r1_official, mode) ? r.r1_to_par ?? 0 : null;
    const r2 = counts(r.r2_holes, r.r2_official, mode) ? r.r2_to_par ?? 0 : null;
    const total = r1 == null && r2 == null ? null : (r1 ?? 0) + (r2 ?? 0);
    return { r, r1, r2, total };
  });
  scored.sort((a, b) =>
    (a.total == null ? 1 : 0) - (b.total == null ? 1 : 0) || (a.total ?? 0) - (b.total ?? 0) || a.r.name.localeCompare(b.r.name));
  const totals = scored.map((s) => s.total).filter((t): t is number => t != null);
  const ranked = scored.map(({ r, r1, r2, total }) => {
    let pos = '–';
    if (total != null) {
      const n = 1 + totals.filter((t) => t < total).length;
      pos = totals.filter((t) => t === total).length > 1 ? `T${n}` : String(n);
    }
    return { id: r.player_id, name: r.name, div: r.div_code, pos, first: pos === '1' || pos === 'T1', r1, r2, total, status: statusLine(r) };
  });
  return playoffWinner ? settlePlayoff(ranked, (p) => p.id === playoffWinner) : ranked;
}

/** Divisions that have players, in canonical order. */
export function divisionsPresent(rows: LbRow[]): string[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.div_code, r.div_sort);
  return [...m].sort((a, b) => a[1] - b[1]).map(([d]) => d);
}

/** Players mid-round right now (at least one hole, not finished, not official). */
export function onCourse(rows: LbRow[]): number {
  const mid = (h: number, off: boolean, n: number) => h > 0 && h < n && !off;
  return rows.filter((r) => mid(r.r1_holes, r.r1_official, r.hole_count) || mid(r.r2_holes, r.r2_official, r.hole_count)).length;
}

export const toPar = (n: number | null): string => (n == null ? '–' : n === 0 ? 'E' : n > 0 ? `+${n}` : String(n));
export const parTone = (n: number | null): 'under' | 'over' | 'even' => (n == null || n === 0 ? 'even' : n < 0 ? 'under' : 'over');

/** One round of a mixed-format event, shaped as a one-round board (its numbers sit in the r1 slots). */
export function onlyRound(rows: LbRow[], round: 1 | 2): LbRow[] {
  return rows.map((r) => round === 1
    ? { ...r, r2_holes: 0, r2_to_par: null, r2_official: false }
    : { ...r, r1_holes: r.r2_holes, r1_to_par: r.r2_to_par, r1_official: r.r2_official, r2_holes: 0, r2_to_par: null, r2_official: false });
}

/** Doubles board row (team_rounds view). A Cali has no b_name. */
export interface TeamRow {
  team_id: string; round: number; team_no: number; a_name: string; b_name: string | null;
  holes_played: number; hole_count: number; to_par: number | null; official: boolean; card_label: string | null;
  /** the captain (scores live on their rows); a doubles playoff is recorded against them */
  player_a?: string;
}
export interface RankedTeam { id: string; name: string; pos: string; first: boolean; total: number | null; status: string; cali: boolean }
export const teamName = (t: Pick<TeamRow, 'a_name' | 'b_name'>) => (t.b_name ? `${t.a_name} & ${t.b_name}` : `${t.a_name} (Cali)`);

/** playoffCaptain: the captain (player_a) of the team that won a playoff for 1st (playoffs 'TEAMS-R<round>'). */
export function rankTeams(rows: TeamRow[], mode: Mode, playoffCaptain?: string | null): RankedTeam[] {
  const scored = rows.map((t) => ({ t, total: counts(t.holes_played, t.official, mode) ? t.to_par ?? 0 : null }));
  scored.sort((a, b) => (a.total == null ? 1 : 0) - (b.total == null ? 1 : 0) || (a.total ?? 0) - (b.total ?? 0) || teamName(a.t).localeCompare(teamName(b.t)));
  const totals = scored.map((s) => s.total).filter((x): x is number => x != null);
  const ranked = scored.map(({ t, total }) => {
    let pos = '–';
    if (total != null) {
      const n = 1 + totals.filter((x) => x < total).length;
      pos = totals.filter((x) => x === total).length > 1 ? `T${n}` : String(n);
    }
    const status = t.holes_played === 0 ? 'Not started' : t.official ? '✓ signed' : `thru ${t.holes_played} · unofficial`;
    return { id: t.team_id, name: teamName(t), pos, first: pos === '1' || pos === 'T1', total, status, cali: !t.b_name };
  });
  if (!playoffCaptain) return ranked;
  const winner = rows.find((t) => t.player_a === playoffCaptain)?.team_id;
  return winner ? settlePlayoff(ranked, (r) => r.id === winner) : ranked;
}
