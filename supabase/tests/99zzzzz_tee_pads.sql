-- Extra tee pads + sponsors on them. Run after stub + all migrations.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create temp table t_ctx (k text primary key, v text);
grant all on t_ctx to anon, authenticated;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.claims(sub text, email text, admin boolean) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', sub, 'email', email, 'app_metadata', case when admin then '{"role":"td"}'::json else '{}'::json end)::text, false) $$;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from t_ctx where k = key $$;
grant execute on function pg_temp.v(text) to anon, authenticated;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000007a1', 'tp-boss@tp.test', now()),
  ('00000000-0000-4000-8000-0000000007b1', 'tp-td@tp.test', now())
on conflict do nothing;
select pg_temp.claims('00000000-0000-4000-8000-0000000007a1', 'tp-boss@tp.test', true); set role authenticated;
insert into t_ctx select 'ev', td_create_event('Pad Open', 'Club', '2026-12-05', '2026-12-05', null, 4, '[{"code":"MA1"}]')->>'id';
insert into event_tds (event_id, email) select pg_temp.v('ev')::uuid, 'tp-td@tp.test';
reset role;
set client_min_messages = notice;

select pg_temp.claims('00000000-0000-4000-8000-0000000007b1', 'tp-td@tp.test', false); set role authenticated;
with x as (insert into hole_tees (event_id, n, label, dist_ft) values (pg_temp.v('ev')::uuid, 3, 'AM pad', 180) returning id) insert into t_ctx select 'am3', id::text from x;
insert into hole_tees (event_id, n, label) values (pg_temp.v('ev')::uuid, 3, 'Rec / Ladies pad');
select pg_temp.ok(pg_temp.refused($q$insert into hole_tees (event_id, n, label) values (pg_temp.v('ev')::uuid, 9, 'AM pad')$q$, 'hole_tees_hole_fk'), 'a pad needs a real hole');
select pg_temp.ok(pg_temp.refused($q$insert into hole_tees (event_id, n, label) values (pg_temp.v('ev')::uuid, 3, 'AM pad')$q$, 'hole_tees_label_uq'), 'pad names are unique per hole');
with x as (insert into sponsors (event_id, name, hole, tee_id) values (pg_temp.v('ev')::uuid, 'Pad Sponsor', 3, pg_temp.v('am3')::uuid) returning id) insert into t_ctx select 'sp', id::text from x;
select pg_temp.ok((select tee_id::text = pg_temp.v('am3') from sponsors where name = 'Pad Sponsor'), 'a sponsor can take a pad sign');
select pg_temp.ok(pg_temp.refused($q$insert into sponsors (event_id, name, hole, tee_id) values (pg_temp.v('ev')::uuid, 'Wrong', 2, pg_temp.v('am3')::uuid)$q$, 'tee_mismatch'), 'not another hole''s pad');
update sponsors set hole = 2 where name = 'Pad Sponsor';
select pg_temp.ok((select tee_id is null and hole = 2 from sponsors where name = 'Pad Sponsor'), 'moving a sponsor to another hole puts them on its main tee');
reset role;

select set_config('request.jwt.claims', '{}', false); set role anon;
select pg_temp.ok((select count(*) = 2 from hole_tees where event_id = pg_temp.v('ev')::uuid), 'the public can read pads (signs, course)');
select pg_temp.ok(pg_temp.refused($q$insert into hole_tees (event_id, n, label) values (pg_temp.v('ev')::uuid, 1, 'X')$q$, 'permission denied'), 'the public cannot add pads');
reset role;

select pg_temp.claims('00000000-0000-4000-8000-0000000007a1', 'tp-boss@tp.test', true); set role authenticated;
insert into t_ctx select 'dup', td_create_event('Pad Open II', 'Club', '2027-12-05', '2027-12-05', pg_temp.v('ev')::uuid)->>'id';
select pg_temp.ok((select count(*) = 2 from hole_tees where event_id = pg_temp.v('dup')::uuid), 'duplicating an event copies its pads');
select td_set_holes(pg_temp.v('ev')::uuid, '[{"n":1,"par":3},{"n":2,"par":3}]');
select pg_temp.ok((select count(*) = 0 from hole_tees where event_id = pg_temp.v('ev')::uuid), 'dropping a hole drops its pads');
reset role;
select 'PASSED 99zzzzz_tee_pads';
