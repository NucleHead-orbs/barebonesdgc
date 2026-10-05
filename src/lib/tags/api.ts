/**
 * Bag tag data access. Public reads go through RLS; My Tag actions are tag_* RPCs checked against the private
 * link token; admin actions are td_tag_* RPCs checked by can_tag(pool). Every call returns { data } or { error }.
 */
import { supabase } from '../supabase';
import type { MatchStatus, PendingSwap, Tag, TagMember, TagPool } from './tags';
import type { BoardHeat, ChatLine, HeatRow } from './heat';
import type { BoardRead, ChallengeRound, MatchupSet, Profile, ReactionKind } from './board';

type Result<T> = { data: T; error?: undefined } | { data?: undefined; error: unknown };
const wrap = async <T>(fn: () => Promise<T>): Promise<Result<T>> => {
  try { return { data: await fn() }; } catch (error) { return { error }; }
};
const must = <T>(r: { data: T; error: unknown }): T => { if (r.error) throw r.error; return r.data; };

const TAG_COLS = 'pool_id, number, holder_id, status, issued_at, moved_at, moves';
const MEMBER_COLS = 'id, name, nickname';

export interface MatchPlayer {
  member_id: string; name: string; nickname: string | null; score: number;
  tag_before: number | null; tag_after: number | null; tag_now?: number | null; confirmed?: boolean; disputed?: boolean;
}
export interface Match {
  id: string; pool: string; pool_name: string; source: 'casual' | 'event'; status: MatchStatus; course: string | null;
  played_on: string; created_at: string; applied_at: string | null; expired?: boolean; created_by: string | null; mine?: boolean;
  players: MatchPlayer[];
}
export interface HistoryLine { id: number; number: number; kind: 'issued' | 'moved' | 'released' | 'retired' | 'undo' | 'bomb' | 'penalty'; member_id: string | null; prev_id: string | null; match_id: string | null; at: string }

// ---------- public ----------
export const loadPools = () => wrap(async (): Promise<TagPool[]> =>
  (must(await supabase.from('tag_pools').select('id, slug, name, sort, invite_only').order('sort')) ?? []) as TagPool[]);

export interface Board { pool: TagPool; tags: Tag[]; members: Record<string, TagMember>; recent: Match[]; pending: PendingSwap[] }

async function membersById(ids: string[]): Promise<Record<string, TagMember>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  const rows = (must(await supabase.from('tag_members').select(MEMBER_COLS).in('id', uniq)) ?? []) as TagMember[];
  return Object.fromEntries(rows.map((m) => [m.id, m]));
}

/** Applied rounds for a pool (public), newest first, with names. */
async function recentMatches(pool: TagPool, limit: number, extraFilter?: { memberNumber?: number }): Promise<Match[]> {
  const q = supabase.from('tag_matches').select('id, source, status, course, played_on, created_at, applied_at, created_by, tag_match_players(member_id, score, tag_before, tag_after)')
    .eq('pool_id', pool.id).eq('status', 'applied').order('applied_at', { ascending: false }).limit(limit);
  const rows = (must(await q) ?? []) as Array<Omit<Match, 'pool' | 'pool_name' | 'players'> & { tag_match_players: Array<Omit<MatchPlayer, 'name' | 'nickname'>> }>;
  const names = await membersById(rows.flatMap((r) => r.tag_match_players.map((p) => p.member_id)));
  const out = rows.map((r) => ({
    ...r, pool: pool.slug, pool_name: pool.name,
    players: r.tag_match_players.map((p) => ({ ...p, name: names[p.member_id]?.name ?? '?', nickname: names[p.member_id]?.nickname ?? null }))
      .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name)),
  }));
  const n = extraFilter?.memberNumber;
  return n === undefined ? out : out.filter((m) => m.players.some((p) => p.tag_before === n || p.tag_after === n));
}

export const loadBoard = (slug: string) => wrap(async (): Promise<Board> => {
  const pool = must(await supabase.from('tag_pools').select('id, slug, name, sort, invite_only').eq('slug', slug).maybeSingle()) as TagPool | null;
  if (!pool) throw new Error('unknown_pool');
  const tags = (must(await supabase.from('tags').select(TAG_COLS).eq('pool_id', pool.id).eq('status', 'held').order('number')) ?? []) as Tag[];
  const [members, recent, pending] = await Promise.all([membersById(tags.map((t) => t.holder_id ?? '')), recentMatches(pool, 12),
    supabase.rpc('tag_pending', { p_pool: pool.id })]);
  return { pool, tags, members, recent, pending: (must(pending) ?? []) as PendingSwap[] };
});

