-- Check-in rounds: check in, cards across the field, one field-wide swap per set. Runs in a transaction, rolls back.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
begin;
create temp table f_ctx (k text primary key, v text) on commit drop;
grant all on f_ctx to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from f_ctx where k = key $$;
create or replace function pg_temp.pool(s text) returns uuid language sql security definer as $$ select id from tag_pools where slug = s $$;
create or replace function pg_temp.mem(n text) returns uuid language sql security definer as $$ select id from tag_members where name = n $$;
create or replace function pg_temp.tok(n text) returns text language sql security definer as $$ select token from tag_members where name = n $$;
create or replace function pg_temp.p(n text, sc jsonb) returns jsonb language sql as $$ select jsonb_build_object('member_id', pg_temp.mem(n), 'scores', sc) $$;
create or replace function pg_temp.card(night text, players jsonb) returns jsonb language sql as $$
  select jsonb_build_object('course', 'Glow Park', 'played_on', current_date, 'pars', '[3,3,3,3]'::jsonb, 'night', night, 'players', players) $$;
grant execute on function pg_temp.v(text), pg_temp.pool(text), pg_temp.mem(text), pg_temp.tok(text), pg_temp.p(text, jsonb), pg_temp.card(text, jsonb) to anon, authenticated;
insert into tag_pools (slug, name, sort, chat) values ('glow-a', 'Glow A', 93, true), ('glow-b', 'Glow B', 94, false);
insert into tag_members (name) values ('Host Glow'), ('P1 Glow'), ('P2 Glow'), ('P3 Glow'), ('P4 Glow');
insert into tags (pool_id, number, holder_id, status) values
  (pg_temp.pool('glow-a'), 1, pg_temp.mem('Host Glow'), 'held'), (pg_temp.pool('glow-a'), 2, pg_temp.mem('P1 Glow'), 'held'),
  (pg_temp.pool('glow-a'), 3, pg_temp.mem('P2 Glow'), 'held'), (pg_temp.pool('glow-a'), 4, pg_temp.mem('P3 Glow'), 'held'),
  (pg_temp.pool('glow-b'), 1, pg_temp.mem('P1 Glow'), 'held'), (pg_temp.pool('glow-b'), 2, pg_temp.mem('P3 Glow'), 'held');
insert into courses (name) values ('Glow Park');
insert into f_ctx values ('course', (select id::text from courses where name = 'Glow Park'));
select set_config('request.jwt.claims', '', false);
set client_min_messages = notice;

set role anon;
select pg_temp.ok(pg_temp.refused(format('select tag_night_create(%L, %L, now() + interval ''1 hour'', %L, null)', pg_temp.tok('P4 Glow'), 'Glow', pg_temp.v('course')), 'no_tag'), 'hosting needs a tag in some set');
insert into f_ctx select 'n', tag_night_create(pg_temp.tok('Host Glow'), 'Friday Glow', now() + interval '1 hour', pg_temp.v('course')::uuid, 'Bring lights')::text;
insert into f_ctx select 'late', tag_night_create(pg_temp.tok('Host Glow'), 'Next Glow', now() + interval '5 hours', pg_temp.v('course')::uuid, null)::text;
select pg_temp.ok(pg_temp.refused(format('select tag_night_create(%L, %L, now() + interval ''1 day'', %L, null)', pg_temp.tok('Host Glow'), 'Third', pg_temp.v('course')), 'too_many_nights'), 'two open nights per host');
select pg_temp.ok(pg_temp.refused(format('select tag_night_checkin(%L, %L, true)', pg_temp.tok('P1 Glow'), pg_temp.v('late')), 'night_not_open'), 'check-in opens 3 h before the start');
select tag_night_checkin(pg_temp.tok('P1 Glow'), pg_temp.v('n')::uuid, true);
select tag_night_checkin(pg_temp.tok('P2 Glow'), pg_temp.v('n')::uuid, true);
select tag_night_checkin(pg_temp.tok('P4 Glow'), pg_temp.v('n')::uuid, true);
select tag_night_add(pg_temp.tok('Host Glow'), pg_temp.v('n')::uuid, pg_temp.mem('P3 Glow'), null);
select tag_night_add(pg_temp.tok('Host Glow'), pg_temp.v('n')::uuid, null, 'Glow Guest');
select pg_temp.ok(pg_temp.refused(format('select tag_night_add(%L, %L, null, %L)', pg_temp.tok('Host Glow'), pg_temp.v('n'), 'glow guest '), 'guest_taken'), 'same guest twice is refused');
select pg_temp.ok(pg_temp.refused(format('select tag_night_add(%L, %L, null, %L)', pg_temp.tok('P1 Glow'), pg_temp.v('n'), 'Sneaky'), 'not_your_night'), 'only the host adds people');
select pg_temp.ok(pg_temp.refused(format('select tag_night_checkin(%L, %L, false)', pg_temp.tok('Host Glow'), pg_temp.v('n')), 'host_stays'), 'the host can''t check out');
select tag_night_checkin(pg_temp.tok('P4 Glow'), pg_temp.v('n')::uuid, false);
select pg_temp.ok((select jsonb_array_length(x -> 'players') = 5 and (x ->> 'open')::boolean and (x ->> 'me_in')::boolean from jsonb_array_elements(tag_nights(pg_temp.tok('P1 Glow'))) x where x ->> 'id' = pg_temp.v('n')),
  'tag_nights: 5 checked in (host, P1, P2, P3, a guest), open, P1 is in');
