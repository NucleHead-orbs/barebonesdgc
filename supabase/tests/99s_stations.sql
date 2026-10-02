-- Volunteer station grid acceptance tests. Run after stub + all migrations.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create temp table s_ctx (k text primary key, v text);
grant all on s_ctx to anon, authenticated;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.claims(sub text, admin boolean) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', sub, 'app_metadata', case when admin then '{"role":"td"}'::json else '{}'::json end)::text, false) $$;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from s_ctx where k = key $$;
grant execute on function pg_temp.v(text) to anon, authenticated;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000a5', 's-boss@st.test', now()),
  ('00000000-0000-4000-8000-0000000000b5', 's-td@st.test', now()),
  ('00000000-0000-4000-8000-0000000000c5', 's-other@st.test', now())
on conflict do nothing;

-- two-day event (day 0, day 1), TD s-td; another event for s-other
select pg_temp.claims('00000000-0000-4000-8000-0000000000a5', true); set role authenticated;
insert into s_ctx select 'ev', td_create_event('Station Weekend', 'Club', '2026-11-21', '2026-11-22', null, 9, '[{"code":"MA1"}]')->>'id';
insert into s_ctx select 'evB', td_create_event('Other Weekend', 'Club', '2026-11-21', '2026-11-21', null, 9, '[{"code":"MA1"}]')->>'id';
insert into event_tds (event_id, email) select v::uuid, 's-td@st.test' from s_ctx where k = 'ev';
insert into event_tds (event_id, email) select v::uuid, 's-other@st.test' from s_ctx where k = 'evB';
reset role;
set client_min_messages = notice;

