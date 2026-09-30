-- Random draw doubles. Run after stub + all migrations.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create temp table d_ctx (k text primary key, v text);
grant all on d_ctx to anon, authenticated;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.claims(sub text, admin boolean) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', sub, 'app_metadata', case when admin then '{"role":"td"}'::json else '{}'::json end)::text, false) $$;
create or replace function pg_temp.pid(n text) returns uuid language sql as $$
  select p.id from players p join events e on e.id = p.event_id where e.slug like 'dubs-night%' and p.name = n $$;
grant execute on function pg_temp.pid(text) to anon, authenticated;
create or replace function pg_temp.ev() returns uuid language sql as $$ select v::uuid from d_ctx where k = 'ev' $$;
grant execute on function pg_temp.ev() to anon, authenticated;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-00000000d0a1', 'd-boss@club.test', now()),
  ('00000000-0000-4000-8000-00000000d0b1', 'd-td@club.test', now()),
  ('00000000-0000-4000-8000-00000000d0c1', 'd-other@club.test', now())
on conflict do nothing;
select pg_temp.claims('00000000-0000-4000-8000-00000000d0a1', true); set role authenticated;
insert into d_ctx select 'ev', td_create_event('Dubs Night', 'Club', '2026-12-05', '2026-12-05', null, 3, '[{"code":"MA1"}]')->>'id';
insert into event_tds (event_id, email) select pg_temp.ev(), 'd-td@club.test';
reset role;
set client_min_messages = notice;

-- ===== the event TD sets up a doubles round 1 + singles round 2 =====
select pg_temp.claims('00000000-0000-4000-8000-00000000d0b1', false); set role authenticated;
select td_update_event(pg_temp.ev(), '{"rounds": 2, "r1_format": "doubles", "dubs_style": "Best disc"}');
select td_import_players(pg_temp.ev(), '[{"name":"Ann","div_code":"MA1"},{"name":"Bob","div_code":"MA1"},{"name":"Cal","div_code":"MA1"},{"name":"Dee","div_code":"MA1"},{"name":"Eve","div_code":"MA1"}]');
select pg_temp.ok(pg_temp.refused($q$select td_set_teams(pg_temp.ev(), 2::smallint, '[]')$q$, 'not_doubles'), 'teams only exist on a doubles round');
select pg_temp.ok(pg_temp.refused(format('select td_set_teams(pg_temp.ev(), 1::smallint, %L)', json_build_array(json_build_array(pg_temp.pid('Ann'), pg_temp.pid('Bob')), json_build_array(pg_temp.pid('Bob'), pg_temp.pid('Cal')))), 'duplicate_player'),
  'a player can only be drawn once');
select pg_temp.ok(td_set_teams(pg_temp.ev(), 1::smallint, json_build_array(json_build_array(pg_temp.pid('Ann'), pg_temp.pid('Bob')),
  json_build_array(pg_temp.pid('Cal'), pg_temp.pid('Dee')), json_build_array(pg_temp.pid('Eve')))::jsonb) = 3, 'draw saved: 2 teams + a Cali');
select pg_temp.ok(pg_temp.refused(format('select td_publish_round(pg_temp.ev(), 1::smallint, %L)', json_build_array(
  json_build_object('wave','AM','start_hole',1,'group_no',1,'player_ids', json_build_array(pg_temp.pid('Ann'), pg_temp.pid('Cal'))),
  json_build_object('wave','AM','start_hole',2,'group_no',1,'player_ids', json_build_array(pg_temp.pid('Bob'), pg_temp.pid('Dee'), pg_temp.pid('Eve'))))), 'team_split'),
  'publish refuses a card that splits a team');
insert into d_ctx select 'pub', td_publish_round(pg_temp.ev(), 1::smallint, json_build_array(
  json_build_object('wave','AM','start_hole',1,'group_no',1,'player_ids', json_build_array(pg_temp.pid('Ann'), pg_temp.pid('Bob'), pg_temp.pid('Eve'))),
  json_build_object('wave','AM','start_hole',2,'group_no',1,'player_ids', json_build_array(pg_temp.pid('Cal'), pg_temp.pid('Dee'))))::jsonb)::text;
select pg_temp.ok(pg_temp.refused($q$select td_update_event(pg_temp.ev(), '{"r1_format": "singles"}')$q$, 'round_has_cards'), 'format locked once the round has cards');
reset role;
insert into d_ctx select 'tok1', token from card_tokens t join cards c on c.event_id = t.event_id and c.round = t.round and c.label = t.label
  where c.event_id = pg_temp.ev() and c.round = 1 and c.start_hole = 1;

-- ===== scorecard (anon, by token) =====
set role anon;
select pg_temp.ok((select (get_card(v)->'card'->>'format') = 'doubles' and (get_card(v)->'card'->>'dubs_style') = 'Best disc'
                   and jsonb_array_length(get_card(v)->'teams') = 2 from d_ctx where k = 'tok1'), 'card knows it is doubles and lists its 2 teams');
