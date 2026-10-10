-- Tagless leagues, week defaults (doubles + a layout), MVP wins board. Rolls back.
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
  ('00000000-0000-4000-8000-0000000d0b01', 'dubs-boss@lt.test', now()),
  ('00000000-0000-4000-8000-0000000d0b02', 'dubs-td@lt.test', now())
on conflict do nothing;
insert into courses (name) values ('Glow Course');
insert into course_layouts (course_id, name) select id, 'Glow 22' from courses where name = 'Glow Course';
insert into course_holes (layout_id, n, par) select (select id from course_layouts where name = 'Glow 22'), g, 3 from generate_series(1, 22) g;
insert into x_ctx values ('layout', (select id::text from course_layouts where name = 'Glow 22'));
set client_min_messages = notice;

-- a tagless league
select pg_temp.claims('00000000-0000-4000-8000-0000000d0b01', true); set role authenticated;
insert into x_ctx select 'lg', td_create_league('Friday Glow', 'friday-glow', false)::text;
insert into x_ctx select 'tagged', td_create_league('Tagged Up', 'tagged-up')::text;
reset role;
insert into x_ctx select 'pool', tag_pool_id::text from leagues where id = pg_temp.v('lg')::uuid;
select pg_temp.ok((select not l.tags and tp.hidden from leagues l join tag_pools tp on tp.id = l.tag_pool_id where l.id = pg_temp.v('lg')::uuid),
  'tags off: the league''s set exists but is hidden');
select pg_temp.ok((select l.tags and not tp.hidden from leagues l join tag_pools tp on tp.id = l.tag_pool_id where l.id = pg_temp.v('tagged')::uuid),
  'the old create still makes a league with tags');
insert into tag_members (name) values ('Tagless Tom');
select pg_temp.ok(pg_temp.refused(format('insert into tags (pool_id, number, holder_id, status) values (%L, 1, (select id from tag_members where name = ''Tagless Tom''), ''held'')', pg_temp.v('pool')), 'tags_off'),
  'no tag can go into a hidden set');
select pg_temp.ok(pg_temp.refused(format('insert into tag_matches (pool_id, source, status) values (%L, ''casual'', ''pending'')', pg_temp.v('pool')), 'tags_off'),
  'no tag round in a hidden set either');
insert into tag_pool_admins (pool_id, email) values (pg_temp.v('pool')::uuid, 'dubs-td@lt.test');

-- the league TD sets the week defaults
select pg_temp.claims('00000000-0000-4000-8000-0000000d0b02', false); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select td_save_league(%L, ''{"week_format":"triples"}'')', pg_temp.v('lg')), 'invalid_format'), 'format is singles or doubles');
select td_save_league(pg_temp.v('lg')::uuid, jsonb_build_object('week_format', 'doubles', 'week_layout_id', pg_temp.v('layout')));
select pg_temp.ok((select week_format = 'doubles' and week_layout_id::text = pg_temp.v('layout') from leagues where id = pg_temp.v('lg')::uuid), 'a league TD saves the week format + layout');
-- first week: doubles on the 22-hole layout, no prior week
insert into x_ctx select 'w1', (td_league_new_week(pg_temp.v('lg')::uuid, '2026-10-16', null, true, 18, '[{"code":"MA1"}]') ->> 'id');
reset role;
select pg_temp.ok((select r1_format = 'doubles' and course_layout_id::text = pg_temp.v('layout') from events where id = pg_temp.v('w1')::uuid)
  and (select count(*) = 22 from holes where event_id = pg_temp.v('w1')::uuid), 'week 1: doubles, 22 holes from the league''s layout');
select pg_temp.ok((select tag_pool_id::text = pg_temp.v('pool') from events where id = pg_temp.v('w1')::uuid), 'the week belongs to the league (its hidden set)');

