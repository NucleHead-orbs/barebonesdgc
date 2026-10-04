-- Leagues as real records (locked 2026-10-04, Mike: "we need a Create a League function which events or league rounds are then
-- attached to"; answers: super admin creates + league TDs run it; each league gets its own tag set; /leagues reads live from
-- league setup; + NEW WEEK copies last week).
-- Source of truth:
--   leagues           : one row per league. Everything /leagues shows (name, tagline, who runs it, when, where, cost, award,
--                       banner/logo) lives here, edited by the league's TDs. slug is fixed at creation and equals its tag set's slug.
--   leagues.tag_pool_id : the league's own tag set (created with it; unique). Golden Boners / Jewel EA stay plain tag sets.
--   league TDs        : the tag_pool_admins of the league's tag set (one list, no second table). Super admin adds/removes them.
--   events.league_id  : the week (league round) belongs to this league. Kind + tag set follow it (trigger below).
-- Rules:
--   * td_create_league: super admin only. Creates the tag set + the league, same slug + name.
--   * td_save_league: any league TD. Renaming also renames its tag set. Images: a built-in /assets/ path or an upload under
--     league-photos/<league_id>/.
--   * A league TD is a TD of every week of that league (can_td below), so weeks list, open and duplicate for them.
--   * td_league_new_week: any league TD. Copies the newest week (course, CTPs, divisions, payouts, players not checked in);
--     no weeks yet = a blank week with the holes/divisions given. Never copies cards, scores, vest or photo.
--   * td_set_event_league: attach/detach an event (TD of the event + TD of the league). Attaching makes it a league week.
--   * Lazy Boners + RBFL are seeded from the old site copy; Lazy Boners League is attached. Safe to re-run.
-- =====================================================================

create table if not exists public.leagues (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name        text not null check (length(btrim(name)) between 1 and 40),
  subtitle    text check (subtitle is null or length(btrim(subtitle)) between 1 and 60),
  title       text check (title is null or length(btrim(title)) between 1 and 80),
  scrawl      text check (scrawl is null or length(btrim(scrawl)) between 1 and 80),
  run_by      text check (run_by is null or length(btrim(run_by)) between 1 and 60),
  started_by  text check (started_by is null or length(btrim(started_by)) between 1 and 60),
  when_text   text check (when_text is null or length(btrim(when_text)) between 1 and 60),
  where_text  text check (where_text is null or length(btrim(where_text)) between 1 and 80),
  where_note  text check (where_note is null or length(btrim(where_note)) between 1 and 120),
  buy_in      text check (buy_in is null or length(btrim(buy_in)) between 1 and 60),
  award       text check (award is null or length(btrim(award)) between 1 and 60),
  banner      text,
  logo        text,
  tag_pool_id uuid not null unique references public.tag_pools(id) on delete restrict,
  hidden      boolean not null default false,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  constraint leagues_banner_check check (banner is null or banner ~ '^/assets/[A-Za-z0-9/_.-]{1,200}$' or (starts_with(banner, id::text || '/') and length(banner) <= 200 and banner !~ '\.\.')),
  constraint leagues_logo_check check (logo is null or logo ~ '^/assets/[A-Za-z0-9/_.-]{1,200}$' or (starts_with(logo, id::text || '/') and length(logo) <= 200 and logo !~ '\.\.'))
);

alter table public.leagues enable row level security;
revoke all on public.leagues from anon, authenticated;
grant select on public.leagues to anon, authenticated;
drop policy if exists "public read" on public.leagues;
create policy "public read" on public.leagues for select to anon, authenticated using (not hidden or public.can_tag(tag_pool_id));

alter table public.events add column if not exists league_id uuid references public.leagues(id) on delete set null;
create index if not exists events_league_idx on public.events (league_id, starts_on) where league_id is not null;

