-- Casual round invites (any distance on the board, up to 6, tags decided at tee-off). Runs in a transaction, rolls back.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
begin;
create temp table i_ctx (k text primary key, v text) on commit drop;
grant all on i_ctx to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from i_ctx where k = key $$;
create or replace function pg_temp.pool() returns uuid language sql as $$ select id from tag_pools where slug = 'invite-test' $$;
create or replace function pg_temp.mem(n text) returns uuid language sql as $$ select id from tag_members where name = n $$;
create or replace function pg_temp.tok(n text) returns text language sql security definer as $$ select token from tag_members where name = n $$;
create or replace function pg_temp.course() returns uuid language sql security definer as $$ select id from courses where name = 'Invite Park' $$;
create or replace function pg_temp.inv(n text) returns jsonb language sql security definer as $$ select i from jsonb_array_elements(tag_casuals(pg_temp.tok(n))) i where i->>'id' = pg_temp.v('i') $$;
create or replace function pg_temp.news(ev text) returns int language sql security definer as $$ select count(*)::int from tag_chat where pool_id = pg_temp.pool() and event = ev $$;
grant execute on function pg_temp.v(text), pg_temp.pool(), pg_temp.mem(text), pg_temp.tok(text), pg_temp.course(), pg_temp.inv(text), pg_temp.news(text) to anon, authenticated;
insert into tag_pools (slug, name, sort, chat, challenges) values ('invite-test', 'Invite Test', 95, true, true);
insert into tag_members (name, nickname) select n, case n when 'Bo Inv' then 'Bomber' end from unnest(array['Al Inv', 'Bo Inv', 'Cy Inv', 'Di Inv', 'Ed Inv', 'Fi Inv', 'Gus Inv', 'Hal Inv', 'Ike Inv', 'Out Inv']) n;
insert into tags (pool_id, number, holder_id, status)
select pg_temp.pool(), i * 3, pg_temp.mem(n), 'held' from unnest(array['Al Inv', 'Bo Inv', 'Cy Inv', 'Di Inv', 'Ed Inv', 'Fi Inv', 'Gus Inv', 'Hal Inv', 'Ike Inv']) with ordinality as x(n, i);
insert into courses (name) values ('Invite Park');
select set_config('request.jwt.claims', '', false);
set client_min_messages = notice;

