-- Coming up live: scheduled rounds on the public Rounds page, flipping to LIVE with their cards. Rolls back.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
begin;
create temp table f_ctx (k text primary key, v text) on commit drop;
grant all on f_ctx to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from f_ctx where k = key $$;
create or replace function pg_temp.mem(n text) returns uuid language sql security definer as $$ select id from tag_members where name = n $$;
create or replace function pg_temp.up(kind text, id text) returns jsonb language sql as $$
  select x from jsonb_array_elements(live_upcoming()) x where x ->> 'kind' = kind and x ->> 'id' = id $$;
grant execute on function pg_temp.v(text), pg_temp.mem(text), pg_temp.up(text, text) to anon, authenticated;
insert into tag_pools (slug, name, sort) values ('up-test', 'Up Test', 95);
insert into tag_members (name, nickname) values ('Ann Up', null), ('Bob Up', 'Bobby'), ('Cat Up', null);
insert into tags (pool_id, number, holder_id, status) select id, 1, pg_temp.mem('Ann Up'), 'held' from tag_pools where slug = 'up-test';
insert into tags (pool_id, number, holder_id, status) select id, 2, pg_temp.mem('Bob Up'), 'held' from tag_pools where slug = 'up-test';
insert into courses (name) values ('Up Park');
insert into tag_nights (host_id, title, course_id, starts_at) values (pg_temp.mem('Ann Up'), 'Up Glow', (select id from courses where name = 'Up Park'), now() + interval '2 hours') returning id::text \gset night_
insert into f_ctx values ('night', :'night_id');
insert into tag_night_players (night_id, member_id) values (pg_temp.v('night')::uuid, pg_temp.mem('Ann Up'));
insert into tag_night_players (night_id, guest_name) values (pg_temp.v('night')::uuid, 'Glow Guy');
insert into tag_challenges (pool_id, challenger_id, challenged_id, status, tee_at, locked_at, course_id)
  select id, pg_temp.mem('Bob Up'), pg_temp.mem('Ann Up'), 'accepted', now() + interval '1 day', now(), (select id from courses where name = 'Up Park') from tag_pools where slug = 'up-test';
insert into f_ctx select 'ch', id::text from tag_challenges where challenger_id = pg_temp.mem('Bob Up');
insert into tag_challenges (pool_id, challenger_id, challenged_id, status, tee_at, course_id)
  select id, pg_temp.mem('Ann Up'), pg_temp.mem('Bob Up'), 'accepted', now() + interval '1 day', null from tag_pools where slug = 'up-test';
insert into f_ctx select 'ch2', id::text from tag_challenges where challenger_id = pg_temp.mem('Ann Up');
insert into tag_casual (pool_id, host_id, tee_at, course_id) select id, pg_temp.mem('Cat Up'), now() + interval '8 days', null from tag_pools where slug = 'up-test';
insert into f_ctx select 'far', id::text from tag_casual where host_id = pg_temp.mem('Cat Up');
insert into tag_casual (pool_id, host_id, tee_at, course_id) select id, pg_temp.mem('Bob Up'), now() - interval '4 hours', null from tag_pools where slug = 'up-test';
insert into f_ctx select 'old', id::text from tag_casual where host_id = pg_temp.mem('Bob Up');
insert into tag_casual_players (invite_id, member_id, status) values (pg_temp.v('old')::uuid, pg_temp.mem('Bob Up'), 'in');
set client_min_messages = notice;

set role anon;
select pg_temp.ok(pg_temp.up('night', pg_temp.v('night')) ->> 'title' = 'Up Glow'
  and pg_temp.up('night', pg_temp.v('night')) -> 'players' = '["Ann Up", "Glow Guy"]'::jsonb
  and jsonb_array_length(pg_temp.up('night', pg_temp.v('night')) -> 'live') = 0, 'anyone sees the night: title, who''s checked in (guests too), not live yet');
select pg_temp.ok(pg_temp.up('challenge', pg_temp.v('ch')) ->> 'title' = 'Bobby (#2) vs Ann Up (#1)' and pg_temp.up('challenge', pg_temp.v('ch')) ->> 'set' = 'Up Test',
  'a locked challenge: short names with their tags');
select pg_temp.ok(pg_temp.up('challenge', pg_temp.v('ch2')) is null, 'no tee time locked yet: not advertised');
select pg_temp.ok(pg_temp.up('casual', pg_temp.v('far')) is null, 'more than 7 days out: not yet');
select pg_temp.ok(pg_temp.up('casual', pg_temp.v('old')) is null, 'teed off 4 h ago with nobody live: gone');
-- a card goes live from the old casual round: it comes back as LIVE
select round_live_push(gen_random_uuid(), repeat('s', 24), null, jsonb_build_object('course', 'Up Park', 'pars', '[3,3]'::jsonb, 'source', 'casual:' || pg_temp.v('old'),
  'players', jsonb_build_array(jsonb_build_object('name', 'Bobby', 'member_id', null, 'scores', '[3]'::jsonb))));
select pg_temp.ok(jsonb_array_length(pg_temp.up('casual', pg_temp.v('old')) -> 'live') = 1, 'a live card started from it: back on, LIVE, with the card');
select round_live_push(gen_random_uuid(), repeat('t', 24), null, jsonb_build_object('course', 'Up Park', 'pars', '[3,3]'::jsonb, 'source', 'night:not-a-uuid',
  'players', jsonb_build_array(jsonb_build_object('name', 'X', 'member_id', null, 'scores', '[]'::jsonb))));
reset role;
select pg_temp.ok((select count(*) = 1 from club_live where source is null and course = 'Up Park'), 'a junk source is dropped, the card still goes live');
-- saved card / closed night: off the list
insert into club_rounds (course, played_on, pars, created_by, source) values ('Up Park', current_date, '{3,3}', pg_temp.mem('Bob Up'), 'challenge:' || pg_temp.v('ch'));
update tag_nights set closed_at = now() where id = pg_temp.v('night')::uuid;
set role anon;
select pg_temp.ok(pg_temp.up('challenge', pg_temp.v('ch')) is null and pg_temp.up('night', pg_temp.v('night')) is null, 'card saved / night closed: off the list');
reset role;
rollback;
