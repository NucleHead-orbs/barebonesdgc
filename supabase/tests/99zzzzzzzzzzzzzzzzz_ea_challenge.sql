-- Early Access: under 3 players, a tag round needs an accepted challenge (tickets + tags). Runs after the early access test.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
create or replace function pg_temp.ev() returns uuid language sql as $$ select id from events where slug = 'jewel-xi-2026' $$;
create or replace function pg_temp.mem(n text) returns uuid language sql as $$ select id from tag_members where name = n $$;
create or replace function pg_temp.tok(n text) returns text language sql as $$ select token from tag_members where name = n $$;
create or replace function pg_temp.ea() returns uuid language sql as $$ select id from tag_pools where slug = 'jewel-xi-ea' $$;
create or replace function pg_temp.num(n text) returns int language sql as $$ select number from tags where pool_id = pg_temp.ea() and holder_id = pg_temp.mem(n) $$;
create or replace function pg_temp.st(n text, f text) returns int language sql as $$
  select (x ->> f)::int from jsonb_array_elements(_ea_standings(pg_temp.ev())) x where x ->> 'name' = n $$;
create or replace function pg_temp.card() returns jsonb language sql as $$ select jsonb_agg(3) from generate_series(1, 18) $$;
create or replace function pg_temp.rnd(who text[]) returns jsonb language sql as $$
  select jsonb_build_object('course', 'Freedom', 'played_on', current_date, 'pars', pg_temp.card(),
    'players', (select jsonb_agg(jsonb_build_object('member_id', pg_temp.mem(w), 'scores', pg_temp.card())) from unnest(who) w)) $$;
create temp table x_ctx (k text primary key, v text);
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from x_ctx where k = key $$;
select set_config('request.jwt.claims', '', false);
-- Rex was removed from early access by the earlier test: hand him the free tag back so there are 3 holders
update tags set holder_id = pg_temp.mem('Rex'), status = 'held' where pool_id = pg_temp.ea() and holder_id is null and status = 'available' and number = (select min(number) from tags where pool_id = pg_temp.ea() and status = 'available');
-- the earlier test left the window closed: open it through today
update early_access set opens_on = least(opens_on, current_date - 1), closes_on = greatest(closes_on, current_date + 7) where event_id = pg_temp.ev();
-- the two players: hi = the better tag, lo = the one who can challenge up
insert into x_ctx select 'hi', case when pg_temp.num('Axl Anhyzer Jr') < pg_temp.num('Dee Skip') then 'Axl Anhyzer Jr' else 'Dee Skip' end;
insert into x_ctx select 'lo', case when pg_temp.v('hi') = 'Axl Anhyzer Jr' then 'Dee Skip' else 'Axl Anhyzer Jr' end;
insert into x_ctx select 'rounds0', coalesce(pg_temp.st('Axl Anhyzer Jr', 'rounds'), 0)::text;
insert into x_ctx select 'nrounds', (select count(*) from club_rounds)::text;
set client_min_messages = notice;

select pg_temp.ok(pg_temp.num('Axl Anhyzer Jr') is not null and pg_temp.num('Dee Skip') is not null and pg_temp.num('Rex') is not null, 'three Early Access tag holders to play with');
select pg_temp.ok(pg_temp.refused(format('select round_save_swap(%L, %L, %L)', pg_temp.tok(pg_temp.v('lo')), pg_temp.rnd(array[pg_temp.v('lo'), pg_temp.v('hi')]), array[pg_temp.ea()]), 'needs_challenge'),
  'scorecard: 2 Jewel players can''t put Early Access tags on the line without a challenge');
select pg_temp.ok((select count(*) from club_rounds)::text = pg_temp.v('nrounds'), 'and nothing half-saved (untick the set and save again)');
select pg_temp.ok(pg_temp.refused(format('select tag_log(%L, %L, %L, ''Freedom'', current_date)', pg_temp.tok(pg_temp.v('lo')), pg_temp.ea(),
  jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem(pg_temp.v('lo')), 'score', 50), jsonb_build_object('member_id', pg_temp.mem(pg_temp.v('hi')), 'score', 55))), 'needs_challenge'),
  'My Tag log: same rule');
