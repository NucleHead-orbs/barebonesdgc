-- Tag heat: bombs, challenges, decline penalty, chat. Run after stub + all migrations.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.claims(sub text, admin boolean) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', sub, 'app_metadata', case when admin then '{"role":"td"}'::json else '{}'::json end)::text, false) $$;
create or replace function pg_temp.pool() returns uuid language sql as $$ select id from tag_pools where slug = 'heat-test' $$;
create or replace function pg_temp.mem(n text) returns uuid language sql as $$ select id from tag_members where name = n $$;
create or replace function pg_temp.tok(n text) returns text language sql security definer as $$ select token from tag_members where name = n $$;
create or replace function pg_temp.num(n text) returns int language sql security definer as $$ select number from tags where pool_id = pg_temp.pool() and holder_id = pg_temp.mem(n) $$;
create or replace function pg_temp.order_() returns text language sql security definer as $$
  select string_agg(left(m.name, 1), '' order by t.number) from tags t join tag_members m on m.id = t.holder_id where t.pool_id = pg_temp.pool() and t.status = 'held' $$;
grant execute on function pg_temp.pool(), pg_temp.mem(text), pg_temp.tok(text), pg_temp.num(text), pg_temp.order_() to anon, authenticated;
create temp table h_ctx (k text primary key, v text);
grant all on h_ctx to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from h_ctx where k = key $$;
grant execute on function pg_temp.v(text) to anon, authenticated;

insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-4000-8000-000000000dd1', 'heat-boss@heat.test', now()) on conflict do nothing;
insert into tag_pools (slug, name, sort) values ('heat-test', 'Heat Test', 99) on conflict do nothing;
insert into tag_members (name) select n from unnest(array['Ace Heat', 'Bo Heat', 'Cy Heat', 'Di Heat', 'Ed Heat', 'Fi Heat', 'Gus Heat', 'Hal Heat', 'Zed Outsider']) n
on conflict do nothing;
insert into tags (pool_id, number, holder_id, status, issued_at)
select pg_temp.pool(), i, pg_temp.mem(n), 'held', now() - interval '20 days'
  from unnest(array['Ace Heat', 'Bo Heat', 'Cy Heat', 'Di Heat', 'Ed Heat', 'Fi Heat', 'Gus Heat', 'Hal Heat']) with ordinality as x(n, i);
insert into tag_history (pool_id, number, kind, member_id, at)
select pool_id, number, 'issued', holder_id, now() - interval '20 days' from tags where pool_id = pg_temp.pool();
set client_min_messages = notice;

-- ---------- switches ----------
select pg_temp.ok(not (select bombs or challenges or chat from tag_pools where id = pg_temp.pool()), 'everything starts off');
select pg_temp.ok((select bombs and challenges and chat and bombs_since is not null from tag_pools where slug = 'jewel-xi-ea'), 'Jewel XI Early Access has all three on');
select set_config('request.jwt.claims', '', false); set role anon;
select pg_temp.ok(pg_temp.refused(format('select td_tag_heat_set(%L, true, true, true)', pg_temp.pool()), 'permission denied'), 'anon can''t flip switches');
select pg_temp.ok(pg_temp.refused(format('select tag_challenge(%L, %L, %L)', pg_temp.tok('Hal Heat'), pg_temp.pool(), pg_temp.mem('Gus Heat')), 'challenges_off'), 'no challenges while off');
reset role;
select pg_temp.claims('00000000-0000-4000-8000-000000000dd1', true); set role authenticated;
select td_tag_heat_set(pg_temp.pool(), true, true, true);
reset role;
select pg_temp.ok((select bombs_since > now() - interval '1 minute' from tag_pools where id = pg_temp.pool()), 'turning bombs on starts the clock now');
select pg_temp.ok((tag_tick() ->> 'booms')::int = 0, 'nobody explodes the moment bombs go on');

