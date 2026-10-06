-- Live rounds + TD vouch. Runs after the early access + invite tests (uses the Jewel EA set).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.mem(n text) returns uuid language sql security definer as $$ select id from tag_members where name = n $$;
create or replace function pg_temp.tok(n text) returns text language sql security definer as $$ select token from tag_members where name = n $$;
create or replace function pg_temp.ea() returns uuid language sql security definer as $$ select id from tag_pools where slug = 'jewel-xi-ea' $$;
create or replace function pg_temp.num(n text) returns int language sql security definer as $$ select number from tags where pool_id = pg_temp.ea() and holder_id = pg_temp.mem(n) $$;
create or replace function pg_temp.card() returns jsonb language sql as $$ select jsonb_agg(3) from generate_series(1, 18) $$;
create or replace function pg_temp.live(scores int) returns jsonb language sql as $$
  select jsonb_build_object('course', 'Papago', 'pars', pg_temp.card(), 'labels', null, 'players', jsonb_build_array(
    jsonb_build_object('name', 'Blake', 'member_id', null, 'scores', (select coalesce(jsonb_agg(3), '[]') from generate_series(1, scores))),
    jsonb_build_object('name', 'Guest Gus', 'member_id', null, 'scores', (select coalesce(jsonb_agg(4), '[]') from generate_series(1, scores))))) $$;
grant execute on function pg_temp.mem(text), pg_temp.tok(text), pg_temp.ea(), pg_temp.num(text), pg_temp.card(), pg_temp.live(int) to anon, authenticated;
create temp table l_ctx (k text primary key, v text);
grant all on l_ctx to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from l_ctx where k = key $$;
grant execute on function pg_temp.v(text) to anon, authenticated;
insert into l_ctx values ('id', gen_random_uuid()::text), ('secret', 'abcdefghijklmnopqrstuvwxyz123456');
select set_config('request.jwt.claims', '', false);
set client_min_messages = notice;

-- ---------- live ----------
set role anon;
select pg_temp.ok(pg_temp.refused(format('select round_live_push(%L, ''short'', null, %L)', pg_temp.v('id'), pg_temp.live(1)), 'invalid_live'), 'needs a real secret');
select pg_temp.ok(pg_temp.refused(format('select round_live_push(%L, %L, null, %L)', pg_temp.v('id'), pg_temp.v('secret'), jsonb_build_object('pars', '[]'::jsonb, 'players', '[]'::jsonb)), 'invalid_card'), 'cards are checked');
select pg_temp.ok(pg_temp.refused(format('select round_live_push(%L, %L, null, %L)', pg_temp.v('id'), pg_temp.v('secret'), jsonb_set(pg_temp.live(1), '{players,0,scores,0}', '99')), 'invalid_card'), 'scores are 1 to 20');
select round_live_push(pg_temp.v('id')::uuid, pg_temp.v('secret'), pg_temp.tok('Axl Anhyzer Jr'), pg_temp.live(3));
select pg_temp.ok((select x ->> 'course' = 'Papago' and jsonb_array_length(x -> 'card' -> 'players') = 2 from jsonb_array_elements(live_rounds()) x where x ->> 'id' = pg_temp.v('id')), 'anyone sees it live, guests by name');
select pg_temp.ok(pg_temp.refused(format('select round_live_push(%L, %L, null, %L)', pg_temp.v('id'), 'someone-else-entirely-secret-xx', pg_temp.live(4)), 'invalid_live'), 'only the scorer''s phone updates it');
select pg_temp.ok(pg_temp.refused('select * from club_live', 'permission denied'), 'the table itself is private');
reset role;
update club_live set updated_at = now() - interval '5 seconds' where id = pg_temp.v('id')::uuid;
set role anon;
select round_live_push(pg_temp.v('id')::uuid, pg_temp.v('secret'), null, pg_temp.live(5));
select pg_temp.ok((live_round(pg_temp.v('id')::uuid) -> 'card' -> 'players' -> 0 -> 'scores') = '[3,3,3,3,3]', 'updates come through');
select round_live_push(pg_temp.v('id')::uuid, pg_temp.v('secret'), null, pg_temp.live(6));
select pg_temp.ok(jsonb_array_length(live_round(pg_temp.v('id')::uuid) -> 'card' -> 'players' -> 0 -> 'scores') = 5, 'pushes 2 seconds apart (extra ones skipped)');
select round_live_end(pg_temp.v('id')::uuid, pg_temp.v('secret'));
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(live_rounds()) x where x ->> 'id' = pg_temp.v('id')) and (live_round(pg_temp.v('id')::uuid) ->> 'ended')::boolean,
  'saved: off the live strip, the link still shows the final card');
