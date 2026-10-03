-- Boner Rounds acceptance tests. Run after stub + all migrations.
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
create or replace function pg_temp.pool(s text) returns uuid language sql as $$ select id from tag_pools where slug = s $$;
create or replace function pg_temp.mem(n text) returns uuid language sql as $$ select id from tag_members where name = n $$;
create or replace function pg_temp.tok(n text) returns text language sql security definer as $$ select token from tag_members where name = n $$;
create or replace function pg_temp.num(p text, n text) returns int language sql as $$
  select number from tags where pool_id = pg_temp.pool(p) and holder_id = pg_temp.mem(n) $$;
create temp table r_ctx (k text primary key, v text);
grant all on r_ctx to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from r_ctx where k = key $$;
grant execute on function pg_temp.pool(text), pg_temp.mem(text), pg_temp.tok(text), pg_temp.num(text, text), pg_temp.v(text) to anon, authenticated;
/** 18 holes of par 3 with a total to-par of d (one bogey/birdie per stroke on the first holes). */
create or replace function pg_temp.card(d int) returns jsonb language sql as $$
  select jsonb_agg(case when i <= abs(d) then 3 + sign(d)::int else 3 end order by i) from generate_series(1, 18) i $$;
grant execute on function pg_temp.card(int) to anon, authenticated;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000aa', 'r-boss@club.test', now()),
  ('00000000-0000-4000-8000-0000000000bb', 'r-rando@club.test', now())
on conflict do nothing;
-- Golden Boners issued in order Rex, Moe, Kit (Rex best). Zed holds only an RBFL tag.
select pg_temp.claims('00000000-0000-4000-8000-0000000000aa', true); set role authenticated;
select td_tag_issue(pg_temp.pool('golden-boners'), null, 'Rex', null, null);
select td_tag_issue(pg_temp.pool('golden-boners'), null, 'Moe', null, null);
select td_tag_issue(pg_temp.pool('golden-boners'), null, 'Kit', null, null);
select td_tag_issue(pg_temp.pool('rbfl'), null, 'Zed', null, null);
reset role;
insert into r_ctx select 'gRex', pg_temp.num('golden-boners', 'Rex')::text;
insert into r_ctx select 'gMoe', pg_temp.num('golden-boners', 'Moe')::text;
insert into r_ctx select 'gKit', pg_temp.num('golden-boners', 'Kit')::text;
select set_config('request.jwt.claims', '', false);
set client_min_messages = notice;

-- ===== save =====
set role anon;
select pg_temp.ok(pg_temp.refused($q$insert into club_rounds (course, played_on, pars, created_by) values ('x', current_date, '{3}', pg_temp.mem('Rex'))$q$, 'permission denied'),
  'nobody writes rounds directly');
