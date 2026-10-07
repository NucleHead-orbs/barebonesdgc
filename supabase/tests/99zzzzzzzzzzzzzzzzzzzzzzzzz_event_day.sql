-- Event day: publishing one wave at a time (td_publish_wave) + pack sizes for the check-in crew. Runs in a transaction and rolls back.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
begin;
create temp table w_ctx (k text primary key, v text) on commit drop;
grant all on w_ctx to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from w_ctx where k = key $$;
create or replace function pg_temp.pid(n text) returns text language sql as $$ select id::text from players where name = n and event_id = (select id from events where slug = 'jewel-xi-2026') $$;
grant execute on function pg_temp.v(text), pg_temp.pid(text) to anon, authenticated;
insert into w_ctx select 'ev', id::text from events where slug = 'jewel-xi-2026';
insert into w_ctx select 'am_ids', string_agg(id::text, ',' order by label) from cards where event_id = pg_temp.v('ev')::uuid and round = 1 and wave = 'AM';
insert into submissions (card_id) select id from cards where event_id = pg_temp.v('ev')::uuid and round = 1 and wave = 'AM' and label = '7B';
insert into scores (player_id, round, hole, strokes, client_ts, device_id) values (pg_temp.pid('Vince Putt')::uuid, 1, 7, 3, now(), 'x')
  on conflict (player_id, round, hole) do update set strokes = 3;
delete from scores where round = 1 and player_id in (pg_temp.pid('Rusty H.')::uuid, pg_temp.pid('Chainz McGee')::uuid, pg_temp.pid('Dee Skip')::uuid);
set client_min_messages = notice;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","app_metadata":{"role":"td"}}', false);
set role authenticated;
select pg_temp.ok((select jsonb_array_length(td_publish_wave(pg_temp.v('ev')::uuid, 1::smallint, 'PM', jsonb_build_array(
  jsonb_build_object('wave', 'PM', 'start_hole', 1, 'group_no', 1, 'player_ids', jsonb_build_array(pg_temp.pid('Rusty H.'), pg_temp.pid('Chainz McGee'), pg_temp.pid('Dee Skip'))))))) = 3,
  'PM publishes while the AM wave is already scoring; returns both waves');
reset role;
select pg_temp.ok((select string_agg(id::text, ',' order by label) from cards where event_id = pg_temp.v('ev')::uuid and round = 1 and wave = 'AM') = pg_temp.v('am_ids'), 'AM cards untouched (same cards)');
select pg_temp.ok((select count(*) = 1 from submissions s join cards c on c.id = s.card_id where c.event_id = pg_temp.v('ev')::uuid and c.round = 1 and c.wave = 'AM'), 'AM submission kept');
select pg_temp.ok(exists (select 1 from card_tokens where event_id = pg_temp.v('ev')::uuid and round = 1 and wave = 'PM' and label = '1'), 'PM card got a printed-code token');
insert into scores (player_id, round, hole, strokes, client_ts, device_id) values (pg_temp.pid('Dee Skip')::uuid, 1, 1, 3, now(), 'x');
insert into w_ctx select 'pm_tok', token from card_tokens where event_id = pg_temp.v('ev')::uuid and round = 1 and wave = 'PM' and label = '1';
set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select td_publish_wave(%L, 1::smallint, %L, %L)', pg_temp.v('ev'), 'PM', jsonb_build_array(
  jsonb_build_object('wave', 'PM', 'start_hole', 2, 'group_no', 1, 'player_ids', jsonb_build_array(pg_temp.pid('Rusty H.'), pg_temp.pid('Chainz McGee'), pg_temp.pid('Dee Skip'))))), 'wave_has_scores'),
  'a wave with scores needs a force republish');
select pg_temp.ok((select jsonb_array_length(td_publish_wave(pg_temp.v('ev')::uuid, 1::smallint, 'PM', jsonb_build_array(
  jsonb_build_object('wave', 'PM', 'start_hole', 1, 'group_no', 1, 'player_ids', jsonb_build_array(pg_temp.pid('Rusty H.'), pg_temp.pid('Chainz McGee'), pg_temp.pid('Dee Skip')))), true))) = 3,
  'force republish works');
reset role;
select pg_temp.ok((select token from card_tokens where event_id = pg_temp.v('ev')::uuid and round = 1 and wave = 'PM' and label = '1') = pg_temp.v('pm_tok')
  and exists (select 1 from scores where player_id = pg_temp.pid('Dee Skip')::uuid and round = 1 and hole = 1), 'printed code and scores survive a republish');
select pg_temp.ok((select count(*) = 1 from submissions s join cards c on c.id = s.card_id where c.event_id = pg_temp.v('ev')::uuid and c.round = 1 and c.wave = 'AM'), 'AM submission still kept');
set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select td_publish_wave(%L, 1::smallint, %L, %L, true)', pg_temp.v('ev'), 'PM', jsonb_build_array(
  jsonb_build_object('wave', 'PM', 'start_hole', 1, 'group_no', 1, 'player_ids', jsonb_build_array(pg_temp.pid('Rusty H.'), pg_temp.pid('Lita Ford'), pg_temp.pid('Dee Skip'))))), 'player_on_other_wave'),
  'nobody on both waves');
select pg_temp.ok(pg_temp.refused(format('select td_publish_wave(%L, 1::smallint, %L, %L, true)', pg_temp.v('ev'), 'PM', jsonb_build_array(
  jsonb_build_object('wave', 'AM', 'start_hole', 1, 'group_no', 1, 'player_ids', jsonb_build_array(pg_temp.pid('Rusty H.'))))), 'invalid_wave'),
  'cards must match the wave being published');
reset role;
select set_config('request.jwt.claims', '', false);
set role anon;
select pg_temp.ok(pg_temp.refused(format('select td_publish_wave(%L, 1::smallint, %L, %L)', pg_temp.v('ev'), 'PM', '[]'), 'permission denied'), 'not for the public');
reset role;

-- ---------- pack bags at check-in ----------
insert into crew (event_id, name, roles) values (pg_temp.v('ev')::uuid, 'Desk Dana', array['checkin']), (pg_temp.v('ev')::uuid, 'Raffle Ray', array['raffle']);
update players set shirt_size = case name when 'Vince Putt' then 'L' when 'Dee Skip' then ' ' else shirt_size end where event_id = pg_temp.v('ev')::uuid;
insert into w_ctx select 'desk', token from crew where name = 'Desk Dana';
insert into w_ctx select 'raffle', token from crew where name = 'Raffle Ray';
set role anon;
select pg_temp.ok((select (crew_pack_sizes(pg_temp.v('desk')))->>pg_temp.pid('Vince Putt')) = 'L', 'check-in crew sees which bag (shirt size)');
select pg_temp.ok(not (crew_pack_sizes(pg_temp.v('desk')) ? pg_temp.pid('Dee Skip')), 'blank sizes are left out');
select pg_temp.ok(pg_temp.refused(format('select crew_pack_sizes(%L)', pg_temp.v('raffle')), 'forbidden'), 'only the check-in crew');
reset role;
rollback;
