-- Dubs vests + the vest page. Run after stub + all migrations (and the earlier suites: uses the Thumpers league).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.claims(sub text, admin boolean) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', sub, 'app_metadata', case when admin then '{"role":"td"}'::json else '{}'::json end)::text, false) $$;
create temp table vv_ctx (k text primary key, v text);
grant all on vv_ctx to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from vv_ctx where k = key $$;
create or replace function pg_temp.p(ev text, n text) returns uuid language sql as $$ select id from players where event_id = ev::uuid and name = n $$;
grant execute on function pg_temp.v(text), pg_temp.p(text, text) to anon, authenticated;
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-4000-8000-000000000bb1', 'vv-boss@vv.test', now()) on conflict do nothing;
select pg_temp.claims('00000000-0000-4000-8000-000000000bb1', true); set role authenticated;
insert into vv_ctx select 'lg', td_create_league('Vesters', 'vesters')::text;
insert into vv_ctx select 'w1', td_league_new_week(pg_temp.v('lg')::uuid, '2026-12-06', null, true, 9, '[{"code":"MA1"}]')->>'id';
reset role;
insert into players (event_id, name, div_code) select pg_temp.v('w1')::uuid, n, 'MA1' from unnest(array['Alex Crook', 'Bo Dee', 'Cal Eye', 'Other Week']) n;
select pg_temp.claims('00000000-0000-4000-8000-000000000bb1', true); set role authenticated;
insert into vv_ctx select 'w2', td_league_new_week(pg_temp.v('lg')::uuid, '2026-12-13')->>'id';
reset role;
set client_min_messages = notice;

select pg_temp.claims('00000000-0000-4000-8000-000000000bb1', true); set role authenticated;
select td_set_vest_holders(pg_temp.v('w1')::uuid, array[pg_temp.p(pg_temp.v('w1'), 'Alex Crook'), pg_temp.p(pg_temp.v('w1'), 'Bo Dee')], '  Dubs kings ');
select pg_temp.ok(pg_temp.refused(format('select td_set_vest_holders(%L, array[%L,%L,%L]::uuid[], null)', pg_temp.v('w1'), pg_temp.p(pg_temp.v('w1'), 'Alex Crook'), pg_temp.p(pg_temp.v('w1'), 'Bo Dee'), pg_temp.p(pg_temp.v('w1'), 'Cal Eye')), 'too_many_holders'), 'at most two wear it');
select pg_temp.ok(pg_temp.refused(format('select td_set_vest_holders(%L, array[%L]::uuid[], null)', pg_temp.v('w2'), pg_temp.p(pg_temp.v('w1'), 'Alex Crook')), 'unknown_player'), 'holders come from that week');
-- week 2 (copied players): Alex again, solo
select td_set_vest_holders(pg_temp.v('w2')::uuid, array[pg_temp.p(pg_temp.v('w2'), 'Alex Crook')], null);
reset role;
select pg_temp.ok((select count(*) = 2 from league_vest where event_id = pg_temp.v('w1')::uuid) and (select vest_note = 'Dubs kings' from events where id = pg_temp.v('w1')::uuid), 'a dubs week has two holders + the shout-out');

select set_config('request.jwt.claims', '', false); set role anon;
select pg_temp.ok((select w->>'vest' = 'Alex Crook & Bo Dee' from jsonb_array_elements(league_weeks('vesters')) w where w->>'starts_on' = '2026-12-06'), 'the wall names both');
select pg_temp.ok((league_vest_page('vesters') -> 'weeks' -> 0 ->> 'starts_on') = '2026-12-13'
  and (league_vest_page('vesters') -> 'weeks' -> 1 -> 'holders') = '["Alex Crook", "Bo Dee"]'::jsonb, 'page: weeks newest first with holders');
select pg_temp.ok((league_vest_page('vesters') -> 'board' -> 0 ->> 'name') = 'Alex Crook' and (league_vest_page('vesters') -> 'board' -> 0 ->> 'weeks') = '2', 'most-vests board counts by name across weeks');
select pg_temp.ok(league_vest_page('nope') is null, 'unknown league = null');
select pg_temp.ok(pg_temp.refused(format('select td_set_vest_holders(%L, ''{}''::uuid[], null)', pg_temp.v('w1')), 'permission denied'), 'anon can''t award');
reset role;

-- take it back
select pg_temp.claims('00000000-0000-4000-8000-000000000bb1', true); set role authenticated;
select td_set_vest_holders(pg_temp.v('w1')::uuid, '{}'::uuid[], 'x');
reset role;
select pg_temp.ok(not exists (select 1 from league_vest where event_id = pg_temp.v('w1')::uuid) and (select vest_note is null from events where id = pg_temp.v('w1')::uuid), 'taken back clears holders + note');
-- hidden leagues have no page
select pg_temp.claims('00000000-0000-4000-8000-000000000bb1', true); set role authenticated;
select td_save_league(pg_temp.v('lg')::uuid, '{"hidden":true,"award_image":"/assets/leagues/vest.webp"}');
reset role;
select pg_temp.ok((select award_image = '/assets/leagues/vest.webp' from leagues where id = pg_temp.v('lg')::uuid), 'award art saved');
select set_config('request.jwt.claims', '', false); set role anon;
select pg_temp.ok(league_vest_page('vesters') is null, 'hidden league = no page');
reset role;
