-- Multi-event acceptance tests (event-scoped TDs + build-menu rules).
-- Run after: stub, all migrations (seed included). Independent of 10_acceptance.sql.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create temp table m_ctx (k text primary key, v text);
grant all on m_ctx to anon, authenticated;

create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
-- Runs sql as the current role; true when it raised an error whose message contains want.
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin
  execute sql;
  return false;
exception when others then
  return sqlerrm like '%' || want || '%';
end $$;
grant execute on function pg_temp.refused(text, text) to authenticated;
create or replace function pg_temp.claims(sub text, admin boolean) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', sub, 'app_metadata', case when admin then '{"role":"td"}'::json else '{}'::json end)::text, false) $$;

-- people
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-00000000000a', 'mike@club.test',   now()),
  ('00000000-0000-4000-8000-00000000000b', 'Tester@Club.test', now()),   -- mixed case on purpose
  ('00000000-0000-4000-8000-00000000000c', 'late@club.test',   null),    -- never confirmed
  ('00000000-0000-4000-8000-00000000000d', 'stranger@club.test', now());
insert into m_ctx select 'jewel', id::text from events where slug = 'jewel-xi-2026';
set client_min_messages = notice;

-- ===== 1. super admin builds an event and invites =====
select pg_temp.claims('00000000-0000-4000-8000-00000000000a', true); set role authenticated;
insert into m_ctx select 'ev', td_create_event('League Night', 'Test Club', '2026-10-06', '2026-10-06', null, 9,
  '[{"code":"open","wave":"AM"},{"code":"REC","wave":"PM"}]')->>'id';
insert into event_tds (event_id, email) select v::uuid, 'tester@club.test' from m_ctx where k = 'ev';
insert into event_tds (event_id, email) select v::uuid, 'late@club.test' from m_ctx where k = 'ev';
reset role;
select pg_temp.ok((select count(*) = 9 and sum(par) = 27 from holes where event_id = (select v::uuid from m_ctx where k='ev')),
  'new event: 9 par-3 holes');
select pg_temp.ok((select string_agg(code || ':' || wave_default, ',' order by sort) = 'OPEN:AM,REC:AM'
                   from divisions where event_id = (select v::uuid from m_ctx where k='ev')),
  'new event: divisions upper-cased, in order, and all AM (single wave by default)');
select pg_temp.ok((select rounds = 1 and waves = 1 and use_checkin and not use_sponsors and skin = 'event'
                   from events where id = (select v::uuid from m_ctx where k='ev')),
  'new event defaults: 1 round, single wave, check-in on, sponsors off, neutral skin');

-- ===== 2. the event TD sees and runs only their event =====
select pg_temp.claims('00000000-0000-4000-8000-00000000000b', false); set role authenticated;
select pg_temp.ok((select array_agg(name) = array['League Night'] from td_my_events()),
  'tester (confirmed, email matched case-insensitively) sees only League Night');
select pg_temp.ok(not can_td((select v::uuid from m_ctx where k='jewel')), 'tester cannot TD Jewel XI');
select pg_temp.ok(pg_temp.refused(format('select td_update_event(%L, ''{"name":"pwned"}'')', (select v from m_ctx where k='jewel')), 'forbidden'),
  'tester: td_update_event on Jewel refused');
select pg_temp.ok(pg_temp.refused(format('select td_import_players(%L, ''[{"name":"X","div_code":"MA1"}]'')', (select v from m_ctx where k='jewel')), 'forbidden'),
  'tester: importing players into Jewel refused');
select pg_temp.ok(pg_temp.refused(format('select td_publish_round(%L, 1::smallint, ''[]'', true)', (select v from m_ctx where k='jewel')), 'forbidden'),
  'tester: publishing a Jewel round refused');
select pg_temp.ok(pg_temp.refused(format('insert into players (event_id, name, div_code) values (%L, ''X'', ''MA1'')', (select v from m_ctx where k='jewel')), 'row-level security'),
  'tester: direct insert into Jewel players blocked by RLS');
select pg_temp.ok(pg_temp.refused(format('select td_create_event(''Copy'', null, ''2026-12-01'', ''2026-12-01'', %L)', (select v from m_ctx where k='jewel')), 'forbidden'),
  'tester: duplicating Jewel refused');
select pg_temp.ok(pg_temp.refused('select td_create_event(''Mine'', null, ''2026-12-01'', ''2026-12-01'', null, 9, ''[{"code":"OPEN"}]'')', 'forbidden'),
  'tester: creating an event from scratch refused (super admin only)');
select pg_temp.ok(pg_temp.refused(format('insert into event_tds (event_id, email) values (%L, ''pal@club.test'')', (select v from m_ctx where k='ev')), 'row-level security'),
  'tester: cannot add TDs (super admin only)');
select pg_temp.ok(pg_temp.refused(format('select td_delete_event(%L)', (select v from m_ctx where k='ev')), 'forbidden'),
  'tester: cannot delete events');