/** A TD of this league: super admin, or an admin of its tag set. */
create or replace function public.can_league(p_league uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_td() or exists (
    select 1 from public.leagues l join public.tag_pool_admins a on a.pool_id = l.tag_pool_id
     where l.id = p_league and a.email = public.my_email())
$$;

/** Event TD: super admin, listed on the event, or a TD of the league the event belongs to. */
create or replace function public.can_td(p_event uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_td()
      or exists (select 1 from public.event_tds t where t.event_id = p_event and t.email = public.my_email())
      or exists (select 1 from public.events e
                   join public.leagues l on l.id = e.league_id
                   join public.tag_pool_admins a on a.pool_id = l.tag_pool_id
                  where e.id = p_event and a.email = public.my_email())
$$;

-- Kind + tag set follow the league. An event-kind row has no league; a league-kind row with a league's tag set joins it
-- (so DUPLICATE, which carries kind + tag set, keeps the copy in the league).
create or replace function public._events_league_sync() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind = 'event' then
    new.league_id := null;
  elsif new.league_id is not null then
    new.tag_pool_id := (select tag_pool_id from public.leagues where id = new.league_id);
  elsif new.tag_pool_id is not null then
    new.league_id := (select id from public.leagues where tag_pool_id = new.tag_pool_id);
  end if;
  return new;
end $$;
drop trigger if exists events_league_sync on public.events;
create trigger events_league_sync before insert or update of league_id, kind, tag_pool_id on public.events
  for each row execute function public._events_league_sync();

/** Leagues this account runs (hidden ones too), with their tag set slug. */
create or replace function public.td_my_leagues() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object('pool_slug', tp.slug) order by l.sort, l.name), '[]'::jsonb)
    from public.leagues l join public.tag_pools tp on tp.id = l.tag_pool_id
   where public.can_league(l.id)
$$;

/** Super admin: a new league + its own tag set (same slug + name). Returns the league id. */
create or replace function public.td_create_league(p_name text, p_slug text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_name text := btrim(coalesce(p_name, '')); v_slug text := lower(btrim(coalesce(p_slug, ''))); v_pool uuid; v_id uuid;
begin
  if not public.is_td() then raise exception 'forbidden'; end if;
  if length(v_name) not between 1 and 40 then raise exception 'invalid_name'; end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,39}$' then raise exception 'invalid_slug'; end if;
  if exists (select 1 from public.tag_pools where slug = v_slug) or exists (select 1 from public.leagues where slug = v_slug) then
    raise exception 'slug_taken';
  end if;
  insert into public.tag_pools (slug, name, sort) values (v_slug, v_name, coalesce((select max(sort) from public.tag_pools), 0) + 1)
    returning id into v_pool;
  insert into public.leagues (slug, name, title, tag_pool_id, sort)
    values (v_slug, v_name, v_name, v_pool, coalesce((select max(sort) from public.leagues), 0) + 1)
    returning id into v_id;
  return v_id;
end $$;

