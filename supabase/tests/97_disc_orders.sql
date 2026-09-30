-- Innova disc orders: TD-only, card data can never be stored, sent_at follows status. Run after stub + all migrations (+ 50).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create temp table o_ctx (k text primary key, v text);
grant all on o_ctx to anon, authenticated;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.claims(sub text, admin boolean) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', sub, 'app_metadata', case when admin then '{"role":"td"}'::json else '{}'::json end)::text, false) $$;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000a7', 'o-boss@club.test', now()),
  ('00000000-0000-4000-8000-0000000000b7', 'o-td@club.test', now()),
  ('00000000-0000-4000-8000-0000000000c7', 'o-other@club.test', now())
on conflict do nothing;
select pg_temp.claims('00000000-0000-4000-8000-0000000000a7', true); set role authenticated;
insert into o_ctx select 'ev', td_create_event('Order Night', 'Club', '2026-11-21', '2026-11-22', null, 9, '[{"code":"MA1"}]')->>'id';
insert into event_tds (event_id, email) select v::uuid, 'o-td@club.test' from o_ctx where k = 'ev';
reset role;
set client_min_messages = notice;

-- ===== the event TD =====
select pg_temp.claims('00000000-0000-4000-8000-0000000000b7', false); set role authenticated;
with x as (insert into disc_orders (event_id, form_path, form_label, lines, details, created_by)
  select v::uuid, v || '/innova/form.xlsx', 'Updated: 09/23/2026', '{"26": {"mold": "DX Alien", "q": {"M": 10}}}',
         '{"artwork": "Jewel XI", "name": "Jason"}', 'o-td@club.test' from o_ctx where k = 'ev' returning id)
insert into o_ctx select 'ord', id::text from x;
select pg_temp.ok((select count(*) = 1 from disc_orders), 'TD creates an order for their event');
select pg_temp.ok(pg_temp.refused(format('update disc_orders set details = ''{"card": "4111"}'' where id = %L', (select v from o_ctx where k='ord')), 'disc_orders_details_check'),
  'card number can never be stored');
select pg_temp.ok(pg_temp.refused(format('update disc_orders set details = ''{"cvc": "123"}'' where id = %L', (select v from o_ctx where k='ord')), 'disc_orders_details_check'),
  'CVC can never be stored');
select pg_temp.ok(pg_temp.refused(format('update disc_orders set lines = ''[]'' where id = %L', (select v from o_ctx where k='ord')), 'disc_orders_lines_check'),
  'lines must be an object');
select pg_temp.ok(pg_temp.refused(format('update disc_orders set status = ''paid'' where id = %L', (select v from o_ctx where k='ord')), 'disc_orders_status_check'),
  'status is draft or sent');
update disc_orders set status = 'sent' where id = (select v::uuid from o_ctx where k='ord');
select pg_temp.ok((select sent_at is not null from disc_orders), 'marking sent stamps sent_at');
update disc_orders set status = 'draft' where id = (select v::uuid from o_ctx where k='ord');
select pg_temp.ok((select sent_at is null from disc_orders), 'back to draft clears sent_at');
reset role;

-- ===== privacy =====
set role anon;
select pg_temp.ok(pg_temp.refused('select count(*) from disc_orders', 'permission denied'), 'anon: cannot read orders');
reset role;
select pg_temp.claims('00000000-0000-4000-8000-0000000000c7', false); set role authenticated;
select pg_temp.ok((select count(*) = 0 from disc_orders), 'other TD: sees no orders');
select pg_temp.ok(pg_temp.refused(format('insert into disc_orders (event_id) values (%L)', (select v from o_ctx where k='ev')), 'row-level security'),
  'other TD: cannot add an order to this event');
update disc_orders set title = 'hacked';
reset role;
select pg_temp.ok((select title = 'Innova order' from disc_orders where id = (select v::uuid from o_ctx where k='ord')), 'other TD: cannot edit it');

-- ===== event deletion cleans up =====
delete from events where id = (select v::uuid from o_ctx where k='ev');
select pg_temp.ok((select count(*) = 0 from disc_orders where id = (select v::uuid from o_ctx where k='ord')), 'deleting the event deletes its orders');
\echo ALL DISC ORDER TESTS PASSED
