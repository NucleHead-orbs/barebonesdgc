-- Crew view acceptance tests. Run after stub + all migrations.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create temp table w_ctx (k text primary key, v text);
grant all on w_ctx to anon, authenticated;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.claims(sub text, admin boolean) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', sub, 'app_metadata', case when admin then '{"role":"td"}'::json else '{}'::json end)::text, false) $$;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from w_ctx where k = key $$;
grant execute on function pg_temp.v(text) to anon, authenticated;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000a4', 'w-boss@crew.test', now()),
  ('00000000-0000-4000-8000-0000000000b4', 'w-td@crew.test', now()),
  ('00000000-0000-4000-8000-0000000000c4', 'w-other@crew.test', now())
on conflict do nothing;

-- setup: event A (TD w-td) with players + tasks; event B (TD w-other)
select pg_temp.claims('00000000-0000-4000-8000-0000000000a4', true); set role authenticated;
insert into w_ctx select 'ev', td_create_event('Crew Night', 'Club', '2026-11-21', '2026-11-21', null, 9, '[{"code":"MA1"},{"code":"MA2"}]')->>'id';
insert into w_ctx select 'evB', td_create_event('Other Night', 'Club', '2026-11-21', '2026-11-21', null, 9, '[{"code":"MA1"}]')->>'id';
insert into event_tds (event_id, email) select v::uuid, 'w-td@crew.test' from w_ctx where k = 'ev';
insert into event_tds (event_id, email) select v::uuid, 'w-other@crew.test' from w_ctx where k = 'evB';
reset role;
select pg_temp.claims('00000000-0000-4000-8000-0000000000b4', false); set role authenticated;
select td_import_players(pg_temp.v('ev')::uuid, '[{"name":"Amy","div_code":"MA1"},{"name":"Ben","div_code":"MA1"},{"name":"Cal","div_code":"MA2"}]');
with x as (insert into crew (event_id, name, roles) values (pg_temp.v('ev')::uuid, 'Sally', '{checkin,raffle}') returning id) insert into w_ctx select 'sal', id::text from x;
with x as (insert into crew (event_id, name, roles) values (pg_temp.v('ev')::uuid, 'Rex', '{requests,contacts}') returning id) insert into w_ctx select 'rex', id::text from x;
with x as (insert into prep_tasks (event_id, title, sort, crew_id) values (pg_temp.v('ev')::uuid, 'Pick up raffle prizes', 0, pg_temp.v('sal')::uuid) returning id) insert into w_ctx select 't1', id::text from x;
with x as (insert into prep_tasks (event_id, title, sort) values (pg_temp.v('ev')::uuid, 'Walk the course', 1) returning id) insert into w_ctx select 't2', id::text from x;
with x as (insert into announcements (event_id, title, body, created_by) values (pg_temp.v('ev')::uuid, 'Arrive 7am', 'Everyone at the pavilion.', 'w-td@crew.test') returning id) insert into w_ctx select 'aAll', id::text from x;
with x as (insert into announcements (event_id, title, roles) values (pg_temp.v('ev')::uuid, 'Raffle float is $100', '{raffle}') returning id) insert into w_ctx select 'aRaf', id::text from x;
reset role;
select pg_temp.claims('00000000-0000-4000-8000-0000000000c4', false); set role authenticated;
select td_import_players(pg_temp.v('evB')::uuid, '[{"name":"Zed","div_code":"MA1"}]');
with x as (insert into crew (event_id, name, roles) values (pg_temp.v('evB')::uuid, 'Zoe', '{checkin}') returning id) insert into w_ctx select 'zed_crew', id::text from x;
reset role;
insert into w_ctx select 'tokS', token from crew where id = pg_temp.v('sal')::uuid;
insert into w_ctx select 'tokR', token from crew where id = pg_temp.v('rex')::uuid;
insert into w_ctx select 'zed', id::text from players where name = 'Zed' and event_id = pg_temp.v('evB')::uuid;
set client_min_messages = notice;

select pg_temp.ok((select length(pg_temp.v('tokS')) = 32 and pg_temp.v('tokS') <> pg_temp.v('tokR')), 'each crew member gets their own 32-char link');