select pg_temp.ok(pg_temp.refused($q$select round_save('nope-nope-nope-nope-nope', '{}')$q$, 'invalid_link'), 'saving needs a member link');
select pg_temp.ok(pg_temp.refused(format($q$select round_save(%L, jsonb_build_object('course', 'Buffalo Ridge', 'played_on', current_date, 'pars', pg_temp.card(0),
  'players', jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Moe'), 'scores', pg_temp.card(1)))))$q$, pg_temp.tok('Rex')), 'must_include_you'),
  'the saver has to be on the round');
select pg_temp.ok(pg_temp.refused(format($q$select round_save(%L, jsonb_build_object('course', 'Buffalo Ridge', 'played_on', current_date, 'pars', pg_temp.card(0),
  'players', jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Rex'), 'scores', '[3,3,3]'::jsonb))))$q$, pg_temp.tok('Rex')), 'every_hole_scored'),
  'every hole must be scored');
select pg_temp.ok(pg_temp.refused(format($q$select round_save(%L, jsonb_build_object('course', 'Buffalo Ridge', 'played_on', current_date - 30, 'pars', pg_temp.card(0),
  'players', jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Rex'), 'scores', pg_temp.card(0)))))$q$, pg_temp.tok('Rex')), 'invalid_date'),
  'rounds older than 14 days are refused');
select pg_temp.ok(pg_temp.refused(format($q$select round_save(%L, jsonb_build_object('course', 'Buffalo Ridge', 'played_on', current_date, 'pars', '[3,9]'::jsonb,
  'players', jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Rex'), 'scores', '[3,3]'::jsonb))))$q$, pg_temp.tok('Rex')), 'invalid_pars'),
  'pars run 2 to 6');
select pg_temp.ok(pg_temp.refused(format($q$select round_save(%L, jsonb_build_object('course', 'Buffalo Ridge', 'played_on', current_date, 'pars', '[3,3]'::jsonb,
  'players', jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Rex'), 'scores', '[3,0]'::jsonb))))$q$, pg_temp.tok('Rex')), 'invalid_score'),
  'hole scores run 1 to 20');
select pg_temp.ok(pg_temp.refused(format($q$select round_save(%L, jsonb_build_object('course', 'Buffalo Ridge', 'played_on', current_date, 'pars', '[3]'::jsonb,
  'players', jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Rex'), 'scores', '[3]'::jsonb), jsonb_build_object('member_id', pg_temp.mem('Rex'), 'scores', '[3]'::jsonb))))$q$, pg_temp.tok('Rex')), 'duplicate_player'),
  'a member is on a round once');

-- Rex +4, Moe +7, Kit +2, Zed (no Golden tag) +1, a guest +9
insert into r_ctx select 'r1', round_save(pg_temp.tok('Rex'), jsonb_build_object('course', 'Buffalo Ridge', 'played_on', current_date, 'pars', pg_temp.card(0), 'note', 'test',
  'players', jsonb_build_array(
    jsonb_build_object('member_id', pg_temp.mem('Rex'), 'scores', pg_temp.card(4)),
    jsonb_build_object('member_id', pg_temp.mem('Moe'), 'scores', pg_temp.card(7)),
    jsonb_build_object('member_id', pg_temp.mem('Kit'), 'scores', pg_temp.card(2)),
    jsonb_build_object('member_id', pg_temp.mem('Zed'), 'scores', pg_temp.card(1)),
    jsonb_build_object('guest_name', '  Uncle Buck ', 'scores', pg_temp.card(9)))))::text;
select pg_temp.ok((select strokes = 58 and to_par = 4 and confirmed_at is not null from club_round_players where round_id = pg_temp.v('r1')::uuid and member_id = pg_temp.mem('Rex')),
  'strokes + to-par computed (58, +4); the saver is confirmed');
select pg_temp.ok((select guest_name = 'Uncle Buck' and to_par = 9 and confirmed_at is null from club_round_players where round_id = pg_temp.v('r1')::uuid and guest_name is not null),
  'guests are saved by name (trimmed)');
select pg_temp.ok((select count(*) = 5 from club_round_players where round_id = pg_temp.v('r1')::uuid), 'public sees the saved round right away');
select pg_temp.ok((round_me(pg_temp.tok('Moe')) -> 'to_confirm' -> 0 ->> 'id') = pg_temp.v('r1'), 'Moe sees it waiting on his confirmation');
select pg_temp.ok(jsonb_array_length(round_me(pg_temp.tok('Rex')) -> 'to_confirm') = 0, 'nothing waiting for the saver');
select pg_temp.ok(not (round_me(pg_temp.tok('Rex'))::text like '%token%'), 'round_me never returns tokens');

-- ===== tag exchange =====
select pg_temp.ok(pg_temp.refused(format('select round_tag_exchange(%L, %L, %L)', pg_temp.tok('Zed'), pg_temp.v('r1'), pg_temp.pool('golden-boners')), 'no_tag_in_pool'),
  'you need a tag in that set to start an exchange');
insert into r_ctx select 'x1', round_tag_exchange(pg_temp.tok('Rex'), pg_temp.v('r1')::uuid, pg_temp.pool('golden-boners'))::text;
select pg_temp.ok(pg_temp.refused(format('select round_tag_exchange(%L, %L, %L)', pg_temp.tok('Moe'), pg_temp.v('r1'), pg_temp.pool('golden-boners')), 'already_exchanged'),
  'one exchange per tag set per round');
reset role;
select pg_temp.ok((select count(*) = 3 and bool_and(score = (select strokes from club_round_players c where c.round_id = pg_temp.v('r1')::uuid and c.member_id = p.member_id))
   from tag_match_players p where match_id = pg_temp.v('x1')::uuid), 'exchange takes the 3 Golden Boner holders at their strokes (Zed and the guest are left out)');
select pg_temp.ok((select round_id = pg_temp.v('r1')::uuid and status = 'pending' from tag_matches where id = pg_temp.v('x1')::uuid), 'exchange is linked to the round and waits');
set role anon;
select pg_temp.ok((select (x -> 0 ->> 'status') = 'pending' and (x -> 0 ->> 'waiting_on')::int = 2 and x -> 0 -> 'moves' = 'null'::jsonb
   from (select round_exchanges(array[pg_temp.v('r1')::uuid]) x) z), 'public sees the exchange waiting on 2, no tag preview');

-- Moe confirms the round on Boner Rounds -> also confirms the exchange
select round_confirm(pg_temp.tok('Moe'), pg_temp.v('r1')::uuid, true);
reset role;
select pg_temp.ok((select confirmed_at is not null from tag_match_players where match_id = pg_temp.v('x1')::uuid and member_id = pg_temp.mem('Moe')),
  'confirming the round confirms the waiting exchange');
-- Kit confirms the exchange on My Tag -> also confirms the round, and the last confirmation swaps
set role anon;
select pg_temp.ok(tag_confirm(pg_temp.tok('Kit'), pg_temp.v('x1')::uuid, true) = 'applied', 'last confirmation (on My Tag) applies the exchange');
reset role;
select pg_temp.ok((select confirmed_at is not null from club_round_players where round_id = pg_temp.v('r1')::uuid and member_id = pg_temp.mem('Kit')),
  'confirming the exchange on My Tag confirms the round too');
select pg_temp.ok(pg_temp.num('golden-boners', 'Kit') = pg_temp.v('gRex')::int and pg_temp.num('golden-boners', 'Rex') = pg_temp.v('gMoe')::int
   and pg_temp.num('golden-boners', 'Moe') = pg_temp.v('gKit')::int,
  'swap: Kit +2 takes the best of the three tags, Rex +4 the middle, Moe +7 the last');
set role anon;
select pg_temp.ok((select jsonb_array_length(x -> 0 -> 'moves') = 3 from (select round_exchanges(array[pg_temp.v('r1')::uuid]) x) z), 'public sees the moves once applied');
select pg_temp.ok(pg_temp.refused(format('select round_void(%L, %L)', pg_temp.tok('Rex'), pg_temp.v('r1')), 'tags_already_moved'),
  'a round whose exchange moved tags can''t be voided');
select pg_temp.ok(pg_temp.refused(format('select round_void(%L, %L)', pg_temp.tok('Moe'), pg_temp.v('r1')), 'not_your_round'), 'only the saver voids');

-- ===== dispute + void =====
insert into r_ctx select 'r2', round_save(pg_temp.tok('Moe'), jsonb_build_object('course', 'Papago', 'played_on', current_date - 1, 'pars', '[3,3,3]'::jsonb,
  'players', jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Moe'), 'scores', '[2,3,3]'::jsonb), jsonb_build_object('member_id', pg_temp.mem('Rex'), 'scores', '[3,3,4]'::jsonb))))::text;
insert into r_ctx select 'x2', round_tag_exchange(pg_temp.tok('Moe'), pg_temp.v('r2')::uuid, pg_temp.pool('golden-boners'))::text;
select round_confirm(pg_temp.tok('Rex'), pg_temp.v('r2')::uuid, false);
reset role;
select pg_temp.ok((select status = 'disputed' from tag_matches where id = pg_temp.v('x2')::uuid)
   and (select disputed_at is not null from club_round_players where round_id = pg_temp.v('r2')::uuid and member_id = pg_temp.mem('Rex')),
  'disputing the round disputes its exchange');
set role anon;
select round_void(pg_temp.tok('Moe'), pg_temp.v('r2')::uuid);
select pg_temp.ok((select count(*) = 0 from club_rounds where id = pg_temp.v('r2')::uuid), 'a voided round leaves the public page');
reset role;
select pg_temp.ok((select status = 'void' from tag_matches where id = pg_temp.v('x2')::uuid), 'voiding a round withdraws its waiting exchange');
select pg_temp.ok(pg_temp.num('golden-boners', 'Moe') = pg_temp.v('gKit')::int, 'nothing moved from the voided round');

-- ===== admin =====
select pg_temp.claims('00000000-0000-4000-8000-0000000000bb', false); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select td_round_void(%L)', pg_temp.v('r1')), 'forbidden'), 'a random account can''t void rounds');
reset role;
set role anon;
select pg_temp.ok(pg_temp.refused(format('select td_round_void(%L)', pg_temp.v('r1')), 'permission denied'), 'anon can''t call the admin void');
reset role;
