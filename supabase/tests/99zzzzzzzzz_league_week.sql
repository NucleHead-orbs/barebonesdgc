-- League week: vest + group photo. Run after stub + all migrations.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.claims(sub text, admin boolean) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', sub, 'app_metadata', case when admin then '{"role":"td"}'::json else '{}'::json end)::text, false) $$;
create temp table lw_ctx (k text primary key, v text);
grant all on lw_ctx to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from lw_ctx where k = key $$;
create or replace function pg_temp.pool(s text) returns uuid language sql as $$ select id from tag_pools where slug = s $$;
grant execute on function pg_temp.v(text), pg_temp.pool(text) to anon, authenticated;
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000009a1', 'lw-boss@lw.test', now()),
  ('00000000-0000-4000-8000-0000000009b1', 'lw-td@lw.test', now()),
  ('00000000-0000-4000-8000-0000000009c1', 'lw-other@lw.test', now())
on conflict do nothing;
select pg_temp.claims('00000000-0000-4000-8000-0000000009a1', true); set role authenticated;
insert into lw_ctx select 'ev', td_create_event('LW League', 'Club', '2026-11-01', '2026-11-01', null, 9, '[{"code":"MA1"}]')->>'id';
insert into lw_ctx select 'other', td_create_event('LW Other', 'Club', '2026-11-01', '2026-11-01', null, 9, '[{"code":"MA1"}]')->>'id';
insert into event_tds (event_id, email) select pg_temp.v('ev')::uuid, 'lw-td@lw.test';
reset role;
insert into players (event_id, name, div_code) values (pg_temp.v('ev')::uuid, 'Vesty McVest', 'MA1'), (pg_temp.v('ev')::uuid, 'Runner Up', 'MA1'),
  (pg_temp.v('other')::uuid, 'Elsewhere', 'MA1');
insert into lw_ctx select 'p1', id::text from players where name = 'Vesty McVest';
insert into lw_ctx select 'px', id::text from players where name = 'Elsewhere';
select pg_temp.claims('00000000-0000-4000-8000-0000000009b1', false); set role authenticated;
select td_set_league(pg_temp.v('ev')::uuid, 'league', pg_temp.pool('lazy-boners'));
reset role;
set client_min_messages = notice;

set role anon;
select pg_temp.ok(jsonb_array_length(league_weeks('lazy-boners')) = (select count(*) from events where kind = 'league' and tag_pool_id = pg_temp.pool('lazy-boners') and (vest_player_id is not null or group_photo is not null)),
  'a week with no vest and no photo stays off the wall');
select pg_temp.ok(pg_temp.refused(format('select td_set_vest(%L, %L, null)', pg_temp.v('ev'), pg_temp.v('p1')), 'permission denied'), 'anon can''t award the vest');
reset role;

select pg_temp.claims('00000000-0000-4000-8000-0000000009c1', false); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select td_set_vest(%L, %L, null)', pg_temp.v('ev'), pg_temp.v('p1')), 'forbidden'), 'only this event''s TDs award the vest');
select pg_temp.ok(pg_temp.refused(format('select td_set_group_photo(%L, %L)', pg_temp.v('ev'), pg_temp.v('ev') || '/x.webp'), 'forbidden'), 'only this event''s TDs set the photo');
select pg_temp.ok(pg_temp.refused(format('insert into storage.objects (bucket_id, name) values (''league-photos'', %L)', pg_temp.v('ev') || '/x.webp'), 'row-level security'), 'other TDs can''t upload to this week''s folder');
reset role;

select pg_temp.claims('00000000-0000-4000-8000-0000000009b1', false); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select td_set_vest(%L, %L, null)', pg_temp.v('ev'), pg_temp.v('px')), 'unknown_player'), 'the vest goes to one of this week''s players');
select pg_temp.ok(pg_temp.refused(format('select td_set_vest(%L, %L, %L)', pg_temp.v('ev'), pg_temp.v('p1'), repeat('x', 121)), 'vest_note_too_long'), 'shout-out is one line');
select td_set_vest(pg_temp.v('ev')::uuid, pg_temp.v('p1')::uuid, '  Minimum effort, maximum vest  ');
insert into storage.objects (bucket_id, name) values ('league-photos', pg_temp.v('ev') || '/group-1.webp');
select pg_temp.ok(true, 'the event''s TD uploads to its folder');
select pg_temp.ok(pg_temp.refused(format('insert into storage.objects (bucket_id, name) values (''league-photos'', %L)', pg_temp.v('other') || '/x.webp'), 'row-level security'), 'but not into another event''s folder');
select pg_temp.ok(pg_temp.refused(format('select td_set_group_photo(%L, %L)', pg_temp.v('ev'), pg_temp.v('other') || '/x.webp'), 'invalid_path'), 'photo path must be under this event');
select pg_temp.ok(pg_temp.refused(format('select td_set_group_photo(%L, %L)', pg_temp.v('ev'), pg_temp.v('ev') || '/../x.webp'), 'invalid_path'), 'no climbing out of the folder');
select td_set_group_photo(pg_temp.v('ev')::uuid, pg_temp.v('ev') || '/group-1.webp');
reset role;

set role anon;
select pg_temp.ok((select w->>'vest' = 'Vesty McVest' and w->>'vest_note' = 'Minimum effort, maximum vest' and w->>'photo' = pg_temp.v('ev') || '/group-1.webp'
  from jsonb_array_elements(league_weeks('lazy-boners')) w where w->>'slug' = (select slug from events where id = pg_temp.v('ev')::uuid)), 'the wall shows the vest, the shout-out and the photo');
select pg_temp.ok(jsonb_array_length(league_weeks('nope')) = 0, 'unknown league = empty wall');
reset role;

-- next week: duplicate doesn't carry the vest or the photo
select pg_temp.claims('00000000-0000-4000-8000-0000000009b1', false); set role authenticated;
insert into lw_ctx select 'ev2', td_create_event('LW League wk2', null, '2026-11-08', '2026-11-08', pg_temp.v('ev')::uuid)->>'id';
reset role;
select pg_temp.ok((select vest_player_id is null and vest_note is null and group_photo is null and kind = 'league' from events where id = pg_temp.v('ev2')::uuid), 'next week starts with no vest and no photo');
select pg_temp.ok(pg_temp.refused(format('update events set vest_player_id = %L where id = %L', pg_temp.v('px'), pg_temp.v('ev')), 'unknown_player'), 'direct writes are checked too');

-- take the vest back
select pg_temp.claims('00000000-0000-4000-8000-0000000009b1', false); set role authenticated;
select td_set_vest(pg_temp.v('ev')::uuid, null, 'ignored');
reset role;
select pg_temp.ok((select vest_player_id is null and vest_note is null and group_photo is not null from events where id = pg_temp.v('ev')::uuid), 'vest taken back (photo stays)');
select set_config('request.jwt.claims', '', false);
