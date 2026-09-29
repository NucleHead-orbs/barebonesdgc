-- Course library acceptance tests. Run after stub + all migrations.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create temp table c_ctx (k text primary key, v text);
grant all on c_ctx to anon, authenticated;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.claims(sub text, admin boolean) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', sub, 'app_metadata', case when admin then '{"role":"td"}'::json else '{}'::json end)::text, false) $$;
create or replace function pg_temp.lay(course text, layout text) returns uuid language sql as $$
  select l.id from course_layouts l join courses c on c.id = l.course_id where c.name = course and l.name = layout $$;
grant execute on function pg_temp.lay(text, text) to anon, authenticated;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000a3', 'c-boss@club.test', now()),
  ('00000000-0000-4000-8000-0000000000b3', 'c-league@club.test', now()),
  ('00000000-0000-4000-8000-0000000000c3', 'c-other@club.test', now()),
  ('00000000-0000-4000-8000-0000000000d3', 'c-nobody@club.test', now())
on conflict do nothing;

select pg_temp.claims('00000000-0000-4000-8000-0000000000a3', true); set role authenticated;
insert into c_ctx select 'ev', td_create_event('Course Night', 'Club', '2026-10-05', '2026-10-05', null, 9, '[{"code":"MA1"}]')->>'id';
insert into c_ctx select 'ev2', td_create_event('Other Night', 'Club', '2026-10-05', '2026-10-05', null, 9, '[{"code":"MA1"}]')->>'id';
insert into event_tds (event_id, email) select v::uuid, 'c-league@club.test' from c_ctx where k = 'ev';
insert into event_tds (event_id, email) select v::uuid, 'c-other@club.test' from c_ctx where k = 'ev2';
reset role;
set client_min_messages = notice;

-- ===== seed =====
select pg_temp.ok((select count(*) = 10 from courses), 'seed: the 10 courses the club plays');
select pg_temp.ok((select count(*) = 3 from course_layouts l join courses c on c.id = l.course_id where c.name = 'Emerald Park'), 'seed: Emerald Park has 3 layouts');
select pg_temp.ok((select count(*) = 54 and bool_and(par = 3) from course_holes where layout_id in
  (select l.id from course_layouts l join courses c on c.id = l.course_id where c.name = 'Emerald Park')), 'seed: Emerald 3 x 18 holes, all par 3');
select pg_temp.ok((select dist_ft = 276 from course_holes where layout_id = pg_temp.lay('Emerald Park', 'A pins') and n = 1)
              and (select dist_ft = 429 from course_holes where layout_id = pg_temp.lay('Emerald Park', 'B pins') and n = 1)
              and (select dist_ft = 475 from course_holes where layout_id = pg_temp.lay('Emerald Park', 'Long tees (A pins)') and n = 6)
              and (select dist_ft = 276 from course_holes where layout_id = pg_temp.lay('Emerald Park', 'Long tees (A pins)') and n = 1),
  'seed: Emerald distances match the tee signs (A, B, long tee falls back to A)');
select pg_temp.ok((select rules = array['Mandatory: left of the light pole'] from course_holes where layout_id = pg_temp.lay('Emerald Park', 'A pins') and n = 7),
  'seed: Emerald 7 carries its mando');
select pg_temp.ok((select verified_at is not null from course_layouts where id = pg_temp.lay('Freedom Park', 'Jewel XI 2026 (20 holes)'))
              and (select count(*) = 20 and sum(par) = 62 from course_holes where layout_id = pg_temp.lay('Freedom Park', 'Jewel XI 2026 (20 holes)')),
  'seed: Freedom Jewel XI layout is verified, 20 holes, par 62');
select pg_temp.ok((select course_layout_id = pg_temp.lay('Freedom Park', 'Jewel XI 2026 (20 holes)') from events where slug = 'jewel-xi-2026'),
  'seed: Jewel XI event points at its layout');

-- ===== who can read / write =====
set role anon;
select pg_temp.ok((select count(*) = 10 from courses) and (select count(*) > 0 from course_holes), 'anon: can read the library');
select pg_temp.ok(pg_temp.refused('insert into courses (name) values (''Anon Park'')', 'permission denied'), 'anon: cannot add a course');
select pg_temp.ok(pg_temp.refused(format('select td_save_layout(%L, null, ''x'', ''[{"n":1,"par":3}]'')', (select id from courses where name = 'Sweetwater')), 'permission denied'),
  'anon: cannot save a layout');
