-- Trophy rooms: room type in league setup, the week's podium (doubles + singles, playoffs, the in-progress gate). Rolls back.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.claims(sub text, admin boolean) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', sub, 'app_metadata', case when admin then '{"role":"td"}'::json else '{}'::json end)::text, false) $$;
begin;
create temp table x_ctx (k text primary key, v text) on commit drop;
grant all on x_ctx to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from x_ctx where k = key $$;
grant execute on function pg_temp.v(text) to anon, authenticated;
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000d0c01', 'trophy-boss@tr.test', now()),
  ('00000000-0000-4000-8000-0000000d0c02', 'trophy-td@tr.test', now())
on conflict do nothing;
insert into courses (name) values ('Trophy Course');
insert into course_layouts (course_id, name) select id, 'Trophy 22' from courses where name = 'Trophy Course';
insert into course_holes (layout_id, n, par) select (select id from course_layouts where name = 'Trophy 22'), g, 3 from generate_series(1, 22) g;
insert into x_ctx values ('layout', (select id::text from course_layouts where name = 'Trophy 22'));
create or replace function pg_temp.pid(ev text, n text) returns uuid language sql as $$ select id from players where event_id = ev::uuid and name = n $$;
set client_min_messages = notice;

select pg_temp.claims('00000000-0000-4000-8000-0000000d0c01', true); set role authenticated;
insert into x_ctx select 'lg', td_create_league('Glow Room', 'glow-room', false)::text;
insert into x_ctx select 'sg', td_create_league('Singles Room', 'singles-room', false)::text;
reset role;
insert into tag_pool_admins (pool_id, email) select tag_pool_id, 'trophy-td@tr.test' from leagues where id in (pg_temp.v('lg')::uuid, pg_temp.v('sg')::uuid);
select pg_temp.ok((select trophy_room is null from leagues where id = pg_temp.v('lg')::uuid), 'a new league has no trophy room');

-- the league TD picks the room
select pg_temp.claims('00000000-0000-4000-8000-0000000d0c02', false); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select td_save_league(%L, ''{"trophy_room":"shrine"}'')', pg_temp.v('lg')), 'invalid_trophy_room'), 'single or podium only');
select pg_temp.ok(pg_temp.refused(format('select td_save_league(%L, ''{"trophy_room":"single"}'')', pg_temp.v('lg')), 'award_needed'), 'a single prize needs its name');
select td_save_league(pg_temp.v('lg')::uuid, '{"trophy_room":"single","award":"Glow Stick"}');
select pg_temp.ok((select trophy_room = 'single' and award = 'Glow Stick' from leagues where id = pg_temp.v('lg')::uuid), 'single prize + its name in one save');
select pg_temp.ok(pg_temp.refused(format('select td_save_league(%L, ''{"award":""}'')', pg_temp.v('lg')), 'award_needed'), 'can''t blank the name of a single prize');
select td_save_league(pg_temp.v('lg')::uuid, jsonb_build_object('trophy_room', 'podium', 'award', '', 'week_format', 'doubles', 'week_layout_id', pg_temp.v('layout')));
select pg_temp.ok((select trophy_room = 'podium' and award is null from leagues where id = pg_temp.v('lg')::uuid), 'a podium needs no name');
select td_save_league(pg_temp.v('sg')::uuid, jsonb_build_object('trophy_room', 'podium', 'week_format', 'singles', 'week_layout_id', pg_temp.v('layout')));
insert into x_ctx select 'w1', (td_league_new_week(pg_temp.v('lg')::uuid, '2026-10-16', null, true, 18, '[{"code":"MIXED"}]') ->> 'id');
insert into x_ctx select 's1', (td_league_new_week(pg_temp.v('sg')::uuid, '2026-10-16', null, true, 18, '[{"code":"MA1"},{"code":"MA2"}]') ->> 'id');
reset role;

