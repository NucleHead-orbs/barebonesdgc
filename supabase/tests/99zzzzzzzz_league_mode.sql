-- League mode + CTP holes. Run after stub + all migrations.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.claims(sub text, admin boolean) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', sub, 'app_metadata', case when admin then '{"role":"td"}'::json else '{}'::json end)::text, false) $$;
create temp table lm_ctx (k text primary key, v text);
grant all on lm_ctx to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from lm_ctx where k = key $$;
create or replace function pg_temp.pool(s text) returns uuid language sql as $$ select id from tag_pools where slug = s $$;
grant execute on function pg_temp.v(text), pg_temp.pool(text) to anon, authenticated;
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000008a1', 'lm-boss@lm.test', now()),
  ('00000000-0000-4000-8000-0000000008b1', 'lm-td@lm.test', now()),
  ('00000000-0000-4000-8000-0000000008c1', 'lm-other@lm.test', now())
on conflict do nothing;
select pg_temp.claims('00000000-0000-4000-8000-0000000008a1', true); set role authenticated;
insert into lm_ctx select 'ev', td_create_event('LM League', 'Club', '2026-11-01', '2026-11-01', null, 9, '[{"code":"MA1"}]')->>'id';
insert into event_tds (event_id, email) select pg_temp.v('ev')::uuid, 'lm-td@lm.test';
reset role;
set client_min_messages = notice;

select pg_temp.ok((select kind = 'event' and tag_pool_id is null from events where id = pg_temp.v('ev')::uuid), 'new events start as events');

select pg_temp.claims('00000000-0000-4000-8000-0000000008c1', false); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select td_set_league(%L, ''league'', null)', pg_temp.v('ev')), 'forbidden'), 'only this event''s TDs set league mode');
select pg_temp.ok(pg_temp.refused(format('select td_set_ctp(%L, 3, ''$20'')', pg_temp.v('ev')), 'forbidden'), 'only this event''s TDs set CTPs');
reset role;

select pg_temp.claims('00000000-0000-4000-8000-0000000008b1', false); set role authenticated;
select td_set_league(pg_temp.v('ev')::uuid, 'league', pg_temp.pool('lazy-boners'));
select pg_temp.ok((select kind = 'league' and tag_pool_id = pg_temp.pool('lazy-boners') from events where id = pg_temp.v('ev')::uuid), 'event TD makes it a league with its tag set');
select pg_temp.ok(pg_temp.refused(format('select td_set_league(%L, ''party'', null)', pg_temp.v('ev')), 'invalid_kind'), 'kind is event or league');
select pg_temp.ok(pg_temp.refused(format('select td_set_league(%L, ''league'', gen_random_uuid())', pg_temp.v('ev')), 'unknown_pool'), 'tag set must exist');

select td_set_ctp(pg_temp.v('ev')::uuid, 3, '  $20 + a disc ');
select td_set_ctp(pg_temp.v('ev')::uuid, 7, 'Ace pot');
select pg_temp.ok((select ctp_prize = '$20 + a disc' from holes where event_id = pg_temp.v('ev')::uuid and n = 3), 'CTP prize saved (trimmed)');
select pg_temp.ok(pg_temp.refused(format('select td_set_ctp(%L, 12, ''$5'')', pg_temp.v('ev')), 'unknown_hole'), 'CTP must be on one of the event''s holes');
select pg_temp.ok(pg_temp.refused(format('select td_set_ctp(%L, 3, %L)', pg_temp.v('ev'), repeat('x', 61)), 'ctp_prize_too_long'), 'prize is short text');
select td_set_ctp(pg_temp.v('ev')::uuid, 7, '  ');
select pg_temp.ok((select ctp_prize is null from holes where event_id = pg_temp.v('ev')::uuid and n = 7), 'blank prize = not a CTP');
-- saving the course keeps the CTP on a hole that still exists
select td_set_holes(pg_temp.v('ev')::uuid, (select jsonb_agg(jsonb_build_object('n', g, 'par', 3)) from generate_series(1, 9) g));
select pg_temp.ok((select ctp_prize = '$20 + a disc' from holes where event_id = pg_temp.v('ev')::uuid and n = 3), 'saving the course keeps CTPs');
-- week 2
insert into lm_ctx select 'ev2', td_create_event('LM League wk2', null, '2026-11-08', '2026-11-08', pg_temp.v('ev')::uuid)->>'id';
reset role;
select pg_temp.ok((select kind = 'league' and tag_pool_id = pg_temp.pool('lazy-boners') from events where id = pg_temp.v('ev2')::uuid), 'duplicate carries league mode + tag set');
select pg_temp.ok((select ctp_prize = '$20 + a disc' from holes where event_id = pg_temp.v('ev2')::uuid and n = 3), 'duplicate carries CTP holes');

set role anon;
select pg_temp.ok((select count(*) = 1 from holes where event_id = pg_temp.v('ev')::uuid and ctp_prize is not null), 'scorecards (public) can read CTP holes');
select pg_temp.ok(pg_temp.refused(format('select td_set_ctp(%L, 3, ''x'')', pg_temp.v('ev')), 'permission denied'), 'anon can''t set CTPs');
reset role;
select pg_temp.claims('00000000-0000-4000-8000-0000000008b1', false); set role authenticated;
select td_set_league(pg_temp.v('ev')::uuid, 'event', pg_temp.pool('lazy-boners'));
reset role;
select pg_temp.ok((select kind = 'event' and tag_pool_id is null from events where id = pg_temp.v('ev')::uuid), 'back to event drops the tag set');
