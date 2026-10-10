-- Dubs nights: format toggle, no cards / no swap, host posts team results, Board story, reads. Rolls back.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
begin;
create temp table f_ctx (k text primary key, v text) on commit drop;
grant all on f_ctx to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from f_ctx where k = key $$;
create or replace function pg_temp.mem(n text) returns uuid language sql security definer as $$ select id from tag_members where name = n $$;
create or replace function pg_temp.tok(n text) returns text language sql security definer as $$ select token from tag_members where name = n $$;
create or replace function pg_temp.m(n text) returns jsonb language sql as $$ select jsonb_build_object('member_id', pg_temp.mem(n)) $$;
grant execute on function pg_temp.v(text), pg_temp.mem(text), pg_temp.tok(text), pg_temp.m(text) to anon, authenticated;
insert into tag_pools (slug, name, sort, chat) values ('dubs-a', 'Dubs A', 96, true);
insert into tag_members (name) values ('Blake Dub'), ('Danny Dub'), ('Roger Dub'), ('Cole Dub'), ('Nick Dub');
insert into tags (pool_id, number, holder_id, status) select id, 1, pg_temp.mem('Blake Dub'), 'held' from tag_pools where slug = 'dubs-a';
insert into tags (pool_id, number, holder_id, status) select id, 2, pg_temp.mem('Danny Dub'), 'held' from tag_pools where slug = 'dubs-a';
insert into courses (name) values ('Dub Park');
insert into f_ctx values ('course', (select id::text from courses where name = 'Dub Park'));
select set_config('request.jwt.claims', '', false);
set client_min_messages = notice;

