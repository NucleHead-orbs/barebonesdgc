-- Course library (locked 2026-09-29)
-- Source of truth:
--   courses        : a place (name, city, PDGA link, PDGA hole count). Shared by every club/event.
--   course_layouts : a way to play it ("A pins", "Long tees", "Jewel XI 2026"), with a source note and
--                    verified_at/verified_by (super admin only).
--   course_holes   : per layout: par, feet, OB, rules (mandos etc.).
--   events.course_layout_id : which layout an event was built from (reference only).
-- Rules:
--   * Anyone can read the library (not sensitive). Any TD (super admin, or TD of any event) can add
--     courses and save layouts. Only a super admin verifies. A non-admin save clears verification.
--   * Applying a layout COPIES its holes into the event (td_apply_layout, same safety checks as
--     td_set_holes). Editing the library later never changes an event. Event hole quotes are untouched.
--   * Duplicating an event carries course_layout_id.
-- =====================================================================

create or replace function public.is_any_td() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_td() or exists (select 1 from public.event_tds where email = public.my_email())
$$;
revoke execute on function public.is_any_td() from public;
grant execute on function public.is_any_td() to anon, authenticated;

create table public.courses (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 80),
  city       text check (city is null or length(btrim(city)) between 1 and 60),
  pdga_url   text check (pdga_url is null or pdga_url like 'https://www.pdga.com/%'),
  pdga_holes smallint check (pdga_holes is null or pdga_holes between 1 and 60),
  notes      text check (notes is null or length(notes) <= 500),
  created_by text,
  created_at timestamptz not null default now()
);
create unique index courses_name_key on public.courses (lower(btrim(name)));

create table public.course_layouts (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 60),
  source      text check (source is null or length(source) <= 300),
  verified_at timestamptz,
  verified_by text,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create unique index course_layouts_name_key on public.course_layouts (course_id, lower(btrim(name)));

create table public.course_holes (
  layout_id uuid not null references public.course_layouts(id) on delete cascade,
  n         smallint not null check (n between 1 and 40),
  par       smallint not null check (par between 2 and 6),
  dist_ft   integer check (dist_ft is null or dist_ft between 1 and 5000),
  ob        text check (ob is null or length(ob) <= 200),
  rules     text[] not null default '{}' check (cardinality(rules) <= 10),
  primary key (layout_id, n)
);

alter table public.events add column course_layout_id uuid references public.course_layouts(id) on delete set null;

-- ---------- RLS ----------
alter table public.courses        enable row level security;
alter table public.course_layouts enable row level security;
alter table public.course_holes   enable row level security;
revoke all on public.courses, public.course_layouts, public.course_holes from anon, authenticated;
grant select on public.courses, public.course_layouts, public.course_holes to anon, authenticated;
grant insert, update on public.courses to authenticated;   -- layouts + holes: RPCs only
create policy "public read" on public.courses        for select to anon, authenticated using (true);
create policy "public read" on public.course_layouts for select to anon, authenticated using (true);
create policy "public read" on public.course_holes   for select to anon, authenticated using (true);
create policy "any td adds" on public.courses for insert to authenticated with check (public.is_any_td());
create policy "any td edits" on public.courses for update to authenticated using (public.is_any_td()) with check (public.is_any_td());

-- ---------- holes json -> validated rows (shared by save + apply) ----------
create or replace function public._check_holes(p_holes jsonb) returns int
language plpgsql immutable set search_path = public, pg_temp as $$
declare v_n int;
begin
  v_n := jsonb_array_length(coalesce(p_holes, '[]'));
  if v_n not between 1 and 40
     or (select count(distinct (h->>'n')::int) from jsonb_array_elements(p_holes) h
          where (h->>'n')::int between 1 and v_n) <> v_n
     or exists (select 1 from jsonb_array_elements(p_holes) h
                 where (h->>'par')::int is null or (h->>'par')::int not between 2 and 6
                    or coalesce(nullif(h->>'dist_ft', '')::int, 1) not between 1 and 5000
                    or length(coalesce(h->>'ob', '')) > 200
                    or (jsonb_typeof(h->'rules') = 'array' and jsonb_array_length(h->'rules') > 10)) then
    raise exception 'invalid_holes';
  end if;
  return v_n;