/** League TD: save the league's setup (every key optional; '' clears a text field). Renames its tag set with it. */
create or replace function public.td_save_league(p_league uuid, p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.leagues; k text;
begin
  if not public.can_league(p_league) then raise exception 'forbidden'; end if;
  select * into l from public.leagues where id = p_league;
  if l.id is null then raise exception 'unknown_league'; end if;
  for k in select jsonb_object_keys(coalesce(p, '{}'::jsonb)) loop
    if k not in ('name', 'subtitle', 'title', 'scrawl', 'run_by', 'started_by', 'when_text', 'where_text', 'where_note',
                 'buy_in', 'award', 'banner', 'logo', 'hidden', 'sort') then
      raise exception 'unknown_field: %', k;
    end if;
  end loop;
  if p ? 'name' and length(btrim(coalesce(p->>'name', ''))) not between 1 and 40 then raise exception 'invalid_name'; end if;
  update public.leagues set
    name       = case when p ? 'name' then btrim(p->>'name') else name end,
    subtitle   = case when p ? 'subtitle' then nullif(btrim(coalesce(p->>'subtitle', '')), '') else subtitle end,
    title      = case when p ? 'title' then nullif(btrim(coalesce(p->>'title', '')), '') else title end,
    scrawl     = case when p ? 'scrawl' then nullif(btrim(coalesce(p->>'scrawl', '')), '') else scrawl end,
    run_by     = case when p ? 'run_by' then nullif(btrim(coalesce(p->>'run_by', '')), '') else run_by end,
    started_by = case when p ? 'started_by' then nullif(btrim(coalesce(p->>'started_by', '')), '') else started_by end,
    when_text  = case when p ? 'when_text' then nullif(btrim(coalesce(p->>'when_text', '')), '') else when_text end,
    where_text = case when p ? 'where_text' then nullif(btrim(coalesce(p->>'where_text', '')), '') else where_text end,
    where_note = case when p ? 'where_note' then nullif(btrim(coalesce(p->>'where_note', '')), '') else where_note end,
    buy_in     = case when p ? 'buy_in' then nullif(btrim(coalesce(p->>'buy_in', '')), '') else buy_in end,
    award      = case when p ? 'award' then nullif(btrim(coalesce(p->>'award', '')), '') else award end,
    banner     = case when p ? 'banner' then nullif(btrim(coalesce(p->>'banner', '')), '') else banner end,
    logo       = case when p ? 'logo' then nullif(btrim(coalesce(p->>'logo', '')), '') else logo end,
    hidden     = case when p ? 'hidden' then coalesce((p->>'hidden')::boolean, false) else hidden end,
    sort       = case when p ? 'sort' then coalesce((p->>'sort')::int, sort) else sort end
  where id = p_league;
  if p ? 'name' then update public.tag_pools set name = btrim(p->>'name') where id = l.tag_pool_id; end if;
end $$;

/** League TD: the next week. Copies the newest week; with none yet, a blank week (p_hole_count holes, p_divisions). */
create or replace function public.td_league_new_week(p_league uuid, p_date date, p_name text default null, p_copy_players boolean default true,
                                                     p_hole_count int default 18, p_divisions jsonb default '[]')
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.leagues; prev uuid; v_name text; r jsonb; v_id uuid; v_slug text;
begin
  if not public.can_league(p_league) then raise exception 'forbidden'; end if;
  select * into l from public.leagues where id = p_league;
  if l.id is null then raise exception 'unknown_league'; end if;
  if p_date is null then raise exception 'invalid_dates'; end if;
  v_name := coalesce(nullif(btrim(coalesce(p_name, '')), ''), l.name || ' · ' || to_char(p_date, 'Mon FMDD'));
  if length(v_name) > 80 then raise exception 'invalid_name'; end if;
  select id into prev from public.events where league_id = p_league order by starts_on desc, created_at desc limit 1;

  if prev is not null then
    r := public.td_create_event(v_name, null, p_date, p_date, prev, 18, '[]', coalesce(p_copy_players, true));
    v_id := (r->>'id')::uuid;
  else
    if p_hole_count is null or p_hole_count not between 1 and 40 then raise exception 'invalid_holes'; end if;
    v_slug := public._event_slug(v_name, p_date);
    insert into public.events (slug, name, starts_on, ends_on, club_name, skin, palette, rounds, waves, use_checkin, use_sponsors,
                               r1_format, r2_format, dubs_style, kind, league_id)
      values (v_slug, v_name, p_date, p_date, 'Bare Bones Disc Golf', 'event', 'cosmic', 1, 1, true, false,
              'singles', 'singles', 'Best shot', 'league', p_league)
      returning id into v_id;
    insert into public.holes (event_id, n, par) select v_id, g, 3 from generate_series(1, p_hole_count) g;
    perform public._write_divisions(v_id, p_divisions);
    r := jsonb_build_object('id', v_id, 'slug', v_slug);
  end if;
  -- a league week: one day, one round, this league (the trigger sets its tag set)
  update public.events set kind = 'league', league_id = p_league, ends_on = starts_on, rounds = 1, waves = 1 where id = v_id;
  return r;
end $$;

/** Attach an event to a league (it becomes a week) or detach it (null: back to a plain event). */
create or replace function public.td_set_event_league(p_event uuid, p_league uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._require_event_td(p_event);
  if p_league is null then
    update public.events set kind = 'event', league_id = null, tag_pool_id = null where id = p_event;
  else
    if not exists (select 1 from public.leagues where id = p_league) then raise exception 'unknown_league'; end if;
    if not public.can_league(p_league) then raise exception 'forbidden'; end if;
    update public.events set kind = 'league', league_id = p_league where id = p_event;
  end if;
end $$;

revoke execute on function public.td_my_leagues(), public.td_create_league(text, text), public.td_save_league(uuid, jsonb),
  public.td_league_new_week(uuid, date, text, boolean, int, jsonb), public.td_set_event_league(uuid, uuid) from public, anon;
grant execute on function public.td_my_leagues(), public.td_create_league(text, text), public.td_save_league(uuid, jsonb),
  public.td_league_new_week(uuid, date, text, boolean, int, jsonb), public.td_set_event_league(uuid, uuid) to authenticated;
revoke execute on function public.can_league(uuid) from public;
grant execute on function public.can_league(uuid) to anon, authenticated;

/** The vest wall for one league (by its slug), newest first. Redefined from league_week: weeks attach by league now. */
create or replace function public.league_weeks(p_pool_slug text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(w order by (w->>'starts_on') desc, w->>'name'), '[]'::jsonb)
  from (
    select jsonb_build_object('slug', e.slug, 'name', e.name, 'starts_on', e.starts_on,
             'vest', p.name, 'vest_note', case when p.id is not null then e.vest_note end, 'photo', e.group_photo) w
    from public.events e
    join public.leagues l on l.id = e.league_id and l.slug = p_pool_slug
    left join public.players p on p.id = e.vest_player_id and p.event_id = e.id
    where (p.id is not null or e.group_photo is not null)
    order by e.starts_on desc
    limit 200
  ) s;
$$;

-- ---------- league images: league-photos/<league_id>/..., written by that league's TDs ----------
drop policy if exists "td reads league photos" on storage.objects;
create policy "td reads league photos" on storage.objects for select to authenticated
  using (bucket_id = 'league-photos' and (public.can_td(public._uuid_or_null((storage.foldername(name))[1]))
                                         or public.can_league(public._uuid_or_null((storage.foldername(name))[1]))));
drop policy if exists "td writes league photos" on storage.objects;
create policy "td writes league photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'league-photos' and (public.can_td(public._uuid_or_null((storage.foldername(name))[1]))
                                              or public.can_league(public._uuid_or_null((storage.foldername(name))[1]))));