-- doubles week tonight: Danny+Roger -18, Saul+Jaden -18, Blake+Cole -13, Megan (Cali) -10; Jerry+Lincoln still on hole 2
update events set starts_on = current_date, ends_on = current_date where id = pg_temp.v('w1')::uuid;
insert into players (event_id, name, div_code) select pg_temp.v('w1')::uuid, n, 'MIXED'
  from unnest(array['Danny', 'Roger', 'Saul', 'Jaden', 'Blake', 'Cole', 'Megan', 'Jerry', 'Lincoln']) n;
insert into teams (event_id, round, team_no, player_a, player_b) values
  (pg_temp.v('w1')::uuid, 1, 1, pg_temp.pid(pg_temp.v('w1'), 'Danny'), pg_temp.pid(pg_temp.v('w1'), 'Roger')),
  (pg_temp.v('w1')::uuid, 1, 2, pg_temp.pid(pg_temp.v('w1'), 'Saul'), pg_temp.pid(pg_temp.v('w1'), 'Jaden')),
  (pg_temp.v('w1')::uuid, 1, 3, pg_temp.pid(pg_temp.v('w1'), 'Blake'), pg_temp.pid(pg_temp.v('w1'), 'Cole')),
  (pg_temp.v('w1')::uuid, 1, 4, pg_temp.pid(pg_temp.v('w1'), 'Megan'), null),
  (pg_temp.v('w1')::uuid, 1, 5, pg_temp.pid(pg_temp.v('w1'), 'Jerry'), pg_temp.pid(pg_temp.v('w1'), 'Lincoln'));
insert into paper_totals (player_id, round, strokes) values
  (pg_temp.pid(pg_temp.v('w1'), 'Danny'), 1, 48), (pg_temp.pid(pg_temp.v('w1'), 'Saul'), 1, 48),
  (pg_temp.pid(pg_temp.v('w1'), 'Blake'), 1, 53), (pg_temp.pid(pg_temp.v('w1'), 'Megan'), 1, 56);
insert into scores (player_id, round, hole, strokes, client_ts, device_id) values
  (pg_temp.pid(pg_temp.v('w1'), 'Jerry'), 1, 1, 3, now(), 'x'), (pg_temp.pid(pg_temp.v('w1'), 'Jerry'), 1, 2, 2, now(), 'x');

set role anon;
select pg_temp.ok((select jsonb_array_length(league_trophy_room('glow-room') -> 'weeks') = 0), 'a card still out on the course holds tonight''s podium');
reset role;
delete from scores where player_id = pg_temp.pid(pg_temp.v('w1'), 'Jerry');
insert into paper_totals (player_id, round, strokes) values (pg_temp.pid(pg_temp.v('w1'), 'Jerry'), 1, 61);
set role anon;
select pg_temp.ok((select array_agg((x ->> 'place') || ':' || (x ->> 'to_par') || ':' || (x -> 'entries')::text order by n)
  from jsonb_array_elements(league_trophy_room('glow-room') -> 'weeks' -> 0 -> 'podium') with ordinality t(x, n)) =
  array['1:-18:[["Danny", "Roger"], ["Saul", "Jaden"]]', '3:-13:[["Blake", "Cole"]]'],
  'all in: a tie for 1st shares the top step, the next team is 3rd, 4th and 5th are off the podium');
reset role;

-- the playoff settles it
insert into playoffs (event_id, div_code, winner_player_id) values (pg_temp.v('w1')::uuid, 'TEAMS-R1', pg_temp.pid(pg_temp.v('w1'), 'Danny'));
set role anon;
select pg_temp.ok((select array_agg((x ->> 'place') || ':' || (x -> 'entries')::text order by n)
  from jsonb_array_elements(league_trophy_room('glow-room') -> 'weeks' -> 0 -> 'podium') with ordinality t(x, n)) =
  array['1:[["Danny", "Roger"]]', '2:[["Saul", "Jaden"]]', '3:[["Blake", "Cole"]]'], 'the playoff winner takes 1st, the tie drops to 2nd');