-- ---------- bombs ----------
update tag_pools set bombs_since = now() - interval '8 days' where id = pg_temp.pool();
insert into tag_fuse (pool_id, member_id, top_since) select pool_id, holder_id, now() - interval '10 days' from tags where pool_id = pg_temp.pool() and number <= 5
on conflict (pool_id, member_id) do update set top_since = excluded.top_since;
-- Bo played a confirmed tag round 2 days ago: safe
insert into tag_matches (pool_id, source, status, created_at, applied_at) values (pg_temp.pool(), 'casual', 'applied', now() - interval '2 days', now() - interval '2 days');
insert into tag_match_players (match_id, member_id, score, confirmed_at)
select (select id from tag_matches where pool_id = pg_temp.pool() order by created_at desc limit 1), pg_temp.mem('Bo Heat'), 50, now() - interval '2 days';
select pg_temp.ok((select (jsonb_array_length(tag_board_heat('heat-test') -> 'fuses'))) = 5, 'the board shows 5 fuses');
select pg_temp.ok((tag_tick() ->> 'booms')::int = 4, 'idle top-5 tags explode until the top 5 is fresh');
select pg_temp.ok(pg_temp.order_() = 'BFGHACDE', 'each idle holder went to the bottom and everyone below moved up');
select pg_temp.ok((select count(*) = 4 and bool_and(kind = 'bomb') from tag_drops where pool_id = pg_temp.pool()), 'every explosion is in the feed');
select pg_temp.ok((select count(*) from tag_history where pool_id = pg_temp.pool() and kind = 'bomb') > 0, 'and in the tag ledger');
select pg_temp.ok((tag_tick() ->> 'booms')::int = 0, 'holders who moved INTO the top 5 get a fresh week');

-- ---------- challenges ----------
-- order is B F G H A C D E (#1..#8)
select set_config('request.jwt.claims', '', false); set role anon;
select pg_temp.ok(pg_temp.refused(format('select tag_challenge(%L, %L, %L)', pg_temp.tok('Ed Heat'), pg_temp.pool(), pg_temp.mem('Fi Heat')), 'out_of_range'), 'only up to 5 spots above');
select pg_temp.ok(pg_temp.refused(format('select tag_challenge(%L, %L, %L)', pg_temp.tok('Fi Heat'), pg_temp.pool(), pg_temp.mem('Ed Heat')), 'out_of_range'), 'only up, never down');
select pg_temp.ok(pg_temp.refused(format('select tag_challenge(%L, %L, %L)', pg_temp.tok('Zed Outsider'), pg_temp.pool(), pg_temp.mem('Bo Heat')), 'no_tag_in_pool'), 'you need a tag in the set');
insert into h_ctx select 'c1', tag_challenge(pg_temp.tok('Ed Heat'), pg_temp.pool(), pg_temp.mem('Gus Heat'))::text;
select pg_temp.ok(pg_temp.refused(format('select tag_challenge(%L, %L, %L)', pg_temp.tok('Ed Heat'), pg_temp.pool(), pg_temp.mem('Hal Heat')), 'one_at_a_time'), 'one open challenge at a time');
select pg_temp.ok(tag_challenge_respond(pg_temp.tok('Gus Heat'), pg_temp.v('c1')::uuid, true) = 'accepted', 'Gus accepts');
select pg_temp.ok((select jsonb_array_length(tag_board_heat('heat-test') -> 'live')) = 1, 'live challenges show on the board');
-- they play: Ed wins, the challenge is settled
insert into h_ctx select 'm1', tag_log(pg_temp.tok('Ed Heat'), pg_temp.pool(), jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Ed Heat'), 'score', 50),
  jsonb_build_object('member_id', pg_temp.mem('Gus Heat'), 'score', 55)), 'Test', current_date)::text;
select pg_temp.ok(tag_confirm(pg_temp.tok('Gus Heat'), pg_temp.v('m1')::uuid, true) = 'applied', 'the round applies');
reset role;
select pg_temp.ok((select status = 'played' and match_id = pg_temp.v('m1')::uuid from tag_challenges where id = pg_temp.v('c1')::uuid), 'an applied round with both players settles the challenge');
select pg_temp.ok(pg_temp.num('Ed Heat') = 3 and pg_temp.num('Gus Heat') = 8, 'and the tags swapped as usual');

