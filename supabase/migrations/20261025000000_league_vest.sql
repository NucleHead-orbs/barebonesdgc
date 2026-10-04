-- The vest page + dubs vests (locked 2026-10-04, Mike: "Technically there's two wearing it this week, since they did dubs";
-- answers: award the team; its own page /leagues/<slug>/vest; this week's holders, group photo, every week, most-vests board).
-- Source of truth:
--   league_vest        : who wears the week's award. One row per holder: 1 on a singles week, the winning team (2, or a Cali's 1)
--                        on a dubs week. Max 2 per week. Replaces events.vest_player_id (kept only as a compat mirror until
--                        the next migration drops it).
--   events.vest_note   : the week's one-line shout-out (unchanged).
--   leagues.award_image: the award's art (Mike's vest asset), '/assets/...' or an upload under league-photos/<league_id>/.
-- Rules:
--   * td_set_vest_holders(event, players[], note): any TD of the event. 0–2 players, all from that week. Empty = taken back.
--   * No FK from league_vest to players on purpose (a second events<->players path makes PostgREST embeds ambiguous);
--     a trigger checks the player belongs to the week, and a removed player just drops off the page.
--   * league_vest_page(slug): public. The league, every week with a vest or photo (holders, note, photo, course), and the
--     most-vests board (by name, case-insensitive, across weeks).
--   * league_weeks(slug) keeps its shape; 'vest' is now the holders' names joined with " & ".
-- =====================================================================

create table if not exists public.league_vest (
  event_id  uuid not null references public.events(id) on delete cascade,
  player_id uuid not null,
  added_at  timestamptz not null default now(),
  primary key (event_id, player_id)
);
alter table public.league_vest enable row level security;
revoke all on public.league_vest from anon, authenticated;
grant select on public.league_vest to anon, authenticated;
drop policy if exists "public read" on public.league_vest;
create policy "public read" on public.league_vest for select to anon, authenticated using (true);

create or replace function public._league_vest_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.players where id = new.player_id and event_id = new.event_id) then raise exception 'unknown_player'; end if;
  if (select count(*) from public.league_vest where event_id = new.event_id and player_id <> new.player_id) >= 2 then raise exception 'too_many_holders'; end if;
  return new;
end $$;
drop trigger if exists league_vest_check on public.league_vest;
create trigger league_vest_check before insert or update on public.league_vest for each row execute function public._league_vest_check();

-- carry over anything awarded the old way
insert into public.league_vest (event_id, player_id)
select e.id, e.vest_player_id from public.events e
 where e.vest_player_id is not null and exists (select 1 from public.players p where p.id = e.vest_player_id and p.event_id = e.id)
on conflict do nothing;

alter table public.leagues add column if not exists award_image text;
alter table public.leagues drop constraint if exists leagues_award_image_check;
alter table public.leagues add constraint leagues_award_image_check check (award_image is null or award_image ~ '^/assets/[A-Za-z0-9/_.-]{1,200}$'
  or (starts_with(award_image, id::text || '/') and length(award_image) <= 200 and award_image !~ '\.\.'));

/** Award the week's vest to 0–2 of its players (a dubs week: the winning team). */
create or replace function public.td_set_vest_holders(p_event uuid, p_players uuid[], p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v text := nullif(btrim(coalesce(p_note, '')), ''); ids uuid[] := array(select distinct x from unnest(coalesce(p_players, '{}')) x where x is not null);
begin
  perform public._require_event_td(p_event);
  if cardinality(ids) > 2 then raise exception 'too_many_holders'; end if;
  if v is not null and length(v) > 120 then raise exception 'vest_note_too_long'; end if;
  delete from public.league_vest where event_id = p_event;
  insert into public.league_vest (event_id, player_id) select p_event, x from unnest(ids) x;
  update public.events set vest_note = case when cardinality(ids) > 0 then v end,
                           vest_player_id = ids[1]  -- compat mirror for the previous app version; dropped next migration
   where id = p_event;
end $$;

/** Previous app version's call: one player (or null). */
create or replace function public.td_set_vest(p_event uuid, p_player uuid, p_note text) returns void
language sql security definer set search_path = public, pg_temp as $$
  select public.td_set_vest_holders(p_event, case when p_player is null then '{}'::uuid[] else array[p_player] end, p_note)
$$;

revoke execute on function public.td_set_vest_holders(uuid, uuid[], text) from public, anon;
grant execute on function public.td_set_vest_holders(uuid, uuid[], text) to authenticated;

/** Holders' names for a week, "A & B" (null = not awarded). */
create or replace function public._vest_names(p_event uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select string_agg(p.name, ' & ' order by p.name) from public.league_vest v join public.players p on p.id = v.player_id and p.event_id = v.event_id
   where v.event_id = p_event
$$;

create or replace function public.league_weeks(p_pool_slug text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(w order by (w->>'starts_on') desc, w->>'name'), '[]'::jsonb)
  from (
    select jsonb_build_object('slug', e.slug, 'name', e.name, 'starts_on', e.starts_on,
             'vest', n.names, 'vest_note', case when n.names is not null then e.vest_note end, 'photo', e.group_photo) w
    from public.events e
    join public.leagues l on l.id = e.league_id and l.slug = p_pool_slug
    cross join lateral (select public._vest_names(e.id) names) n
    where (n.names is not null or e.group_photo is not null)
    order by e.starts_on desc
    limit 200
  ) s;
$$;

/** Everything the vest page shows (public). null = no such league (or hidden). */
create or replace function public.league_vest_page(p_slug text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with l as (select * from public.leagues where slug = p_slug and not hidden),
  wk as (
    select e.id, e.slug, e.name, e.starts_on, e.vest_note, e.group_photo,
           (select coalesce(c.name, '') from public.course_layouts cl join public.courses c on c.id = cl.course_id where cl.id = e.course_layout_id) course,
           (select coalesce(jsonb_agg(p.name order by p.name), '[]'::jsonb) from public.league_vest v join public.players p on p.id = v.player_id and p.event_id = v.event_id where v.event_id = e.id) holders
      from public.events e join l on l.id = e.league_id
  ),
  shown as (select * from wk where jsonb_array_length(holders) > 0 or group_photo is not null),
  board as (
    select max(btrim(p.name)) as name, count(*) as weeks, max(e.starts_on) as last_on
      from public.league_vest v join public.players p on p.id = v.player_id and p.event_id = v.event_id
      join public.events e on e.id = v.event_id join l on l.id = e.league_id
     group by lower(btrim(p.name))
  )
  select case when not exists (select 1 from l) then null else jsonb_build_object(
    'league', (select jsonb_build_object('id', id, 'slug', slug, 'name', name, 'award', award, 'award_image', award_image, 'banner', banner, 'logo', logo) from l),
    'weeks', coalesce((select jsonb_agg(jsonb_build_object('slug', slug, 'name', name, 'starts_on', starts_on, 'course', nullif(course, ''),
                 'holders', holders, 'note', case when jsonb_array_length(holders) > 0 then vest_note end, 'photo', group_photo)
               order by starts_on desc, name) from (select * from shown order by starts_on desc limit 200) s), '[]'::jsonb),
    'board', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'weeks', weeks, 'last_on', last_on) order by weeks desc, last_on desc, name)
               from (select * from board order by weeks desc, last_on desc, name limit 25) b), '[]'::jsonb)
  ) end
