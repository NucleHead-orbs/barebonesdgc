-- Card requests / private tags / keep-apart acceptance tests. Run after stub + all migrations.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create temp table r_ctx (k text primary key, v text);
grant all on r_ctx to anon, authenticated;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.claims(sub text, admin boolean) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', sub, 'app_metadata', case when admin then '{"role":"td"}'::json else '{}'::json end)::text, false) $$;
create or replace function pg_temp.pid(n text) returns uuid language sql as $$
  select id from players where name = n and event_id = (select v::uuid from r_ctx where k = 'ev') $$;
grant execute on function pg_temp.pid(text) to anon, authenticated;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000aa', 'boss@club.test', now()),
  ('00000000-0000-4000-8000-0000000000bb', 'league@club.test', now()),
  ('00000000-0000-4000-8000-0000000000cc', 'other@club.test', now())
on conflict do nothing;

-- setup: an event run by league@, 6 players; a second event run by other@
select pg_temp.claims('00000000-0000-4000-8000-0000000000aa', true); set role authenticated;
insert into r_ctx select 'ev', td_create_event('Req Night', 'Club', '2026-10-01', '2026-10-01', null, 9, '[{"code":"OPEN"},{"code":"REC"}]')->>'id';
insert into r_ctx select 'ev2', td_create_event('Other Night', 'Club', '2026-10-01', '2026-10-01', null, 9, '[{"code":"OPEN"}]')->>'id';
insert into event_tds (event_id, email) select v::uuid, 'league@club.test' from r_ctx where k = 'ev';
insert into event_tds (event_id, email) select v::uuid, 'other@club.test' from r_ctx where k = 'ev2';
select td_import_players((select v::uuid from r_ctx where k='ev'), '[
  {"name":"Amy","div_code":"OPEN"},{"name":"Ben","div_code":"OPEN"},{"name":"Cal","div_code":"OPEN"},
  {"name":"Dee","div_code":"REC"},{"name":"Eli","div_code":"REC"},{"name":"Fay","div_code":"REC"}]');
select td_import_players((select v::uuid from r_ctx where k='ev2'), '[{"name":"Zed","div_code":"OPEN"}]');
reset role;
set client_min_messages = notice;

-- ===== 1. players submit without logging in =====
set role anon;
select pg_temp.ok(submit_card_request((select v::uuid from r_ctx where k='ev'), pg_temp.pid('Amy'), array[pg_temp.pid('Ben')], ' please! ') = 'submitted',
  'anon: player submits a request');
select pg_temp.ok(submit_card_request((select v::uuid from r_ctx where k='ev'), pg_temp.pid('Amy'), array[pg_temp.pid('Ben'), pg_temp.pid('Amy')]) = 'duplicate',
  'anon: same request again is not duplicated (self in list ignored)');
select pg_temp.ok(pg_temp.refused(format('select submit_card_request(%L, %L, array[%L]::uuid[])', (select v from r_ctx where k='ev'), pg_temp.pid('Amy'),
  (select id from players where name = 'Zed')), 'unknown_player'), 'anon: partner from another event refused');
select pg_temp.ok(pg_temp.refused(format('select submit_card_request(%L, %L, array[]::uuid[])', (select v from r_ctx where k='ev'), pg_temp.pid('Amy')), 'invalid_request'),
  'anon: no partners refused');
select pg_temp.ok(pg_temp.refused(format('select submit_card_request(%L, %L, array[%L]::uuid[], %L)', (select v from r_ctx where k='ev'), pg_temp.pid('Amy'), pg_temp.pid('Cal'), repeat('x', 141)), 'invalid_request'),
  'anon: note over 140 chars refused');
select submit_card_request((select v::uuid from r_ctx where k='ev'), pg_temp.pid('Amy'), array[pg_temp.pid('Cal')]);
select submit_card_request((select v::uuid from r_ctx where k='ev'), pg_temp.pid('Amy'), array[pg_temp.pid('Dee')]);
select pg_temp.ok(pg_temp.refused(format('select submit_card_request(%L, %L, array[%L]::uuid[])', (select v from r_ctx where k='ev'), pg_temp.pid('Amy'), pg_temp.pid('Eli')), 'too_many'),
  'anon: 4th pending request from the same player refused');
select pg_temp.ok(pg_temp.refused('select count(*) from card_requests', 'permission denied'), 'anon: cannot read requests');
select pg_temp.ok(pg_temp.refused('select count(*) from player_private', 'permission denied'), 'anon: cannot read private tags');
select pg_temp.ok(pg_temp.refused('select count(*) from keep_apart', 'permission denied'), 'anon: cannot read keep-apart pairs');
reset role;

