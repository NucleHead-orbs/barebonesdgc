-- Skins: the club default, who can set it, and it ending on its own. Runs in a transaction, rolls back.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
begin;
select set_config('request.jwt.claims', '', false);
set client_min_messages = notice;

set role anon;
select pg_temp.ok(skin_default_get() = '{"skin": "night", "until": null}'::jsonb, 'out of the box: Night Card');
select pg_temp.ok(pg_temp.refused('select td_skin_default_set(''spooky'', null)', ''), 'anon cannot set it');
select pg_temp.ok(pg_temp.refused('select * from skin_default', 'permission denied'), 'the table is not readable directly');
reset role;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","email":"td@example.com","app_metadata":{}}', false);
select pg_temp.ok(pg_temp.refused('select td_skin_default_set(''spooky'', null)', 'not_allowed'), 'an event TD cannot set it');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c2","email":"boss@example.com","app_metadata":{"role":"td"}}', false);
select pg_temp.ok(pg_temp.refused('select td_skin_default_set(''hotdog'', null)', 'invalid_skin'), 'only known skins');
select pg_temp.ok(pg_temp.refused('select td_skin_default_set(null, null)', 'invalid_skin'), 'a skin is required');
select pg_temp.ok(pg_temp.refused(format('select td_skin_default_set(%L, %L)', 'spooky', (now() at time zone 'America/Phoenix')::date - 1), 'invalid_until'), 'no end date in the past');
select pg_temp.ok(td_skin_default_set('spooky', ((now() at time zone 'America/Phoenix')::date + 20)) ->> 'skin' = 'spooky', 'super admin sets Spooky for the season');
select pg_temp.ok(td_skin_default_set('sweater', (now() at time zone 'America/Phoenix')::date) ->> 'skin' = 'sweater', 'ending today still counts today');
reset role;
select pg_temp.ok((select set_at from skin_default) > now() - interval '1 minute', 'when it was set is kept');

-- ends on its own: once the last day has passed, everyone is back on Night Card
update skin_default set until = (now() at time zone 'America/Phoenix')::date - 1;
set role anon;
select pg_temp.ok(skin_default_get() = '{"skin": "night", "until": null}'::jsonb, 'an ended default falls back to Night Card');
reset role;
set role authenticated;
select pg_temp.ok(td_skin_default_set('gmode', null) = '{"skin": "gmode", "until": null}'::jsonb, 'no end date = until changed');
reset role;
select pg_temp.ok((select count(*) from skin_default) = 1, 'always one row');

select 'PASSED' as skins;
rollback;
