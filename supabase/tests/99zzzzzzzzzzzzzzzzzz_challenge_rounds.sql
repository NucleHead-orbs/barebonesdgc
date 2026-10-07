-- Challenge rounds: slot (time + course), lock, jump-ins. Run after stub + all migrations.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon;
create or replace function pg_temp.pool() returns uuid language sql as $$ select id from tag_pools where slug = 'rounds-test' $$;
create or replace function pg_temp.mem(n text) returns uuid language sql as $$ select id from tag_members where name = n $$;
create or replace function pg_temp.tok(n text) returns text language sql security definer as $$ select token from tag_members where name = n $$;
create or replace function pg_temp.course() returns uuid language sql security definer as $$ select id from courses where name = 'Round Park' $$;
create or replace function pg_temp.news(ev text) returns int language sql security definer as $$ select count(*)::int from tag_chat where pool_id = pg_temp.pool() and event = ev $$;
create temp table r_ctx (k text primary key, v text);
grant all on r_ctx to anon;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from r_ctx where k = key $$;
create or replace function pg_temp.rounds(n text) returns jsonb language sql security definer as $$ select tag_rounds(pg_temp.tok(n)) $$;
create or replace function pg_temp.tee(c uuid) returns timestamptz language sql security definer as $$ select tee_at from tag_challenges where id = c $$;
grant execute on function pg_temp.tee(uuid) to anon;
grant execute on function pg_temp.pool(), pg_temp.mem(text), pg_temp.tok(text), pg_temp.course(), pg_temp.news(text), pg_temp.v(text), pg_temp.rounds(text) to anon;

insert into tag_pools (slug, name, sort, chat, challenges) values ('rounds-test', 'Rounds Test', 96, true, true);
insert into tag_members (name) select n from unnest(array['Al Round', 'Bea Round', 'Cal Round', 'Dot Round', 'Eve Round', 'Flo Round', 'Gus Round', 'Hal Round', 'Ivy Round', 'Jon Round', 'Kay Round', 'Lou Round', 'Out Round']) n;
insert into tags (pool_id, number, holder_id, status)
select pg_temp.pool(), i, pg_temp.mem(n), 'held' from unnest(array['Al Round', 'Bea Round', 'Cal Round', 'Dot Round', 'Eve Round', 'Flo Round', 'Gus Round', 'Hal Round', 'Ivy Round', 'Jon Round', 'Kay Round', 'Lou Round']) with ordinality as x(n, i);
insert into courses (name) values ('Round Park');
select set_config('request.jwt.claims', '', false);
set client_min_messages = notice;