select pg_temp.ok((select score_upsert(v, pg_temp.pid('Bob'), 1::smallint, 3::smallint) = 'applied' from d_ctx where k = 'tok1'), 'partner can enter the team score');
reset role;
select pg_temp.ok((select count(*) = 1 from scores where player_id = pg_temp.pid('Ann') and round = 1)
                  and (select count(*) = 0 from scores where player_id = pg_temp.pid('Bob')), 'partner entry lands on the captain');
set role anon;
select score_upsert(v, pg_temp.pid('Ann'), h::smallint, 3::smallint) from d_ctx, generate_series(2, 3) h where k = 'tok1';
select pg_temp.ok((select sign_card(v, pg_temp.pid('Ann'), 'AA') = 'incomplete' from d_ctx where k = 'tok1'), 'Cali still has holes to score');
select score_upsert(v, pg_temp.pid('Eve'), h::smallint, 4::smallint) from d_ctx, generate_series(1, 3) h where k = 'tok1';
select pg_temp.ok((select (get_card(v)->>'complete')::boolean from d_ctx where k = 'tok1'), 'card complete with one line per team');
select pg_temp.ok((select sign_card(v, pg_temp.pid('Bob'), 'BB') = 'signed' from d_ctx where k = 'tok1'), 'partner signs for the team');
select pg_temp.ok((select submit_card(v) = 'missing_signatures' from d_ctx where k = 'tok1'), 'the Cali still has to sign');
select sign_card(v, pg_temp.pid('Eve'), 'EE') from d_ctx where k = 'tok1';
select pg_temp.ok((select submit_card(v) = 'submitted' from d_ctx where k = 'tok1'), 'one signature per team submits the card');
select pg_temp.ok((select strokes = 9 and official from player_rounds where player_id = pg_temp.pid('Bob') and round = 1), 'partner''s round mirrors the team');
select pg_temp.ok((select strokes = 9 and b_name = 'Bob' and card_label = '1' from team_rounds where player_a = pg_temp.pid('Ann')), 'team board row');
select pg_temp.ok((select strokes = 12 and b_name is null from team_rounds where player_a = pg_temp.pid('Eve')), 'Cali on the team board');
select pg_temp.ok(pg_temp.refused('select count(*) from round_payouts', 'permission denied'), 'anon: team payouts are private');
reset role;

-- ===== locks + privacy =====
select pg_temp.claims('00000000-0000-4000-8000-00000000d0b1', false); set role authenticated;
select pg_temp.ok(pg_temp.refused($q$select td_set_teams(pg_temp.ev(), 1::smallint, '[]')$q$, 'round_has_scores'), 'no re-draw once scoring started');
insert into round_payouts (event_id, round, currency, entry_fee) values (pg_temp.ev(), 1, 'cash', 5);
reset role;
select pg_temp.claims('00000000-0000-4000-8000-00000000d0c1', false); set role authenticated;
select pg_temp.ok(pg_temp.refused($q$select td_set_teams(pg_temp.ev(), 1::smallint, '[]')$q$, 'forbidden'), 'other TD cannot touch the draw');
select pg_temp.ok((select count(*) = 0 from round_payouts), 'other TD cannot see team payouts');
reset role;
set role anon;
select pg_temp.ok(pg_temp.refused(format('insert into teams (event_id, round, team_no, player_a) values (%L, 2, 9, %L)', pg_temp.ev(), pg_temp.pid('Ann')), 'permission denied'), 'anon cannot write teams');
reset role;

-- ===== next event =====
select pg_temp.claims('00000000-0000-4000-8000-00000000d0b1', false); set role authenticated;
insert into d_ctx select 'next', td_create_event('Dubs Night 2', null, '2026-12-12', '2026-12-12', pg_temp.ev(), 3, '[]')->>'id';
reset role;
select pg_temp.ok((select r1_format = 'doubles' and r2_format = 'singles' and dubs_style = 'Best disc' from events where id = (select v::uuid from d_ctx where k = 'next')),
  'duplicate keeps the round formats');
select pg_temp.ok((select count(*) = 1 from round_payouts where event_id = (select v::uuid from d_ctx where k = 'next')), 'duplicate keeps the team payout setup');
select pg_temp.ok((select count(*) = 0 from teams where event_id = (select v::uuid from d_ctx where k = 'next')), 'duplicate never copies the draw');

-- ===== switching back to singles drops the draw (only while no cards) =====
select pg_temp.claims('00000000-0000-4000-8000-00000000d0b1', false); set role authenticated;
select td_update_event((select v::uuid from d_ctx where k = 'next'), '{"r1_format": "doubles"}');
reset role;
\echo ALL DOUBLES TESTS PASSED