-- ===== 2. the event's TD manages them; another event's TD sees nothing =====
select pg_temp.claims('00000000-0000-4000-8000-0000000000bb', false); set role authenticated;
select pg_temp.ok((select count(*) = 3 from card_requests where status = 'new'), 'TD: sees the 3 new requests');
select pg_temp.ok((select note = 'please!' from card_requests r join card_request_players m on m.request_id = r.id
                   where m.player_id = pg_temp.pid('Ben')), 'TD: note trimmed and kept');
update card_requests set status = 'approved', decided_at = now()
 where id in (select request_id from card_request_players where player_id = pg_temp.pid('Ben'));
update card_requests set status = 'declined', decided_at = now()
 where id in (select request_id from card_request_players where player_id = pg_temp.pid('Dee'));
insert into r_ctx select 'hand', td_add_card_request((select v::uuid from r_ctx where k='ev'), array[pg_temp.pid('Eli'), pg_temp.pid('Fay')], 'couple')::text;
insert into player_private (player_id, event_id, vibe) select pg_temp.pid('Amy'), v::uuid, 'star' from r_ctx where k='ev';
insert into player_private (player_id, event_id, vibe) select pg_temp.pid('Cal'), v::uuid, 'easy' from r_ctx where k='ev';
insert into keep_apart (event_id, player_a, player_b)
  select v::uuid, least(pg_temp.pid('Amy'), pg_temp.pid('Eli')), greatest(pg_temp.pid('Amy'), pg_temp.pid('Eli')) from r_ctx where k='ev';
select pg_temp.ok(pg_temp.refused(format('insert into player_private (player_id, event_id, vibe) values (%L, %L, ''star'')',
  (select id from players where name = 'Zed'), (select v from r_ctx where k='ev')), 'wrong_event'), 'TD: cannot tag a player from another event');
reset role;
select pg_temp.ok((select status = 'approved' and source = 'td' from card_requests where id = (select v::uuid from r_ctx where k='hand')),
  'TD: hand-added request lands approved');
select pg_temp.ok((select count(*) = 1 from card_request_players where request_id = (select v::uuid from r_ctx where k='hand') and is_requester),
  'TD: hand-added request has one requester');

select pg_temp.claims('00000000-0000-4000-8000-0000000000cc', false); set role authenticated;
select pg_temp.ok((select count(*) = 0 from card_requests) and (select count(*) = 0 from player_private) and (select count(*) = 0 from keep_apart)
                  and (select count(*) = 0 from card_request_players),
  'other event''s TD: sees no requests, tags or pairs');
with u as (update card_requests set status = 'declined' returning 1) select pg_temp.ok((select count(*) = 0 from u), 'other event''s TD: cannot decide requests');
select pg_temp.ok(pg_temp.refused(format('select td_add_card_request(%L, array[%L, %L]::uuid[])', (select v from r_ctx where k='ev'), pg_temp.pid('Amy'), pg_temp.pid('Ben')), 'forbidden'),
  'other event''s TD: cannot add requests');
reset role;

-- ===== 3. week 2 carries tags + keep-apart, never requests =====
select pg_temp.claims('00000000-0000-4000-8000-0000000000bb', false); set role authenticated;
insert into r_ctx select 'wk2', td_create_event('Req Night', null, '2026-10-08', '2026-10-08', (select v::uuid from r_ctx where k='ev'), 18, '[]', true)->>'id';
reset role;
select pg_temp.ok((select vibe = 'star' from player_private pp join players p on p.id = pp.player_id
                   where p.event_id = (select v::uuid from r_ctx where k='wk2') and p.name = 'Amy'), 'week 2: Amy still ⭐');
select pg_temp.ok((select count(*) = 1 from keep_apart where event_id = (select v::uuid from r_ctx where k='wk2')), 'week 2: keep-apart pair carried');
select pg_temp.ok((select count(*) = 0 from card_requests where event_id = (select v::uuid from r_ctx where k='wk2')), 'week 2: no requests carried');

-- ===== 4. removing a player removes them everywhere =====
delete from players where id = pg_temp.pid('Eli');
select pg_temp.ok((select count(*) = 0 from keep_apart where event_id = (select v::uuid from r_ctx where k='ev')), 'player removed: keep-apart pair gone');
select pg_temp.ok((select count(*) = 1 from card_request_players where request_id = (select v::uuid from r_ctx where k='hand')), 'player removed: dropped from request');

-- ===== 5. archived events refuse requests =====
select pg_temp.claims('00000000-0000-4000-8000-0000000000bb', false); set role authenticated;
select td_update_event((select v::uuid from r_ctx where k='ev'), '{"archived":true}');
reset role; set role anon;
select pg_temp.ok(pg_temp.refused(format('select submit_card_request(%L, %L, array[%L]::uuid[])', (select v from r_ctx where k='ev'), pg_temp.pid('Ben'), pg_temp.pid('Cal')), 'event_closed'),
  'archived event refuses requests');
reset role;

\echo ALL CARD REQUEST TESTS PASSED
