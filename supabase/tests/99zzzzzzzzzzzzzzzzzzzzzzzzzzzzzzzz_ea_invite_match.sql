-- Early Access invites: find the existing member before making a new one. Runs in a transaction, rolls back.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
begin;
create or replace function pg_temp.ev() returns uuid language sql as $$ select id from events where slug = 'jewel-xi-2026' $$;
create or replace function pg_temp.mem(n text) returns uuid language sql security definer as $$ select id from tag_members where name = n $$;
create or replace function pg_temp.names(q text) returns text[] language sql as $$ select array(select x ->> 'name' from jsonb_array_elements(td_ea_invite_matches(pg_temp.ev(), q)) x) $$;
grant execute on function pg_temp.ev(), pg_temp.mem(text), pg_temp.names(text) to anon, authenticated;
insert into tag_pools (slug, name, sort) values ('match-test', 'Match Test', 90);
insert into tag_members (name, nickname) values ('Hayden', 'The Canayden'), ('Haydenn Lookalike', null), ('Purvis Pete', null), ('Bo Match', 'Hay Bale'), ('Zed Other', null);
insert into tags (pool_id, number, holder_id, status) values ((select id from tag_pools where slug = 'match-test'), 7, pg_temp.mem('Hayden'), 'held');
set client_min_messages = notice;

select set_config('request.jwt.claims', '', false); set role anon;
select pg_temp.ok(pg_temp.refused(format('select td_ea_invite_matches(%L, ''Hayden'')', pg_temp.ev()), 'permission denied'), 'anon can''t search members');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000ea0a1', 'app_metadata', json_build_object('role', 'td'))::text, false); set role authenticated;
select pg_temp.ok((pg_temp.names('Hayden Purvis'))[1] = 'Hayden', 'typed "Hayden Purvis": the existing Hayden comes first');
select pg_temp.ok('Purvis Pete' = any (pg_temp.names('Hayden Purvis')) and not ('Zed Other' = any (pg_temp.names('Hayden Purvis'))), 'any word that starts a name counts; strangers don''t');
select pg_temp.ok('Haydenn Lookalike' = any (pg_temp.names('Hay')) and 'Bo Match' = any (pg_temp.names('Hay')), 'prefix match, on names and nicknames');
select pg_temp.ok('Hayden' = any (pg_temp.names('Canayden')) and not ('Hayden' = any (pg_temp.names('anayden'))), 'nicknames count, from the start of a word');
select pg_temp.ok((select (x -> 'tags') = '["Match Test #7"]'::jsonb and not (x ->> 'joined')::boolean from jsonb_array_elements(td_ea_invite_matches(pg_temp.ev(), 'hayden')) x where x ->> 'name' = 'Hayden'), 'shows the tags they hold');
select pg_temp.ok(td_ea_invite_matches(pg_temp.ev(), 'a') = '[]'::jsonb, 'one letter: nothing');
select pg_temp.ok((td_ea_invite_member(pg_temp.ev(), pg_temp.mem('Hayden')) ->> 'member_id')::uuid = pg_temp.mem('Hayden'), 'invite the existing member');
select pg_temp.ok((select (x ->> 'joined')::boolean from jsonb_array_elements(td_ea_invite_matches(pg_temp.ev(), 'hayden')) x where x ->> 'name' = 'Hayden'), '...now marked as joined');
select pg_temp.ok(pg_temp.refused(format('select td_ea_invite_member(%L, %L)', pg_temp.ev(), pg_temp.mem('Hayden')), 'member_already_joined'), 'not twice');
select pg_temp.ok(pg_temp.refused(format('select td_ea_invite_member(%L, %L)', pg_temp.ev(), gen_random_uuid()), 'not_found'), 'unknown member');
reset role;
select pg_temp.ok((select count(*) from tag_members where name ilike 'hayden%') = 2, 'no new Hayden was made');
select pg_temp.ok(exists (select 1 from tags t join early_access e on e.pool_id = t.pool_id where e.event_id = pg_temp.ev() and t.holder_id = pg_temp.mem('Hayden')), 'his Early Access tag is on the same member');
rollback;
