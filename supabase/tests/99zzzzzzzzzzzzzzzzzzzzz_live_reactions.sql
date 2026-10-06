-- Live reactions. Runs after the live test (members from the early access tests).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon;
create or replace function pg_temp.tok(n text) returns text language sql security definer as $$ select token from tag_members where name = n $$;
grant execute on function pg_temp.tok(text) to anon;
create temp table x_ctx (k text primary key, v text);
grant all on x_ctx to anon;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from x_ctx where k = key $$;
grant execute on function pg_temp.v(text) to anon;
insert into x_ctx values ('id', gen_random_uuid()::text), ('secret', 'reaction-test-secret-0123456789');
select set_config('request.jwt.claims', '', false);
set client_min_messages = notice;

set role anon;
select round_live_push(pg_temp.v('id')::uuid, pg_temp.v('secret'), null,
  '{"course":"Papago","pars":[3,3],"labels":null,"players":[{"name":"Blake","member_id":null,"scores":[3]},{"name":"Guest Gus","member_id":null,"scores":[4]}]}');
select pg_temp.ok(pg_temp.refused(format('select live_react(%L, ''nope-nope-nope-nope-nope'', ''skull'', null)', pg_temp.v('id')), 'invalid_link'), 'you need a My Tag link to send');
select pg_temp.ok(pg_temp.refused(format('select live_react(%L, %L, ''poop'', null)', pg_temp.v('id'), pg_temp.tok('Greg Wood')), 'invalid_reaction'), 'eight reactions only');
select pg_temp.ok(pg_temp.refused(format('select live_react(%L, %L, ''skull'', ''Nobody'')', pg_temp.v('id'), pg_temp.tok('Greg Wood')), 'unknown_player'), 'target is someone on the card');
insert into x_ctx select 'r1', live_react(pg_temp.v('id')::uuid, pg_temp.tok('Greg Wood'), 'skull', 'Blake')::text;
select pg_temp.ok(pg_temp.refused(format('select live_react(%L, %L, ''clap'', null)', pg_temp.v('id'), pg_temp.tok('Greg Wood')), 'slow_down'), 'one every 15 seconds each');
select live_react(pg_temp.v('id')::uuid, pg_temp.tok('Axl Anhyzer Jr'), 'clap', null);
select pg_temp.ok((select (x -> 'list' -> 0 ->> 'who') = 'Woody' and (x -> 'list' -> 0 ->> 'target') = 'Blake' and jsonb_array_length(x -> 'list') = 2 from (select live_reactions(pg_temp.v('id')::uuid, 0) x) z),
  'everyone reads them, with who sent them (nickname)');
select pg_temp.ok(jsonb_array_length(live_reactions(pg_temp.v('id')::uuid, pg_temp.v('r1')::bigint) -> 'list') = 1, 'only the new ones after an id');
select pg_temp.ok(pg_temp.refused(format('select round_live_mute(%L, ''wrong-secret-wrong-secret-xx'', true)', pg_temp.v('id')), 'invalid_live'), 'only the scorer mutes');
select round_live_mute(pg_temp.v('id')::uuid, pg_temp.v('secret'), true);
select pg_temp.ok((live_round(pg_temp.v('id')::uuid) ->> 'muted')::boolean and (live_reactions(pg_temp.v('id')::uuid, 0) ->> 'muted')::boolean, 'muted shows');
select pg_temp.ok(pg_temp.refused(format('select live_react(%L, %L, ''fire'', null)', pg_temp.v('id'), pg_temp.tok('Rex')), 'muted'), 'muted = no reactions');
select round_live_mute(pg_temp.v('id')::uuid, pg_temp.v('secret'), false);
select round_live_end(pg_temp.v('id')::uuid, pg_temp.v('secret'));
select pg_temp.ok(pg_temp.refused(format('select live_react(%L, %L, ''fire'', null)', pg_temp.v('id'), pg_temp.tok('Rex')), 'not_live'), 'saved rounds take no more');
select pg_temp.ok(pg_temp.refused('select * from club_live_reactions', 'permission denied'), 'table is private');
reset role;
