/**
 * Early access data access. Every call is an RPC (the tables have no client grants):
 * ea_* are public or checked against a My Tag link / claim secret; td_ea_* are checked by can_td(event).
 */
import { supabase } from '../supabase';
import type { EaClaimStatus, EaMine, EaPublic, EaTd } from './early';

type Result<T> = { data: T; error?: undefined } | { data?: undefined; error: unknown };
const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<Result<T>> => {
  try {
    const r = await supabase.rpc(fn, args);
    if (r.error) return { error: r.error };
    return { data: r.data as T };
  } catch (error) { return { error }; }
};

// ---------- public / player ----------
export const loadPublic = (slug: string) => rpc<EaPublic>('ea_public', { p_slug: slug });
export const claim = (slug: string, playerId: string, nickname: string) =>
  rpc<string>('ea_claim', { p_slug: slug, p_player: playerId, p_nickname: nickname.trim() || null });
export const claimMine = (token: string, slug: string, playerId: string) =>
  rpc<null>('ea_claim_mine', { p_token: token, p_slug: slug, p_player: playerId });
export const claimStatus = (secret: string) => rpc<EaClaimStatus>('ea_claim_status', { p_secret: secret });
export const mine = (token: string) => rpc<EaMine[]>('ea_me', { p_token: token });

// ---------- TD ----------
export const tdGet = (eventId: string) => rpc<EaTd>('td_ea_get', { p_event: eventId });
export const tdStart = (eventId: string) => rpc<null>('td_ea_start', { p_event: eventId });
export const tdSettings = (eventId: string, opens: string, closes: string, min: number, cap: number) =>
  rpc<null>('td_ea_settings', { p_event: eventId, p_opens: opens, p_closes: closes, p_min: min, p_cap: cap });
export const tdSetMax = (eventId: string, max: number | null) => rpc<null>('td_ea_set_max', { p_event: eventId, p_max: max });
export const tdApprove = (claimId: string, memberId: string | null) =>
  rpc<{ member_id: string; number: number }>('td_ea_approve', { p_claim: claimId, p_member: memberId });
export const tdDecline = (claimId: string) => rpc<null>('td_ea_decline', { p_claim: claimId });
export const tdRemove = (claimId: string) => rpc<null>('td_ea_remove', { p_claim: claimId });
export const tdBonus = (eventId: string, memberId: string, n: number, reason: string) =>
  rpc<null>('td_ea_bonus', { p_event: eventId, p_member: memberId, p_tickets: n, p_reason: reason });
export const tdBonusVoid = (id: number) => rpc<null>('td_ea_bonus_void', { p_id: id });
export const tdDraw = (eventId: string) => rpc<{ member_id: string; name: string; tickets: number; total: number }>('td_ea_draw', { p_event: eventId });
export const tdDrawVoid = (id: number) => rpc<null>('td_ea_draw_void', { p_id: id });
