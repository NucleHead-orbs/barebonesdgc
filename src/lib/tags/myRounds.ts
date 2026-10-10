/**
 * My Tag → MY ROUNDS (migration 20261117): every saved Scorecard card I'm on (full hole-by-hole card) and every applied
 * tag round without one (manual submissions, league nights: totals only). Server owns the list; this is display logic.
 */
export interface MyCardPlayer {
  member_id: string | null; name: string; nickname: string | null; guest: boolean;
  scores: number[] | null; strokes: number; to_par: number; confirmed: boolean; disputed: boolean;
  /** pulled out after this many holes (DNF) */
  dnf_after?: number | null;
}
export interface MyTagMove { pool_name: string; status: 'pending' | 'applied' | 'disputed'; before: number | null; after: number | null }
export interface MyCardRound {
  kind: 'card'; id: string; course: string; played_on: string; pars: number[]; hole_labels: string[] | null; totals_only: boolean;
  note: string | null; players: MyCardPlayer[]; tags: MyTagMove[];
}
export interface MyTagPlayer { member_id: string; name: string; nickname: string | null; score: number; before: number | null; after: number | null }
export interface MyTagRound { kind: 'tag'; id: string; course: string | null; played_on: string; pool_name: string; source: 'casual' | 'event'; players: MyTagPlayer[] }
/** A dubs night (migration 20261125): team standings the host posted. */
export interface NightTeam { team: number; place: number; to_par: number; players: Array<{ id: string | null; name: string }> }
export interface MyNightRound { kind: 'night'; id: string; title: string; course: string | null; played_on: string; format: 'singles' | 'dubs'; note: string | null; teams: NightTeam[] }
export type MyPlayRound = MyCardRound | MyTagRound;
export type MyRound = MyPlayRound | MyNightRound;
export interface MyRoundsPage { rounds: MyRound[]; more: boolean }

/** Where I finished: 1 = best (ties share the place), out of how many. */
export function myPlace(r: MyPlayRound, meId: string): { place: number; of: number; tied: boolean } | null {
  const scores = r.kind === 'card' ? r.players.map((p) => ({ id: p.member_id, s: p.strokes + (p.dnf_after != null ? 100000 : 0) })) : r.players.map((p) => ({ id: p.member_id, s: p.score }));
  const me = scores.find((x) => x.id === meId);
  if (!me) return null;
  return { place: 1 + scores.filter((x) => x.s < me.s).length, of: scores.length, tied: scores.filter((x) => x.s === me.s).length > 1 };
}

export const ordinal = (n: number) => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
};

/** "#4 → #2", "kept #3", or "" when nothing moved / no tags. */
export function tagMove(before: number | null, after: number | null): string {
  if (before == null && after == null) return '';
  if (before === after) return `kept #${after}`;
  return `#${before ?? '–'} → #${after ?? '–'}`;
}

/** Birdies-or-better / bogeys-or-worse on a card, for the summary chip. */
export function holeCounts(pars: number[], scores: number[] | null): { under: number; over: number } | null {
  if (!scores) return null;
  let under = 0, over = 0;
  scores.forEach((s, i) => { if (s == null || pars[i] == null) return; if (s < pars[i]) under++; else if (s > pars[i]) over++; });
  return { under, over };
}

/** My team on a night: its place, out of how many teams, tied or not. */
export function myTeam(teams: NightTeam[], meId: string): { team: NightTeam; of: number; tied: boolean } | null {
  const t = teams.find((x) => x.players.some((p) => p.id === meId));
  if (!t) return null;
  return { team: t, of: teams.length, tied: teams.filter((x) => x.place === t.place).length > 1 };
}