select pg_temp.ok(pg_temp.refused(format('select tag_night_close(%L, %L)', pg_temp.tok('Host Glow'), pg_temp.v('n')), 'no_cards_yet'), 'nothing to close before a card is in');

-- card 1: Host, P1 and the guest
select pg_temp.ok(pg_temp.refused(format('select round_save_swap(%L, %L, array[%L]::uuid[])', pg_temp.tok('Host Glow'),
  pg_temp.card(pg_temp.v('n'), jsonb_build_array(pg_temp.p('Host Glow', '[2,3,3,2]'), pg_temp.p('P1 Glow', '[3,3,3,3]'))), pg_temp.pool('glow-a')), 'night_tags_field'),
  'no per-card tags on a night card');
insert into f_ctx select 'c1', round_save(pg_temp.tok('Host Glow'), pg_temp.card(pg_temp.v('n'), jsonb_build_array(pg_temp.p('Host Glow', '[2,3,3,2]'), pg_temp.p('P1 Glow', '[3,3,3,3]'),
  jsonb_build_object('guest_name', 'Glow Guest', 'scores', '[4,4,4,4]'::jsonb))))::text;
select pg_temp.ok(pg_temp.refused(format('select tag_night_checkin(%L, %L, false)', pg_temp.tok('P1 Glow'), pg_temp.v('n')), 'already_on_card'), 'on a saved card: can''t check out');
select pg_temp.ok((select not (x ->> 'closed')::boolean and (x ->> 'cards')::int = 1 and x ->> 'my_card' = pg_temp.v('c1')
                     and (select bool_and((p ->> 'carded')::boolean) from jsonb_array_elements(x -> 'players') p where p ->> 'name' in ('Glow Guest', 'P1 Glow'))
                     and not (select (p ->> 'carded')::boolean from jsonb_array_elements(x -> 'players') p where p ->> 'name' = 'P2 Glow')
                   from jsonb_array_elements(tag_nights(pg_temp.tok('P1 Glow'))) x where x ->> 'id' = pg_temp.v('n')),
  'one card in: still open, P1 and the guest show on a card, P2 doesn''t');
select pg_temp.ok(pg_temp.refused(format('select round_save(%L, %L)', pg_temp.tok('P2 Glow'),
  pg_temp.card(pg_temp.v('n'), jsonb_build_array(pg_temp.p('P2 Glow', '[2,2,2,3]'), pg_temp.p('P1 Glow', '[3,3,3,3]')))), 'already_on_card:P1 Glow'), 'a member can''t be on two cards');
select pg_temp.ok(pg_temp.refused(format('select round_save(%L, %L)', pg_temp.tok('P2 Glow'),
  pg_temp.card(pg_temp.v('late'), jsonb_build_array(pg_temp.p('P2 Glow', '[2,2,2,3]')))), 'night_not_open'), 'no cards before the night opens');
-- card 2: P2 and P3 (P3 pulls out after 2): the last checked-in members, so the night closes itself
insert into f_ctx select 'c2', round_save(pg_temp.tok('P2 Glow'), pg_temp.card(pg_temp.v('n'), jsonb_build_array(pg_temp.p('P2 Glow', '[2,2,2,3]'),
  jsonb_build_object('member_id', pg_temp.mem('P3 Glow'), 'scores', '[2,2,null,null]'::jsonb, 'dnf_after', 2))))::text;
reset role;
select pg_temp.ok((select closed_at is not null from tag_nights where id = pg_temp.v('n')::uuid), 'last checked-in member carded: the night closes itself');
select pg_temp.ok((select count(*) = 2 from tag_matches where night_id = pg_temp.v('n')::uuid and status = 'pending'), 'one pending field swap per set (A: 4 holders, B: 2)');
select pg_temp.ok((select count(*) = 4 from tag_match_players p join tag_matches m on m.id = p.match_id where m.night_id = pg_temp.v('n')::uuid and m.pool_id = pg_temp.pool('glow-a')),
  'set A: every holder in the field, across both cards');
select pg_temp.ok((select bool_and((p.confirmed_at is not null) = (x.name in ('Host Glow', 'P2 Glow'))) from tag_match_players p join tag_matches m on m.id = p.match_id join tag_members x on x.id = p.member_id
                    where m.night_id = pg_temp.v('n')::uuid), 'the scorers start confirmed, everyone else waits');
select pg_temp.ok((select p.dnf from tag_match_players p join tag_matches m on m.id = p.match_id where m.night_id = pg_temp.v('n')::uuid and m.pool_id = pg_temp.pool('glow-a') and p.member_id = pg_temp.mem('P3 Glow')),
  'the DNF carries onto the field swap');
