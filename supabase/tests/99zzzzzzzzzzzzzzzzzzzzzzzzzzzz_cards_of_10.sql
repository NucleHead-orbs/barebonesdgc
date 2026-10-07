-- Cards of 10: Scorecard rounds, the live mirror and manual tag rounds take up to 10. Runs in a transaction, rolls back.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
begin;
insert into tag_pools (slug, name, sort) values ('ten-test', 'Ten Test', 94);
insert into tag_members (name) select 'Ten ' || g from generate_series(1, 11) g;
insert into tags (pool_id, number, holder_id, status) select (select id from tag_pools where slug = 'ten-test'), g, (select id from tag_members where name = 'Ten ' || g), 'held' from generate_series(1, 11) g;
create or replace function pg_temp.tok() returns text language sql security definer as $$ select token from tag_members where name = 'Ten 1' $$;
create or replace function pg_temp.card(n int) returns jsonb language sql security definer as $$
  select jsonb_build_object('course', 'Ten Park', 'played_on', current_date, 'pars', jsonb_build_array(3, 3, 3),
    'players', jsonb_build_array(jsonb_build_object('member_id', (select id from tag_members where name = 'Ten 1'), 'scores', jsonb_build_array(3, 3, 3)))
      || coalesce((select jsonb_agg(jsonb_build_object('guest_name', 'Guest ' || g, 'scores', jsonb_build_array(3, 4, 3))) from generate_series(2, n) g), '[]'))
$$;
create or replace function pg_temp.tagplayers(n int) returns jsonb language sql security definer as $$
  select jsonb_agg(jsonb_build_object('member_id', (select id from tag_members where name = 'Ten ' || g), 'score', 50 + g)) from generate_series(1, n) g
$$;
grant execute on function pg_temp.tok(), pg_temp.card(int), pg_temp.tagplayers(int) to anon, authenticated;
set client_min_messages = notice;
set role anon;
select pg_temp.ok(round_save(pg_temp.tok(), pg_temp.card(10)) is not null, 'a Scorecard round of 10 saves');
select pg_temp.ok(pg_temp.refused(format('select round_save(%L, %L)', pg_temp.tok(), pg_temp.card(11)), 'players_1_to_10'), '11 is too many');
select pg_temp.ok(tag_log(pg_temp.tok(), (select id from tag_pools where slug = 'ten-test'), pg_temp.tagplayers(10), 'Ten Park', current_date) is not null, 'a manual tag round of 10');
select pg_temp.ok(pg_temp.refused(format('select tag_log(%L, %L, %L, null, current_date)', pg_temp.tok(), (select id from tag_pools where slug = 'ten-test'), pg_temp.tagplayers(11)), 'players_2_to_10'), '...not 11');
reset role;
select pg_temp.ok((select max(seq) = 10 from club_round_players p join club_rounds r on r.id = p.round_id where r.course = 'Ten Park'), 'seats 1-10 stored');
do $$ begin perform public._live_check((select pg_temp.card(10)) || jsonb_build_object('players', (select jsonb_agg(jsonb_build_object('name', 'P' || g, 'scores', jsonb_build_array(3))) from generate_series(1, 10) g))); raise notice 'pass: the live mirror takes 10'; end $$;
select pg_temp.ok(pg_temp.refused($$select public._live_check(jsonb_build_object('pars', jsonb_build_array(3), 'players', (select jsonb_agg(jsonb_build_object('name', 'P' || g, 'scores', jsonb_build_array(3))) from generate_series(1, 11) g)))$$, 'invalid_card'), '...not 11');
rollback;