-- an open (not yet accepted) challenge isn't enough
select pg_temp.ok(not tag_line_ok(pg_temp.ea(), array[pg_temp.mem(pg_temp.v('lo')), pg_temp.mem(pg_temp.v('hi'))]) and tag_line_ok(pg_temp.ea(), array[pg_temp.mem('Rex'), pg_temp.mem('Axl Anhyzer Jr'), pg_temp.mem('Dee Skip')])
  and tag_line_ok((select id from tag_pools where slug <> 'jewel-xi-ea' and id not in (select pool_id from early_access) limit 1), array[pg_temp.mem('Rex'), pg_temp.mem('Dee Skip')]), 'the scorecard can ask before tee-off');
insert into x_ctx select 'c', tag_challenge(pg_temp.tok(pg_temp.v('lo')), pg_temp.ea(), pg_temp.mem(pg_temp.v('hi')))::text;
select pg_temp.ok(pg_temp.refused(format('select round_save_swap(%L, %L, %L)', pg_temp.tok(pg_temp.v('lo')), pg_temp.rnd(array[pg_temp.v('lo'), pg_temp.v('hi')]), array[pg_temp.ea()]), 'needs_challenge'),
  'a challenge has to be accepted first');
select tag_challenge_respond(pg_temp.tok(pg_temp.v('hi')), pg_temp.v('c')::uuid, true);
select pg_temp.ok(pg_temp.refused(format('select round_save_swap(%L, %L, %L)', pg_temp.tok('Rex'), pg_temp.rnd(array['Rex', pg_temp.v('hi')]), array[pg_temp.ea()]), 'needs_challenge'),
  'only the challenge pair gets the 2-player pass');
select pg_temp.ok(tag_line_ok(pg_temp.ea(), array[pg_temp.mem(pg_temp.v('lo')), pg_temp.mem(pg_temp.v('hi'))]), 'and gets a yes once the challenge is accepted');
insert into x_ctx select 'rid', (round_save_swap(pg_temp.tok(pg_temp.v('lo')), pg_temp.rnd(array[pg_temp.v('lo'), pg_temp.v('hi')]), array[pg_temp.ea()]) ->> 'round_id');
select pg_temp.ok(pg_temp.v('rid') is not null, 'accepted challenge: the 2-player round saves with tags on the line');
select round_confirm(pg_temp.tok(pg_temp.v('hi')), pg_temp.v('rid')::uuid, true);
select pg_temp.ok((select status = 'played' from tag_challenges where id = pg_temp.v('c')::uuid), 'confirming the round applies the swap and settles the challenge');
select pg_temp.ok(pg_temp.st('Axl Anhyzer Jr', 'rounds') = pg_temp.v('rounds0')::int + 1, 'and it earns a raffle round (2 players, challenge settled)');
-- a plain 2-player round with no tags still doesn't count
insert into x_ctx select 'plain', round_save(pg_temp.tok('Axl Anhyzer Jr'), pg_temp.rnd(array['Axl Anhyzer Jr', 'Rex']))::text;
select round_confirm(pg_temp.tok('Rex'), pg_temp.v('plain')::uuid, true);
select pg_temp.ok(pg_temp.st('Axl Anhyzer Jr', 'rounds') = pg_temp.v('rounds0')::int + 1, 'a casual 2-player round still doesn''t count');
-- 3 Jewel players: no challenge needed (unchanged)
select pg_temp.ok((round_save_swap(pg_temp.tok('Rex'), pg_temp.rnd(array['Rex', 'Axl Anhyzer Jr', 'Dee Skip']), array[pg_temp.ea()]) ->> 'round_id') is not null, '3 players: tags on the line, no challenge needed');
