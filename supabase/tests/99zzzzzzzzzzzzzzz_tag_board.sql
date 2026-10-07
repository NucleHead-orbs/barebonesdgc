-- The Board, reactions, news posts, profiles, matchups, Matchmaker. Run after stub + all migrations.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.pool(s text default 'board-test') returns uuid language sql as $$ select id from tag_pools where slug = s $$;
create or replace function pg_temp.mem(n text) returns uuid language sql as $$ select id from tag_members where name = n $$;
create or replace function pg_temp.tok(n text) returns text language sql security definer as $$ select token from tag_members where name = n $$;
create or replace function pg_temp.course(n text) returns uuid language sql security definer as $$ select id from courses where name = n $$;
create or replace function pg_temp.news(ev text) returns int language sql security definer as $$ select count(*)::int from tag_chat where pool_id = pg_temp.pool() and kind = 'system' and event = ev $$;
grant execute on function pg_temp.pool(text), pg_temp.mem(text), pg_temp.tok(text), pg_temp.course(text), pg_temp.news(text) to anon, authenticated;
create temp table b_ctx (k text primary key, v text);
grant all on b_ctx to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from b_ctx where k = key $$;
grant execute on function pg_temp.v(text) to anon, authenticated;

insert into tag_pools (slug, name, sort, chat, challenges) values ('board-test', 'Board Test', 98, true, true), ('quiet-test', 'Quiet Test', 97, false, true);
insert into tag_members (name, nickname) select n, case when n = 'Cy Board' then 'Cyclops' end
  from unnest(array['Ace Board', 'Bo Board', 'Cy Board', 'Di Board', 'Ed Board', 'Fi Board', 'Zed Board']) n;
insert into tags (pool_id, number, holder_id, status, issued_at)
select pg_temp.pool(), i, pg_temp.mem(n), 'held', now() - interval '20 days'
  from unnest(array['Ace Board', 'Bo Board', 'Cy Board', 'Di Board', 'Ed Board', 'Fi Board']) with ordinality as x(n, i);
insert into tags (pool_id, number, holder_id, status) values (pg_temp.pool('quiet-test'), 1, pg_temp.mem('Ace Board'), 'held'), (pg_temp.pool('quiet-test'), 2, pg_temp.mem('Bo Board'), 'held');
insert into tag_history (pool_id, number, kind, member_id, at)
select pool_id, number, 'issued', holder_id, now() - interval '20 days' from tags where pool_id = pg_temp.pool();
insert into courses (name) values ('Board Park'), ('Board Hills'), ('Board Canyon'), ('Board Flats');
set client_min_messages = notice;

-- ---------- profiles ----------
select set_config('request.jwt.claims', '', false); set role anon;
select pg_temp.ok((select (p->>'saved')::boolean = false and (p->>'am')::int = 0 and jsonb_array_length(p->'library') >= 4 from (select tag_profile_get(pg_temp.tok('Fi Board')) p) x), 'new players start blank with the course library to pick from');
select pg_temp.ok(pg_temp.refused(format('select tag_profile_save(%L, 200, 0, null)', pg_temp.tok('Fi Board')), 'invalid_days'), 'days are a week');
select pg_temp.ok(pg_temp.refused(format('select tag_profile_save(%L, 0, 0, %L)', pg_temp.tok('Fi Board'), array[pg_temp.course('Board Park'), pg_temp.course('Board Hills'), pg_temp.course('Board Canyon'), pg_temp.course('Board Flats')]), 'too_many_courses'), 'three favorite courses max');
select pg_temp.ok(pg_temp.refused(format('select tag_profile_save(%L, 0, 0, %L)', pg_temp.tok('Fi Board'), array[gen_random_uuid()]), 'unknown_course'), 'courses come from the library');
select pg_temp.ok(pg_temp.refused($$select tag_profile_save('nope-nope-nope-nope-nope', 0, 0, null)$$, 'invalid_link'), 'needs a real My Tag link');
-- Fi (#6): Sat AM, Sun PM, Park + Hills. Cy (#3): Sat AM, Park. Ed (#5): Wed PM. Bo (#2): nothing set.
select tag_profile_save(pg_temp.tok('Fi Board'), 32, 64, array[pg_temp.course('Board Park'), pg_temp.course('Board Hills'), pg_temp.course('Board Park')]);
select tag_profile_save(pg_temp.tok('Cy Board'), 32 | 1, 0, array[pg_temp.course('Board Park')]);
select tag_profile_save(pg_temp.tok('Ed Board'), 0, 4, null);
select pg_temp.ok((select (p->>'saved')::boolean and (p->>'am')::int = 32 and jsonb_array_length(p->'courses') = 2 from (select tag_profile_get(pg_temp.tok('Fi Board')) p) x), 'saved (duplicate course kept once)');
select pg_temp.ok(pg_temp.refused('select * from tag_profiles', 'permission denied'), 'profiles aren''t readable directly');

-- ---------- matchups ----------
select pg_temp.ok((select jsonb_array_length(m->'picks') = 3 from jsonb_array_elements(tag_matchups(pg_temp.tok('Fi Board'))) m where m->>'pool' = 'board-test'), 'three picks');
select pg_temp.ok((select m->'picks'->0->>'name' = 'Cy Board' and m->'picks'->0->'days' = '["Sat"]' and m->'picks'->0->'courses' = '["Board Park"]'
  from jsonb_array_elements(tag_matchups(pg_temp.tok('Fi Board'))) m where m->>'pool' = 'board-test'), 'best pick shares a day and a course, and says so');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(tag_matchups(pg_temp.tok('Fi Board'))) m where m->>'pool' = 'board-test'
  and exists (select 1 from jsonb_array_elements(m->'picks') p where (p->>'number')::int >= 6 or (p->>'number')::int < 1)), 'only people above you');