with u as (update divisions set sort = 99 where event_id = (select v::uuid from m_ctx where k='jewel') returning 1)
select pg_temp.ok((select count(*) = 0 from u), 'tester: direct update of Jewel divisions touches 0 rows');
select pg_temp.ok((select count(*) = 0 from card_tokens where event_id = (select v::uuid from m_ctx where k='jewel')),
  'tester: cannot read Jewel card tokens');

-- ...but runs their own event end to end
select td_update_event((select v::uuid from m_ctx where k='ev'), '{"palette":"toxic","waves":2}');
select td_set_holes((select v::uuid from m_ctx where k='ev'),
  (select jsonb_agg(jsonb_build_object('n', g, 'par', case when g = 9 then 4 else 3 end, 'dist_ft', 200 + g)) from generate_series(1, 9) g));
select td_set_divisions((select v::uuid from m_ctx where k='ev'), '[{"code":"OPEN","wave":"AM"},{"code":"REC","wave":"PM"}]');
insert into m_ctx select 'imp', td_import_players((select v::uuid from m_ctx where k='ev'), '[
  {"name":"Ann One","div_code":"OPEN","reg_order":1,"checked_in":true},
  {"name":"Bo Two","div_code":"OPEN","reg_order":2,"checked_in":true},
  {"name":"Cy Three","div_code":"OPEN","reg_order":3,"checked_in":true},
  {"name":"Di Four","div_code":"REC","reg_order":4}]')::text;
update players set checked_in = true where name = 'Di Four';
insert into m_ctx select 'pub', td_publish_round((select v::uuid from m_ctx where k='ev'), 1::smallint, jsonb_build_array(
  jsonb_build_object('wave','AM','start_hole',1,'group_no',1,'locked',false,'player_ids',
    (select jsonb_agg(id order by reg_order) from players where event_id = (select v::uuid from m_ctx where k='ev') and div_code = 'OPEN')),
  jsonb_build_object('wave','PM','start_hole',9,'group_no',1,'locked',false,'player_ids',
    (select jsonb_agg(id) from players where event_id = (select v::uuid from m_ctx where k='ev') and div_code = 'REC'))))::text;
reset role;
select pg_temp.ok((select palette = 'toxic' and waves = 2 from events where id = (select v::uuid from m_ctx where k='ev')),
  'tester: saved palette + switched to AM/PM');
select pg_temp.ok((select sum(par) = 28 from holes where event_id = (select v::uuid from m_ctx where k='ev')), 'tester: course saved (par 28)');
select pg_temp.ok((select (v::jsonb->>'inserted')::int = 4 from m_ctx where k='imp'), 'tester: walk-ups added');
select pg_temp.ok((select count(*) = 4 from players where event_id = (select v::uuid from m_ctx where k='ev') and checked_in), 'tester: check-in saved');
select pg_temp.ok((select jsonb_array_length(v::jsonb) = 2 and bool_and(e->>'token' <> '')
                   from m_ctx, jsonb_array_elements(v::jsonb) e where k='pub' group by v), 'tester: published 2 cards with tokens');

-- ===== 3. build-menu rules =====
select pg_temp.claims('00000000-0000-4000-8000-00000000000b', false); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select td_publish_round(%L, 2::smallint, ''[]'')', (select v from m_ctx where k='ev')), 'invalid_round'),
  'rule: a 1-round event refuses a round 2 publish');
select pg_temp.ok(pg_temp.refused(format('select td_update_event(%L, ''{"waves":1}'')', (select v from m_ctx where k='ev')), 'pm_cards_exist'),
  'rule: can''t switch to single wave while PM cards are published');
select pg_temp.ok(pg_temp.refused(format('select td_set_holes(%L, ''[{"n":1,"par":3},{"n":2,"par":3}]'')', (select v from m_ctx where k='ev')), 'holes_have_cards'),
  'rule: can''t drop a hole a card starts on');
select pg_temp.ok(pg_temp.refused(format('select td_set_divisions(%L, ''[{"code":"OPEN"}]'')', (select v from m_ctx where k='ev')), 'division_in_use REC'),
  'rule: can''t drop a division that has players (names it)');
select pg_temp.ok(pg_temp.refused(format('select td_set_holes(%L, ''[{"n":1,"par":7}]'')', (select v from m_ctx where k='ev')), 'invalid_holes'),
  'rule: par outside 2-6 refused');
select pg_temp.ok(pg_temp.refused(format('select td_update_event(%L, ''{"ends_on":"2026-01-01"}'')', (select v from m_ctx where k='ev')), 'invalid_dates'),
  'rule: end before start refused');
with u as (update events set name = 'x' where id = (select v::uuid from m_ctx where k='ev') returning 1)
select pg_temp.ok((select count(*) = 0 from u), 'rule: events have no direct UPDATE path, even for their own TD (RLS matches 0 rows)');

