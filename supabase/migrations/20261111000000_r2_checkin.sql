-- =====================================================================
-- Round 2 confirm (locked 2026-10-07, Mike: "We often have people bail on second round and need to avoid cards with
-- too many missing players." Choices: desk + self-confirm; only confirmed players get Round 2 cards).
--
-- Source of truth: players.r2_in  (null = hasn't answered, true = playing Round 2, false = out), r2_in_at, r2_in_by
--   ('self' from the scorecard, 'desk' from a check-in crew phone, or the TD's email). players.checked_in stays Round 1.
-- Rules:
--   * Only for events with 2 rounds and check-in on. Round 2 cards use r2_in = true (the client's card pool; the TD
--     can still move anyone by hand).
--   * Self-confirm: card_r2_set(token, player, in) from a Round 1 card that has been SUBMITTED, for a player on that
--     card, while that player isn't on a published Round 2 card yet ('r2_closed' after that: see the desk).
--     card_r2_status(token) feeds the scorecard's "Playing Round 2?" panel.
--   * Desk: crew_r2_status / crew_r2_set for the check-in crew (any player of the event, any time). TDs update
--     players directly (existing TD write policy).
-- =====================================================================

alter table public.players add column if not exists r2_in boolean;
alter table public.players add column if not exists r2_in_at timestamptz;
alter table public.players add column if not exists r2_in_by text;

/** Who on this card has answered for Round 2. open = this card can still answer. */
create or replace function public.card_r2_status(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c public.cards; ev public.events;
begin
  c := public._card_for_token(p_token);
  select * into ev from public.events where id = c.event_id;
  return jsonb_build_object(
    'asks', ev.rounds = 2 and ev.use_checkin and c.round = 1,
    'open', ev.rounds = 2 and ev.use_checkin and c.round = 1 and exists (select 1 from public.submissions where card_id = c.id),
    'players', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'r2_in', p.r2_in,
                  'locked', exists (select 1 from public.card_players x where x.player_id = p.id and x.round = 2))
                  order by cp.seat)
                from public.card_players cp join public.players p on p.id = cp.player_id where cp.card_id = c.id), '[]'));
end $$;

-- Returns 'saved' | 'not_open' | 'rejected_not_on_card' | 'r2_closed'
create or replace function public.card_r2_set(p_token text, p_player uuid, p_in boolean) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.cards; ev public.events;
begin
  c := public._card_for_token(p_token);
  select * into ev from public.events where id = c.event_id;
  if not (ev.rounds = 2 and ev.use_checkin and c.round = 1) or p_in is null
     or not exists (select 1 from public.submissions where card_id = c.id) then return 'not_open'; end if;
  if not exists (select 1 from public.card_players where card_id = c.id and player_id = p_player) then return 'rejected_not_on_card'; end if;
  if exists (select 1 from public.card_players where player_id = p_player and round = 2) then return 'r2_closed'; end if;
  update public.players set r2_in = p_in, r2_in_at = now(), r2_in_by = 'self' where id = p_player;
  return 'saved';
end $$;

/** Check-in crew: everyone's Round 2 answer ({player_id: true|false}; missing = no answer). */
create or replace function public.crew_r2_status(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c public.crew; ev public.events;
begin
  c := public._crew(p_token);
  if not ('checkin' = any (c.roles)) then raise exception 'forbidden'; end if;
  select * into ev from public.events where id = c.event_id;
  return jsonb_build_object('asks', ev.rounds = 2 and ev.use_checkin,
    'r2', coalesce((select jsonb_object_agg(p.id, p.r2_in) from public.players p where p.event_id = c.event_id and p.r2_in is not null), '{}'::jsonb));
end $$;

/** Check-in crew sets a Round 2 answer (null clears it). */
create or replace function public.crew_r2_set(p_token text, p_player uuid, p_in boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.crew;
begin
  c := public._crew(p_token);
  if not ('checkin' = any (c.roles)) then raise exception 'forbidden'; end if;
  update public.players set r2_in = p_in, r2_in_at = case when p_in is null then null else now() end,
         r2_in_by = case when p_in is null then null else 'desk' end
   where id = p_player and event_id = c.event_id;
  if not found then raise exception 'not_found'; end if;
end $$;

revoke all on function public.card_r2_status(text), public.card_r2_set(text, uuid, boolean),
                       public.crew_r2_status(text), public.crew_r2_set(text, uuid, boolean) from public;
grant execute on function public.card_r2_status(text), public.card_r2_set(text, uuid, boolean),
                          public.crew_r2_status(text), public.crew_r2_set(text, uuid, boolean) to anon, authenticated;