reset role;
update club_live set ended_at = null, updated_at = now() - interval '31 minutes' where id = pg_temp.v('id')::uuid;
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(live_rounds()) x where x ->> 'id' = pg_temp.v('id')), 'quiet for 30 minutes: off the strip');

-- ---------- vouch ----------
-- a 2-player Early Access round with guests, saved without tags (the rule said no)
set role anon;
insert into l_ctx select 'r', round_save(pg_temp.tok('Axl Anhyzer Jr'), jsonb_build_object('course', 'Papago', 'played_on', current_date, 'pars', pg_temp.card(),
  'players', jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Axl Anhyzer Jr'), 'scores', (select jsonb_agg(4) from generate_series(1, 18))),
                               jsonb_build_object('member_id', pg_temp.mem('Greg Wood'), 'scores', pg_temp.card()),
                               jsonb_build_object('guest_name', 'Guest Gus', 'scores', pg_temp.card()))))::text;
select pg_temp.ok(pg_temp.refused(format('select td_round_vouch(%L, %L)', pg_temp.v('r'), pg_temp.ea()), 'permission denied'), 'players can''t vouch');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000ea1a1')::text, false); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select td_round_vouch(%L, %L)', pg_temp.v('r'), pg_temp.ea()), 'forbidden'), 'only that set''s admins vouch');
select pg_temp.ok(jsonb_array_length(td_round_vouch_options(pg_temp.v('r')::uuid)) = 0, 'and they see no options');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000ea0a1', 'app_metadata', json_build_object('role', 'td'))::text, false); set role authenticated;
select pg_temp.ok((select x ->> 'pool_id' = pg_temp.ea()::text and jsonb_array_length(x -> 'holders') = 2 from jsonb_array_elements(td_round_vouch_options(pg_temp.v('r')::uuid)) x where x ->> 'pool_id' = pg_temp.ea()::text),
  'the admin sees the Early Access set with its 2 holders');
insert into l_ctx select 'a0', pg_temp.num('Axl Anhyzer Jr')::text;
insert into l_ctx select 'g0', pg_temp.num('Greg Wood')::text;
insert into l_ctx select 'm', td_round_vouch(pg_temp.v('r')::uuid, pg_temp.ea())::text;
select pg_temp.ok(pg_temp.refused(format('select td_round_vouch(%L, %L)', pg_temp.v('r'), pg_temp.ea()), 'already_exchanged'), 'once per set per round');
reset role;
select pg_temp.ok((select status = 'pending' and vouched_by = 'ea-boss@club.test' from tag_matches where id = pg_temp.v('m')::uuid), 'vouched: a pending tag round past the 2-player rule');
select pg_temp.ok((select count(*) = 1 from tag_chat where pool_id = pg_temp.ea() and event = 'vouched' and body like '%Papago%confirm on My Tag.'), 'the Board hears about it');
set role anon;
select tag_confirm(pg_temp.tok('Axl Anhyzer Jr'), pg_temp.v('m')::uuid, true);
select pg_temp.ok(tag_confirm(pg_temp.tok('Greg Wood'), pg_temp.v('m')::uuid, true) = 'applied', 'both confirm: it applies');
reset role;
select pg_temp.ok(pg_temp.num('Greg Wood') = least(pg_temp.v('a0')::int, pg_temp.v('g0')::int) and pg_temp.num('Axl Anhyzer Jr') = greatest(pg_temp.v('a0')::int, pg_temp.v('g0')::int), 'better score takes the better tag');
select set_config('request.jwt.claims', '', false);