reset role;

select pg_temp.claims('00000000-0000-4000-8000-0000000000d3', false); set role authenticated;
select pg_temp.ok(pg_temp.refused('insert into courses (name) values (''Nobody Park'')', 'row-level security'), 'signed-in non-TD: cannot add a course');
select pg_temp.ok(pg_temp.refused(format('select td_save_layout(%L, null, ''x'', ''[{"n":1,"par":3}]'')', (select id from courses where name = 'Sweetwater')), 'forbidden'),
  'signed-in non-TD: cannot save a layout');
reset role;

-- ===== an event TD builds the library =====
select pg_temp.claims('00000000-0000-4000-8000-0000000000b3', false); set role authenticated;
insert into courses (name, city, created_by) values ('Test Hills', 'Mesa', 'c-league@club.test');
select pg_temp.ok(pg_temp.refused('insert into courses (name) values (''  test hills '')', 'duplicate'), 'course names are unique (case/space-insensitive)');
insert into c_ctx select 'sw', td_save_layout((select id from courses where name = 'Sweetwater'), null, 'Main',
  '[{"n":1,"par":3,"dist_ft":250,"ob":"Road","rules":["Mando left"," "]},{"n":2,"par":4,"dist_ft":480}]', 'Walked it 2026-09-29')::text;
select pg_temp.ok(pg_temp.refused(format('select td_save_layout(%L, null, ''Bad'', ''[{"n":1,"par":7}]'')', (select id from courses where name = 'Sweetwater')), 'invalid_holes'),
  'par outside 2..6 refused');
select pg_temp.ok(pg_temp.refused(format('select td_save_layout(%L, null, ''Gap'', ''[{"n":1,"par":3},{"n":3,"par":3}]'')', (select id from courses where name = 'Sweetwater')), 'invalid_holes'),
  'holes must be 1..n with no gaps');
select pg_temp.ok(pg_temp.refused(format('select td_verify_layout(%L, true)', (select v from c_ctx where k = 'sw')), 'forbidden'), 'event TD: cannot verify');
reset role;
select pg_temp.ok((select count(*) = 2 from course_holes where layout_id = (select v::uuid from c_ctx where k = 'sw')), 'TD saved a 2-hole layout');
select pg_temp.ok((select rules = array['Mando left'] from course_holes where layout_id = (select v::uuid from c_ctx where k = 'sw') and n = 1), 'blank rules dropped');
select pg_temp.ok((select updated_by = 'c-league@club.test' and verified_at is null from course_layouts where id = (select v::uuid from c_ctx where k = 'sw')), 'saved by, unverified');

-- super admin verifies; a TD edit clears it; an admin edit keeps it
select pg_temp.claims('00000000-0000-4000-8000-0000000000a3', true); set role authenticated;
select td_verify_layout((select v::uuid from c_ctx where k = 'sw'), true);
reset role;
select pg_temp.ok((select verified_by = 'c-boss@club.test' from course_layouts where id = (select v::uuid from c_ctx where k = 'sw')), 'super admin verified it');
select pg_temp.claims('00000000-0000-4000-8000-0000000000b3', false); set role authenticated;
select td_save_layout((select id from courses where name = 'Sweetwater'), (select v::uuid from c_ctx where k = 'sw'), 'Main',
  '[{"n":1,"par":3,"dist_ft":255},{"n":2,"par":4,"dist_ft":480},{"n":3,"par":3}]');
reset role;
select pg_temp.ok((select verified_at is null from course_layouts where id = (select v::uuid from c_ctx where k = 'sw'))
              and (select count(*) = 3 from course_holes where layout_id = (select v::uuid from c_ctx where k = 'sw')),
  'TD edit replaces the holes and clears verification');
select pg_temp.claims('00000000-0000-4000-8000-0000000000a3', true); set role authenticated;
select td_verify_layout((select v::uuid from c_ctx where k = 'sw'), true);
select td_save_layout((select id from courses where name = 'Sweetwater'), (select v::uuid from c_ctx where k = 'sw'), 'Main',
  '[{"n":1,"par":3,"dist_ft":255},{"n":2,"par":4,"dist_ft":480},{"n":3,"par":3,"dist_ft":300}]');