-- ===== privacy =====
set role anon;
select pg_temp.ok(pg_temp.refused('select count(*) from crew', 'permission denied'), 'anon: cannot read crew (or their links)');
select pg_temp.ok(pg_temp.refused('select count(*) from raffle_sales', 'permission denied'), 'anon: cannot read raffle sales');
select pg_temp.ok(pg_temp.refused('select count(*) from contacts', 'permission denied'), 'anon: cannot read contacts');
select pg_temp.ok(pg_temp.refused('select count(*) from announcements', 'permission denied'), 'anon: cannot read announcements directly');
select pg_temp.ok(pg_temp.refused('select crew_home(''not-a-real-link-0000000000000000'')', 'invalid_link'), 'a made-up link is refused');
reset role;
select pg_temp.claims('00000000-0000-4000-8000-0000000000c4', false); set role authenticated;
select pg_temp.ok((select count(*) = 0 from crew where event_id = pg_temp.v('ev')::uuid) and (select count(*) = 0 from announcements where event_id = pg_temp.v('ev')::uuid),
  'other event''s TD: sees none of this event''s crew or announcements');
reset role;

-- ===== briefing =====
set role anon;
select pg_temp.ok((select jsonb_array_length(crew_home(pg_temp.v('tokS'))->'announcements') = 2), 'Sally (raffle) sees the everyone + raffle announcements');
select pg_temp.ok((select jsonb_array_length(crew_home(pg_temp.v('tokR'))->'announcements') = 1), 'Rex (no raffle role) sees only the everyone one');
select pg_temp.ok((select crew_home(pg_temp.v('tokS')) ? 'players' and crew_home(pg_temp.v('tokS')) ? 'raffle' and not crew_home(pg_temp.v('tokS')) ? 'contacts'),
  'Sally''s page has players + raffle, no contacts');
select pg_temp.ok((select not crew_home(pg_temp.v('tokR')) ? 'raffle' and crew_home(pg_temp.v('tokR')) ? 'contacts'), 'Rex''s page has contacts, no raffle');
select crew_ack(pg_temp.v('tokS'), pg_temp.v('aAll')::uuid);
select crew_ack(pg_temp.v('tokS'), pg_temp.v('aAll')::uuid);
select pg_temp.ok(pg_temp.refused(format('select crew_ack(%L, %L)', pg_temp.v('tokR'), pg_temp.v('aRaf')), 'not_found'), 'cannot ack an announcement not meant for you');
reset role;
select pg_temp.ok((select count(*) = 1 from announcement_reads where announcement_id = pg_temp.v('aAll')::uuid), 'Got it recorded once');
select pg_temp.ok((select last_seen_at is not null from crew where id = pg_temp.v('sal')::uuid), 'opening the link records last seen');
select pg_temp.claims('00000000-0000-4000-8000-0000000000b4', false); set role authenticated;
select pg_temp.ok((select count(*) = 1 from announcement_reads), 'TD sees the read receipt');
reset role;

-- ===== tasks =====
set role anon;
select crew_task_done(pg_temp.v('tokS'), pg_temp.v('t1')::uuid, true);
select pg_temp.ok(pg_temp.refused(format('select crew_task_done(%L, %L, true)', pg_temp.v('tokS'), pg_temp.v('t2')), 'not_your_task'), 'crew can only tick tasks assigned to them');
select crew_task_note(pg_temp.v('tokR'), pg_temp.v('t2')::uuid, '  Course looks good, 7 baskets need flags ');
select pg_temp.ok(pg_temp.refused(format('select crew_task_note(%L, %L, '' '')', pg_temp.v('tokR'), pg_temp.v('t2')), 'invalid_note'), 'blank notes refused');
reset role;
select pg_temp.ok((select done_at is not null and done_by = 'Sally' from prep_tasks where id = pg_temp.v('t1')::uuid), 'Sally ticked her task (done by Sally)');
select pg_temp.ok((select author = 'Rex' and body = 'Course looks good, 7 baskets need flags' from prep_task_notes where task_id = pg_temp.v('t2')::uuid), 'Rex''s update is on the task');
select pg_temp.claims('00000000-0000-4000-8000-0000000000b4', false); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('update prep_tasks set crew_id = %L where id = %L', pg_temp.v('zed_crew'), pg_temp.v('t2')), 'wrong_event'),
  'a task can''t be assigned to another event''s crew');
reset role;