drop policy if exists "td deletes league photos" on storage.objects;
create policy "td deletes league photos" on storage.objects for delete to authenticated
  using (bucket_id = 'league-photos' and (public.can_td(public._uuid_or_null((storage.foldername(name))[1]))
                                         or public.can_league(public._uuid_or_null((storage.foldername(name))[1]))));

-- ---------- data: the two leagues the site had hard-coded (src/lib/leagues/leagues.ts, 2026-10-04) ----------
insert into public.leagues (slug, name, subtitle, title, scrawl, run_by, started_by, when_text, where_text, where_note, award, banner, logo, tag_pool_id, sort)
select 'lazy-boners', 'Lazy Boners', 'Club league', 'Lazy Boners', 'Minimum effort. Maximum Boner.', 'T-Bone', 'T-Bone & Fixer',
       'Sundays · 7:30 AM', 'Traveling league', 'Course rotates. The group posts where.', 'Lazy Boner Safety Vest',
       '/assets/leagues/lazy-boners-banner.webp', null, id, 1
  from public.tag_pools where slug = 'lazy-boners'
on conflict (slug) do nothing;
insert into public.leagues (slug, name, subtitle, title, scrawl, run_by, when_text, where_text, logo, tag_pool_id, sort)
select 'rbfl', 'RBFL', 'Root Beer Float League', 'Root Beer Float League', 'Float on, Boners.', 'George',
       'Thursdays · 4:30 PM', 'Emerald Park', '/assets/leagues/rbfl-logo.webp', id, 2
  from public.tag_pools where slug = 'rbfl'
on conflict (slug) do nothing;

-- weeks already set up as league nights join their league (the trigger derives it from the tag set)
update public.events e set league_id = l.id
  from public.leagues l
 where e.kind = 'league' and e.tag_pool_id = l.tag_pool_id and e.league_id is null;
