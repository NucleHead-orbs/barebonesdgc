-- Tag swaps from the scorecard + pending swaps on the boards (locked 2026-10-03, Mike: "initiate that tag swap
-- right from the scorecard ... leaderboards would show the tags re-ranked but pending confirmation").
-- Source of truth: unchanged. A pending swap is a tag_matches row (status pending) waiting on its players' confirmations;
-- that is the approval queue. Nothing moves until the last confirmation (_tag_apply), exactly as before.
-- Rules:
--   * round_save_swap saves a round and puts the chosen tag sets on the line in ONE transaction: if any set can't go
--     on the line (no tag, fewer than 2 holders, too many open), nothing is saved and the phone keeps the card.
--   * tag_pending(pool) is public: the waiting and disputed swaps in a set (not expired), oldest first, with each
--     holder's place on that round (1 = best, ties share a place) and who has confirmed. Never scores or tokens.
--     The board projects them in that order with the same swap rule and labels the result "pending".
--   * Safe to re-run.
-- =====================================================================

/** Save a round (round_save) and start a tag exchange for each pool in p_pools, all or nothing. */
create or replace function public.round_save_swap(p_token text, p_round jsonb, p_pools uuid[]) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare rid uuid; pid uuid; ex jsonb := '[]';
begin
  if cardinality(coalesce(p_pools, '{}')) > 5 then raise exception 'invalid_round'; end if;
  rid := public.round_save(p_token, p_round);
  foreach pid in array coalesce(p_pools, '{}') loop
    ex := ex || jsonb_build_array(jsonb_build_object('pool_id', pid, 'match_id', public.round_tag_exchange(p_token, rid, pid)));
  end loop;
  return jsonb_build_object('round_id', rid, 'exchanges', ex);
end $$;

/** Waiting/disputed swaps in a pool, oldest first: place per holder (1 = best; ties share), confirmations, round link. */
create or replace function public.tag_pending(p_pool uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'status', m.status, 'round_id', m.round_id, 'course', m.course, 'played_on', m.played_on, 'created_at', m.created_at,
      'players', (select jsonb_agg(jsonb_build_object('member_id', p.member_id, 'place', p.place, 'confirmed', p.confirmed_at is not null,
                    'disputed', p.disputed_at is not null) order by p.place)
                  from (select tp.member_id, tp.confirmed_at, tp.disputed_at, rank() over (order by tp.score) as place
                          from public.tag_match_players tp
                         where tp.match_id = m.id and exists (select 1 from public.tags t where t.pool_id = m.pool_id and t.holder_id = tp.member_id)) p))
    order by m.created_at), '[]')
  from public.tag_matches m
  where m.pool_id = p_pool and m.status in ('pending', 'disputed') and m.created_at >= now() - interval '7 days'
$$;

revoke execute on function public.round_save_swap(text, jsonb, uuid[]), public.tag_pending(uuid) from public;
grant execute on function public.round_save_swap(text, jsonb, uuid[]), public.tag_pending(uuid) to anon, authenticated;