set role anon;
-- Dot (#4) challenges Bea (#2); Bea accepts
insert into r_ctx select 'c', tag_challenge(pg_temp.tok('Dot Round'), pg_temp.pool(), pg_temp.mem('Bea Round'))::text;
select pg_temp.ok(pg_temp.refused(format('select tag_challenge_slot(%L, %L, now() + interval ''2 days'', %L)', pg_temp.tok('Bea Round'), pg_temp.v('c'), pg_temp.course()), 'challenge_open'), 'no slot until it''s accepted');
select tag_challenge_respond(pg_temp.tok('Bea Round'), pg_temp.v('c')::uuid, true);
select pg_temp.ok(pg_temp.refused(format('select tag_challenge_slot(%L, %L, now() + interval ''2 days'', %L)', pg_temp.tok('Dot Round'), pg_temp.v('c'), pg_temp.course()), 'defender_picks'), 'the challenged player picks first');
select pg_temp.ok(pg_temp.refused(format('select tag_challenge_slot(%L, %L, now() + interval ''1 hour'', %L)', pg_temp.tok('Bea Round'), pg_temp.v('c'), pg_temp.course()), 'slot_too_soon'), 'at least 2 hours out');
select pg_temp.ok(pg_temp.refused(format('select tag_challenge_slot(%L, %L, now() + interval ''9 days'', %L)', pg_temp.tok('Bea Round'), pg_temp.v('c'), pg_temp.course()), 'slot_after_due'), 'inside the 7-day play-by');
select pg_temp.ok(pg_temp.refused(format('select tag_challenge_slot(%L, %L, now() + interval ''2 days'', %L)', pg_temp.tok('Bea Round'), pg_temp.v('c'), gen_random_uuid()), 'unknown_course'), 'a library course');
select pg_temp.ok(pg_temp.refused(format('select tag_challenge_slot(%L, %L, now() + interval ''2 days'', %L)', pg_temp.tok('Eve Round'), pg_temp.v('c'), pg_temp.course()), 'not_your_challenge'), 'outsiders can''t pick');
select tag_challenge_slot(pg_temp.tok('Bea Round'), pg_temp.v('c')::uuid, now() + interval '2 days', pg_temp.course());
select pg_temp.ok(pg_temp.refused(format('select tag_challenge_slot_ok(%L, %L)', pg_temp.tok('Bea Round'), pg_temp.v('c')), 'other_player_oks'), 'you can''t OK your own slot');
select pg_temp.ok(pg_temp.refused(format('select tag_challenge_join(%L, %L)', pg_temp.tok('Eve Round'), pg_temp.v('c')), 'not_open'), 'no jump-ins until both agree');
-- Dot counters with a day later; now Bea has to OK
select tag_challenge_slot(pg_temp.tok('Dot Round'), pg_temp.v('c')::uuid, now() + interval '3 days', pg_temp.course());
select pg_temp.ok(pg_temp.refused(format('select tag_challenge_slot_ok(%L, %L)', pg_temp.tok('Dot Round'), pg_temp.v('c')), 'other_player_oks'), 'a counter goes back to the other one');
select tag_challenge_slot_ok(pg_temp.tok('Bea Round'), pg_temp.v('c')::uuid);
select tag_challenge_slot(pg_temp.tok('Bea Round'), pg_temp.v('c')::uuid, pg_temp.tee(pg_temp.v('c')::uuid), pg_temp.course());
select pg_temp.ok((select r->>'locked' = 'true' from jsonb_array_elements(pg_temp.rounds('Bea Round')) r), 're-sending the agreed slot keeps it locked');
select pg_temp.ok((select r->>'locked' = 'true' and r->>'role' = 'challenged' and r->>'course' = 'Round Park' from jsonb_array_elements(pg_temp.rounds('Bea Round')) r), 'locked; the pair sees it');
select pg_temp.ok(jsonb_array_length(pg_temp.rounds('Out Round')) = 0, 'people outside the set don''t see it');
select pg_temp.ok((select r->>'role' is null from jsonb_array_elements(pg_temp.rounds('Flo Round')) r), 'set holders see it as open');
-- jump-ins
select pg_temp.ok(pg_temp.refused(format('select tag_challenge_join(%L, %L)', pg_temp.tok('Out Round'), pg_temp.v('c')), 'no_tag_in_pool'), 'you need a tag in the set to jump in');
select pg_temp.ok(pg_temp.refused(format('select tag_challenge_join(%L, %L)', pg_temp.tok('Dot Round'), pg_temp.v('c')), 'already_in'), 'the pair is already in');
select tag_challenge_join(pg_temp.tok('Eve Round'), pg_temp.v('c')::uuid);
select pg_temp.ok(pg_temp.refused(format('select tag_challenge_join(%L, %L)', pg_temp.tok('Eve Round'), pg_temp.v('c')), 'already_in'), 'once is enough');
select tag_challenge_join(pg_temp.tok('Al Round'), pg_temp.v('c')::uuid);
select tag_challenge_join(pg_temp.tok('Cal Round'), pg_temp.v('c')::uuid);
select tag_challenge_join(pg_temp.tok('Gus Round'), pg_temp.v('c')::uuid);
select tag_challenge_join(pg_temp.tok('Hal Round'), pg_temp.v('c')::uuid);
select tag_challenge_join(pg_temp.tok('Ivy Round'), pg_temp.v('c')::uuid);
select tag_challenge_join(pg_temp.tok('Jon Round'), pg_temp.v('c')::uuid);
select tag_challenge_join(pg_temp.tok('Kay Round'), pg_temp.v('c')::uuid);
select pg_temp.ok(pg_temp.refused(format('select tag_challenge_join(%L, %L)', pg_temp.tok('Flo Round'), pg_temp.v('c')), 'round_full'), 'eight jump-ins max (a card of 10)');
select tag_challenge_leave(pg_temp.tok('Al Round'), pg_temp.v('c')::uuid);
select pg_temp.ok(pg_temp.refused(format('select tag_challenge_leave(%L, %L)', pg_temp.tok('Al Round'), pg_temp.v('c')), 'not_in'), 'drop out once');
select tag_challenge_join(pg_temp.tok('Flo Round'), pg_temp.v('c')::uuid);
select pg_temp.ok((select jsonb_array_length(r->'joins') = 8 and r->>'role' = 'joined' from jsonb_array_elements(pg_temp.rounds('Flo Round')) r), 'a dropped spot can be taken');
reset role;
select pg_temp.ok(pg_temp.news('scheduled') = 1 and pg_temp.news('jumpin') = 9 and pg_temp.news('dropout') = 1, 'the Board hears about the lock, jump-ins and the drop-out');
select pg_temp.ok((select body like '%vs%is on: %at Round Park. 8 spots to jump in%' from tag_chat where pool_id = pg_temp.pool() and event = 'scheduled'), 'the lock post has the time and course');
set role anon;
select pg_temp.ok(pg_temp.refused('select * from tag_challenge_joins', 'permission denied'), 'joins table has no client grants');
reset role;
-- close the window: 2 hours before tee
update tag_challenges set tee_at = now() + interval '90 minutes' where id = pg_temp.v('c')::uuid;
set role anon;
select pg_temp.ok(pg_temp.refused(format('select tag_challenge_leave(%L, %L)', pg_temp.tok('Flo Round'), pg_temp.v('c')), 'slot_closed'), 'no dropping out after it closes');
select pg_temp.ok(pg_temp.refused(format('select tag_challenge_slot(%L, %L, now() + interval ''2 days'', %L)', pg_temp.tok('Bea Round'), pg_temp.v('c'), pg_temp.course()), 'slot_closed'), 'or moving it');
reset role;
-- they play with jump-ins: the challenge still settles
set role anon;
insert into r_ctx select 'm', tag_log(pg_temp.tok('Dot Round'), pg_temp.pool(), jsonb_build_array(
  jsonb_build_object('member_id', pg_temp.mem('Dot Round'), 'score', 50), jsonb_build_object('member_id', pg_temp.mem('Bea Round'), 'score', 52),
  jsonb_build_object('member_id', pg_temp.mem('Eve Round'), 'score', 49), jsonb_build_object('member_id', pg_temp.mem('Flo Round'), 'score', 60)), 'Round Park', current_date)::text;
select tag_confirm(pg_temp.tok('Bea Round'), pg_temp.v('m')::uuid, true);
select tag_confirm(pg_temp.tok('Eve Round'), pg_temp.v('m')::uuid, true);
select tag_confirm(pg_temp.tok('Flo Round'), pg_temp.v('m')::uuid, true);
reset role;
select pg_temp.ok((select status = 'played' from tag_challenges where id = pg_temp.v('c')::uuid), 'the round with jump-ins settles the challenge');
select pg_temp.ok(jsonb_array_length(tag_rounds(pg_temp.tok('Flo Round'))) = 0, 'and it drops off the list');