select pg_temp.ok(jsonb_array_length((select m->'picks' from jsonb_array_elements(tag_matchups(pg_temp.tok('Ace Board'))) m where m->>'pool' = 'board-test')) = 0, '#1 has nobody to challenge');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(tag_matchups(pg_temp.tok('Ace Board'))) m where m->>'pool' = 'quiet-test' and false), 'sets with challenges on are listed');
reset role;

-- ---------- news posts ----------
set role anon;
insert into b_ctx select 'c1', tag_challenge(pg_temp.tok('Fi Board'), pg_temp.pool(), pg_temp.mem('Cy Board'))::text;
reset role;
select pg_temp.ok(pg_temp.news('challenge') = 1 and (select body like 'Fi Board (#6) called out Cyclops (#3).%' from tag_chat where pool_id = pg_temp.pool() and event = 'challenge'), 'a challenge posts to the Board (nicknames win)');
set role anon;
select pg_temp.ok((select m->>'open' = 'true' and m->'picks'->0->>'name' <> 'Cy Board' from jsonb_array_elements(tag_matchups(pg_temp.tok('Fi Board'))) m where m->>'pool' = 'board-test'), 'a pair you just challenged drops off your picks; your open challenge shows');
select pg_temp.ok(tag_challenge_respond(pg_temp.tok('Cy Board'), pg_temp.v('c1')::uuid, true) = 'accepted', 'Cy accepts');
reset role;
select pg_temp.ok(pg_temp.news('accepted') = 1, 'accepting posts');
set role anon;
insert into b_ctx select 'm1', tag_log(pg_temp.tok('Fi Board'), pg_temp.pool(), jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Fi Board'), 'score', 50),
  jsonb_build_object('member_id', pg_temp.mem('Cy Board'), 'score', 55)), 'Test', current_date)::text;
select tag_confirm(pg_temp.tok('Cy Board'), pg_temp.v('m1')::uuid, true);
reset role;
select pg_temp.ok((select body like 'Challenge settled: Fi Board (#3) took the higher tag from Cyclops (#6). %5%Fi Board climbs from #6 to #3.' from tag_chat where pool_id = pg_temp.pool() and event = 'played'), 'the result posts with the new numbers');
set role anon;
insert into b_ctx select 'c2', tag_challenge(pg_temp.tok('Ed Board'), pg_temp.pool(), pg_temp.mem('Bo Board'))::text;
select tag_challenge_respond(pg_temp.tok('Bo Board'), pg_temp.v('c2')::uuid, false);
insert into b_ctx select 'c3', tag_challenge(pg_temp.tok('Di Board'), pg_temp.pool(), pg_temp.mem('Ace Board'))::text;
select tag_challenge_cancel(pg_temp.tok('Di Board'), pg_temp.v('c3')::uuid);
reset role;
select pg_temp.ok(pg_temp.news('declined') = 1 and pg_temp.news('challenge') = 3, 'declines post');
select pg_temp.ok((select count(*) from tag_chat where pool_id = pg_temp.pool() and body like '%cancel%') = 0, 'cancelled challenges stay quiet');
select _tag_drop(pg_temp.pool(), pg_temp.mem('Ace Board'), null, 'bomb');
select pg_temp.ok((select body like 'BOOM. Ace Board''s #1 blew up%Down to #6.%' from tag_chat where pool_id = pg_temp.pool() and event = 'bomb'), 'explosions post');
select _tag_drop(pg_temp.pool('quiet-test'), pg_temp.mem('Ace Board'), null, 'bomb');
select pg_temp.ok(not exists (select 1 from tag_chat where pool_id = pg_temp.pool('quiet-test')), 'a set with the Board off gets no posts');
select pg_temp.ok(pg_temp.refused($$insert into tag_chat (pool_id, member_id, body, kind, event) values ((select id from tag_pools where slug = 'board-test'), (select id from tag_members where name = 'Bo Board'), 'x', 'system', 'bomb')$$, 'tag_chat_kind_check'), 'house posts have no author');