$$;
revoke execute on function public.league_vest_page(text), public._vest_names(uuid) from public;
grant execute on function public.league_vest_page(text) to anon, authenticated;

/** League setup now also saves award_image (redefined from leagues: one more key). */
create or replace function public.td_save_league(p_league uuid, p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.leagues; k text;
begin
  if not public.can_league(p_league) then raise exception 'forbidden'; end if;
  select * into l from public.leagues where id = p_league;
  if l.id is null then raise exception 'unknown_league'; end if;
  for k in select jsonb_object_keys(coalesce(p, '{}'::jsonb)) loop
    if k not in ('name', 'subtitle', 'title', 'scrawl', 'run_by', 'started_by', 'when_text', 'where_text', 'where_note',
                 'buy_in', 'award', 'banner', 'logo', 'award_image', 'hidden', 'sort') then
      raise exception 'unknown_field: %', k;
    end if;
  end loop;
  if p ? 'name' and length(btrim(coalesce(p->>'name', ''))) not between 1 and 40 then raise exception 'invalid_name'; end if;
  update public.leagues set
    name        = case when p ? 'name' then btrim(p->>'name') else name end,
    subtitle    = case when p ? 'subtitle' then nullif(btrim(coalesce(p->>'subtitle', '')), '') else subtitle end,
    title       = case when p ? 'title' then nullif(btrim(coalesce(p->>'title', '')), '') else title end,
    scrawl      = case when p ? 'scrawl' then nullif(btrim(coalesce(p->>'scrawl', '')), '') else scrawl end,
    run_by      = case when p ? 'run_by' then nullif(btrim(coalesce(p->>'run_by', '')), '') else run_by end,
    started_by  = case when p ? 'started_by' then nullif(btrim(coalesce(p->>'started_by', '')), '') else started_by end,
    when_text   = case when p ? 'when_text' then nullif(btrim(coalesce(p->>'when_text', '')), '') else when_text end,
    where_text  = case when p ? 'where_text' then nullif(btrim(coalesce(p->>'where_text', '')), '') else where_text end,
    where_note  = case when p ? 'where_note' then nullif(btrim(coalesce(p->>'where_note', '')), '') else where_note end,
    buy_in      = case when p ? 'buy_in' then nullif(btrim(coalesce(p->>'buy_in', '')), '') else buy_in end,
    award       = case when p ? 'award' then nullif(btrim(coalesce(p->>'award', '')), '') else award end,
    banner      = case when p ? 'banner' then nullif(btrim(coalesce(p->>'banner', '')), '') else banner end,
    logo        = case when p ? 'logo' then nullif(btrim(coalesce(p->>'logo', '')), '') else logo end,
    award_image = case when p ? 'award_image' then nullif(btrim(coalesce(p->>'award_image', '')), '') else award_image end,
    hidden      = case when p ? 'hidden' then coalesce((p->>'hidden')::boolean, false) else hidden end,
    sort        = case when p ? 'sort' then coalesce((p->>'sort')::int, sort) else sort end
  where id = p_league;
  if p ? 'name' then update public.tag_pools set name = btrim(p->>'name') where id = l.tag_pool_id; end if;
end $$;
