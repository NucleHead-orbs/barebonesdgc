-- =====================================================================
-- Tagless leagues, league week defaults, MVP (locked 2026-10-10, Mike: Blake's Friday glow league "is always dubs and
-- always the 22 hole layout. They wouldn't need their own set of tags, so let's make a toggle for tags in league
-- creation." + "track most valuable partners ... it's random draw, so basically just individual with most wins").
-- Answers: a league flag (the set stays, hidden: its admin list still names the league's TDs); week defaults live in
-- league settings; MVP = the individual with the most wins.
--
-- Source of truth:
--   leagues.tags           : true = the league runs its own tag set (as before). false = no tags at all.
--   tag_pools.hidden       : mirrors "its league has tags off" (kept by trigger). Hidden sets are left off the tag
--                            boards and refuse tags and tag rounds. Their admins still run the league.
--   leagues.week_format    : 'singles' | 'doubles' | null (null = copy the week before, singles for the first).
--   leagues.week_layout_id : a library layout every NEW WEEK loads | null (null = copy the week before).
--   MVP: computed, nothing stored: league weeks with a doubles round 1, complete team rounds (every hole), placed by
--        team score (ties share). Each player on a team = that team's place.
-- Rules:
--   * td_create_league(name, slug, tags): super admin; tags off creates the set hidden. td_save_league takes 'tags',
--     'week_format', 'week_layout_id' (a league TD). Turning tags off is refused while anyone holds one of its tags
--     ('tags_held': release them first).
--   * No tag can be issued (any path) and no tag round recorded in a hidden set ('tags_off').
--   * td_league_new_week applies week_format to round 1 and loads week_layout_id, after the usual copy.
--   * league_mvp(slug): public. Per player (matched by name, case-insensitive, across the league's weeks): weeks,
--     wins, podiums (top 3), best score to par. Most wins first, then podiums, then fewer weeks.
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

alter table public.leagues add column if not exists tags boolean not null default true;
alter table public.leagues add column if not exists week_format text check (week_format is null or week_format in ('singles', 'doubles'));
alter table public.leagues add column if not exists week_layout_id uuid references public.course_layouts (id) on delete set null;
alter table public.tag_pools add column if not exists hidden boolean not null default false;

-- the set's hidden flag follows its league
create or replace function public._league_tags_sync() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.tag_pools set hidden = not new.tags where id = new.tag_pool_id and hidden is distinct from (not new.tags);
  return new;
end $$;
drop trigger if exists leagues_tags_sync on public.leagues;
create trigger leagues_tags_sync after insert or update of tags, tag_pool_id on public.leagues for each row execute function public._league_tags_sync();

-- hidden sets take no tags and no tag rounds, whatever the path
create or replace function public._tag_pool_open() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.tag_pools where id = new.pool_id and hidden) then raise exception 'tags_off'; end if;
  return new;
end $$;
drop trigger if exists tags_pool_open on public.tags;
create trigger tags_pool_open before insert on public.tags for each row execute function public._tag_pool_open();
drop trigger if exists tag_matches_pool_open on public.tag_matches;
create trigger tag_matches_pool_open before insert on public.tag_matches for each row execute function public._tag_pool_open();

/** Super admin: a new league; tags off = its set is created hidden (no tags, no tag board). */
create or replace function public.td_create_league(p_name text, p_slug text, p_tags boolean) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  v_id := public.td_create_league(p_name, p_slug);
  if not coalesce(p_tags, true) then update public.leagues set tags = false where id = v_id; end if;
  return v_id;
end $$;

select pg_temp.patch('public.td_save_league(uuid,jsonb)', array[
  '''buy_in'', ''award'', ''banner'', ''logo'', ''award_image'', ''hidden'', ''sort'') then',
  '''buy_in'', ''award'', ''banner'', ''logo'', ''award_image'', ''hidden'', ''sort'', ''tags'', ''week_format'', ''week_layout_id'') then',
  '  if p ? ''name'' and length(',
  '  if p ? ''tags'' and not coalesce((p->>''tags'')::boolean, true) and exists (select 1 from public.tags where pool_id = l.tag_pool_id and holder_id is not null) then
    raise exception ''tags_held'';
  end if;
  if p ? ''week_format'' and nullif(p->>''week_format'', '''') is not null and p->>''week_format'' not in (''singles'', ''doubles'') then raise exception ''invalid_format''; end if;
  if p ? ''week_layout_id'' and nullif(p->>''week_layout_id'', '''') is not null
     and not exists (select 1 from public.course_layouts where id::text = p->>''week_layout_id'') then raise exception ''unknown_layout''; end if;
  if p ? ''name'' and length(',
  '    sort        = case when p ? ''sort'' then coalesce((p->>''sort'')::int, sort) else sort end',
  '    sort        = case when p ? ''sort'' then coalesce((p->>''sort'')::int, sort) else sort end,
    tags        = case when p ? ''tags'' then coalesce((p->>''tags'')::boolean, true) else tags end,
    week_format = case when p ? ''week_format'' then nullif(p->>''week_format'', '''') else week_format end,
    week_layout_id = case when p ? ''week_layout_id'' then nullif(p->>''week_layout_id'', '''')::uuid else week_layout_id end']);

-- NEW WEEK: the league's format + layout, after the copy
select pg_temp.patch('public.td_league_new_week(uuid,date,text,boolean,integer,jsonb)', array[
  '  update public.events set kind = ''league'', league_id = p_league, ends_on = starts_on, rounds = 1, waves = 1 where id = v_id;
  return r;',
  '  update public.events set kind = ''league'', league_id = p_league, ends_on = starts_on, rounds = 1, waves = 1 where id = v_id;
  if l.week_format is not null then update public.events set r1_format = l.week_format where id = v_id; end if;
  if l.week_layout_id is not null and (select course_layout_id from public.events where id = v_id) is distinct from l.week_layout_id then
    perform public.td_apply_layout(v_id, l.week_layout_id);
  end if;
  return r;']);

/** The league's MVP board: most wins in its doubles weeks. */
create or replace function public.league_mvp(p_slug text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with wk as (
    select e.id from public.events e join public.leagues l on l.id = e.league_id
     where l.slug = p_slug and e.r1_format = 'doubles' and not coalesce(e.archived, false)
  ), tr as (
    select t.event_id, t.a_name, t.b_name, t.to_par, rank() over (partition by t.event_id order by t.to_par) place
      from public.team_rounds t join wk on wk.id = t.event_id
     where t.round = 1 and t.hole_count > 0 and t.holes_played = t.hole_count
  ), pl as (
    select event_id, btrim(a_name) nm, to_par, place from tr
    union all
    select event_id, btrim(b_name), to_par, place from tr where b_name is not null
  ), agg as (
    select lower(nm) k, (array_agg(nm order by event_id desc))[1] name, count(distinct event_id)::int weeks,
           count(*) filter (where place = 1)::int wins, count(*) filter (where place <= 3)::int podiums, min(to_par)::int best
      from pl where nm <> '' group by lower(nm)
  )
  select jsonb_build_object('weeks', (select count(distinct event_id) from tr),
    'players', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'weeks', weeks, 'wins', wins, 'podiums', podiums, 'best', best)
                           order by wins desc, podiums desc, weeks, name) from agg), '[]'))
$$;

revoke all on function public._league_tags_sync(), public._tag_pool_open() from public, anon, authenticated;
revoke all on function public.td_create_league(text, text, boolean) from public, anon;
grant execute on function public.td_create_league(text, text, boolean) to authenticated;
grant execute on function public.league_mvp(text) to anon, authenticated;