-- ---------- 4th decline drops 5 places ----------
-- order now B F E H A C D G; Bo (#1) gets challenged by F, E, H, A
set role anon;
select tag_challenge_respond(pg_temp.tok('Bo Heat'), tag_challenge(pg_temp.tok(n), pg_temp.pool(), pg_temp.mem('Bo Heat')), false)
  from unnest(array['Fi Heat', 'Ed Heat', 'Hal Heat']) n;
select pg_temp.ok(pg_temp.num('Bo Heat') = 1 and (tag_board_heat('heat-test') -> 'declines' ->> '1')::int = 3, '3 declines are free (and shown)');
insert into h_ctx select 'c4', tag_challenge(pg_temp.tok('Ace Heat'), pg_temp.pool(), pg_temp.mem('Bo Heat'))::text;
reset role;
-- 48 hours of silence = a decline
update tag_challenges set expires_at = now() - interval '1 minute' where id = pg_temp.v('c4')::uuid;
select pg_temp.ok((tag_tick() ->> 'expired')::int = 1, 'silence for 48 hours expires the challenge');
select pg_temp.ok(pg_temp.order_() = 'FEHACBDG', 'the 4th decline drops Bo 5 places; the 5 he passed move up one');
select pg_temp.ok((select kind = 'decline' and from_number = 1 and to_number = 6 from tag_drops where member_id = pg_temp.mem('Bo Heat') order by at desc limit 1), 'drop recorded');
set role anon;
select pg_temp.ok(((tag_heat(pg_temp.tok('Bo Heat')) -> 0) ->> 'declines')::int = 0, 'the count starts over');
select pg_temp.ok(pg_temp.refused(format('select tag_challenge_respond(%L, %L, true)', pg_temp.tok('Bo Heat'), pg_temp.v('c4')), 'challenge_expired'), 'too late to answer');
select pg_temp.ok(pg_temp.refused(format('select tag_challenge(%L, %L, %L)', pg_temp.tok('Fi Heat'), pg_temp.pool(), pg_temp.mem('Bo Heat')), 'out_of_range'), 'challenges only go up');
reset role;

-- ---------- chat ----------
set role anon;
select pg_temp.ok(tag_chat_post(pg_temp.tok('Ace Heat'), pg_temp.pool(), '  who wants some  ') > 0, 'a member posts');
select pg_temp.ok(pg_temp.refused(format('select tag_chat_post(%L, %L, %L)', pg_temp.tok('Ace Heat'), pg_temp.pool(), 'again'), 'slow_down'), 'no spamming');
select pg_temp.ok(pg_temp.refused(format('select tag_chat_post(%L, %L, %L)', pg_temp.tok('Zed Outsider'), pg_temp.pool(), 'hi'), 'no_tag_in_pool'), 'outsiders can''t post');
select pg_temp.ok(pg_temp.refused(format('select tag_chat_read(%L, %L, 0)', pg_temp.tok('Zed Outsider'), pg_temp.pool()), 'no_tag_in_pool'), 'or read');
select pg_temp.ok((select x ->> 'body' from jsonb_array_elements(tag_chat_read(pg_temp.tok('Bo Heat'), pg_temp.pool(), 0)) x where x ->> 'kind' = 'chat' limit 1) = 'who wants some', 'members read it (trimmed)');
reset role;
select pg_temp.claims('00000000-0000-4000-8000-000000000dd1', true); set role authenticated;
select td_tag_chat_hide((select (x ->> 'id')::bigint from jsonb_array_elements(td_tag_chat(pg_temp.pool())) x where x ->> 'kind' = 'chat' limit 1), true);
reset role;
select set_config('request.jwt.claims', '', false); set role anon;
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(tag_chat_read(pg_temp.tok('Bo Heat'), pg_temp.pool(), 0)) x where x ->> 'kind' = 'chat'), 'TDs can hide a message');
reset role;
select pg_temp.claims('00000000-0000-4000-8000-000000000dd1', true); set role authenticated;
select td_tag_heat_set(pg_temp.pool(), false, false, false);
reset role;
select set_config('request.jwt.claims', '', false); set role anon;
select pg_temp.ok(pg_temp.refused(format('select tag_chat_post(%L, %L, %L)', pg_temp.tok('Bo Heat'), pg_temp.pool(), 'hi'), 'chat_off'), 'chat off = no posting');
reset role;
select pg_temp.ok(not exists (select 1 from tags where pool_id = pg_temp.pool() and status = 'held' group by holder_id having count(*) > 1)
  and (select count(*) from tags where pool_id = pg_temp.pool() and status = 'held') = 8, 'nobody lost or doubled a tag through all that');
select set_config('request.jwt.claims', '', false);
