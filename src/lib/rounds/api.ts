/**
 * Boner Rounds data access. Public reads (saved rounds, members, course library, tags) go through RLS;
 * saving / confirming / exchanging / voiding are round_* RPCs checked against the My Tag link token.
 */
import { supabase } from '../supabase';
import type { TagMember, TagPool } from '../tags/tags';

type Result<T> = { data: T; error?: undefined } | { data?: undefined; error: unknown };
const wrap = async <T>(fn: () => Promise<T>): Promise<Result<T>> => {
  try { return { data: await fn() }; } catch (error) { return { error }; }
};
const must = <T>(r: { data: T; error: unknown }): T => { if (r.error) throw r.error; return r.data; };

export interface CourseOption { id: string; name: string; city: string | null; layouts: Array<{ id: string; name: string; pars: number[]; labels: string[] | null; ft: Array<number | null> }> }
export interface RoundMe { me: TagMember; pools: Array<{ pool_id: string; number: number }>; to_confirm: Array<{ id: string; course: string; played_on: string }> }
export interface RoundPlayer {
  seq: number; member_id: string | null; guest_name: string | null; name: string; nickname: string | null;
  scores: number[] | null; strokes: number; to_par: number; confirmed: boolean; disputed: boolean;
}
export interface Exchange {
  id: string; round_id: string; pool: string; pool_name: string; status: 'pending' | 'applied' | 'disputed';
  waiting_on: number | null; moves: Array<{ member_id: string; tag_before: number | null; tag_after: number | null }> | null;
}
export interface Round {
  id: string; course: string; course_id: string | null; played_on: string; pars: number[]; hole_labels: string[] | null; totals_only: boolean; note: string | null;
  created_by: string; created_at: string; players: RoundPlayer[]; exchanges: Exchange[];
}

export const loadMembers = () => wrap(async (): Promise<TagMember[]> =>
  (must(await supabase.from('tag_members').select('id, name, nickname').order('name')) ?? []) as TagMember[]);

/** Courses A–Z with each layout's pars (hole order). */
export const loadCourses = () => wrap(async (): Promise<CourseOption[]> => {
  const rows = (must(await supabase.from('courses').select('id, name, city, course_layouts(id, name, course_holes(n, par, label, dist_ft))').order('name')) ?? []) as Array<{
    id: string; name: string; city: string | null; course_layouts: Array<{ id: string; name: string; course_holes: Array<{ n: number; par: number; label: string | null; dist_ft: number | null }> }> }>;
  return rows.map((c) => ({
    id: c.id, name: c.name, city: c.city,
    layouts: (c.course_layouts ?? []).filter((l) => l.course_holes?.length).map((l) => {
      const hs = l.course_holes.slice().sort((a, b) => a.n - b.n);
      return { id: l.id, name: l.name, pars: hs.map((h) => h.par), labels: hs.some((h) => h.label) ? hs.map((h) => h.label ?? String(h.n)) : null, ft: hs.map((h) => h.dist_ft) };
    }),
  }));
});

export const roundMe = (token: string) => wrap(async (): Promise<RoundMe> => must(await supabase.rpc('round_me', { p_token: token })) as RoundMe);
export const saveRound = (token: string, payload: unknown) =>
  wrap(async (): Promise<string> => must(await supabase.rpc('round_save', { p_token: token, p_round: payload })) as string);
export const confirmRound = (token: string, id: string, ok: boolean) =>
  wrap(async () => { must(await supabase.rpc('round_confirm', { p_token: token, p_round: id, p_ok: ok })); });
export const startExchange = (token: string, id: string, poolId: string) =>
  wrap(async (): Promise<string> => must(await supabase.rpc('round_tag_exchange', { p_token: token, p_round: id, p_pool: poolId })) as string);
export const voidRound = (token: string, id: string) =>
  wrap(async () => { must(await supabase.rpc('round_void', { p_token: token, p_round: id })); });

const ROUND_COLS = 'id, course, course_id, played_on, pars, hole_labels, totals_only, note, created_by, created_at, club_round_players(seq, member_id, guest_name, scores, strokes, to_par, confirmed_at, disputed_at)';
type RoundRow = Omit<Round, 'players' | 'exchanges'> & { club_round_players: Array<Omit<RoundPlayer, 'name' | 'nickname' | 'confirmed' | 'disputed'> & { confirmed_at: string | null; disputed_at: string | null }> };

async function hydrate(rows: RoundRow[]): Promise<Round[]> {
  if (!rows.length) return [];
  const ids = [...new Set(rows.flatMap((r) => r.club_round_players.map((p) => p.member_id)).filter(Boolean))] as string[];
  const [members, ex] = await Promise.all([
    ids.length ? supabase.from('tag_members').select('id, name, nickname').in('id', ids) : Promise.resolve({ data: [], error: null }),
    supabase.rpc('round_exchanges', { p_rounds: rows.map((r) => r.id) }),
  ]);
  const byId = new Map(((must(members) ?? []) as TagMember[]).map((m) => [m.id, m]));
  const exchanges = (must(ex) ?? []) as Exchange[];
  return rows.map(({ club_round_players, ...r }) => ({
    ...r,
    players: club_round_players.map((p) => {
      const m = p.member_id ? byId.get(p.member_id) : null;
      return { seq: p.seq, member_id: p.member_id, guest_name: p.guest_name, scores: p.scores, strokes: p.strokes, to_par: p.to_par,
        name: m?.name ?? p.guest_name ?? '?', nickname: m?.nickname ?? null, confirmed: !!p.confirmed_at, disputed: !!p.disputed_at };
    }).sort((a, b) => a.strokes - b.strokes || a.seq - b.seq),
    exchanges: exchanges.filter((x) => x.round_id === r.id),
  }));
}

export const loadRounds = (limit = 40) => wrap(async (): Promise<Round[]> =>
  hydrate((must(await supabase.from('club_rounds').select(ROUND_COLS).eq('status', 'saved')
    .order('played_on', { ascending: false }).order('created_at', { ascending: false }).limit(limit)) ?? []) as RoundRow[]));

export const loadRound = (id: string) => wrap(async (): Promise<Round | null> => {
  const row = must(await supabase.from('club_rounds').select(ROUND_COLS).eq('id', id).eq('status', 'saved').maybeSingle()) as RoundRow | null;
  return row ? (await hydrate([row]))[0] : null;
});

/** Pools + the tags held by these members (for "put tags on the line"). */
export const tagsFor = (memberIds: string[]) => wrap(async (): Promise<{ pools: TagPool[]; tags: Array<{ pool_id: string; number: number; holder_id: string | null }> }> => {
  const [pools, tags] = await Promise.all([
    supabase.from('tag_pools').select('id, slug, name, sort, invite_only').order('sort'),
    memberIds.length ? supabase.from('tags').select('pool_id, number, holder_id').eq('status', 'held').in('holder_id', memberIds) : Promise.resolve({ data: [], error: null }),
  ]);
  return { pools: (must(pools) ?? []) as TagPool[], tags: (must(tags) ?? []) as Array<{ pool_id: string; number: number; holder_id: string | null }> };
});