-- the whole card flows for the tester's players: score, sign, submit, unlock
select score_sync((select e->>'token' from m_ctx, jsonb_array_elements(v::jsonb) e where k='pub' and e->>'wave'='PM'),
  (select jsonb_agg(jsonb_build_object('player_id', p.id, 'hole', g, 'strokes', 3, 'client_ts', now(), 'device_id', 't'))
     from players p, generate_series(1, 9) g where p.name = 'Di Four'));
select pg_temp.ok(sign_card((select e->>'token' from m_ctx, jsonb_array_elements(v::jsonb) e where k='pub' and e->>'wave'='PM'),
  (select id from players where name = 'Di Four'), 'df') = 'signed', 'card: signed');
select pg_temp.ok(submit_card((select e->>'token' from m_ctx, jsonb_array_elements(v::jsonb) e where k='pub' and e->>'wave'='PM')) = 'submitted', 'card: submitted');
select td_unlock_card((select (e->>'card_id')::uuid from m_ctx, jsonb_array_elements(v::jsonb) e where k='pub' and e->>'wave'='PM'));
reset role;
select pg_temp.ok((select count(*) = 0 from submissions s join cards c on c.id = s.card_id where c.event_id = (select v::uuid from m_ctx where k='ev')),
  'tester: unlocked their own card');
select pg_temp.ok((select get_card(e->>'token')->'event'->>'name' = 'League Night' and get_card(e->>'token')->'event'->>'palette' = 'toxic'
                   from m_ctx, jsonb_array_elements(v::jsonb) e where k='pub' and e->>'wave'='PM'),
  'get_card carries the event name + palette for the scorecard');

-- ===== 4. league week 2 =====
select pg_temp.claims('00000000-0000-4000-8000-00000000000b', false); set role authenticated;
insert into m_ctx select 'wk2', td_create_event('League Night', null, '2026-10-13', '2026-10-13',
  (select v::uuid from m_ctx where k='ev'), 18, '[]', true)->>'id';
reset role;
select pg_temp.ok((select slug = 'league-night-2026-10-13' and palette = 'toxic' and waves = 2 and club_name = 'Test Club'
                   from events where id = (select v::uuid from m_ctx where k='wk2')), 'duplicate: format, palette, club copied; slug from new date');
select pg_temp.ok((select count(*) = 9 from holes where event_id = (select v::uuid from m_ctx where k='wk2')), 'duplicate: course copied');
select pg_temp.ok((select count(*) = 4 and bool_and(not checked_in) from players where event_id = (select v::uuid from m_ctx where k='wk2')),
  'duplicate: players copied, nobody checked in');
select pg_temp.ok((select count(*) = 0 from cards where event_id = (select v::uuid from m_ctx where k='wk2')), 'duplicate: no cards copied');
select pg_temp.ok((select count(*) = 2 from event_tds where event_id = (select v::uuid from m_ctx where k='wk2')), 'duplicate: TD list copied');

-- ===== 5. unconfirmed and unrelated accounts get nothing =====
select pg_temp.claims('00000000-0000-4000-8000-00000000000c', false); set role authenticated;
select pg_temp.ok((select count(*) = 0 from td_my_events()), 'unconfirmed email: no events even though invited');
select pg_temp.claims('00000000-0000-4000-8000-00000000000d', false);
select pg_temp.ok((select count(*) = 0 from td_my_events()), 'stranger: no events');
select pg_temp.ok((select count(*) = 0 from event_tds), 'stranger: cannot see anyone''s TD list');
reset role;
set role anon;
select pg_temp.ok(pg_temp.refused('select td_my_events()', 'permission denied'), 'anon: TD functions not callable');
reset role;

-- ===== 6. super admin can delete a finished event (submitted cards included); Jewel is protected =====
select pg_temp.claims('00000000-0000-4000-8000-00000000000a', true); set role authenticated;
select submit_card(e->>'token') from m_ctx, jsonb_array_elements(v::jsonb) e where k='pub' and e->>'wave'='PM';
select sign_card((select e->>'token' from m_ctx, jsonb_array_elements(v::jsonb) e where k='pub' and e->>'wave'='PM'),
  (select id from players where name = 'Di Four' and event_id = (select v::uuid from m_ctx where k='ev')), 'df');
select submit_card(e->>'token') from m_ctx, jsonb_array_elements(v::jsonb) e where k='pub' and e->>'wave'='PM';
select pg_temp.ok(pg_temp.refused(format('select td_delete_event(%L)', (select v from m_ctx where k='jewel')), 'protected_event'), 'admin: Jewel XI cannot be deleted');
select td_delete_event((select v::uuid from m_ctx where k='ev'));
select td_delete_event((select v::uuid from m_ctx where k='wk2'));
reset role;
select pg_temp.ok((select count(*) = 0 from events where slug like 'league-night%'), 'admin: deleted both test events (submitted card and all)');
select pg_temp.ok((select count(*) = 1 from events where slug = 'jewel-xi-2026'), 'Jewel XI untouched');

\echo ALL MULTI-EVENT TESTS PASSED
