-- League mode + CTP holes (locked 2026-10-04, Mike: "select event or league which changes those sub pages";
-- "Trevor should be able to enter what the CTP prize is and for what hole"; scorecard animates on a CTP hole).
-- Source of truth:
--   events.kind        : 'event' (tournament: Prep, Crew, Early Access) | 'league' (weekly night: no Prep/Crew/Early Access,
--                        one round, one day; a TAGS tab for the league's own tag set).
--   events.tag_pool_id : the league's tag set (e.g. Lazy Boners). Its tags are recorded from this event's results.
--   holes.ctp_prize    : this hole is a closest-to-the-pin hole, and what it pays ("$20", "Disc + $10"). null = not a CTP.
-- Rules:
--   * td_set_league / td_set_ctp: any TD of the event. A CTP must be on one of the event's holes.
--   * Duplicating an event (league week 2) carries kind, tag set and CTP holes + prizes (td_create_event).
--   * Saving or loading a course keeps CTPs on holes that still exist (holes are upserted by number).
--   * Lazy Boners League is set to league + the Lazy Boners tag set. Safe to re-run.
-- =====================================================================

alter table public.events add column if not exists kind text not null default 'event';
alter table public.events drop constraint if exists events_kind_check;
alter table public.events add constraint events_kind_check check (kind in ('event', 'league'));
alter table public.events add column if not exists tag_pool_id uuid references public.tag_pools(id) on delete set null;

alter table public.holes add column if not exists ctp_prize text;
alter table public.holes drop constraint if exists holes_ctp_prize_check;
alter table public.holes add constraint holes_ctp_prize_check check (ctp_prize is null or length(btrim(ctp_prize)) between 1 and 60);

/** Event or league, and (for a league) its tag set. */
create or replace function public.td_set_league(p_event uuid, p_kind text, p_pool uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._require_event_td(p_event);
  if p_kind not in ('event', 'league') then raise exception 'invalid_kind'; end if;
  if p_pool is not null and not exists (select 1 from public.tag_pools where id = p_pool) then raise exception 'unknown_pool'; end if;
  update public.events set kind = p_kind, tag_pool_id = case when p_kind = 'league' then p_pool end where id = p_event;
end $$;

/** Make hole p_n a CTP paying p_prize (blank/null = not a CTP anymore). */
create or replace function public.td_set_ctp(p_event uuid, p_n int, p_prize text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v text := nullif(btrim(coalesce(p_prize, '')), '');
begin
  perform public._require_event_td(p_event);
  if v is not null and length(v) > 60 then raise exception 'ctp_prize_too_long'; end if;
  update public.holes set ctp_prize = v where event_id = p_event and n = p_n;
  if not found then raise exception 'unknown_hole'; end if;
end $$;

revoke execute on function public.td_set_league(uuid, text, uuid), public.td_set_ctp(uuid, int, text) from public, anon;
grant execute on function public.td_set_league(uuid, text, uuid), public.td_set_ctp(uuid, int, text) to authenticated;

-- ---------- duplicate carries kind, tag set and CTPs (redefined from tee_pads) ----------
create or replace function public.td_create_event(
  p_name text, p_club text, p_starts date, p_ends date,
  p_copy_from uuid default null, p_hole_count int default 18, p_divisions jsonb default '[]',
  p_copy_players boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare src public.events; v_id uuid; v_slug text;
begin
  if p_copy_from is null then
    if not public.is_td() then raise exception 'forbidden'; end if;
  else
    perform public._require_event_td(p_copy_from);
    select * into src from public.events where id = p_copy_from;
  end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'invalid_name'; end if;
  if p_starts is null or p_ends is null or p_ends < p_starts then raise exception 'invalid_dates'; end if;

  v_slug := public._event_slug(p_name, p_starts);
  insert into public.events (slug, name, starts_on, ends_on, club_name, skin, palette, rounds, waves, use_checkin, use_sponsors, course_layout_id,
                             r1_format, r2_format, dubs_style, kind, tag_pool_id)
  values (v_slug, btrim(p_name), p_starts, p_ends, nullif(btrim(coalesce(p_club, src.club_name, '')), ''),
          coalesce(src.skin, 'event'), coalesce(src.palette, 'cosmic'), coalesce(src.rounds, 1), coalesce(src.waves, 1),
          coalesce(src.use_checkin, true), coalesce(src.use_sponsors, false), src.course_layout_id,
          coalesce(src.r1_format, 'singles'), coalesce(src.r2_format, 'singles'), coalesce(src.dubs_style, 'Best shot'),
          coalesce(src.kind, 'event'), src.tag_pool_id)
  returning id into v_id;

  if p_copy_from is not null then
    insert into public.holes (event_id, n, par, dist_ft, ob, quote, rules, ctp_prize)
      select v_id, n, par, dist_ft, ob, quote, rules, ctp_prize from public.holes where event_id = p_copy_from;
    insert into public.hole_tees (event_id, n, label, dist_ft, par, sort)
      select v_id, n, label, dist_ft, par, sort from public.hole_tees where event_id = p_copy_from;
    insert into public.divisions (event_id, code, sort, wave_default)
      select v_id, code, sort, wave_default from public.divisions where event_id = p_copy_from;
    insert into public.builder_settings (event_id, round, settings)
      select v_id, round, settings from public.builder_settings where event_id = p_copy_from;
    insert into public.event_tds (event_id, email)
      select v_id, email from public.event_tds where event_id = p_copy_from;
    insert into public.event_prize (event_id, credit_round, credit_label)
      select v_id, credit_round, credit_label from public.event_prize where event_id = p_copy_from;
    insert into public.round_payouts (event_id, round, currency, entry_fee, payback_pct, added_override, paid_places, pcts)
      select v_id, round, currency, entry_fee, payback_pct, added_override, paid_places, pcts
        from public.round_payouts where event_id = p_copy_from;
    insert into public.division_payouts (event_id, div_code, currency, entry_fee, payback_pct, added_override, paid_places, pcts)
      select v_id, div_code, currency, entry_fee, payback_pct, added_override, paid_places, pcts
        from public.division_payouts where event_id = p_copy_from;
    insert into public.prep_tasks (event_id, title, category, due_offset_days, assignee, notes, sort)
      select v_id, title, category, due_offset_days, assignee, notes, sort from public.prep_tasks where event_id = p_copy_from;
    insert into public.crew (event_id, name, roles)
      select v_id, name, roles from public.crew where event_id = p_copy_from and revoked_at is null;
    insert into public.stations (event_id, name, need, notes, sort)
      select v_id, name, need, notes, sort from public.stations where event_id = p_copy_from;
    insert into public.station_needs (station_id, day, half, need)
      select ns.id, n.day, n.half, n.need
        from public.station_needs n
        join public.stations os on os.id = n.station_id and os.event_id = p_copy_from
        join public.stations ns on ns.event_id = v_id and ns.name = os.name;
    if p_copy_players then
      insert into public.players (event_id, name, div_code, rating, pdga, dgs_id, reg_order, checked_in)
        select v_id, name, div_code, rating, pdga, dgs_id, reg_order, false from public.players where event_id = p_copy_from;
      insert into public.player_private (player_id, event_id, vibe)
        select np.id, v_id, pp.vibe
          from public.player_private pp
          join public.players op on op.id = pp.player_id
          join public.players np on np.event_id = v_id and lower(btrim(np.name)) = lower(btrim(op.name))
         where pp.event_id = p_copy_from and pp.vibe is not null;
      insert into public.keep_apart (event_id, player_a, player_b)
        select distinct v_id, least(na.id, nb.id), greatest(na.id, nb.id)
          from public.keep_apart k
          join public.players oa on oa.id = k.player_a
          join public.players ob on ob.id = k.player_b
          join public.players na on na.event_id = v_id and lower(btrim(na.name)) = lower(btrim(oa.name))
          join public.players nb on nb.event_id = v_id and lower(btrim(nb.name)) = lower(btrim(ob.name))
         where k.event_id = p_copy_from and na.id <> nb.id
        on conflict do nothing;
    end if;
  else
    if p_hole_count is null or p_hole_count not between 1 and 40 then raise exception 'invalid_holes'; end if;
    insert into public.holes (event_id, n, par) select v_id, g, 3 from generate_series(1, p_hole_count) g;
    perform public._write_divisions(v_id, p_divisions);
  end if;
  return jsonb_build_object('id', v_id, 'slug', v_slug);
end $$;

-- ---------- data: Trevor's league ----------
update public.events e set kind = 'league', tag_pool_id = (select id from public.tag_pools where slug = 'lazy-boners')
 where e.slug = 'lazy-boners-league-2026-09-28' and e.kind = 'event';
