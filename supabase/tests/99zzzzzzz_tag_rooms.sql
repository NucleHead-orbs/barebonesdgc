-- Tag rooms: one shared link, tap your tile, first come first numbered. Run after stub + all migrations.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.claims(sub text, admin boolean) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', sub, 'app_metadata', case when admin then '{"role":"td"}'::json else '{}'::json end)::text, false) $$;
create or replace function pg_temp.pool() returns uuid language sql as $$ select id from tag_pools where slug = 'room-test' $$;
create or replace function pg_temp.mem(n text) returns uuid language sql as $$ select id from tag_members where name = n $$;
create or replace function pg_temp.tok(n text) returns text language sql security definer as $$ select token from tag_members where name = n $$;
create or replace function pg_temp.room() returns text language sql security definer as $$ select token from tag_rooms where pool_id = pg_temp.pool() $$;
create or replace function pg_temp.num(n text) returns int language sql as $$ select number from tags where pool_id = pg_temp.pool() and holder_id = pg_temp.mem(n) $$;
create temp table r2_ctx (k text primary key, v text);
grant all on r2_ctx to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from r2_ctx where k = key $$;
create or replace function pg_temp.put(key text, val text) returns void language sql as $$
  insert into r2_ctx values (key, val) on conflict (k) do update set v = excluded.v $$;
grant execute on function pg_temp.pool(), pg_temp.mem(text), pg_temp.tok(text), pg_temp.room(), pg_temp.num(text), pg_temp.v(text), pg_temp.put(text, text) to anon, authenticated;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-00000000f0a1', 'rm-boss@club.test', now()),
  ('00000000-0000-4000-8000-00000000f0b1', 'rm-rando@club.test', now())
on conflict do nothing;
insert into tag_pools (slug, name, sort, invite_only) values ('room-test', 'Room Test', 99, true) on conflict do nothing;
select set_config('request.jwt.claims', '', false);
set client_min_messages = notice;

-- ---------- Golden Boners got its room from the migration ----------
select pg_temp.ok(exists (select 1 from tag_rooms r join tag_pools p on p.id = r.pool_id where p.slug = 'golden-boners' and r.open), 'Golden Boners room is open');

-- ---------- access ----------
set role anon;
select pg_temp.ok(pg_temp.refused('select * from tag_rooms', 'permission denied'), 'rooms table is private');
select pg_temp.ok(pg_temp.refused('select * from tag_invites', 'permission denied'), 'invites table is private');
select pg_temp.ok(pg_temp.refused('select room_get(''nope'')', 'invalid_room'), 'bad room link refused');
reset role;
select pg_temp.claims('00000000-0000-4000-8000-00000000f0b1', false); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select td_room_start(%L)', pg_temp.pool()), 'forbidden'), 'only a pool admin opens a room');
reset role;

-- ---------- admin sets it up ----------
select pg_temp.claims('00000000-0000-4000-8000-00000000f0a1', true); set role authenticated;
select pg_temp.ok((td_room_get(pg_temp.pool()) ->> 'on')::boolean = false, 'no room yet');
select td_room_start(pg_temp.pool());
select td_room_start(pg_temp.pool());
select pg_temp.ok(length(td_room_get(pg_temp.pool()) ->> 'token') = 64, 'room has a long shared link; starting twice is harmless');
select td_room_invite(pg_temp.pool(), null, 'Gilda Gold', 'Gilly');
select td_room_invite(pg_temp.pool(), null, 'Goldie Hawn-Bone', null);
select td_room_invite(pg_temp.pool(), null, 'Midas Touch', null);
select td_room_invite(pg_temp.pool(), null, 'gilda gold', null);
select pg_temp.ok(jsonb_array_length(td_room_get(pg_temp.pool()) -> 'invites') = 3, 'same name invited twice = one tile');
select pg_temp.ok(pg_temp.refused(format('select td_room_invite(%L, null, %L, null)', pg_temp.pool(), ' '), 'name_required'), 'invite needs a name');
reset role;

-- ---------- players tap tiles ----------
set role anon;
select pg_temp.ok(jsonb_array_length(room_get(pg_temp.room()) -> 'tiles') = 3
  and (select bool_and(not (x ->> 'active')::boolean) from jsonb_array_elements(room_get(pg_temp.room()) -> 'tiles') x), 'room shows 3 untapped tiles');
select pg_temp.ok(not (room_get(pg_temp.room()) ? 'token') and (select bool_and(not (x ? 'token')) from jsonb_array_elements(room_get(pg_temp.room()) -> 'tiles') x),
  'room page never shows My Tag links');
