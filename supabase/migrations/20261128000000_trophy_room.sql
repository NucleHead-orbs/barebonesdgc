-- =====================================================================
-- Trophy rooms (2026-10-10, Mike: "there should be a similar winners block to the vest of Lazy. We can just make that a
-- 'trophy room', and in the lazy league it happens to be a vest. Let's make it look like a podium where the top 3 names
-- are floating above their positions ... So in TD you would choose what kind of trophy room you want, a single prize or
-- a podium celebration.")
--
-- Source of truth:
--   leagues.trophy_room : null (none) | 'single' (one weekly prize the TD hands out: league_vest, e.g. the Lazy Boner
--                         Safety Vest) | 'podium' (the week's top 3, straight from the results; nothing to hand out).
--                         Backfill: every league with an award name is 'single' (Lazy Boners keeps its vest).
--   leagues.award       : the prize's name (single) or the room's name (podium, optional).
--   A week's podium     : computed, nothing stored (_week_podium). Round 1 only.
--                         Doubles week: teams (team_rounds), a recorded playoff 'TEAMS-R1' settles a tie for 1st.
--                         Singles week: the top division (lowest sort), its own playoff (div_code) settles a tie for 1st.
--                         Places by score to par, ties share (1, 1, 3). The playoff winner keeps 1st; the rest of that
--                         tie drop to 2nd. Top 3 places only.
-- Rules:
--   * A podium shows once the week's cards are all in (no entry part-way through). A week that has passed shows what is
--     complete (a walk-off doesn't hold the podium hostage).
--   * league_trophy_room(slug): public. The league (room type, name, art), every week with a podium (newest first, with
--     course + group photo) and the MVP board. null = no such league, or hidden.
--   * td_save_league takes 'trophy_room' ('' = none). 'single' needs an award name ('award_needed').
-- =====================================================================

create or replace function pg_temp.patch(p_fn regprocedure, p_pairs text[]) returns void language plpgsql as $$
declare d text := pg_get_functiondef(p_fn); i int;
begin
  for i in 1 .. cardinality(p_pairs) / 2 loop
    if position(p_pairs[2 * i - 1] in d) = 0 then raise exception 'patch_failed: % (%)', p_fn, p_pairs[2 * i - 1]; end if;
    d := replace(d, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute d;
end $$;

alter table public.leagues add column if not exists trophy_room text check (trophy_room is null or trophy_room in ('single', 'podium'));
update public.leagues set trophy_room = 'single' where award is not null and trophy_room is null;

select pg_temp.patch('public.td_save_league(uuid,jsonb)', array[
  '''tags'', ''week_format'', ''week_layout_id'') then',
  '''tags'', ''week_format'', ''week_layout_id'', ''trophy_room'') then',
  '  if p ? ''name'' and length(',
  '  if p ? ''trophy_room'' and nullif(p->>''trophy_room'', '''') is not null and p->>''trophy_room'' not in (''single'', ''podium'') then raise exception ''invalid_trophy_room''; end if;
  if (case when p ? ''trophy_room'' then nullif(p->>''trophy_room'', '''') else l.trophy_room end) = ''single''
     and (case when p ? ''award'' then nullif(btrim(coalesce(p->>''award'', '''')), '''') else l.award end) is null then raise exception ''award_needed''; end if;
  if p ? ''name'' and length(',
  '    week_layout_id = case when p ? ''week_layout_id'' then nullif(p->>''week_layout_id'', '''')::uuid else week_layout_id end',
  '    week_layout_id = case when p ? ''week_layout_id'' then nullif(p->>''week_layout_id'', '''')::uuid else week_layout_id end,
    trophy_room = case when p ? ''trophy_room'' then nullif(p->>''trophy_room'', '''') else trophy_room end']);

/** A week's top 3 (round 1): [{place, to_par, entries: [[names]]}], null = nothing to show yet. */
create or replace function public._week_podium(p_event uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with ev as (select id, r1_format, starts_on from public.events where id = p_event),
  top_div as (select d.code from public.divisions d where d.event_id = p_event order by d.sort, d.code limit 1),
  ent as (
    select t.player_a who, array_remove(array[btrim(t.a_name), nullif(btrim(t.b_name), '')], null) names,
           t.to_par, t.holes_played, t.hole_count, 'TEAMS-R1' po_key
      from public.team_rounds t join ev on ev.id = t.event_id and ev.r1_format = 'doubles'
     where t.round = 1
    union all
    select l.player_id, array[btrim(l.name)], l.r1_to_par, l.r1_holes, l.hole_count, l.div_code
      from public.leaderboard l join ev on ev.id = l.event_id and ev.r1_format <> 'doubles'
     where l.div_code = (select code from top_div)
  ),
  done as (select * from ent where hole_count > 0 and holes_played = hole_count and to_par is not null),
  gate as (
    select not exists (select 1 from ent where holes_played > 0 and holes_played < hole_count)
        or (select starts_on < current_date from ev) ok
  ),
  ranked as (select d.*, rank() over (order by d.to_par) place from done d),
  settled as (
    select r.names, r.to_par,
           case when r.place = 1 and po.winner_player_id is not null and po.winner_player_id <> r.who
                     and exists (select 1 from ranked w where w.place = 1 and w.who = po.winner_player_id)
                then 2 else r.place end place
      from ranked r left join public.playoffs po on po.event_id = p_event and po.div_code = r.po_key
  )
  select case when not (select ok from gate) or not exists (select 1 from settled) then null else
    (select jsonb_agg(jsonb_build_object('place', place, 'to_par', to_par, 'entries', entries) order by place)
       from (select place, min(to_par) to_par, jsonb_agg(to_jsonb(names) order by names) entries
               from settled where place <= 3 group by place) g)
  end
$$;

/** Everything a league's trophy room shows (public). null = no such league, or hidden. */
create or replace function public.league_trophy_room(p_slug text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with l as (select * from public.leagues where slug = p_slug and not hidden),
  wk as (
    select e.slug, e.name, e.starts_on, e.group_photo,
           (select c.name from public.course_layouts cl join public.courses c on c.id = cl.course_id where cl.id = e.course_layout_id) course,
           public._week_podium(e.id) podium
      from public.events e join l on l.id = e.league_id
     where not coalesce(e.archived, false)
     order by e.starts_on desc
     limit 100
  )
  select case when not exists (select 1 from l) then null else jsonb_build_object(
    'league', (select jsonb_build_object('id', id, 'slug', slug, 'name', name, 'award', award, 'award_image', award_image,
                 'trophy_room', trophy_room, 'banner', banner, 'logo', logo) from l),
    'weeks', coalesce((select jsonb_agg(jsonb_build_object('slug', slug, 'name', name, 'starts_on', starts_on, 'course', course,
                 'photo', group_photo, 'podium', podium) order by starts_on desc, name) from wk where podium is not null), '[]'::jsonb),
    'mvp', public.league_mvp(p_slug)) end
$$;

revoke all on function public._week_podium(uuid) from public, anon, authenticated;
grant execute on function public.league_trophy_room(text) to anon, authenticated;
