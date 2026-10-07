-- =====================================================================
-- Event day: publish one wave at a time + pack bags at check-in (locked 2026-10-07, Mike: AM and PM check in separately; "generate the cards once
-- everyone is checked in"). The AM wave is out scoring while the PM wave checks in, so publishing PM cards must
-- never touch AM cards (td_publish_round replaces the whole round and refuses once anyone has a score).
--
-- td_publish_wave(event, round, wave, cards, force):
--   * every card in p_cards must be in p_wave (and the event must have that wave);
--   * refuses 'wave_has_scores' when a player on this wave's CURRENT cards has a score this round (force = republish
--     anyway: scores stay, this wave's signatures/submissions on rebuilt cards drop, same as a forced round publish);
--   * replaces only this wave's cards; the other wave's cards, signatures and submissions are untouched;
--   * a player can't be on both waves' cards ('player_on_other_wave');
--   * card tokens are per (round, wave, label) as before, so printed codes keep working.
-- Returns every published card in the round (both waves), same shape as td_publish_round.
-- =====================================================================

create or replace function public.td_publish_wave(
  p_event_id uuid, p_round smallint, p_wave text, p_cards jsonb, p_force boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare it jsonb; v_card uuid; v_label text; v_n int; pid text; seat int; ev public.events;
begin
  perform public._require_event_td(p_event_id);
  select * into ev from public.events where id = p_event_id;
  if p_round not in (1,2) or p_round > ev.rounds then raise exception 'invalid_round'; end if;
  if p_wave not in ('AM', 'PM') or (ev.waves = 1 and p_wave <> 'AM') then raise exception 'invalid_wave'; end if;
  if exists (select 1 from jsonb_array_elements(p_cards) o where o->>'wave' is distinct from p_wave) then
    raise exception 'invalid_wave';
  end if;
  perform public._check_doubles_cards(p_event_id, p_round, p_cards);

  if exists (select 1 from jsonb_array_elements(p_cards) o, jsonb_array_elements_text(o->'player_ids') x
              join public.card_players cp on cp.player_id = x::uuid and cp.round = p_round
              join public.cards c on c.id = cp.card_id and c.event_id = p_event_id and c.wave <> p_wave) then
    raise exception 'player_on_other_wave';
  end if;

  if not p_force and exists (
      select 1 from public.cards c join public.card_players cp on cp.card_id = c.id
        join public.scores s on s.player_id = cp.player_id and s.round = p_round
       where c.event_id = p_event_id and c.round = p_round and c.wave = p_wave) then
    raise exception 'wave_has_scores';
  end if;

  delete from public.cards where event_id = p_event_id and round = p_round and wave = p_wave;

  for it in select value from jsonb_array_elements(p_cards) loop
    if jsonb_array_length(coalesce(it->'player_ids', '[]')) = 0 then
      raise exception 'empty_card';
    end if;
    select count(*) into v_n from jsonb_array_elements(p_cards) o
      where (o->>'start_hole')::int = (it->>'start_hole')::int;
    v_label := (it->>'start_hole') || case when v_n > 1 then chr(64 + (it->>'group_no')::int) else '' end;

    insert into public.cards (event_id, round, wave, start_hole, group_no, label, locked)
    values (p_event_id, p_round, p_wave, (it->>'start_hole')::smallint, (it->>'group_no')::smallint, v_label,
            coalesce((it->>'locked')::boolean, false))
    returning id into v_card;

    seat := 0;
    for pid in select jsonb_array_elements_text(it->'player_ids') loop
      seat := seat + 1;
      if not exists (select 1 from public.players where id = pid::uuid and event_id = p_event_id) then
        raise exception 'unknown_player %', pid;
      end if;
      insert into public.card_players (card_id, round, player_id, seat) values (v_card, p_round, pid::uuid, seat);
    end loop;

    insert into public.card_tokens (event_id, round, wave, label) values (p_event_id, p_round, p_wave, v_label)
    on conflict do nothing;
  end loop;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'card_id', c.id, 'wave', c.wave, 'label', c.label, 'start_hole', c.start_hole, 'token', t.token,
      'players', (select jsonb_agg(cp.player_id order by cp.seat) from public.card_players cp where cp.card_id = c.id))
      order by c.wave, c.start_hole, c.group_no)
    from public.cards c
    join public.card_tokens t on t.event_id = c.event_id and t.round = c.round and t.wave = c.wave and t.label = c.label
    where c.event_id = p_event_id and c.round = p_round), '[]');
end $$;

revoke all on function public.td_publish_wave(uuid, smallint, text, jsonb, boolean) from public, anon;
grant execute on function public.td_publish_wave(uuid, smallint, text, jsonb, boolean) to authenticated;

-- ---------- player pack bags at check-in ----------
-- Packs are pre-bagged and labeled by name + shirt size (Prep → PACKS prints the labels). When the check-in crew taps
-- CHECK IN, their screen shows which bag to hand over: crew_pack_sizes gives the check-in crew {player_id: shirt_size}
-- for the event (same people who already see the player list in crew_home). Nothing new is stored.
create or replace function public.crew_pack_sizes(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c public.crew;
begin
  c := public._crew(p_token);
  if not ('checkin' = any (c.roles)) then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_object_agg(p.id, p.shirt_size) from public.players p
                    where p.event_id = c.event_id and nullif(btrim(p.shirt_size), '') is not null), '{}'::jsonb);
end $$;
revoke all on function public.crew_pack_sizes(text) from public;
grant execute on function public.crew_pack_sizes(text) to anon, authenticated;