select pg_temp.claims('00000000-0000-4000-8000-0000000000b5', false); set role authenticated;
with x as (insert into stations (event_id, name, need, sort) values (pg_temp.v('ev')::uuid, 'Spotters', 2, 0) returning id) insert into s_ctx select 'spot', id::text from x;
with x as (insert into stations (event_id, name, need, sort) values (pg_temp.v('ev')::uuid, 'Water & Ice', 1, 1) returning id) insert into s_ctx select 'water', id::text from x;
insert into station_needs (station_id, day, half, need) values (pg_temp.v('water')::uuid, 1, 'PM', 0);
with x as (insert into crew (event_id, name, roles) values (pg_temp.v('ev')::uuid, 'Amy', '{}') returning id) insert into s_ctx select 'amy', id::text from x;
with x as (insert into crew (event_id, name, roles) values (pg_temp.v('ev')::uuid, 'Bo', '{}') returning id) insert into s_ctx select 'bo', id::text from x;
with x as (insert into crew (event_id, name, roles) values (pg_temp.v('ev')::uuid, 'Cy', '{}') returning id) insert into s_ctx select 'cy', id::text from x;
insert into station_slots (event_id, station_id, day, half, crew_id) values (pg_temp.v('ev')::uuid, pg_temp.v('spot')::uuid, 0, 'AM', pg_temp.v('amy')::uuid);
select pg_temp.ok(pg_temp.refused('insert into stations (event_id, name) values (''' || pg_temp.v('ev') || ''', ''  spotters '')', 'duplicate'), 'station names are unique per event');
select pg_temp.ok(pg_temp.refused(format('insert into station_slots (event_id, station_id, day, half, crew_id) values (%L, %L, 2, ''AM'', %L)', pg_temp.v('ev'), pg_temp.v('spot'), pg_temp.v('bo')), 'not_an_event_day'),
  'a shift must be on an event day (day 2 of a 2-day event refused)');
select pg_temp.ok(pg_temp.refused(format('insert into station_slots (event_id, station_id, day, half, crew_id) values (%L, %L, 0, ''AM'', %L)', pg_temp.v('ev'), pg_temp.v('spot'), pg_temp.v('amy')), 'duplicate'),
  'same person, same station, same shift: once');
select pg_temp.ok(pg_temp.refused(format('insert into station_slots (event_id, station_id, day, half, crew_id) values (%L, %L, 0, ''XX'', %L)', pg_temp.v('ev'), pg_temp.v('spot'), pg_temp.v('bo')), 'check'),
  'half is AM or PM');
insert into station_slots (event_id, station_id, day, half, crew_id) values (pg_temp.v('ev')::uuid, pg_temp.v('water')::uuid, 0, 'AM', pg_temp.v('amy')::uuid);
reset role;
select pg_temp.ok((select count(*) = 2 from station_slots where crew_id = pg_temp.v('amy')::uuid and day = 0 and half = 'AM'), 'two stations in one shift is allowed (UI flags it)');
insert into s_ctx select 'tokB', token from crew where id = pg_temp.v('bo')::uuid;
insert into s_ctx select 'tokC', token from crew where id = pg_temp.v('cy')::uuid;

select pg_temp.claims('00000000-0000-4000-8000-0000000000c5', false); set role authenticated;
with x as (insert into crew (event_id, name, roles) values (pg_temp.v('evB')::uuid, 'Zed', '{}') returning id) insert into s_ctx select 'zed', id::text from x;
select pg_temp.ok((select count(*) = 0 from stations where event_id = pg_temp.v('ev')::uuid) and (select count(*) = 0 from station_slots where event_id = pg_temp.v('ev')::uuid),
  'other event''s TD sees none of the grid');
select pg_temp.ok(pg_temp.refused(format('insert into station_slots (event_id, station_id, day, half, crew_id) values (%L, %L, 0, ''PM'', %L)', pg_temp.v('ev'), pg_temp.v('spot'), pg_temp.v('bo')), 'row-level security'),
  'other event''s TD cannot write to this grid');
reset role;
select pg_temp.claims('00000000-0000-4000-8000-0000000000b5', false); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('insert into station_slots (event_id, station_id, day, half, crew_id) values (%L, %L, 0, ''PM'', %L)', pg_temp.v('ev'), pg_temp.v('spot'), pg_temp.v('zed')), 'wrong_event'),
  'a slot can''t hold another event''s crew member');
reset role;

-- ===== crew =====
set role anon;
select pg_temp.ok(pg_temp.refused('select count(*) from station_slots', 'permission denied'), 'anon cannot read slots directly');
select pg_temp.ok((select jsonb_array_length(crew_home(pg_temp.v('tokB'))->'stations') = 2 and jsonb_array_length(crew_home(pg_temp.v('tokB'))->'slots') = 2),
  'crew page shows the whole grid (2 stations, 2 slots)');
select pg_temp.ok((select (crew_home(pg_temp.v('tokB'))->'slots'->0->>'name') in ('Amy')), 'slots carry names');
insert into s_ctx select 'bClaim', crew_claim_slot(pg_temp.v('tokB'), pg_temp.v('spot')::uuid, 0, 'AM')::text;
select pg_temp.ok(pg_temp.refused(format('select crew_claim_slot(%L, %L, 0, ''AM'')', pg_temp.v('tokC'), pg_temp.v('spot')), 'station_full'), 'claim refused once the cell is full (2/2)');
select pg_temp.ok(pg_temp.refused(format('select crew_claim_slot(%L, %L, 1, ''PM'')', pg_temp.v('tokC'), pg_temp.v('water')), 'station_full'), 'a shift override of 0 means no one is needed');
select pg_temp.ok(pg_temp.refused(format('select crew_claim_slot(%L, %L, 5, ''AM'')', pg_temp.v('tokC'), pg_temp.v('spot')), 'not_an_event_day'), 'claim outside the event days refused');
select crew_claim_slot(pg_temp.v('tokC'), pg_temp.v('spot')::uuid, 1, 'PM');
select pg_temp.ok(pg_temp.refused(format('select crew_claim_slot(%L, %L, 1, ''PM'')', pg_temp.v('tokC'), pg_temp.v('spot')), 'already_there'), 'can''t claim the same spot twice');
select pg_temp.ok(pg_temp.refused(format('select crew_drop_slot(%L, %L)', pg_temp.v('tokC'), pg_temp.v('bClaim')), 'not_your_claim'), 'can''t drop someone else''s spot');
reset role;
select pg_temp.ok((select claimed and crew_id = pg_temp.v('bo')::uuid from station_slots where id = pg_temp.v('bClaim')::uuid), 'claim recorded as claimed by Bo');
insert into s_ctx select 'amySlot', id::text from station_slots where crew_id = pg_temp.v('amy')::uuid and station_id = pg_temp.v('spot')::uuid;
insert into s_ctx select 'tokA', token from crew where id = pg_temp.v('amy')::uuid;
set role anon;
select pg_temp.ok(pg_temp.refused(format('select crew_drop_slot(%L, %L)', pg_temp.v('tokA'), pg_temp.v('amySlot')), 'not_your_claim'), 'crew can''t drop a TD assignment');
select crew_drop_slot(pg_temp.v('tokB'), pg_temp.v('bClaim')::uuid);
reset role;
select pg_temp.ok((select count(*) = 0 from station_slots where id = pg_temp.v('bClaim')::uuid), 'crew dropped their own claim');

-- revoked crew lose their spots' link power
select pg_temp.claims('00000000-0000-4000-8000-0000000000b5', false); set role authenticated;
update crew set revoked_at = now() where id = pg_temp.v('cy')::uuid;
reset role;
set role anon;
select pg_temp.ok(pg_temp.refused(format('select crew_claim_slot(%L, %L, 0, ''PM'')', pg_temp.v('tokC'), pg_temp.v('spot')), 'invalid_link'), 'revoked link can''t claim');
reset role;

-- ===== duplicate =====
select pg_temp.claims('00000000-0000-4000-8000-0000000000b5', false); set role authenticated;
insert into s_ctx select 'next', td_create_event('Station Weekend', null, '2027-11-20', '2027-11-21', pg_temp.v('ev')::uuid, 18, '[]', false)->>'id';
reset role;
select pg_temp.ok((select count(*) = 2 from stations where event_id = pg_temp.v('next')::uuid), 'duplicate carries stations');
select pg_temp.ok((select n.need = 0 from station_needs n join stations s on s.id = n.station_id where s.event_id = pg_temp.v('next')::uuid and s.name = 'Water & Ice' and n.day = 1 and n.half = 'PM'),
  'duplicate carries shift overrides');
select pg_temp.ok((select count(*) = 0 from station_slots where event_id = pg_temp.v('next')::uuid), 'duplicate never carries assignments');

\echo ALL STATION TESTS PASSED