set role anon;
-- Ike (#27) invites Al (#3) and Bo (#6): way more than 5 spots apart
select pg_temp.ok(pg_temp.refused(format('select tag_casual_create(%L, %L, now() + interval ''5 minutes'', %L, %L, null)', pg_temp.tok('Ike Inv'), pg_temp.pool(), pg_temp.course(), array[pg_temp.mem('Al Inv')]), 'slot_too_soon'), 'at least 15 minutes out');
select pg_temp.ok(pg_temp.refused(format('select tag_casual_create(%L, %L, now() + interval ''31 days'', %L, %L, null)', pg_temp.tok('Ike Inv'), pg_temp.pool(), pg_temp.course(), array[pg_temp.mem('Al Inv')]), 'slot_too_far'), 'within 30 days');
select pg_temp.ok(pg_temp.refused(format('select tag_casual_create(%L, %L, now() + interval ''1 day'', %L, %L, null)', pg_temp.tok('Ike Inv'), pg_temp.pool(), pg_temp.course(), array[pg_temp.mem('Out Inv')]), 'not_in_set'), 'only people in the set');
select pg_temp.ok(pg_temp.refused(format('select tag_casual_create(%L, %L, now() + interval ''1 day'', %L, %L, null)', pg_temp.tok('Ike Inv'), pg_temp.pool(), pg_temp.course(),
  array[pg_temp.mem('Al Inv'), pg_temp.mem('Bo Inv'), pg_temp.mem('Cy Inv'), pg_temp.mem('Di Inv'), pg_temp.mem('Ed Inv'), pg_temp.mem('Fi Inv')]), 'too_many_players'), 'up to 5 invited (a card of 6)');
select pg_temp.ok(pg_temp.refused(format('select tag_casual_create(%L, %L, now() + interval ''1 day'', %L, %L, null)', pg_temp.tok('Out Inv'), pg_temp.pool(), pg_temp.course(), array[pg_temp.mem('Al Inv')]), 'no_tag_in_pool'), 'hosts hold a tag in the set');
select pg_temp.ok(pg_temp.refused(format('select tag_casual_create(%L, %L, now() + interval ''1 day'', %L, %L, null)', pg_temp.tok('Ike Inv'), pg_temp.pool(), gen_random_uuid(), array[pg_temp.mem('Al Inv')]), 'unknown_course'), 'a library course');
insert into i_ctx select 'i', tag_casual_create(pg_temp.tok('Ike Inv'), pg_temp.pool(), now() + interval '1 day', pg_temp.course(), array[pg_temp.mem('Al Inv'), pg_temp.mem('Bo Inv'), pg_temp.mem('Al Inv')], '  Loser buys tacos  ')::text;
select pg_temp.ok((select (pg_temp.inv('Ike Inv')->>'host_me')::boolean and pg_temp.inv('Ike Inv')->>'mine' = 'in' and jsonb_array_length(pg_temp.inv('Ike Inv')->'players') = 3
  and pg_temp.inv('Ike Inv')->>'note' = 'Loser buys tacos'), 'invite made: host in, 2 invited (duplicates dropped), note trimmed');
select pg_temp.ok(pg_temp.inv('Al Inv')->>'mine' = 'invited' and pg_temp.inv('Hal Inv')->>'mine' is null and pg_temp.inv('Out Inv') is null, 'invitees see it as invited, set holders as open, outsiders not at all');
reset role;
select pg_temp.ok(pg_temp.news('invite') = 1 and (select body like '%Ike Inv (#27) is playing %at Invite Park. Invited: @Al Inv, @Bomber.%"Loser buys tacos"' from tag_chat where pool_id = pg_temp.pool() and event = 'invite'), 'the Board gets the invite with @names');
select pg_temp.ok((select count(*) = 2 from tag_chat_mentions m join tag_chat c on c.id = m.chat_id where c.pool_id = pg_temp.pool() and c.event = 'invite'), 'invitees get the @ ping');
set role anon;
select pg_temp.ok(jsonb_array_length(tag_mentions(pg_temp.tok('Bo Inv'))) = 1, '...in their My Tag bell');
-- answers, jump-ins, capacity
select tag_casual_answer(pg_temp.tok('Al Inv'), pg_temp.v('i')::uuid, true);
select tag_casual_answer(pg_temp.tok('Bo Inv'), pg_temp.v('i')::uuid, false);
select pg_temp.ok(pg_temp.inv('Al Inv')->>'mine' = 'in' and pg_temp.inv('Bo Inv')->>'mine' = 'out', 'invited players say in / out');
select tag_casual_answer(pg_temp.tok('Cy Inv'), pg_temp.v('i')::uuid, true);
select tag_casual_answer(pg_temp.tok('Di Inv'), pg_temp.v('i')::uuid, true);
select tag_casual_answer(pg_temp.tok('Ed Inv'), pg_temp.v('i')::uuid, true);
select tag_casual_answer(pg_temp.tok('Fi Inv'), pg_temp.v('i')::uuid, true);
select pg_temp.ok(pg_temp.refused(format('select tag_casual_answer(%L, %L, true)', pg_temp.tok('Gus Inv'), pg_temp.v('i')), 'round_full'), 'a card holds 6');
select pg_temp.ok(pg_temp.refused(format('select tag_casual_answer(%L, %L, true)', pg_temp.tok('Bo Inv'), pg_temp.v('i')), 'round_full'), 'seats aren''t held for invitees: first in wins');
select tag_casual_answer(pg_temp.tok('Fi Inv'), pg_temp.v('i')::uuid, false);
select pg_temp.ok(pg_temp.inv('Fi Inv')->>'mine' is null, 'a jump-in who drops out is just gone');
select tag_casual_answer(pg_temp.tok('Bo Inv'), pg_temp.v('i')::uuid, true);
select pg_temp.ok(pg_temp.inv('Bo Inv')->>'mine' = 'in' and (select count(*) from jsonb_array_elements(pg_temp.inv('Ike Inv')->'players') p where p->>'status' = 'in') = 6, 'the open seat is taken: 6 in');
select tag_casual_answer(pg_temp.tok('Bo Inv'), pg_temp.v('i')::uuid, true);
select pg_temp.ok(pg_temp.refused(format('select tag_casual_answer(%L, %L, false)', pg_temp.tok('Ike Inv'), pg_temp.v('i')), 'host_cancels'), 'the host calls it off instead of dropping out');
select pg_temp.ok(pg_temp.refused(format('select tag_casual_answer(%L, %L, true)', pg_temp.tok('Out Inv'), pg_temp.v('i')), 'no_tag_in_pool'), 'outsiders can''t jump in');
reset role;
select pg_temp.ok(pg_temp.news('jumpin') = 6 and pg_temp.news('dropout') = 1, 'the Board hears jump-ins and drop-outs (saying IN twice posts once)');
-- tee time passes: closed
update tag_casual set tee_at = now() - interval '1 minute' where id = pg_temp.v('i')::uuid;
set role anon;
select pg_temp.ok(pg_temp.refused(format('select tag_casual_answer(%L, %L, false)', pg_temp.tok('Cy Inv'), pg_temp.v('i')), 'slot_closed'), 'closes at tee time');
select pg_temp.ok(not (pg_temp.inv('Cy Inv')->>'open')::boolean, '...and still shows while they play');
-- calling off + limits
insert into i_ctx select 'i2', tag_casual_create(pg_temp.tok('Hal Inv'), pg_temp.pool(), now() + interval '2 days', pg_temp.course(), '{}', null)::text;
select pg_temp.ok(pg_temp.refused(format('select tag_casual_cancel(%L, %L)', pg_temp.tok('Al Inv'), pg_temp.v('i2')), 'not_your_invite'), 'only the host calls it off');
select tag_casual_cancel(pg_temp.tok('Hal Inv'), pg_temp.v('i2')::uuid);
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(tag_casuals(pg_temp.tok('Hal Inv'))) i where i->>'id' = pg_temp.v('i2')), 'called-off invites drop off');
select tag_casual_create(pg_temp.tok('Hal Inv'), pg_temp.pool(), now() + interval '2 days', pg_temp.course(), '{}', null);
select tag_casual_create(pg_temp.tok('Hal Inv'), pg_temp.pool(), now() + interval '3 days', pg_temp.course(), '{}', null);
select tag_casual_create(pg_temp.tok('Hal Inv'), pg_temp.pool(), now() + interval '4 days', pg_temp.course(), '{}', null);
select pg_temp.ok(pg_temp.refused(format('select tag_casual_create(%L, %L, now() + interval ''5 days'', %L, %L, null)', pg_temp.tok('Hal Inv'), pg_temp.pool(), pg_temp.course(), '{}'::uuid[]), 'too_many_invites'), '3 upcoming invites per host per set');
select pg_temp.ok(pg_temp.refused('select * from tag_casual', 'permission denied') and pg_temp.refused('select * from tag_casual_players', 'permission denied'), 'tables aren''t readable directly');
reset role;
select pg_temp.ok(pg_temp.news('invite_off') = 1, 'calling it off posts');
rollback;
