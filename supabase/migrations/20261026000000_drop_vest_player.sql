-- Finish the dubs-vest move (20261025): league_vest is the only record of who wears the award.
-- Drops the old single-holder column events.vest_player_id and its trigger; td_set_vest_holders stops mirroring it.
-- td_set_vest(event, player, note) stays as a one-player shortcut for any app still open on an older version.
-- =====================================================================

create or replace function public.td_set_vest_holders(p_event uuid, p_players uuid[], p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v text := nullif(btrim(coalesce(p_note, '')), ''); ids uuid[] := array(select distinct x from unnest(coalesce(p_players, '{}')) x where x is not null);
begin
  perform public._require_event_td(p_event);
  if cardinality(ids) > 2 then raise exception 'too_many_holders'; end if;
  if v is not null and length(v) > 120 then raise exception 'vest_note_too_long'; end if;
  delete from public.league_vest where event_id = p_event;
  insert into public.league_vest (event_id, player_id) select p_event, x from unnest(ids) x;
  update public.events set vest_note = case when cardinality(ids) > 0 then v end where id = p_event;
end $$;

drop trigger if exists events_vest_check on public.events;
drop function if exists public._events_vest_check();
alter table public.events drop column if exists vest_player_id;
