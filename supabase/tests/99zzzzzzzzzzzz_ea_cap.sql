-- Early access: first N registrants only. Run after stub + all migrations.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.claims(sub text, admin boolean) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', sub, 'app_metadata', case when admin then '{"role":"td"}'::json else '{}'::json end)::text, false) $$;
create temp table cap_ctx (k text primary key, v text);
grant all on cap_ctx to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from cap_ctx where k = key $$;
create or replace function pg_temp.pl(n text) returns uuid language sql as $$ select id from players where event_id = pg_temp.v('ev')::uuid and name = n $$;
grant execute on function pg_temp.v(text), pg_temp.pl(text) to anon, authenticated;
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-4000-8000-000000000cc1', 'cap-boss@cap.test', now()) on conflict do nothing;
select pg_temp.claims('00000000-0000-4000-8000-000000000cc1', true); set role authenticated;
insert into cap_ctx select 'ev', td_create_event('Cap Open', 'Club', current_date + 30, current_date + 30, null, 9, '[{"code":"MA1"}]')->>'id';
insert into cap_ctx select 'slug', slug from events where id = pg_temp.v('ev')::uuid;
select td_ea_start(pg_temp.v('ev')::uuid);
reset role;
insert into players (event_id, name, div_code, reg_order) values
  (pg_temp.v('ev')::uuid, 'First Inn', 'MA1', 1), (pg_temp.v('ev')::uuid, 'Second Inn', 'MA1', 2), (pg_temp.v('ev')::uuid, 'Third Wheel', 'MA1', 3);
set client_min_messages = notice;

select pg_temp.ok((select max_players is null from early_access where event_id = pg_temp.v('ev')::uuid), 'no limit unless a TD sets one');
select pg_temp.ok((select max_players = 50 from early_access where event_id = (select id from events where slug = 'jewel-xi-2026')), 'Jewel XI is the first 50');
select pg_temp.claims('00000000-0000-4000-8000-000000000cc1', true); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select td_ea_set_max(%L, 0)', pg_temp.v('ev')), 'invalid_rules'), 'limit is 1..500');
select td_ea_set_max(pg_temp.v('ev')::uuid, 2);
reset role;

select set_config('request.jwt.claims', '', false); set role anon;
select pg_temp.ok(pg_temp.refused(format('select td_ea_set_max(%L, 5)', pg_temp.v('ev')), 'permission denied'), 'anon can''t change the limit');
select pg_temp.ok(pg_temp.refused(format('select ea_claim(%L, %L, null)', pg_temp.v('slug'), pg_temp.pl('Third Wheel')), 'early_access_full'), 'registrant #3 of 2 can''t claim');
select pg_temp.ok(ea_claim(pg_temp.v('slug'), pg_temp.pl('Second Inn'), null) is not null, 'registrant #2 can');
select pg_temp.ok((select (r->>'eligible')::boolean from jsonb_array_elements(ea_public(pg_temp.v('slug'))->'roster') r where r->>'name' = 'Third Wheel') = false
  and (ea_public(pg_temp.v('slug'))->>'max_players')::int = 2 and (ea_public(pg_temp.v('slug'))->>'registered')::int = 3, 'public page knows the limit and who''s in');
reset role;

-- #1 drops out: #3 moves up
delete from players where id = pg_temp.pl('First Inn');
select set_config('request.jwt.claims', '', false); set role anon;
select pg_temp.ok(ea_claim(pg_temp.v('slug'), pg_temp.pl('Third Wheel'), null) is not null, 'when someone ahead drops out, the next one moves in');
reset role;
-- limit lowered after a claim: approval is refused
insert into cap_ctx select 'c3', id::text from ea_claims where player_id = pg_temp.pl('Third Wheel');
select pg_temp.claims('00000000-0000-4000-8000-000000000cc1', true); set role authenticated;
select td_ea_set_max(pg_temp.v('ev')::uuid, 1);
select pg_temp.ok(pg_temp.refused(format('select td_ea_approve(%L, null)', pg_temp.v('c3')), 'early_access_full'), 'approval checks the limit too');
select pg_temp.ok((td_ea_get(pg_temp.v('ev')::uuid)->>'max_players')::int = 1, 'TD panel sees the limit');
reset role;
select set_config('request.jwt.claims', '', false);
