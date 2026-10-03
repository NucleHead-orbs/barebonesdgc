-- Hole labels acceptance tests. Run after stub + all migrations (and 99z_club_rounds, which issues the test members).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.tok(n text) returns text language sql security definer as $$ select token from tag_members where name = n $$;
create or replace function pg_temp.mem(n text) returns uuid language sql as $$ select id from tag_members where name = n $$;
grant execute on function pg_temp.tok(text), pg_temp.mem(text) to anon, authenticated;
create temp table l_ctx (k text primary key, v text);
grant all on l_ctx to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from l_ctx where k = key $$;
grant execute on function pg_temp.v(text) to anon, authenticated;
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-4000-8000-0000000000ab', 'l-boss@club.test', now()) on conflict do nothing;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000ab', 'app_metadata', '{"role":"td"}'::json)::text, false);
insert into courses (name) values ('Label Park') on conflict do nothing;
set client_min_messages = notice;

set role authenticated;
insert into l_ctx select 'lay', td_save_layout((select id from courses where name = 'Label Park'), null, 'Outside Ring',
  '[{"n":1,"par":3,"label":"1"},{"n":2,"par":4,"label":"A","dist_ft":575},{"n":3,"par":3,"label":"14"}]'::jsonb, 'test')::text;
select pg_temp.ok((select array_agg(label order by n) = '{1,A,14}' from course_holes where layout_id = pg_temp.v('lay')::uuid), 'layout keeps its hole labels');
select pg_temp.ok(pg_temp.refused($q$select td_save_layout((select id from courses where name = 'Label Park'), null, 'Bad', '[{"n":1,"par":3,"label":"Hole 1"}]'::jsonb, null)$q$, 'invalid_holes'),
  'labels are 1-4 letters/digits');
insert into l_ctx select 'lay2', td_save_layout((select id from courses where name = 'Label Park'), null, 'Plain', '[{"n":1,"par":3},{"n":2,"par":3}]'::jsonb, null)::text;
select pg_temp.ok((select bool_and(label is null) from course_holes where layout_id = pg_temp.v('lay2')::uuid), 'no label in the payload = no label');
reset role;

set role anon;
insert into l_ctx select 'r', round_save(pg_temp.tok('Rex'), jsonb_build_object('course', 'Label Park', 'played_on', current_date, 'pars', '[3,4,3]'::jsonb,
  'labels', '["1","A","14"]'::jsonb, 'players', jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Rex'), 'scores', '[3,4,2]'::jsonb))))::text;
select pg_temp.ok((select hole_labels = '{1,A,14}' and pars = '{3,4,3}' from club_rounds where id = pg_temp.v('r')::uuid), 'a round keeps the labels it was played with');
insert into l_ctx select 'r2', round_save(pg_temp.tok('Rex'), jsonb_build_object('course', 'Label Park', 'played_on', current_date, 'pars', '[3,3]'::jsonb,
  'labels', '["1","2"]'::jsonb, 'players', jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Rex'), 'scores', '[3,3]'::jsonb))))::text;
select pg_temp.ok((select hole_labels is null from club_rounds where id = pg_temp.v('r2')::uuid), 'plain 1..n labels are stored as none');
select pg_temp.ok(pg_temp.refused(format($q$select round_save(%L, jsonb_build_object('course', 'Label Park', 'played_on', current_date, 'pars', '[3,3]'::jsonb,
  'labels', '["1"]'::jsonb, 'players', jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Rex'), 'scores', '[3,3]'::jsonb))))$q$, pg_temp.tok('Rex')), 'invalid_labels'),
  'labels must match the hole count');
reset role;