select pg_temp.put('g1', room_activate(pg_temp.room(), pg_temp.mem('Goldie Hawn-Bone'))::text);
select pg_temp.ok((pg_temp.v('g1')::jsonb ->> 'number')::int = 1, 'first tap gets #1');
select pg_temp.ok((pg_temp.v('g1')::jsonb ->> 'token') = pg_temp.tok('Goldie Hawn-Bone'), 'that phone gets the My Tag link');
select pg_temp.ok(pg_temp.refused(format('select room_activate(%L, %L)', pg_temp.room(), pg_temp.mem('Goldie Hawn-Bone')), 'already_active'), 'a tile taps once');
select pg_temp.ok((room_activate(pg_temp.room(), pg_temp.mem('Gilda Gold')) ->> 'number')::int = 2, 'second tap gets #2');
select pg_temp.ok(pg_temp.refused(format('select room_activate(%L, %L)', pg_temp.room(), pg_temp.mem('Rex')), 'not_invited'), 'uninvited member refused');
select pg_temp.ok((select (x ->> 'number')::int from jsonb_array_elements(room_get(pg_temp.room()) -> 'tiles') x where x ->> 'name' = 'Gilda Gold') = 2, 'tapped tile shows its number');
reset role;
select pg_temp.ok((select kind from tag_history where pool_id = pg_temp.pool() and number = 1 order by id desc limit 1) = 'issued', 'activation logged as issued');

-- closed room
select pg_temp.claims('00000000-0000-4000-8000-00000000f0a1', true); set role authenticated;
select td_room_set_open(pg_temp.pool(), false);
reset role;
set role anon;
select pg_temp.ok(pg_temp.refused(format('select room_activate(%L, %L)', pg_temp.room(), pg_temp.mem('Midas Touch')), 'room_closed'), 'closed room: no taps');
select pg_temp.ok((room_get(pg_temp.room()) ->> 'open')::boolean = false, 'page knows the room is closed');
reset role;

-- ---------- wrong tile: reset ----------
select pg_temp.put('oldtok', pg_temp.tok('Goldie Hawn-Bone'));
select pg_temp.claims('00000000-0000-4000-8000-00000000f0a1', true); set role authenticated;
select td_room_set_open(pg_temp.pool(), true);
select td_room_reset(pg_temp.pool(), pg_temp.mem('Goldie Hawn-Bone'));
select pg_temp.ok(pg_temp.refused(format('select td_room_reset(%L, %L)', pg_temp.pool(), pg_temp.mem('Midas Touch')), 'not_active'), 'can''t reset an untapped tile');
select pg_temp.ok(pg_temp.refused(format('select td_room_uninvite(%L, %L)', pg_temp.pool(), pg_temp.mem('Gilda Gold')), 'reset_first'), 'tapped tile must be reset before removing');
reset role;
select pg_temp.ok(pg_temp.num('Goldie Hawn-Bone') is null and (select status from tags where pool_id = pg_temp.pool() and number = 1) = 'available', 'reset puts the tag back in the pot');
select pg_temp.ok(pg_temp.tok('Goldie Hawn-Bone') <> pg_temp.v('oldtok'), 'reset replaces their My Tag link');
set role anon;
select pg_temp.ok(pg_temp.refused(format('select tag_me(%L)', pg_temp.v('oldtok')), 'invalid_link'), 'the wrong phone loses access');
select pg_temp.ok((room_activate(pg_temp.room(), pg_temp.mem('Midas Touch')) ->> 'number')::int = 1, 'next tap gets the lowest free number');
select pg_temp.ok((room_activate(pg_temp.room(), pg_temp.mem('Goldie Hawn-Bone')) ->> 'number')::int = 3, 'reset tile can be tapped again');
reset role;

-- retired numbers are skipped
select pg_temp.claims('00000000-0000-4000-8000-00000000f0a1', true); set role authenticated;
select td_room_invite(pg_temp.pool(), null, 'Late Larry', null);
select td_tag_release(pg_temp.pool(), 3, true);
reset role;
set role anon;
select pg_temp.ok((room_activate(pg_temp.room(), pg_temp.mem('Late Larry')) ->> 'number')::int = 4, 'retired numbers are never handed out');
reset role;

-- ---------- list upkeep ----------
select pg_temp.claims('00000000-0000-4000-8000-00000000f0a1', true); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select td_room_invite(%L, %L, null, null)', pg_temp.pool(), pg_temp.mem('Midas Touch')), 'already_has_tag'), 'tag holders aren''t re-invited');
select td_room_invite(pg_temp.pool(), null, 'Extra Ed', null);
select td_room_uninvite(pg_temp.pool(), pg_temp.mem('Extra Ed'));
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(td_room_get(pg_temp.pool()) -> 'invites') x where x ->> 'name' = 'Extra Ed'), 'removed tile is gone');
select pg_temp.put('oldroom', pg_temp.room());
select td_room_new_link(pg_temp.pool());
reset role;
set role anon;
select pg_temp.ok(pg_temp.refused(format('select room_get(%L)', pg_temp.v('oldroom')), 'invalid_room'), 'new link: the old one stops working');
select pg_temp.ok(jsonb_array_length(room_get(pg_temp.room()) -> 'tiles') = 4, 'new link works');
reset role;
select set_config('request.jwt.claims', '', false);
\echo PASSED 99zzzzzzz_tag_rooms
