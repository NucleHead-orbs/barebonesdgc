-- Tags are declared before the round; league nights can put other tag sets on the line (locked 2026-10-03, Mike).
-- Rules:
--   * Scorecard: tag sets go on the line at tee-off and are saved with the round (round_save_swap). There is no
--     putting tags on the line after a round is saved: round_tag_exchange is no longer callable directly, only
--     through round_save_swap.
--   * League night: the league's own set is recorded by its pool admin and applies at once (td_tag_record, unchanged).
--     Any TD of that event can also PROPOSE another set (e.g. Golden Boners) from the same results with
--     td_tag_propose: it goes up pending with nobody confirmed, each holder confirms from My Tag (tag_confirm), and the
--     last confirmation swaps. A dispute stops it for that set's admin. Once per set per event (unless voided).
--   * Safe to re-run.
-- =====================================================================

revoke execute on function public.round_tag_exchange(text, uuid, uuid) from public, anon, authenticated;

/** p_rows: [{member_id, score}] from the event's official results; every row must hold a tag in p_pool. */
create or replace function public.td_tag_propose(p_pool uuid, p_event uuid, p_rows jsonb, p_course text, p_played_on date) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare mid uuid; n int;
begin
  if p_event is null or not public.can_td(p_event) then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'invalid_players'; end if;
  n := jsonb_array_length(p_rows);
  if n < 2 or n > 200 then raise exception 'players_2_or_more'; end if;
  if (select count(distinct x ->> 'member_id') from jsonb_array_elements(p_rows) x) <> n then raise exception 'duplicate_player'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) x where (x ->> 'score') is null or (x ->> 'score') !~ '^-?[0-9]{1,3}$') then raise exception 'invalid_score'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) x
              where not exists (select 1 from public.tags t where t.pool_id = p_pool and t.holder_id = (x ->> 'member_id')::uuid)) then
    raise exception 'no_tag_in_pool';
  end if;
  if exists (select 1 from public.tag_matches where pool_id = p_pool and event_id = p_event and status <> 'void') then raise exception 'event_already_recorded'; end if;
  insert into public.tag_matches (pool_id, source, event_id, status, course, played_on, created_by_td)
  values (p_pool, 'event', p_event, 'pending', nullif(btrim(coalesce(p_course, '')), ''),
          coalesce(p_played_on, (select starts_on from public.events where id = p_event), current_date), coalesce(public.my_email(), 'td'))
  returning id into mid;
  insert into public.tag_match_players (match_id, member_id, score)
  select mid, (x ->> 'member_id')::uuid, (x ->> 'score')::int from jsonb_array_elements(p_rows) x;
  return mid;
end $$;

revoke execute on function public.td_tag_propose(uuid, uuid, jsonb, text, date) from public, anon;
grant execute on function public.td_tag_propose(uuid, uuid, jsonb, text, date) to authenticated;