select pg_temp.ok((select count(*) = 1 from tag_chat where pool_id = pg_temp.pool('glow-a') and body like 'Friday Glow is in: 4 players on 2 cards.%'), 'the Board says the night is in (sets with the Board on)');
select pg_temp.ok((select count(*) = 0 from tag_push_queue q join tag_matches m on q.ref = m.id::text where m.night_id = pg_temp.v('n')::uuid), 'no second confirm ping for the night swap (the card pinged)');
select pg_temp.ok((select _tag_match_json(m.id, pg_temp.mem('P1 Glow')) ->> 'round_id' = pg_temp.v('c1') from tag_matches m where m.night_id = pg_temp.v('n')::uuid and m.pool_id = pg_temp.pool('glow-a')),
  'My Tag: P1 confirms the night swap on their own card');

set role anon;
select pg_temp.ok(pg_temp.refused(format('select round_save(%L, %L)', pg_temp.tok('P4 Glow'),
  pg_temp.card(pg_temp.v('n'), jsonb_build_array(pg_temp.p('P4 Glow', '[3,3,3,3]')))), 'night_closed'), 'closed: no more cards on the night');
select round_confirm(pg_temp.tok('P1 Glow'), pg_temp.v('c1')::uuid, true);
reset role;
select pg_temp.ok((select count(*) = 2 from tag_matches where night_id = pg_temp.v('n')::uuid and status = 'pending'), 'P1 confirmed; still waiting on P3');
set role anon;
select round_confirm(pg_temp.tok('P3 Glow'), pg_temp.v('c2')::uuid, true);
reset role;
select pg_temp.ok((select count(*) = 2 from tag_matches where night_id = pg_temp.v('n')::uuid and status = 'applied'), 'last OK: both sets swap');
select pg_temp.ok((select array_agg(x.name order by t.number) from tags t join tag_members x on x.id = t.holder_id where t.pool_id = pg_temp.pool('glow-a'))
  = '{P2 Glow,Host Glow,P1 Glow,P3 Glow}', 'set A, ranked across both cards: P2 9, Host 10, P1 12, P3 DNF last');
select pg_temp.ok((select array_agg(x.name order by t.number) from tags t join tag_members x on x.id = t.holder_id where t.pool_id = pg_temp.pool('glow-b'))
  = '{P1 Glow,P3 Glow}', 'set B: only its holders swap');
select pg_temp.ok((select count(*) = 1 from tag_chat where pool_id = pg_temp.pool('glow-a') and body like 'Friday Glow at Glow Park: P2 Glow 9, Host Glow 10, P1 Glow 12, P3 Glow 16.%'
  and body like '%P3 Glow pulled out way before climax%'), 'the result post names the night and calls out the DNF');

-- call off, close by hand, and the 12 h backstop
set role anon;
select tag_night_cancel(pg_temp.tok('Host Glow'), pg_temp.v('late')::uuid);
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(tag_nights(pg_temp.tok('Host Glow'))) x where x ->> 'id' = pg_temp.v('late')), 'called off: gone from the list');
insert into f_ctx select 'n2', tag_night_create(pg_temp.tok('Host Glow'), 'Glow Two', now(), pg_temp.v('course')::uuid, null)::text;
select tag_night_checkin(pg_temp.tok('P1 Glow'), pg_temp.v('n2')::uuid, true);
select tag_night_checkin(pg_temp.tok('P2 Glow'), pg_temp.v('n2')::uuid, true);
select round_save(pg_temp.tok('Host Glow'), pg_temp.card(pg_temp.v('n2'), jsonb_build_array(pg_temp.p('Host Glow', '[3,3,3,3]'), pg_temp.p('P1 Glow', '[2,3,3,3]'))));
select pg_temp.ok(pg_temp.refused(format('select tag_night_cancel(%L, %L)', pg_temp.tok('Host Glow'), pg_temp.v('n2')), 'cards_saved'), 'can''t call it off once a card is in');
select pg_temp.ok(pg_temp.refused(format('select tag_night_close(%L, %L)', pg_temp.tok('P1 Glow'), pg_temp.v('n2')), 'not_your_night'), 'only the host closes it');
select pg_temp.ok(tag_night_close(pg_temp.tok('Host Glow'), pg_temp.v('n2')::uuid) = 1, 'host closes early (P2 never carded): set A goes up with who played');
select pg_temp.ok(pg_temp.refused(format('select tag_night_close(%L, %L)', pg_temp.tok('Host Glow'), pg_temp.v('n2')), 'night_closed'), 'closing twice is refused');
insert into f_ctx select 'n3', tag_night_create(pg_temp.tok('Host Glow'), 'Glow Three', now(), pg_temp.v('course')::uuid, null)::text;
reset role;
update tag_nights set starts_at = now() - interval '13 hours' where id = pg_temp.v('n3')::uuid;
select pg_temp.ok(tag_night_tick() >= 1, 'the clock finds the stale night');
select pg_temp.ok((select closed_at is not null from tag_nights where id = pg_temp.v('n3')::uuid), '12 h after the start the clock closes it');
rollback;