export interface TagPage { pool: TagPool; tag: Tag | null; holder: TagMember | null; history: Array<HistoryLine & { who: TagMember | null; prev: TagMember | null }> }
export const loadTagPage = (slug: string, n: number) => wrap(async (): Promise<TagPage> => {
  const pool = must(await supabase.from('tag_pools').select('id, slug, name, sort, invite_only').eq('slug', slug).maybeSingle()) as TagPool | null;
  if (!pool) throw new Error('unknown_pool');
  const tag = must(await supabase.from('tags').select(TAG_COLS).eq('pool_id', pool.id).eq('number', n).maybeSingle()) as Tag | null;
  const hist = (must(await supabase.from('tag_history').select('id, number, kind, member_id, prev_id, match_id, at').eq('pool_id', pool.id).eq('number', n)
    .order('id', { ascending: false }).limit(50)) ?? []) as HistoryLine[];
  const names = await membersById([tag?.holder_id ?? '', ...hist.flatMap((h) => [h.member_id ?? '', h.prev_id ?? ''])]);
  return {
    pool, tag, holder: tag?.holder_id ? names[tag.holder_id] ?? null : null,
    history: hist.map((h) => ({ ...h, who: h.member_id ? names[h.member_id] ?? null : null, prev: h.prev_id ? names[h.prev_id] ?? null : null })),
  };
});

// ---------- My Tag (private link) ----------
export interface Holding { pool_id: string; pool: string; pool_name: string; number: number; moved_at: string | null; moves: number; held: number }
export interface RosterEntry { member_id: string; name: string; nickname: string | null; number: number }
export interface TagHome { me: TagMember; holdings: Holding[]; rosters: Record<string, RosterEntry[]>; open: Match[]; recent: Match[] }

export const me = (token: string) => wrap(async (): Promise<TagHome> => must(await supabase.rpc('tag_me', { p_token: token })) as TagHome);
export const log = (token: string, poolId: string, players: Array<{ member_id: string; score: number }>, course: string, playedOn: string) =>
  wrap(async (): Promise<string> => must(await supabase.rpc('tag_log', { p_token: token, p_pool: poolId, p_players: players, p_course: course || null, p_played_on: playedOn || null })) as string);
export const confirm = (token: string, matchId: string, ok: boolean) =>
  wrap(async (): Promise<string> => must(await supabase.rpc('tag_confirm', { p_token: token, p_match: matchId, p_ok: ok })) as string);
export const withdraw = (token: string, matchId: string) =>
  wrap(async () => { must(await supabase.rpc('tag_withdraw', { p_token: token, p_match: matchId })); });

// ---------- admin ----------
export interface AdminMember extends TagMember { token: string; last_seen_at: string | null; created_at: string }

export const isTagAdmin = () => wrap(async (): Promise<boolean> => !!must(await supabase.rpc('is_tag_admin')));
/** Pools this account runs (super admin: all). */
export const myPools = () => wrap(async (): Promise<TagPool[]> => {
  const pools = (must(await supabase.from('tag_pools').select('id, slug, name, sort, invite_only').order('sort')) ?? []) as TagPool[];
  const ok = await Promise.all(pools.map(async (p) => !!must(await supabase.rpc('can_tag', { p_pool: p.id }))));
  return pools.filter((_, i) => ok[i]);
});
export const adminMembers = () => wrap(async (): Promise<AdminMember[]> => (must(await supabase.rpc('td_tag_members')) ?? []) as AdminMember[]);
export const poolTags = (poolId: string) => wrap(async (): Promise<Tag[]> =>
  (must(await supabase.from('tags').select(TAG_COLS).eq('pool_id', poolId).order('number')) ?? []) as Tag[]);