-- week 1 results: 3 teams (one a Cali), paper totals on the captains; par 66
insert into players (event_id, name, div_code) select pg_temp.v('w1')::uuid, n, 'MA1' from unnest(array['Blake', 'Danny', 'Roger', 'Saul', 'Jaden', 'Cole']) n;
create or replace function pg_temp.pid(ev text, n text) returns uuid language sql as $$ select id from players where event_id = ev::uuid and name = n $$;
insert into teams (event_id, round, team_no, player_a, player_b) values
  (pg_temp.v('w1')::uuid, 1, 1, pg_temp.pid(pg_temp.v('w1'), 'Danny'), pg_temp.pid(pg_temp.v('w1'), 'Roger')),
  (pg_temp.v('w1')::uuid, 1, 2, pg_temp.pid(pg_temp.v('w1'), 'Saul'), pg_temp.pid(pg_temp.v('w1'), 'Jaden')),
  (pg_temp.v('w1')::uuid, 1, 3, pg_temp.pid(pg_temp.v('w1'), 'Blake'), pg_temp.pid(pg_temp.v('w1'), 'Cole'));
insert into paper_totals (player_id, round, strokes) values
  (pg_temp.pid(pg_temp.v('w1'), 'Danny'), 1, 48), (pg_temp.pid(pg_temp.v('w1'), 'Saul'), 1, 52), (pg_temp.pid(pg_temp.v('w1'), 'Blake'), 1, 53);

-- week 2 copies week 1 (players too) and still gets the league's format + layout; redraw: Blake + Saul win, Danny + Jaden, Cole alone
select pg_temp.claims('00000000-0000-4000-8000-0000000d0b02', false); set role authenticated;
insert into x_ctx select 'w2', (td_league_new_week(pg_temp.v('lg')::uuid, '2026-10-23') ->> 'id');
reset role;
select pg_temp.ok((select r1_format = 'doubles' and course_layout_id::text = pg_temp.v('layout') from events where id = pg_temp.v('w2')::uuid), 'week 2: still doubles on the 22');
insert into teams (event_id, round, team_no, player_a, player_b) values
  (pg_temp.v('w2')::uuid, 1, 1, pg_temp.pid(pg_temp.v('w2'), 'Blake'), pg_temp.pid(pg_temp.v('w2'), 'Saul')),
  (pg_temp.v('w2')::uuid, 1, 2, pg_temp.pid(pg_temp.v('w2'), 'Danny'), pg_temp.pid(pg_temp.v('w2'), 'Jaden')),
  (pg_temp.v('w2')::uuid, 1, 3, pg_temp.pid(pg_temp.v('w2'), 'Cole'), null);
insert into paper_totals (player_id, round, strokes) values
  (pg_temp.pid(pg_temp.v('w2'), 'Blake'), 1, 50), (pg_temp.pid(pg_temp.v('w2'), 'Danny'), 1, 50), (pg_temp.pid(pg_temp.v('w2'), 'Cole'), 1, 60);

set role anon;
select pg_temp.ok((league_mvp('friday-glow') ->> 'weeks')::int = 2, 'MVP counts the 2 doubles weeks');
select pg_temp.ok((select array_agg((x ->> 'name') || ':' || (x ->> 'wins') || '/' || (x ->> 'podiums') || '/' || (x ->> 'weeks') order by n)
  from jsonb_array_elements(league_mvp('friday-glow') -> 'players') with ordinality t(x, n)) =
  '{Danny:2/2/2,Blake:1/2/2,Jaden:1/2/2,Saul:1/2/2,Roger:1/1/1,Cole:0/2/2}',
  'most wins first (a tie at the top = a win for both), then podiums, then fewer weeks, then name');
select pg_temp.ok((select (x ->> 'best')::int = -18 from jsonb_array_elements(league_mvp('friday-glow') -> 'players') x where x ->> 'name' = 'Danny'), 'best score to par per player');
reset role;

-- tags back on works (nobody holds one); tags off is refused while someone holds a tag
select pg_temp.claims('00000000-0000-4000-8000-0000000d0b02', false); set role authenticated;
select td_save_league(pg_temp.v('lg')::uuid, '{"tags": true}');
reset role;
select pg_temp.ok((select not hidden from tag_pools where id = pg_temp.v('pool')::uuid), 'tags on: the set is back');
insert into tags (pool_id, number, holder_id, status) select pg_temp.v('pool')::uuid, 1, id, 'held' from tag_members where name = 'Tagless Tom';
select pg_temp.claims('00000000-0000-4000-8000-0000000d0b02', false); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select td_save_league(%L, ''{"tags": false}'')', pg_temp.v('lg')), 'tags_held'), 'can''t turn tags off while someone holds one');
reset role;
rollback;