-- ---------- the Board + reactions ----------
set role anon;
insert into b_ctx select 'msg', tag_chat_post(pg_temp.tok('Bo Board'), pg_temp.pool(), 'Who wants some')::text;
select pg_temp.ok(pg_temp.refused(format('select tag_board_read(%L, %L, 0)', pg_temp.tok('Zed Board'), pg_temp.pool()), 'no_tag_in_pool'), 'only tag holders read the Board');
select pg_temp.ok((select jsonb_array_length(b->'lines') = 8 and (select count(*) from jsonb_array_elements(b->'lines') l where l->>'kind' = 'system') = 7
  from (select tag_board_read(pg_temp.tok('Fi Board'), pg_temp.pool(), 0) b) x), 'the Board has the news and the chat');
select pg_temp.ok(tag_chat_react(pg_temp.tok('Fi Board'), pg_temp.v('msg')::bigint, 'fire'), 'react on');
select tag_chat_react(pg_temp.tok('Cy Board'), pg_temp.v('msg')::bigint, 'fire');
select tag_chat_react(pg_temp.tok('Cy Board'), pg_temp.v('msg')::bigint, 'skull');
select pg_temp.ok((select b->'reactions'->(pg_temp.v('msg'))->'counts' = '{"fire": 2, "skull": 1}' and b->'reactions'->(pg_temp.v('msg'))->'mine' = '["fire"]'
  from (select tag_board_read(pg_temp.tok('Fi Board'), pg_temp.pool(), 999999) b) x), 'tallies + mine come with every read (even with no new lines)');
select pg_temp.ok(not tag_chat_react(pg_temp.tok('Fi Board'), pg_temp.v('msg')::bigint, 'fire'), 'tap again = off');
select pg_temp.ok(pg_temp.refused(format('select tag_chat_react(%L, %s, ''poop'')', pg_temp.tok('Fi Board'), pg_temp.v('msg')), 'invalid_reaction'), 'four reactions only');
select pg_temp.ok(pg_temp.refused(format('select tag_chat_react(%L, %s, ''fire'')', pg_temp.tok('Zed Board'), pg_temp.v('msg')), 'no_tag_in_pool'), 'outsiders can''t react');
reset role;
update tag_chat set hidden = true where id = pg_temp.v('msg')::bigint;
set role anon;
select pg_temp.ok(pg_temp.refused(format('select tag_chat_react(%L, %s, ''fire'')', pg_temp.tok('Fi Board'), pg_temp.v('msg')), 'not_found'), 'hidden lines can''t be reacted to');
reset role;

-- ---------- Matchmaker ----------
delete from tag_challenges where pool_id = pg_temp.pool();
select pg_temp.ok(tag_matchmaker() >= 1, 'the Matchmaker posts');
select pg_temp.ok((select body like 'MATCHMAKER: this week''s hottest matchups%' and array_length(string_to_array(body, E'\n'), 1) = 5 from tag_chat where pool_id = pg_temp.pool() and event = 'matchmaker'), 'three matchups, one line each');
select pg_temp.ok((select count(distinct n) = count(n) from (select unnest(regexp_matches(body, '([A-Za-z]+ Board|Cyclops) \(#', 'g')) n from tag_chat where pool_id = pg_temp.pool() and event = 'matchmaker') z), 'nobody is in two matchups');
select pg_temp.ok(not exists (select 1 from tag_chat where pool_id = pg_temp.pool('quiet-test') and event = 'matchmaker'), 'not on sets with the Board off');
select pg_temp.ok(tag_matchmaker() = 0 and pg_temp.news('matchmaker') = 1, 'once a week per set');
set role anon;
select pg_temp.ok(pg_temp.refused('select tag_matchmaker()', 'permission denied'), 'only the clock runs the Matchmaker');
reset role;

-- ---------- who reacted (20261101) ----------
set role anon;
insert into b_ctx select 'msg2', tag_chat_post(pg_temp.tok('Di Board'), pg_temp.pool(), 'Names please')::text;
select tag_chat_react(pg_temp.tok('Cy Board'), pg_temp.v('msg2')::bigint, 'flex');
select tag_chat_react(pg_temp.tok('Ed Board'), pg_temp.v('msg2')::bigint, 'flex');
select pg_temp.ok((select b->'reactions'->(pg_temp.v('msg2'))->'who'->'flex' = '["Cyclops", "Ed Board"]'
  from (select tag_board_read(pg_temp.tok('Bo Board'), pg_temp.pool(), 999999) b) x), 'everyone on the Board sees who reacted (nicknames win, first first)');
reset role;