-- ===== check-in =====
set role anon;
select crew_checkin(pg_temp.v('tokS'), (select id from players where name = 'Amy' and event_id = pg_temp.v('ev')::uuid), true);
select pg_temp.ok(pg_temp.refused(format('select crew_checkin(%L, %L, true)', pg_temp.v('tokS'), pg_temp.v('zed')), 'unknown_player'), 'Sally cannot check in another event''s player');
select pg_temp.ok(pg_temp.refused(format('select crew_checkin(%L, %L, true)', pg_temp.v('tokR'), (select id from players where name = 'Ben' and event_id = pg_temp.v('ev')::uuid)), 'not_your_role'), 'Rex (no check-in role) cannot check people in');
select crew_walkup(pg_temp.v('tokS'), '  Dee   Driver ', 'ma2');
select crew_walkup(pg_temp.v('tokS'), 'dee driver', 'MA2');
select pg_temp.ok(pg_temp.refused(format('select crew_walkup(%L, ''Eve'', ''ZZZ'')', pg_temp.v('tokS')), 'invalid_division'), 'walk-up needs a real division');
reset role;
select pg_temp.ok((select checked_in from players where name = 'Amy' and event_id = pg_temp.v('ev')::uuid), 'Amy checked in by crew');
select pg_temp.ok((select count(*) = 1 and bool_and(checked_in) and bool_and(div_code = 'MA2') from players where event_id = pg_temp.v('ev')::uuid and name = 'Dee Driver'),
  'walk-up added once, checked in (repeat name updates, never duplicates)');

-- ===== raffle =====
set role anon;
insert into w_ctx select 's1', crew_raffle_sale(pg_temp.v('tokS'), 'Amy', 5, 20, 'cash')::text;
insert into w_ctx select 's2', crew_raffle_sale(pg_temp.v('tokS'), null, 25, 50, 'card')::text;
select crew_raffle_void(pg_temp.v('tokS'), pg_temp.v('s2')::uuid);
select pg_temp.ok(pg_temp.refused(format('select crew_raffle_void(%L, %L)', pg_temp.v('tokS'), pg_temp.v('s2')), 'not_your_sale'), 'a sale can''t be voided twice');
select pg_temp.ok(pg_temp.refused(format('select crew_raffle_sale(%L, null, 1, 5, ''cash'')', pg_temp.v('tokR')), 'not_your_role'), 'Rex (no raffle role) cannot log sales');
select pg_temp.ok(pg_temp.refused(format('select crew_raffle_sale(%L, null, 0, 5, ''cash'')', pg_temp.v('tokS')), 'check'), 'zero tickets refused');
select pg_temp.ok((select (crew_home(pg_temp.v('tokS'))->'raffle'->>'total')::numeric = 20 and (crew_home(pg_temp.v('tokS'))->'raffle'->>'tickets')::int = 5),
  'raffle total counts only un-voided sales');
reset role;
select pg_temp.ok((select voided_at is not null and logged_by = 'Sally' from raffle_sales where id = pg_temp.v('s2')::uuid), 'voided sale kept (never deleted), logged by Sally');

-- ===== card requests =====
set role anon;
insert into w_ctx select 'req', crew_card_request(pg_temp.v('tokR'), array[(select id from players where name = 'Ben' and event_id = pg_temp.v('ev')::uuid), (select id from players where name = 'Cal' and event_id = pg_temp.v('ev')::uuid)], 'brothers')::text;
select pg_temp.ok(pg_temp.refused(format('select crew_card_request(%L, array[%L, %L]::uuid[])', pg_temp.v('tokR'), (select id from players where name = 'Ben' and event_id = pg_temp.v('ev')::uuid), pg_temp.v('zed')), 'unknown_player'),
  'a request can''t include another event''s player');
select pg_temp.ok(pg_temp.refused(format('select crew_card_request(%L, array[%L]::uuid[])', pg_temp.v('tokR'), (select id from players where name = 'Ben' and event_id = pg_temp.v('ev')::uuid)), 'invalid_request'), 'a request needs 2+ players');
select pg_temp.ok(pg_temp.refused(format('select crew_card_request(%L, array[%L, %L]::uuid[])', pg_temp.v('tokS'), (select id from players where name = 'Ben' and event_id = pg_temp.v('ev')::uuid), (select id from players where name = 'Cal' and event_id = pg_temp.v('ev')::uuid)), 'not_your_role'),
  'Sally (no requests role) cannot submit card requests');
select pg_temp.ok((select jsonb_array_length(crew_home(pg_temp.v('tokR'))->'my_requests') = 1), 'Rex sees his request');
reset role;
select pg_temp.ok((select status = 'new' and source = 'crew' and crew_id = pg_temp.v('rex')::uuid from card_requests where id = pg_temp.v('req')::uuid), 'crew request lands NEW for the TD');

