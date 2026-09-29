-- Winners Circle acceptance tests. Run after stub + all migrations.
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

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000a1', 'w-boss@club.test', now()),
  ('00000000-0000-4000-8000-0000000000b1', 'w-league@club.test', now()),
  ('00000000-0000-4000-8000-0000000000c1', 'w-other@club.test', now())
on conflict do nothing;

select pg_temp.claims('00000000-0000-4000-8000-0000000000a1', true); set role authenticated;
insert into w_ctx select 'ev', td_create_event('Win Night', 'Club', '2026-10-01', '2026-10-01', null, 9, '[{"code":"MPO"},{"code":"MA1"}]')->>'id';
insert into event_tds (event_id, email) select v::uuid, 'w-league@club.test' from w_ctx where k = 'ev';
select td_import_players((select v::uuid from w_ctx where k='ev'), '[{"name":"Pro One","div_code":"MPO"},{"name":"Am One","div_code":"MA1"}]');
reset role;
set client_min_messages = notice;

select pg_temp.ok((select credit_label = 'Boner Bucks' from event_prize e join events v on v.id = e.event_id where v.slug = 'jewel-xi-2026'),
  'Jewel XI prizes are Boner Bucks');

-- ===== the event TD sets up and posts =====
select pg_temp.claims('00000000-0000-4000-8000-0000000000b1', false); set role authenticated;
insert into event_prize (event_id, added_total, credit_round, credit_label) select v::uuid, 250, 5, 'Bone Bucks' from w_ctx where k='ev';
insert into division_payouts (event_id, div_code, currency, entry_fee, payback_pct, paid_places, pcts)
  select v::uuid, 'MPO', 'cash', 60, 100, 3, '{50,30,20}' from w_ctx where k='ev';
insert into division_payouts (event_id, div_code, currency, entry_fee, payback_pct)
  select v::uuid, 'MA1', 'credit', 40, 70 from w_ctx where k='ev';
update players set finish_status = 'dnf' where name = 'Am One';
insert into winners_posts (event_id, payload) select v::uuid, '{"divisions":[]}' from w_ctx where k='ev';
update winners_posts set payload = '{"divisions":[{"div":"MPO"}]}', posted_at = now() where event_id = (select v::uuid from w_ctx where k='ev');
select pg_temp.ok(pg_temp.refused(format('insert into division_payouts (event_id, div_code, currency) values (%L, ''ZZZ'', ''cash'')', (select v from w_ctx where k='ev')), 'foreign key'),
  'a payout row must match a real division');
select pg_temp.ok(pg_temp.refused(format('update division_payouts set payback_pct = 101 where event_id = %L', (select v from w_ctx where k='ev')), 'check'),
  'payback over 100% refused');
select pg_temp.ok(pg_temp.refused(format('update event_prize set credit_round = 3 where event_id = %L', (select v from w_ctx where k='ev')), 'check'),
  'credit rounding is $1 or $5 only');
reset role;
select pg_temp.ok((select finish_status = 'dnf' from players where name = 'Am One'), 'TD marked a DNF');
select pg_temp.ok((select payload->'divisions'->0->>'div' = 'MPO' from winners_posts where event_id = (select v::uuid from w_ctx where k='ev')), 'TD posted results');

-- ===== privacy =====
set role anon;
select pg_temp.ok(pg_temp.refused('select count(*) from event_prize', 'permission denied'), 'anon: cannot read the added total');
select pg_temp.ok(pg_temp.refused('select count(*) from division_payouts', 'permission denied'), 'anon: cannot read fees/tables');
select pg_temp.ok((select count(*) = 1 from winners_posts where event_id = (select v::uuid from w_ctx where k='ev')), 'anon: can read posted results');
select pg_temp.ok(pg_temp.refused(format('insert into winners_posts (event_id, payload) values (%L, ''{}'')', (select v from w_ctx where k='ev')), 'permission denied'),
  'anon: cannot post results');
reset role;
select pg_temp.claims('00000000-0000-4000-8000-0000000000c1', false); set role authenticated;
select pg_temp.ok((select count(*) = 0 from event_prize) and (select count(*) = 0 from division_payouts), 'other TD: sees no pools or fees');
with u as (update winners_posts set payload = '{"hacked":true}' returning 1) select pg_temp.ok((select count(*) = 0 from u), 'other TD: cannot change posted results');
reset role;

-- ===== week 2 =====
select pg_temp.claims('00000000-0000-4000-8000-0000000000b1', false); set role authenticated;
insert into w_ctx select 'wk2', td_create_event('Win Night', null, '2026-10-08', '2026-10-08', (select v::uuid from w_ctx where k='ev'), 18, '[]', true)->>'id';
reset role;
select pg_temp.ok((select added_total = 0 and credit_round = 5 and credit_label = 'Bone Bucks' from event_prize where event_id = (select v::uuid from w_ctx where k='wk2')),
  'week 2: rounding + label carried, added total reset to 0');
select pg_temp.ok((select count(*) = 2 and bool_and(entry_fee > 0) from division_payouts where event_id = (select v::uuid from w_ctx where k='wk2')),
  'week 2: fees and tables carried');
select pg_temp.ok((select pcts = '{50,30,20}' from division_payouts where event_id = (select v::uuid from w_ctx where k='wk2') and div_code = 'MPO'),
  'week 2: custom % table carried');
select pg_temp.ok((select count(*) = 0 from winners_posts where event_id = (select v::uuid from w_ctx where k='wk2')), 'week 2: no posted results');
select pg_temp.ok((select bool_and(finish_status is null) from players where event_id = (select v::uuid from w_ctx where k='wk2')), 'week 2: DNF/DQ reset');

-- ===== removing a division drops its payout row =====
select pg_temp.claims('00000000-0000-4000-8000-0000000000b1', false); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select td_set_divisions(%L, ''[{"code":"MPO"}]'')', (select v from w_ctx where k='wk2')), 'division_in_use MA1'),
  'a division with players (and a payout row) can''t be dropped');
reset role;
delete from players where event_id = (select v::uuid from w_ctx where k='wk2') and div_code = 'MA1';
select pg_temp.claims('00000000-0000-4000-8000-0000000000b1', false); set role authenticated;
select td_set_divisions((select v::uuid from w_ctx where k='wk2'), '[{"code":"MPO"}]');
reset role;
select pg_temp.ok((select count(*) = 1 from division_payouts where event_id = (select v::uuid from w_ctx where k='wk2')), 'dropping an empty division drops its payout row');

\echo ALL WINNERS TESTS PASSED
