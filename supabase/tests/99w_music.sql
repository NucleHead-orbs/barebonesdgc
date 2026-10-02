-- Music listening acceptance tests. Run after stub + all migrations.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.live() returns bigint language sql as $$ select (music_stats()->>'live')::bigint $$;
grant execute on function pg_temp.live() to anon;
create or replace function pg_temp.plays(s text) returns bigint language sql as $$ select coalesce((music_stats()->'plays'->>s)::bigint, 0) $$;
grant execute on function pg_temp.plays(text) to anon;

set role anon;
select pg_temp.ok(pg_temp.live() = 0 and pg_temp.plays('corn-nuts') = 0, 'nobody listening yet');
select music_heartbeat('00000000-0000-4000-8000-0000000000e1', 'corn-nuts');
select music_heartbeat('00000000-0000-4000-8000-0000000000e2', 'whoa-shit');
select music_heartbeat('00000000-0000-4000-8000-0000000000e1', 'corn-nuts');
select pg_temp.ok(pg_temp.live() = 2, 'two listeners live (a repeat heartbeat is still one listener)');
select music_heartbeat('00000000-0000-4000-8000-0000000000e2', null);
select pg_temp.ok(pg_temp.live() = 1, 'pausing drops you from live');
select pg_temp.ok(music_log_play('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000e1', 'corn-nuts'), 'a play counts');
select pg_temp.ok(not music_log_play('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000e2', 'corn-nuts'), 'same play id counts once');
select pg_temp.ok(not music_log_play('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000e1', 'corn-nuts'), 'one listener cannot log plays faster than they can listen');
select pg_temp.ok(music_log_play('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000e2', 'corn-nuts'), 'another listener counts');
select pg_temp.ok(pg_temp.plays('corn-nuts') = 2, 'public count = 2');
select pg_temp.ok(pg_temp.refused($q$select music_heartbeat('00000000-0000-4000-8000-0000000000e3', 'Robert''); drop table x;--')$q$, 'bad_slug'), 'junk slugs refused');
select pg_temp.ok(pg_temp.refused('select count(*) from music_plays', 'permission denied'), 'raw plays are private');
select pg_temp.ok(pg_temp.refused('select count(*) from music_listeners', 'permission denied'), 'raw listeners are private');
select pg_temp.ok(pg_temp.refused($q$insert into music_plays values (gen_random_uuid(), gen_random_uuid(), 'corn-nuts')$q$, 'permission denied'), 'no writing around the RPC');
reset role;
update music_listeners set seen_at = now() - interval '2 minutes';
select pg_temp.ok(pg_temp.live() = 0, 'a listener who stops checking in drops off live');
delete from music_plays; delete from music_listeners;
select 'PASSED 99w_music';