select pg_temp.ok((select (r -> 'league' ->> 'trophy_room') = 'podium' and (r -> 'mvp' ->> 'weeks')::int = 1 and r -> 'weeks' -> 0 ->> 'course' = 'Trophy Course'
  from league_trophy_room('glow-room') r), 'the room carries its type, the course and the MVP board');
reset role;

-- a week that has passed shows what's complete, even with a walk-off
select pg_temp.claims('00000000-0000-4000-8000-0000000d0c02', false); set role authenticated;
insert into x_ctx select 'w0', (td_league_new_week(pg_temp.v('lg')::uuid, '2026-10-02', null, true, 18, '[{"code":"MIXED"}]') ->> 'id');
reset role;
update events set starts_on = current_date - 7, ends_on = current_date - 7 where id = pg_temp.v('w0')::uuid;
insert into players (event_id, name, div_code) select pg_temp.v('w0')::uuid, n, 'MIXED' from unnest(array['Ann', 'Bo', 'Cy', 'Di']) n
  on conflict do nothing;
delete from teams where event_id = pg_temp.v('w0')::uuid;
insert into teams (event_id, round, team_no, player_a, player_b) values
  (pg_temp.v('w0')::uuid, 1, 1, pg_temp.pid(pg_temp.v('w0'), 'Ann'), pg_temp.pid(pg_temp.v('w0'), 'Bo')),
  (pg_temp.v('w0')::uuid, 1, 2, pg_temp.pid(pg_temp.v('w0'), 'Cy'), pg_temp.pid(pg_temp.v('w0'), 'Di'));
insert into paper_totals (player_id, round, strokes) values (pg_temp.pid(pg_temp.v('w0'), 'Ann'), 1, 60);
insert into scores (player_id, round, hole, strokes, client_ts, device_id) values (pg_temp.pid(pg_temp.v('w0'), 'Cy'), 1, 1, 3, now(), 'x');
set role anon;
select pg_temp.ok((select jsonb_array_length(r -> 'weeks') = 2 and r -> 'weeks' -> 0 ->> 'starts_on' = current_date::text
   and (r -> 'weeks' -> 1 -> 'podium')::text = '[{"place": 1, "to_par": -6, "entries": [["Ann", "Bo"]]}]'
  from league_trophy_room('glow-room') r), 'newest first; last week''s walk-off doesn''t hold its podium');
reset role;

-- singles week: the top division only, its own playoff
update events set starts_on = current_date, ends_on = current_date where id = pg_temp.v('s1')::uuid;
insert into players (event_id, name, div_code) values
  (pg_temp.v('s1')::uuid, 'Ace', 'MA1'), (pg_temp.v('s1')::uuid, 'Bee', 'MA1'), (pg_temp.v('s1')::uuid, 'Cee', 'MA1'),
  (pg_temp.v('s1')::uuid, 'Dee', 'MA1'), (pg_temp.v('s1')::uuid, 'Rook', 'MA2');
insert into paper_totals (player_id, round, strokes) values
  (pg_temp.pid(pg_temp.v('s1'), 'Ace'), 1, 60), (pg_temp.pid(pg_temp.v('s1'), 'Bee'), 1, 62), (pg_temp.pid(pg_temp.v('s1'), 'Cee'), 1, 62),
  (pg_temp.pid(pg_temp.v('s1'), 'Dee'), 1, 64), (pg_temp.pid(pg_temp.v('s1'), 'Rook'), 1, 50);
set role anon;
select pg_temp.ok((select array_agg((x ->> 'place') || ':' || (x -> 'entries')::text order by n)
  from jsonb_array_elements(league_trophy_room('singles-room') -> 'weeks' -> 0 -> 'podium') with ordinality t(x, n)) =
  array['1:[["Ace"]]', '2:[["Bee"], ["Cee"]]'], 'singles: the top division (MA2''s hot round isn''t on it); a tie for 2nd shares the step');
reset role;
update leagues set hidden = true where id = pg_temp.v('sg')::uuid;
set role anon;
select pg_temp.ok(league_trophy_room('singles-room') is null and league_trophy_room('nope') is null, 'hidden or unknown league: no room');
reset role;
rollback;
