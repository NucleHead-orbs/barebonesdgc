-- Event prep acceptance tests. Run after stub + all migrations.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create temp table p_ctx (k text primary key, v text);
grant all on p_ctx to anon, authenticated;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.claims(sub text, admin boolean) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', sub, 'app_metadata', case when admin then '{"role":"td"}'::json else '{}'::json end)::text, false) $$;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000a2', 'p-boss@club.test', now()),
  ('00000000-0000-4000-8000-0000000000b2', 'p-league@club.test', now()),
  ('00000000-0000-4000-8000-0000000000c2', 'p-other@club.test', now())
on conflict do nothing;

select pg_temp.claims('00000000-0000-4000-8000-0000000000a2', true); set role authenticated;
insert into p_ctx select 'ev', td_create_event('Prep Night', 'Club', '2026-11-21', '2026-11-22', null, 9, '[{"code":"MA1"}]')->>'id';
insert into event_tds (event_id, email) select v::uuid, 'p-league@club.test' from p_ctx where k = 'ev';
reset role;
set client_min_messages = notice;

-- ===== the event TD =====
select pg_temp.claims('00000000-0000-4000-8000-0000000000b2', false); set role authenticated;
select td_import_players((select v::uuid from p_ctx where k='ev'), '[{"name":"Sal","div_code":"MA1","shirt_size":"xl"},{"name":"Tia","div_code":"MA1"}]');
select td_import_players((select v::uuid from p_ctx where k='ev'), '[{"name":"Sal","div_code":"MA1"}]');
insert into prep_tasks (event_id, title, category, due_offset_days, sort) select v::uuid, 'Order shirts', 'shirts', -21, 1 from p_ctx where k='ev';
insert into prep_tasks (event_id, title, category, due_offset_days, sort, done_at, done_by) select v::uuid, 'Book course', 'course', -60, 0, now(), 'p-league@club.test' from p_ctx where k='ev';
insert into shirt_order (event_id, extras, vendor) select v::uuid, '{"L": 5, "XL": 2}', 'Ink Co' from p_ctx where k='ev';
with x as (insert into design_assets (event_id, category, title) select v::uuid, 'shirts', 'Front print' from p_ctx where k='ev' returning id)
insert into p_ctx select 'asset', id::text from x;
insert into design_files (asset_id, version, path, file_name) select v::uuid, 1, (select v from p_ctx where k='ev') || '/shirts/front-v1.png', 'front.png' from p_ctx where k='asset';
insert into storage.objects (bucket_id, name) select 'event-assets', v || '/shirts/front-v1.png' from p_ctx where k='ev';
select pg_temp.ok(pg_temp.refused(format('insert into design_assets (event_id, category, title) values (%L, ''stickers'', ''x'')', (select v from p_ctx where k='ev')), 'check'),
  'design categories are a fixed list');
select pg_temp.ok(pg_temp.refused(format('insert into design_files (asset_id, version, path, file_name) values (%L, 1, ''x/y'', ''dupe'')', (select v from p_ctx where k='asset')), 'duplicate'),
  'a version number is used once per design');
reset role;
select pg_temp.ok((select shirt_size = 'XL' from players where name = 'Sal'), 'import stores the shirt size (upper-cased)');
select pg_temp.ok((select shirt_size = 'XL' from players where name = 'Sal'), 're-import without a size never wipes it');
select pg_temp.ok((select count(*) = 1 from storage.objects where bucket_id = 'event-assets'), 'TD uploaded a file into its event folder');

-- ===== privacy =====
set role anon;
select pg_temp.ok(pg_temp.refused('select count(*) from prep_tasks', 'permission denied'), 'anon: cannot read tasks');
select pg_temp.ok(pg_temp.refused('select count(*) from shirt_order', 'permission denied'), 'anon: cannot read the shirt order');
select pg_temp.ok(pg_temp.refused('select count(*) from design_assets', 'permission denied'), 'anon: cannot read designs');
reset role;
select pg_temp.claims('00000000-0000-4000-8000-0000000000c2', false); set role authenticated;
select pg_temp.ok((select count(*) = 0 from prep_tasks) and (select count(*) = 0 from design_assets) and (select count(*) = 0 from design_files)
                  and (select count(*) = 0 from shirt_order), 'other TD: sees no tasks, designs or orders');
select pg_temp.ok((select count(*) = 0 from storage.objects where bucket_id = 'event-assets'), 'other TD: cannot see the files');
select pg_temp.ok(pg_temp.refused(format('insert into storage.objects (bucket_id, name) values (''event-assets'', %L)', (select v from p_ctx where k='ev') || '/x.png'), 'row-level security'),
  'other TD: cannot upload into this event''s folder');
select pg_temp.ok(pg_temp.refused('insert into storage.objects (bucket_id, name) values (''event-assets'', ''not-a-uuid/x.png'')', 'row-level security'),
  'nobody can upload outside an event folder');
reset role;

-- ===== next year =====
select pg_temp.claims('00000000-0000-4000-8000-0000000000b2', false); set role authenticated;
insert into p_ctx select 'next', td_create_event('Prep Night', null, '2027-11-20', '2027-11-21', (select v::uuid from p_ctx where k='ev'), 18, '[]', true)->>'id';
reset role;
select pg_temp.ok((select count(*) = 2 and bool_and(done_at is null) from prep_tasks where event_id = (select v::uuid from p_ctx where k='next')),
  'duplicate: checklist copied with nothing done');
select pg_temp.ok((select due_offset_days = -21 from prep_tasks where event_id = (select v::uuid from p_ctx where k='next') and title = 'Order shirts'),
  'duplicate: due dates stay relative (shift with the new date)');
select pg_temp.ok((select count(*) = 0 from design_assets where event_id = (select v::uuid from p_ctx where k='next'))
                  and (select count(*) = 0 from shirt_order where event_id = (select v::uuid from p_ctx where k='next')),
  'duplicate: designs and shirt order not copied');
select pg_temp.ok((select bool_and(shirt_size is null) from players where event_id = (select v::uuid from p_ctx where k='next')),
  'duplicate: shirt sizes start empty (new year, new shirts)');

\echo ALL EVENT PREP TESTS PASSED