/** Rounds that need an admin (pending/disputed), plus the latest applied ones. Admin RLS sees all statuses. */
export const adminMatches = (pool: TagPool) => wrap(async (): Promise<Match[]> => {
  const rows = (must(await supabase.from('tag_matches')
    .select('id, source, status, course, played_on, created_at, applied_at, created_by, event_id, tag_match_players(member_id, score, tag_before, tag_after, confirmed_at, disputed_at)')
    .eq('pool_id', pool.id).in('status', ['pending', 'disputed', 'applied']).order('created_at', { ascending: false }).limit(40)) ?? []) as Array<
      Omit<Match, 'pool' | 'pool_name' | 'players'> & { tag_match_players: Array<{ member_id: string; score: number; tag_before: number | null; tag_after: number | null; confirmed_at: string | null; disputed_at: string | null }> }>;
  const names = await membersById(rows.flatMap((r) => r.tag_match_players.map((p) => p.member_id)));
  const week = Date.now() - 7 * 864e5;
  return rows.map((r) => ({
    ...r, pool: pool.slug, pool_name: pool.name, expired: r.status === 'pending' && Date.parse(r.created_at) < week,
    players: r.tag_match_players.map((p) => ({
      member_id: p.member_id, score: p.score, tag_before: p.tag_before, tag_after: p.tag_after,
      confirmed: !!p.confirmed_at, disputed: !!p.disputed_at, name: names[p.member_id]?.name ?? '?', nickname: names[p.member_id]?.nickname ?? null,
    })).sort((a, b) => a.score - b.score || a.name.localeCompare(b.name)),
  }));
});

export const issue = (poolId: string, p: { member?: string | null; name?: string; nickname?: string; number?: number | null }) =>
  wrap(async (): Promise<{ member_id: string; number: number }> => must(await supabase.rpc('td_tag_issue', {
    p_pool: poolId, p_member: p.member ?? null, p_name: p.name ?? null, p_nickname: p.nickname ?? null, p_number: p.number ?? null,
  })) as { member_id: string; number: number });
export const release = (poolId: string, n: number, retire: boolean) =>
  wrap(async () => { must(await supabase.rpc('td_tag_release', { p_pool: poolId, p_number: n, p_retire: retire })); });
export const updateMember = (id: string, name: string, nickname: string) =>
  wrap(async () => { must(await supabase.rpc('td_tag_member_update', { p_member: id, p_name: name, p_nickname: nickname || null })); });
export const newLink = (id: string) => wrap(async (): Promise<string> => must(await supabase.rpc('td_tag_new_link', { p_member: id })) as string);
export const record = (poolId: string, eventId: string | null, rows: Array<{ member_id: string; score: number }>, course: string, playedOn: string) =>
  wrap(async (): Promise<string> => must(await supabase.rpc('td_tag_record', {
    p_pool: poolId, p_event: eventId, p_rows: rows, p_course: course || null, p_played_on: playedOn || null,
  })) as string);
/** League night: put ANOTHER tag set on the line from the event's results. Pending until every holder confirms on My Tag. */
export const propose = (poolId: string, eventId: string, rows: Array<{ member_id: string; score: number }>, course: string, playedOn: string) =>
  wrap(async (): Promise<string> => must(await supabase.rpc('td_tag_propose', {
    p_pool: poolId, p_event: eventId, p_rows: rows, p_course: course || null, p_played_on: playedOn || null,
  })) as string);
export const resolve = (matchId: string, apply: boolean) =>
  wrap(async (): Promise<string> => must(await supabase.rpc('td_tag_resolve', { p_match: matchId, p_apply: apply })) as string);
export const undo = (poolId: string) => wrap(async () => { must(await supabase.rpc('td_tag_undo', { p_pool: poolId })); });

export const poolAdmins = (poolId: string) => wrap(async (): Promise<string[]> =>
  ((must(await supabase.from('tag_pool_admins').select('email').eq('pool_id', poolId).order('added_at')) ?? []) as Array<{ email: string }>).map((r) => r.email));
export const addPoolAdmin = (poolId: string, email: string) =>
  wrap(async () => { must(await supabase.from('tag_pool_admins').insert({ pool_id: poolId, email: email.trim().toLowerCase() })); });
export const removePoolAdmin = (poolId: string, email: string) =>
  wrap(async () => { must(await supabase.from('tag_pool_admins').delete().eq('pool_id', poolId).eq('email', email)); });