reset role;
select pg_temp.ok((select verified_at is not null from course_layouts where id = (select v::uuid from c_ctx where k = 'sw')), 'admin edit keeps verification');

-- ===== apply a layout to an event =====
select pg_temp.claims('00000000-0000-4000-8000-0000000000b3', false); set role authenticated;
select pg_temp.ok(td_apply_layout((select v::uuid from c_ctx where k = 'ev'), pg_temp.lay('Emerald Park', 'A pins')) = 18, 'TD applies Emerald A pins to their event');
select pg_temp.ok(pg_temp.refused(format('select td_apply_layout(%L, %L)', (select v from c_ctx where k = 'ev2'), pg_temp.lay('Emerald Park', 'A pins')), 'forbidden'),
  'TD cannot apply a layout to someone else''s event');
reset role;
select pg_temp.ok((select count(*) = 18 from holes where event_id = (select v::uuid from c_ctx where k = 'ev')), 'event now has 18 holes');
select pg_temp.ok((select dist_ft = 276 and ob = 'Sidewalk / street OB' from holes where event_id = (select v::uuid from c_ctx where k = 'ev') and n = 1)
              and (select rules = array['Mandatory: left of the light pole'] from holes where event_id = (select v::uuid from c_ctx where k = 'ev') and n = 7),
  'event holes copied with feet, OB and mandos');
select pg_temp.ok((select course_layout_id = pg_temp.lay('Emerald Park', 'A pins') from events where id = (select v::uuid from c_ctx where k = 'ev')), 'event remembers its layout');

-- library edits never touch the event
select pg_temp.claims('00000000-0000-4000-8000-0000000000b3', false); set role authenticated;
select td_save_layout((select id from courses where name = 'Emerald Park'), pg_temp.lay('Emerald Park', 'A pins'), 'A pins',
  (select jsonb_agg(jsonb_build_object('n', n, 'par', par, 'dist_ft', dist_ft + 1, 'ob', ob, 'rules', to_jsonb(rules)) order by n)
     from course_holes where layout_id = pg_temp.lay('Emerald Park', 'A pins')));
reset role;
select pg_temp.ok((select dist_ft = 277 from course_holes where layout_id = pg_temp.lay('Emerald Park', 'A pins') and n = 1)
              and (select dist_ft = 276 from holes where event_id = (select v::uuid from c_ctx where k = 'ev') and n = 1),
  'editing the library later leaves the event unchanged');

-- a shorter layout can't strand a card
insert into cards (event_id, round, wave, start_hole, group_no, label) select v::uuid, 1, 'AM', 12, 1, '12' from c_ctx where k = 'ev';
select pg_temp.claims('00000000-0000-4000-8000-0000000000b3', false); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select td_apply_layout(%L, %L)', (select v from c_ctx where k = 'ev'), (select v from c_ctx where k = 'sw')), 'holes_have_cards'),
  'a 3-hole layout is refused while a card starts on hole 12');
reset role;
select pg_temp.ok((select count(*) = 18 from holes where event_id = (select v::uuid from c_ctx where k = 'ev')), 'refused apply changed nothing');

-- duplicate keeps the link
select pg_temp.claims('00000000-0000-4000-8000-0000000000b3', false); set role authenticated;
insert into c_ctx select 'wk2', td_create_event('Course Night', null, '2026-10-12', '2026-10-12', (select v::uuid from c_ctx where k = 'ev'), 18, '[]', false)->>'id';
reset role;
select pg_temp.ok((select course_layout_id = pg_temp.lay('Emerald Park', 'A pins') from events where id = (select v::uuid from c_ctx where k = 'wk2')), 'duplicate carries the layout link');

-- deleting a layout un-links events, never deletes them
delete from course_layouts where id = pg_temp.lay('Emerald Park', 'B pins');
select pg_temp.ok((select count(*) = 2 from course_layouts l join courses c on c.id = l.course_id where c.name = 'Emerald Park'), 'layout delete cascades its holes only');

\echo ALL COURSE TESTS PASSED