end $$;

-- ---------- save a layout (new or existing) ----------
create or replace function public.td_save_layout(p_course_id uuid, p_layout_id uuid, p_name text, p_holes jsonb, p_source text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_admin boolean := public.is_td(); v_me text := public.my_email();
begin
  if not public.is_any_td() then raise exception 'forbidden'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'invalid_name'; end if;
  perform public._check_holes(p_holes);
  if p_layout_id is null then
    insert into public.course_layouts (course_id, name, source, updated_by)
    values (p_course_id, btrim(p_name), nullif(btrim(coalesce(p_source, '')), ''), v_me)
    returning id into v_id;
  else
    update public.course_layouts
       set name = btrim(p_name), source = coalesce(nullif(btrim(coalesce(p_source, '')), ''), source),
           updated_at = now(), updated_by = v_me,
           verified_at = case when v_admin then verified_at end,
           verified_by = case when v_admin then verified_by end
     where id = p_layout_id and course_id = p_course_id
    returning id into v_id;
    if v_id is null then raise exception 'unknown_layout'; end if;
    delete from public.course_holes where layout_id = v_id;
  end if;
  insert into public.course_holes (layout_id, n, par, dist_ft, ob, rules)
    select v_id, (h->>'n')::smallint, (h->>'par')::smallint, nullif(h->>'dist_ft', '')::int,
           nullif(btrim(coalesce(h->>'ob', '')), ''),
           coalesce(array(select btrim(r) from jsonb_array_elements_text(case when jsonb_typeof(h->'rules') = 'array' then h->'rules' else '[]' end) r
                          where btrim(r) <> ''), '{}')
      from jsonb_array_elements(p_holes) h;
  return v_id;
end $$;

create or replace function public.td_verify_layout(p_layout_id uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_td() then raise exception 'forbidden'; end if;
  update public.course_layouts
     set verified_at = case when p_on then now() end, verified_by = case when p_on then public.my_email() end
   where id = p_layout_id;
  if not found then raise exception 'unknown_layout'; end if;
end $$;

-- ---------- copy a layout into an event ----------
create or replace function public.td_apply_layout(p_event_id uuid, p_layout_id uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  perform public._require_event_td(p_event_id);
  select count(*) into v_n from public.course_holes where layout_id = p_layout_id;
  if v_n = 0 then raise exception 'unknown_layout'; end if;
  if exists (select 1 from public.cards where event_id = p_event_id and start_hole > v_n) then
    raise exception 'holes_have_cards';
  end if;
  if exists (select 1 from public.scores s join public.players p on p.id = s.player_id
              where p.event_id = p_event_id and s.hole > v_n) then
    raise exception 'holes_have_scores';
  end if;
  delete from public.holes where event_id = p_event_id and n > v_n;
  insert into public.holes (event_id, n, par, dist_ft, ob, rules)
    select p_event_id, n, par, dist_ft, ob, rules from public.course_holes where layout_id = p_layout_id
  on conflict (event_id, n) do update set par = excluded.par, dist_ft = excluded.dist_ft, ob = excluded.ob, rules = excluded.rules;
  update public.events set course_layout_id = p_layout_id where id = p_event_id;
  return v_n;
end $$;

revoke execute on function public._check_holes(jsonb) from public, anon, authenticated;
revoke execute on function public.td_save_layout(uuid, uuid, text, jsonb, text), public.td_verify_layout(uuid, boolean),
                          public.td_apply_layout(uuid, uuid) from public, anon;
grant execute on function public.td_save_layout(uuid, uuid, text, jsonb, text), public.td_verify_layout(uuid, boolean),
                          public.td_apply_layout(uuid, uuid) to authenticated;

-- ---------- duplicate carries the layout link (td_create_event, redefined from event_prep) ----------
drop function public.td_create_event(text, text, date, date, uuid, int, jsonb, boolean);
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
  insert into public.events (slug, name, starts_on, ends_on, club_name, skin, palette, rounds, waves, use_checkin, use_sponsors, course_layout_id)
  values (v_slug, btrim(p_name), p_starts, p_ends, nullif(btrim(coalesce(p_club, src.club_name, '')), ''),
          coalesce(src.skin, 'event'), coalesce(src.palette, 'cosmic'), coalesce(src.rounds, 1), coalesce(src.waves, 1),
          coalesce(src.use_checkin, true), coalesce(src.use_sponsors, false), src.course_layout_id)
  returning id into v_id;

  if p_copy_from is not null then
    insert into public.holes (event_id, n, par, dist_ft, ob, quote, rules)
      select v_id, n, par, dist_ft, ob, quote, rules from public.holes where event_id = p_copy_from;
    insert into public.divisions (event_id, code, sort, wave_default)
      select v_id, code, sort, wave_default from public.divisions where event_id = p_copy_from;
    insert into public.builder_settings (event_id, round, settings)
      select v_id, round, settings from public.builder_settings where event_id = p_copy_from;
    insert into public.event_tds (event_id, email)
      select v_id, email from public.event_tds where event_id = p_copy_from;
    insert into public.event_prize (event_id, credit_round, credit_label)
      select v_id, credit_round, credit_label from public.event_prize where event_id = p_copy_from;
    insert into public.division_payouts (event_id, div_code, currency, entry_fee, payback_pct, added_override, paid_places, pcts)
      select v_id, div_code, currency, entry_fee, payback_pct, added_override, paid_places, pcts
        from public.division_payouts where event_id = p_copy_from;
    insert into public.prep_tasks (event_id, title, category, due_offset_days, assignee, notes, sort)
      select v_id, title, category, due_offset_days, assignee, notes, sort from public.prep_tasks where event_id = p_copy_from;
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

revoke execute on function public.td_create_event(text, text, date, date, uuid, int, jsonb, boolean) from public, anon;
grant execute on function public.td_create_event(text, text, date, date, uuid, int, jsonb, boolean) to authenticated;

-- ---------- seed: the courses Bare Bones plays (2026-09-29) ----------
insert into public.courses (name, city, pdga_url, pdga_holes, notes, created_by) values
  ('Emerald Park', 'Mesa', 'https://www.pdga.com/course-directory/course/emerald-park', 9,
   'PDGA lists 9 baskets; the tee signs number 18 holes with A/B/C pins and long tees on 6, 9, 12, 13.', 'seed'),
  ('Freedom Park', 'Mesa', 'https://www.pdga.com/course-directory/course/stripe-show-golf-club', 18,
   'PDGA name: Freedom Disc Golf at Stripe Show Golf Club. Home of the Jewel.', 'seed'),
  ('Red Mountain - North', 'Mesa', 'https://www.pdga.com/course-directory/course/red-mountain-north', 18, null, 'seed'),
  ('Red Mountain - South', 'Mesa', 'https://www.pdga.com/course-directory/course/red-mountain-south', 18, null, 'seed'),
  ('Vista del Camino', 'Scottsdale', 'https://www.pdga.com/course-directory/course/vista-del-camino-park', 18,
   'Shelly Sharpe Memorial Disc Golf Course at Vista del Camino Park.', 'seed'),
  ('Papago', 'Tempe', null, null, 'PDGA name: Papago Disc Golf Course at Moeur Park.', 'seed'),
  ('Conocido Park', null, null, null, null, 'seed'),
  ('Sweetwater', null, null, null, null, 'seed'),
  ('Skunk Creek', null, null, null, null, 'seed'),
  ('Buffalo Ridge', null, null, null, null, 'seed')
on conflict do nothing;

-- Emerald Park from the Bare Bones tee sign artwork (2018). Three layouts: A pins, B pins, long tees (A pins).
do $$
declare c uuid; la uuid; lb uuid; ll uuid;
begin
  select id into c from public.courses where name = 'Emerald Park';
  insert into public.course_layouts (course_id, name, source, updated_by) values
    (c, 'A pins', 'Bare Bones tee signs, Emerald Park (2018 artwork)', 'seed') returning id into la;
  insert into public.course_layouts (course_id, name, source, updated_by) values
    (c, 'B pins', 'Bare Bones tee signs, Emerald Park (2018 artwork)', 'seed') returning id into lb;
  insert into public.course_layouts (course_id, name, source, updated_by) values
    (c, 'Long tees (A pins)', 'Bare Bones tee signs, Emerald Park (2018 artwork); long tees on 6, 9, 12, 13', 'seed') returning id into ll;

  -- n, A, B, long tee (lt, null = none), OB, rules
  create temp table em (n int, a int, b int, lt int, ob text, rules text[]) on commit drop;
  insert into em values
    (1, 276, 429, null, 'Sidewalk / street OB', '{}'),
    (2, 366, 378, null, 'Beyond fence OB', '{}'),
    (3, 264, 324, null, 'Beyond fence OB', '{}'),
    (4, 198, 315, null, 'Beyond fence / concrete OB', '{}'),
    (5, 240, 288, null, 'Sidewalk / parking lot / street OB', '{}'),
    (6, 306, 346, 475, 'Sidewalk / street OB', '{}'),
    (7, 273, 312, null, 'Marked OB area', array['Mandatory: left of the light pole']),
    (8, 300, 336, null, 'Over the wall OB', array['Do not climb walls']),
    (9, 267, 294, 357, 'Over the wall / street / sidewalk OB', array['Do not climb walls']),
    (10, 366, 393, null, 'Over the wall OB', array['Do not climb walls']),
    (11, 279, 321, null, 'Over the wall OB', array['Do not climb walls']),
    (12, 288, 312, 345, null, '{}'),
    (13, 287, 310, 383, 'Sidewalk / street OB', '{}'),
    (14, 228, 297, null, 'Marked OB area', '{}'),
    (15, 321, 387, null, 'Beyond fence / concrete OB', '{}'),
    (16, 279, 372, null, null, '{}'),
    (17, 231, 330, null, 'Beyond fence / sidewalk OB', '{}'),
    (18, 198, 210, null, 'Parking lot / sidewalk OB', array['Mandatory: right of the light pole']);
  insert into public.course_holes (layout_id, n, par, dist_ft, ob, rules) select la, n, 3, a, ob, rules from em;
  insert into public.course_holes (layout_id, n, par, dist_ft, ob, rules) select lb, n, 3, b, ob, rules from em;
  insert into public.course_holes (layout_id, n, par, dist_ft, ob, rules) select ll, n, 3, coalesce(lt, a), ob, rules from em;
end $$;

-- Freedom Park: the Jewel XI 2026 layout, verified (Mike confirmed the course guide 2026-09-28).
do $$
declare c uuid; l uuid; ev uuid;
begin
  select id into ev from public.events where slug = 'jewel-xi-2026';
  if ev is null then return; end if;
  select id into c from public.courses where name = 'Freedom Park';
  insert into public.course_layouts (course_id, name, source, verified_at, verified_by, updated_by)
  values (c, 'Jewel XI 2026 (20 holes)', 'YT & Beard course guide, confirmed by Mike 2026-09-28', now(), 'mike@yourmindsite.me', 'seed')
  returning id into l;
  insert into public.course_holes (layout_id, n, par, dist_ft, ob, rules)
    select l, n, par, dist_ft, left(ob, 200), rules from public.holes where event_id = ev;
  update public.events set course_layout_id = l where id = ev;
end $$;
