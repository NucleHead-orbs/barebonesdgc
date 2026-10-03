/**
 * Which tee signs an event needs (pure). One sign per hole (its main tee) plus one per extra tee pad
 * (hole_tees, supabase/migrations/20261018000000_tee_pads.sql). Sponsors sit on a sign by hole + tee_id
 * (null = the main tee). A sign holds one sponsor (full) or two (half).
 */
export interface HoleTee { id: string; n: number; label: string; dist_ft: number | null; par: number | null; sort: number }
export interface SignRef { key: string; n: number; tee: HoleTee | null }
export interface SignSponsor { hole: number | null; tee_id: string | null; sort: number }

export const MAX_PER_SIGN = 2;

/** Every sign in play order: hole 1, hole 2, …, with a hole's extra pads right after its main tee. */
export function signList(holes: number[], tees: HoleTee[]): SignRef[] {
  const out: SignRef[] = [];
  for (const n of [...holes].sort((a, b) => a - b)) {
    out.push({ key: String(n), n, tee: null });
    for (const t of tees.filter((x) => x.n === n).sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))) out.push({ key: `${n}:${t.id}`, n, tee: t });
  }
  return out;
}

/** The sponsors on one sign, in sponsor order. A sponsor whose tee no longer exists counts on the main tee. */
export function sponsorsOn<T extends SignSponsor>(spons: T[], sign: SignRef, tees: HoleTee[]): T[] {
  const live = new Set(tees.map((t) => t.id));
  return spons
    .filter((s) => s.hole === sign.n && (sign.tee ? s.tee_id === sign.tee.id : !s.tee_id || !live.has(s.tee_id)))
    .sort((a, b) => a.sort - b.sort);
}

/** Bottom-box line: what kind of sponsorship this sign is. */
export function tierLabel(sign: SignRef, count: number): string {
  const what = sign.tee ? `${sign.tee.label.toUpperCase()}` : count > 1 ? '½ HOLE' : 'FULL HOLE';
  return `${what} ${count > 1 ? 'SPONSORS' : 'SPONSOR'}`;
}

/** Short tile text for the sign picker: "13" or "13 · AM pad". */
export const signShort = (s: SignRef) => (s.tee ? `${s.n} · ${s.tee.label}` : String(s.n));