-- ===== contacts =====
set role anon;
insert into w_ctx select 'k1', crew_add_contact(pg_temp.v('tokR'), '{"kind":"sponsor","name":"Jo","org":"Joe''s Tacos","phone":"480-555-0100","amount":"250"}')::text;
select pg_temp.ok(pg_temp.refused(format('select crew_update_contact(%L, %L, ''to_ask'', null)', pg_temp.v('tokR'), pg_temp.v('k1')), 'lead_needs_td'), 'crew can''t approve their own lead');
select pg_temp.ok(pg_temp.refused(format('select crew_add_contact(%L, ''{"name":"X"}'')', pg_temp.v('tokS')), 'not_your_role'), 'Sally (no contacts role) cannot add contacts');
reset role;
select pg_temp.ok((select status = 'lead' and created_by = 'Rex' and amount = 250 from contacts where id = pg_temp.v('k1')::uuid), 'lead added by Rex, owned by Rex');
select pg_temp.claims('00000000-0000-4000-8000-0000000000b4', false); set role authenticated;
update contacts set status = 'to_ask' where id = pg_temp.v('k1')::uuid;
reset role;
set role anon;
select crew_update_contact(pg_temp.v('tokR'), pg_temp.v('k1')::uuid, 'yes', 'Said yes to a hole');
reset role;
select pg_temp.ok((select status = 'yes' and notes = 'Said yes to a hole' from contacts where id = pg_temp.v('k1')::uuid), 'owner moved it to yes after the TD approved the lead');
select pg_temp.claims('00000000-0000-4000-8000-0000000000b4', false); set role authenticated;
insert into w_ctx select 'sp', td_promote_contact(pg_temp.v('k1')::uuid)::text;
select pg_temp.ok(td_promote_contact(pg_temp.v('k1')::uuid)::text = pg_temp.v('sp'), 'promoting twice returns the same sponsor');
reset role;
select pg_temp.ok((select name = 'Joe''s Tacos' and hidden from sponsors where id = pg_temp.v('sp')::uuid), 'promoted sponsor lands hidden (TD approves in Sponsors)');
select pg_temp.claims('00000000-0000-4000-8000-0000000000c4', false); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select td_promote_contact(%L)', pg_temp.v('k1')), 'forbidden'), 'other event''s TD cannot promote it');
select pg_temp.ok(pg_temp.refused(format('select td_new_crew_link(%L)', pg_temp.v('sal')), 'forbidden'), 'other event''s TD cannot reissue a link');
reset role;

-- ===== revoke + new link =====
select pg_temp.claims('00000000-0000-4000-8000-0000000000b4', false); set role authenticated;
update crew set revoked_at = now() where id = pg_temp.v('sal')::uuid;
reset role;
set role anon;
select pg_temp.ok(pg_temp.refused(format('select crew_home(%L)', pg_temp.v('tokS')), 'invalid_link'), 'revoked link is dead');
reset role;
select pg_temp.claims('00000000-0000-4000-8000-0000000000b4', false); set role authenticated;
insert into w_ctx select 'tokS2', td_new_crew_link(pg_temp.v('sal')::uuid);
reset role;
set role anon;
select pg_temp.ok((crew_home(pg_temp.v('tokS2'))->'me'->>'name') = 'Sally' and pg_temp.v('tokS2') <> pg_temp.v('tokS'), 'a new link works; the old one stays dead');
select pg_temp.ok(pg_temp.refused(format('select crew_home(%L)', pg_temp.v('tokS')), 'invalid_link'), 'old link still dead after reissue');
reset role;

-- ===== archived event closes links =====
select pg_temp.claims('00000000-0000-4000-8000-0000000000b4', false); set role authenticated;
insert into w_ctx select 'wk2', td_create_event('Crew Night', null, '2026-11-28', '2026-11-28', pg_temp.v('ev')::uuid, 18, '[]', false)->>'id';
select td_update_event(pg_temp.v('ev')::uuid, '{"archived":true}');
reset role;
set role anon;
select pg_temp.ok(pg_temp.refused(format('select crew_home(%L)', pg_temp.v('tokR')), 'event_closed'), 'archived event: crew links close');
reset role;
select pg_temp.ok((select count(*) = 2 and bool_and(token not in (pg_temp.v('tokR'), pg_temp.v('tokS2'))) from crew where event_id = pg_temp.v('wk2')::uuid),
  'duplicate carries the roster with brand-new links');
select pg_temp.ok((select count(*) = 0 from announcements where event_id = pg_temp.v('wk2')::uuid) and (select count(*) = 0 from raffle_sales where event_id = pg_temp.v('wk2')::uuid),
  'duplicate starts with no announcements or raffle sales');

\echo ALL CREW TESTS PASSED