set role anon;
insert into f_ctx select 'n', tag_night_create(pg_temp.tok('Blake Dub'), 'Glow Dubs', now() - interval '30 minutes', pg_temp.v('course')::uuid, null)::text;
select tag_night_checkin(pg_temp.tok('Danny Dub'), pg_temp.v('n')::uuid, true);
select pg_temp.ok(pg_temp.refused(format('select tag_night_format(%L, %L, ''dubs'')', pg_temp.tok('Danny Dub'), pg_temp.v('n')), 'not_your_night'), 'only the host flips the format');
select tag_night_format(pg_temp.tok('Blake Dub'), pg_temp.v('n')::uuid, 'dubs');
select pg_temp.ok((select x ->> 'format' = 'dubs' from jsonb_array_elements(tag_nights(pg_temp.tok('Danny Dub'))) x where x ->> 'id' = pg_temp.v('n')), 'the night reads as dubs');
select pg_temp.ok(pg_temp.refused(format('select round_save(%L, %L)', pg_temp.tok('Danny Dub'),
  jsonb_build_object('course', 'Dub Park', 'played_on', current_date, 'pars', '[3,3]'::jsonb, 'night', pg_temp.v('n'),
    'players', jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Danny Dub'), 'scores', '[3,3]'::jsonb)))), 'night_dubs'), 'dubs: no Scorecard cards on the night');
select pg_temp.ok(pg_temp.refused(format('select tag_night_close(%L, %L)', pg_temp.tok('Blake Dub'), pg_temp.v('n')), 'night_dubs'), 'dubs closes with its results, not CLOSE THE NIGHT');
select pg_temp.ok(pg_temp.refused(format('select tag_night_results(%L, %L, %L, null)', pg_temp.tok('Blake Dub'), pg_temp.v('n'),
  jsonb_build_array(jsonb_build_object('to_par', -3, 'players', jsonb_build_array(pg_temp.m('Blake Dub'))))), 'teams_2_to_60'), 'at least 2 teams');
select pg_temp.ok(pg_temp.refused(format('select tag_night_results(%L, %L, %L, null)', pg_temp.tok('Blake Dub'), pg_temp.v('n'),
  jsonb_build_array(jsonb_build_object('to_par', -3, 'players', jsonb_build_array(pg_temp.m('Blake Dub'), pg_temp.m('Danny Dub'))),
                    jsonb_build_object('to_par', -1, 'players', jsonb_build_array(pg_temp.m('Danny Dub'), pg_temp.m('Cole Dub'))))), 'player_twice'), 'nobody on two teams');
-- the real results: Blake & Danny -9, Roger & a guest -7, Cole & Nick -7 (tie), a Cali (Glow Guy alone) -2
insert into f_ctx select 'res', tag_night_results(pg_temp.tok('Blake Dub'), pg_temp.v('n')::uuid, jsonb_build_array(
  jsonb_build_object('to_par', -7, 'players', jsonb_build_array(pg_temp.m('Roger Dub'), jsonb_build_object('guest_name', 'Uncle Gary'))),
  jsonb_build_object('to_par', -9, 'players', jsonb_build_array(pg_temp.m('Blake Dub'), pg_temp.m('Danny Dub'))),
  jsonb_build_object('to_par', -7, 'players', jsonb_build_array(pg_temp.m('Cole Dub'), pg_temp.m('Nick Dub'))),
  jsonb_build_object('to_par', -2, 'players', jsonb_build_array(jsonb_build_object('guest_name', 'Glow Guy')))), 'Glow sticks everywhere')::text;
reset role;
select pg_temp.ok((select array_agg((x ->> 'place')::int order by n) from jsonb_array_elements(pg_temp.v('res')::jsonb) with ordinality t(x, n)) = '{1,2,2,4}',
  'places from the scores, ties share (1, T2, T2, 4)');
select pg_temp.ok((select closed_at is not null and results_at is not null from tag_nights where id = pg_temp.v('n')::uuid), 'posting results closes the night');
select pg_temp.ok(not exists (select 1 from tag_matches where night_id = pg_temp.v('n')::uuid), 'no tag swap on a dubs night');
select pg_temp.ok(exists (select 1 from tag_night_players where night_id = pg_temp.v('n')::uuid and member_id = pg_temp.mem('Nick Dub')), 'members on a team are checked in');
select pg_temp.ok((select count(*) = 1 from tag_chat where pool_id = (select id from tag_pools where slug = 'dubs-a')
   and body like 'Glow Dubs (dubs at Dub Park): 1. Blake Dub & Danny Dub -9, T2. Roger Dub & Uncle Gary -7, T2. Cole Dub & Nick Dub -7, 4. Glow Guy -2.%'
   and body like '%Glow Guy%' and body like '%"Glow sticks everywhere"%'), 'the Board story: standings with ties, the margin, the last-place roast, the note');
set role anon;
select tag_night_results(pg_temp.tok('Blake Dub'), pg_temp.v('n')::uuid, jsonb_build_array(
  jsonb_build_object('to_par', -10, 'players', jsonb_build_array(pg_temp.m('Blake Dub'), pg_temp.m('Danny Dub'))),
  jsonb_build_object('to_par', -7, 'players', jsonb_build_array(pg_temp.m('Roger Dub'), jsonb_build_object('guest_name', 'Uncle Gary'))),
  jsonb_build_object('to_par', -7, 'players', jsonb_build_array(pg_temp.m('Cole Dub'), pg_temp.m('Nick Dub'))),
  jsonb_build_object('to_par', -2, 'players', jsonb_build_array(jsonb_build_object('guest_name', 'Glow Guy')))), null);
reset role;
select pg_temp.ok((select count(*) = 1 from tag_chat where body like 'Glow Dubs (dubs%') and (select to_par = -10 from tag_night_teams where night_id = pg_temp.v('n')::uuid and place = 1),
  'posting again fixes the numbers, no second Board story');
set role anon;
select pg_temp.ok((select x -> 'results' -> 0 ->> 'to_par' = '-10' and x ->> 'format' = 'dubs' from jsonb_array_elements(live_upcoming()) x where x ->> 'id' = pg_temp.v('n')),
  'Boner Rounds: the night shows FINAL with its standings');
select pg_temp.ok((select r ->> 'kind' = 'night' and jsonb_array_length(r -> 'teams') = 4 from jsonb_array_elements(tag_my_rounds(pg_temp.tok('Nick Dub')) -> 'rounds') r limit 1),
  'MY ROUNDS: the night is in each team member''s list');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(tag_my_rounds(pg_temp.tok('Blake Dub')) -> 'rounds') r where r ->> 'kind' = 'night' and r ->> 'id' <> pg_temp.v('n')), 'only nights you played');
-- flipping to dubs is refused once a singles card is in
insert into f_ctx select 'n2', tag_night_create(pg_temp.tok('Danny Dub'), 'Singles Glow', now() - interval '10 minutes', pg_temp.v('course')::uuid, null, 'singles')::text;
select round_save(pg_temp.tok('Danny Dub'), jsonb_build_object('course', 'Dub Park', 'played_on', current_date, 'pars', '[3,3]'::jsonb, 'night', pg_temp.v('n2'),
  'players', jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Danny Dub'), 'scores', '[3,3]'::jsonb))));
select pg_temp.ok(pg_temp.refused(format('select tag_night_format(%L, %L, ''dubs'')', pg_temp.tok('Danny Dub'), pg_temp.v('n2')), 'night_closed'), 'singles night that closed itself can''t flip');
select pg_temp.ok(pg_temp.refused(format('select tag_night_results(%L, %L, ''[]'', null)', pg_temp.tok('Danny Dub'), pg_temp.v('n2')), 'not_dubs'), 'results are for dubs nights');
insert into f_ctx select 'n3', tag_night_create(pg_temp.tok('Blake Dub'), 'Dubs From Start', now() + interval '1 hour', pg_temp.v('course')::uuid, null, 'dubs')::text;
reset role;
select pg_temp.ok((select format = 'dubs' from tag_nights where id = pg_temp.v('n3')::uuid), 'a night can start as dubs');
update tag_nights set starts_at = now() - interval '13 hours' where id = pg_temp.v('n3')::uuid;
select tag_night_tick();
select pg_temp.ok((select closed_at is not null from tag_nights where id = pg_temp.v('n3')::uuid) and not exists (select 1 from tag_matches where night_id = pg_temp.v('n3')::uuid),
  'the clock closes a dubs night without results quietly');
rollback;
