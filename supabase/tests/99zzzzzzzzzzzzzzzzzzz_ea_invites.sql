-- Early Access invites (not registrants). Runs after the early access tests.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.ev() returns uuid language sql as $$ select id from events where slug = 'jewel-xi-2026' $$;
create or replace function pg_temp.mem(n text) returns uuid language sql security definer as $$ select id from tag_members where name = n $$;
create or replace function pg_temp.tok(n text) returns text language sql security definer as $$ select token from tag_members where name = n $$;
create or replace function pg_temp.ea() returns uuid language sql security definer as $$ select id from tag_pools where slug = 'jewel-xi-ea' $$;
create or replace function pg_temp.st(n text, f text) returns int language sql security definer as $$
  select (x ->> f)::int from jsonb_array_elements(_ea_standings(pg_temp.ev())) x where x ->> 'name' = n $$;
create or replace function pg_temp.card() returns jsonb language sql as $$ select jsonb_agg(3) from generate_series(1, 18) $$;
create or replace function pg_temp.rnd(who text[]) returns jsonb language sql as $$
  select jsonb_build_object('course', 'Freedom', 'played_on', current_date, 'pars', pg_temp.card(),
    'players', (select jsonb_agg(jsonb_build_object('member_id', pg_temp.mem(w), 'scores', pg_temp.card())) from unnest(who) w)) $$;
grant execute on function pg_temp.ev(), pg_temp.mem(text), pg_temp.tok(text), pg_temp.ea(), pg_temp.st(text, text), pg_temp.card(), pg_temp.rnd(text[]) to anon, authenticated;
create temp table i_ctx (k text primary key, v text);
grant all on i_ctx to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from i_ctx where k = key $$;
grant execute on function pg_temp.v(text) to anon, authenticated;
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-4000-8000-0000000ea1a1', 'inv-rando@club.test', now()) on conflict do nothing;
-- the spots are full: invites don't care
update early_access set max_players = 1, opens_on = least(opens_on, current_date - 1), closes_on = greatest(closes_on, current_date + 7) where event_id = pg_temp.ev();
insert into tag_members (name) values ('Jack Selleh') on conflict do nothing;
set client_min_messages = notice;

select set_config('request.jwt.claims', '', false); set role anon;
select pg_temp.ok(pg_temp.refused(format('select td_ea_invite(%L, ''Greg Wood'', null)', pg_temp.ev()), 'permission denied'), 'anon can''t invite');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000ea1a1')::text, false); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select td_ea_invite(%L, ''Greg Wood'', null)', pg_temp.ev()), 'forbidden'), 'only the event''s TDs invite');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000ea0a1', 'app_metadata', json_build_object('role', 'td'))::text, false); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select td_ea_invite(%L, ''  '', null)', pg_temp.ev()), 'name_required'), 'needs a name');
insert into i_ctx select 'greg', td_ea_invite(pg_temp.ev(), '  Greg Wood ', 'Woody')::text;
insert into i_ctx select 'jack', td_ea_invite(pg_temp.ev(), 'jack selleh', null)::text;
select pg_temp.ok((pg_temp.v('greg')::jsonb ->> 'token') = pg_temp.tok('Greg Wood') and (pg_temp.v('greg')::jsonb ->> 'number') is not null, 'invite: new member, a tag, and their My Tag link (spots full or not)');
select pg_temp.ok((pg_temp.v('jack')::jsonb ->> 'member_id')::uuid = pg_temp.mem('Jack Selleh'), 'an existing club member is reused by name');
select pg_temp.ok(pg_temp.refused(format('select td_ea_invite(%L, ''GREG WOOD'', null)', pg_temp.ev()), 'member_already_joined'), 'one invite per person');
select pg_temp.ok((select x ->> 'via' = 'invite' and x ->> 'player' = 'Greg Wood' and x ->> 'token' = pg_temp.tok('Greg Wood') from jsonb_array_elements(td_ea_get(pg_temp.ev()) -> 'linked') x where x ->> 'member' = 'Greg Wood'),
  'TDs see invites in the joined list with the link to re-send');
select pg_temp.ok((select x ->> 'token' is null from jsonb_array_elements(td_ea_get(pg_temp.ev()) -> 'linked') x where x ->> 'via' <> 'invite' limit 1), 'registrants'' links aren''t in that list');
reset role;
select pg_temp.ok((select nickname = 'Woody' from tag_members where name = 'Greg Wood'), 'nickname kept');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(ea_public('jewel-xi-2026') -> 'roster') x where x ->> 'name' = 'Greg Wood')
  and exists (select 1 from jsonb_array_elements(ea_public('jewel-xi-2026') -> 'standings') x where x ->> 'name' = 'Greg Wood'), 'not on the registrant roster, on the raffle board');
-- invites count as Jewel players: Greg + Jack + Axl is a counting round
set role anon;
insert into i_ctx select 'r', (round_save_swap(pg_temp.tok('Greg Wood'), pg_temp.rnd(array['Greg Wood', 'Jack Selleh', 'Axl Anhyzer Jr']), array[pg_temp.ea()]) ->> 'round_id');
select round_confirm(pg_temp.tok('Jack Selleh'), pg_temp.v('r')::uuid, true);
select round_confirm(pg_temp.tok('Axl Anhyzer Jr'), pg_temp.v('r')::uuid, true);
select pg_temp.ok(pg_temp.st('Greg Wood', 'rounds') = 1 and pg_temp.st('Greg Wood', 'partners') = 2, 'invites earn tickets like anyone');
select pg_temp.ok((select x ->> 'status' from jsonb_array_elements(ea_me(pg_temp.tok('Greg Wood'))) x where x ->> 'slug' = 'jewel-xi-2026') = 'approved', 'My Tag shows Greg is in');
select pg_temp.ok(pg_temp.refused(format('select round_save_swap(%L, %L, %L)', pg_temp.tok('Greg Wood'), pg_temp.rnd(array['Greg Wood', 'Jack Selleh']), array[pg_temp.ea()]), 'needs_challenge'), 'and the 2-player rule applies to them too');
reset role;
-- remove works the same
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000ea0a1', 'app_metadata', json_build_object('role', 'td'))::text, false); set role authenticated;
select td_ea_remove((select x ->> 'claim_id' from jsonb_array_elements(td_ea_get(pg_temp.ev()) -> 'linked') x where x ->> 'member' = 'Jack Selleh')::uuid);
reset role;
select pg_temp.ok(not exists (select 1 from tags where pool_id = pg_temp.ea() and holder_id = pg_temp.mem('Jack Selleh')), 'removing an invite frees the tag');
select pg_temp.ok(pg_temp.refused($$insert into ea_claims (event_id, player_id, member_id, via, status) values ((select id from events where slug = 'jewel-xi-2026'), null, (select id from tag_members where name = 'Jack Selleh'), 'mytag', 'approved')$$, 'ea_claims_invite_check'), 'only invites have no registrant');
select set_config('request.jwt.claims', '', false);