// ---------- heat: time bombs, challenges, chat (migration 20261028) ----------
export const heat = (token: string) => wrap(async (): Promise<HeatRow[]> => (must(await supabase.rpc('tag_heat', { p_token: token })) ?? []) as HeatRow[]);
export const challenge = (token: string, poolId: string, target: string) =>
  wrap(async () => { must(await supabase.rpc('tag_challenge', { p_token: token, p_pool: poolId, p_target: target })); });
export const respondChallenge = (token: string, id: string, accept: boolean) =>
  wrap(async (): Promise<string> => must(await supabase.rpc('tag_challenge_respond', { p_token: token, p_challenge: id, p_accept: accept })) as string);
export const cancelChallenge = (token: string, id: string) =>
  wrap(async () => { must(await supabase.rpc('tag_challenge_cancel', { p_token: token, p_challenge: id })); });
export const chatRead = (token: string, poolId: string, after: number) =>
  wrap(async (): Promise<ChatLine[]> => (must(await supabase.rpc('tag_chat_read', { p_token: token, p_pool: poolId, p_after: after })) ?? []) as ChatLine[]);
export const chatPost = (token: string, poolId: string, body: string) =>
  wrap(async () => { must(await supabase.rpc('tag_chat_post', { p_token: token, p_pool: poolId, p_body: body })); });
export const boardHeat = (slug: string) => wrap(async (): Promise<BoardHeat | null> => (must(await supabase.rpc('tag_board_heat', { p_slug: slug })) ?? null) as BoardHeat | null);
export const tdHeatSet = (poolId: string, bombs: boolean, challenges: boolean, chat: boolean) =>
  wrap(async () => { must(await supabase.rpc('td_tag_heat_set', { p_pool: poolId, p_bombs: bombs, p_challenges: challenges, p_chat: chat })); });
export const tdChat = (poolId: string) => wrap(async (): Promise<ChatLine[]> => (must(await supabase.rpc('td_tag_chat', { p_pool: poolId })) ?? []) as ChatLine[]);
export const tdChatHide = (id: number, hide: boolean) => wrap(async () => { must(await supabase.rpc('td_tag_chat_hide', { p_id: id, p_hide: hide })); });

// ---------- the Board, profiles, Matchups (migration 20261031) ----------
export const boardRead = (token: string, poolId: string, after: number) =>
  wrap(async (): Promise<BoardRead> => must(await supabase.rpc('tag_board_read', { p_token: token, p_pool: poolId, p_after: after })) as BoardRead);
export const react = (token: string, chatId: number, kind: ReactionKind) =>
  wrap(async (): Promise<boolean> => !!must(await supabase.rpc('tag_chat_react', { p_token: token, p_chat: chatId, p_kind: kind })));
export const profileGet = (token: string) => wrap(async (): Promise<Profile> => must(await supabase.rpc('tag_profile_get', { p_token: token })) as Profile);
export const profileSave = (token: string, am: number, pm: number, courses: string[]) =>
  wrap(async () => { must(await supabase.rpc('tag_profile_save', { p_token: token, p_am: am, p_pm: pm, p_courses: courses })); });
export const matchups = (token: string) => wrap(async (): Promise<MatchupSet[]> => (must(await supabase.rpc('tag_matchups', { p_token: token })) ?? []) as MatchupSet[]);

// ---------- challenge rounds (migration 20261103) ----------
export const rounds = (token: string) => wrap(async (): Promise<ChallengeRound[]> => (must(await supabase.rpc('tag_rounds', { p_token: token })) ?? []) as ChallengeRound[]);
export const setSlot = (token: string, id: string, teeIso: string, courseId: string) =>
  wrap(async () => { must(await supabase.rpc('tag_challenge_slot', { p_token: token, p_challenge: id, p_tee: teeIso, p_course: courseId })); });
export const okSlot = (token: string, id: string) => wrap(async () => { must(await supabase.rpc('tag_challenge_slot_ok', { p_token: token, p_challenge: id })); });
export const jumpIn = (token: string, id: string) => wrap(async () => { must(await supabase.rpc('tag_challenge_join', { p_token: token, p_challenge: id })); });
export const dropOut = (token: string, id: string) => wrap(async () => { must(await supabase.rpc('tag_challenge_leave', { p_token: token, p_challenge: id })); });
