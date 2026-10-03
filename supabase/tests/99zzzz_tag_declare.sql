-- Declared tags + league-night proposals. Run after stub + all migrations and the 99z suites (Rex/Moe/Kit/Zed).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.tok(n text) returns text language sql security definer as $$ select token from tag_members where name = n $$;
create or replace function pg_temp.mem(n text) returns uuid language sql as $$ select id from tag_members where name = n $$;
create or replace function pg_temp.pool(s text) returns uuid language sql as $$ select id from tag_pools where slug = s $$;
create or replace function pg_temp.ev() returns uuid language sql as $$ select id from events where slug = 'jewel-xi-2026' $$;
grant execute on function pg_temp.tok(text), pg_temp.mem(text), pg_temp.pool(text), pg_temp.ev() to anon, authenticated;
create or replace function pg_temp.claims(sub text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', sub, 'app_metadata', '{}'::json)::text, false) $$;
create temp table d_ctx (k text primary key, v text);
grant all on d_ctx to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from d_ctx where k = key $$;
grant execute on function pg_temp.v(text) to anon, authenticated;
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000dd', 'd-leaguetd@club.test', now()),
  ('00000000-0000-4000-8000-0000000000de', 'd-rando@club.test', now())
on conflict do nothing;
insert into event_tds (event_id, email) select pg_temp.ev(), 'd-leaguetd@club.test' on conflict do nothing;
update tag_matches set status = 'void' where status in ('pending', 'disputed');
insert into d_ctx select 'rex', (select number from tags where pool_id = pg_temp.pool('golden-boners') and holder_id = pg_temp.mem('Rex'))::text;
insert into d_ctx select 'moe', (select number from tags where pool_id = pg_temp.pool('golden-boners') and holder_id = pg_temp.mem('Moe'))::text;
select set_config('request.jwt.claims', '', false);
set client_min_messages = notice;

-- scorecard: no putting tags on the line after the round is saved
set role anon;
select pg_temp.ok(pg_temp.refused(format('select round_tag_exchange(%L, gen_random_uuid(), %L)', pg_temp.tok('Rex'), pg_temp.pool('golden-boners')), 'permission denied'),
  'tags can''t be put on the line after a round is saved');
reset role;

-- league night: a TD of the event (not a Golden Boners admin) proposes the Golden set
select pg_temp.claims('00000000-0000-4000-8000-0000000000de'); set role authenticated;
select pg_temp.ok(pg_temp.refused(format($q$select td_tag_propose(%L, %L, jsonb_build_array(jsonb_build_object('member_id', %L, 'score', 50), jsonb_build_object('member_id', %L, 'score', 52)), null, null)$q$,
  pg_temp.pool('golden-boners'), pg_temp.ev(), pg_temp.mem('Rex'), pg_temp.mem('Moe')), 'forbidden'), 'only a TD of that event can propose');
reset role;
select pg_temp.claims('00000000-0000-4000-8000-0000000000dd'); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select td_tag_record(%L, %L, %L, null, null)', pg_temp.pool('golden-boners'), pg_temp.ev(),
  jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Rex'), 'score', 50), jsonb_build_object('member_id', pg_temp.mem('Moe'), 'score', 52))), 'forbidden'),
  'the league TD still can''t apply Golden Boners directly');
select pg_temp.ok(pg_temp.refused(format($q$select td_tag_propose(%L, %L, jsonb_build_array(jsonb_build_object('member_id', %L, 'score', 50), jsonb_build_object('member_id', %L, 'score', 52)), null, null)$q$,
  pg_temp.pool('golden-boners'), pg_temp.ev(), pg_temp.mem('Rex'), pg_temp.mem('Zed')), 'no_tag_in_pool'), 'everyone on a proposal holds a tag in that set');
-- Moe shoots 50 (better), Rex 52
insert into d_ctx select 'm', td_tag_propose(pg_temp.pool('golden-boners'), pg_temp.ev(),
  jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Moe'), 'score', 50), jsonb_build_object('member_id', pg_temp.mem('Rex'), 'score', 52)), 'League night', null)::text;
select pg_temp.ok(pg_temp.refused(format($q$select td_tag_propose(%L, %L, jsonb_build_array(jsonb_build_object('member_id', %L, 'score', 50), jsonb_build_object('member_id', %L, 'score', 52)), null, null)$q$,
  pg_temp.pool('golden-boners'), pg_temp.ev(), pg_temp.mem('Rex'), pg_temp.mem('Moe')), 'event_already_recorded'), 'once per set per event');
reset role;
select pg_temp.ok((select status = 'pending' and source = 'event' and created_by_td = 'd-leaguetd@club.test' from tag_matches where id = pg_temp.v('m')::uuid)
  and (select count(*) = 0 from tag_match_players where match_id = pg_temp.v('m')::uuid and confirmed_at is not null), 'proposal waits with nobody confirmed');
select pg_temp.ok((select (number)::text = pg_temp.v('rex') from tags where pool_id = pg_temp.pool('golden-boners') and holder_id = pg_temp.mem('Rex')), 'nothing moved yet');

set role anon;
select pg_temp.ok((tag_me(pg_temp.tok('Rex')) -> 'open' -> 0 ->> 'source') = 'event', 'it shows on the holder''s My Tag to confirm');
select pg_temp.ok(jsonb_array_length(tag_pending(pg_temp.pool('golden-boners'))) = 1, 'and on the Golden Boners board as pending');
select pg_temp.ok(tag_confirm(pg_temp.tok('Rex'), pg_temp.v('m')::uuid, true) = 'pending', 'first confirmation waits');
select pg_temp.ok(tag_confirm(pg_temp.tok('Moe'), pg_temp.v('m')::uuid, true) = 'applied', 'last confirmation swaps');
reset role;
select pg_temp.ok(
  (select number from tags where pool_id = pg_temp.pool('golden-boners') and holder_id = pg_temp.mem('Moe')) = least(pg_temp.v('rex')::int, pg_temp.v('moe')::int)
  and (select number from tags where pool_id = pg_temp.pool('golden-boners') and holder_id = pg_temp.mem('Rex')) = greatest(pg_temp.v('rex')::int, pg_temp.v('moe')::int),
  'Moe (better score) holds the better of the two tags');
set role anon;
select pg_temp.ok(pg_temp.refused(format('select td_tag_propose(%L, %L, %L, null, null)', pg_temp.pool('golden-boners'), pg_temp.ev(), '[]'), 'permission denied'), 'anon can''t propose');
reset role;
