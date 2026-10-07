-- TD ROUNDS: the TD sees every upcoming tag round in a set and adds / removes players by hand. Runs in a transaction, rolls back.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.claims(sub text, admin boolean) returns text language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', sub, 'app_metadata', case when admin then '{"role":"td"}'::json else '{}'::json end)::text, false) $$;
begin;
create temp table r_ctx (k text primary key, v text) on commit drop;
grant all on r_ctx to anon, authenticated;
create or replace function pg_temp.v(key text) returns uuid language sql as $$ select v::uuid from r_ctx where k = key $$;
create or replace function pg_temp.pool() returns uuid language sql security definer as $$ select id from tag_pools where slug = 'tdr-test' $$;
create or replace function pg_temp.mem(n text) returns uuid language sql security definer as $$ select id from tag_members where name = n $$;
create or replace function pg_temp.tok(n text) returns text language sql security definer as $$ select token from tag_members where name = n $$;
create or replace function pg_temp.rnd(kind text) returns jsonb language sql security definer as $$
  select r from jsonb_array_elements(td_tag_rounds(pg_temp.pool())) r where r->>'kind' = kind and (r->>'id')::uuid = pg_temp.v(kind) $$;
create or replace function pg_temp.on_(kind text, n text) returns text language sql security definer as $$
  select p->>'role' from jsonb_array_elements(pg_temp.rnd(kind)->'players') p where (p->>'id')::uuid = pg_temp.mem(n) $$;
create or replace function pg_temp.pings(n text) returns int language sql security definer as $$ select count(*)::int from tag_chat_mentions where member_id = pg_temp.mem(n) $$;
grant execute on function pg_temp.v(text), pg_temp.pool(), pg_temp.mem(text), pg_temp.tok(text), pg_temp.rnd(text), pg_temp.on_(text, text), pg_temp.pings(text) to anon, authenticated;
insert into tag_pools (slug, name, sort, chat, challenges) values ('tdr-test', 'TD Rounds Test', 96, true, true);
insert into tag_members (name) select 'R' || i || ' Tdr' from generate_series(1, 13) i;
insert into tag_members (name) values ('Out Tdr');
insert into tags (pool_id, number, holder_id, status) select pg_temp.pool(), i, pg_temp.mem('R' || i || ' Tdr'), 'held' from generate_series(1, 13) i;
insert into courses (name) values ('TD Rounds Park');
insert into tag_challenges (pool_id, challenger_id, challenged_id, status, due_at, tee_at, course_id, locked_at)
  values (pg_temp.pool(), pg_temp.mem('R2 Tdr'), pg_temp.mem('R1 Tdr'), 'accepted', now() + interval '3 days', now() - interval '20 minutes',
          (select id from courses where name = 'TD Rounds Park'), now() - interval '1 day');
insert into r_ctx select 'challenge', id from tag_challenges where pool_id = pg_temp.pool();
insert into tag_challenge_joins (challenge_id, member_id) values (pg_temp.v('challenge'), pg_temp.mem('R3 Tdr'));
insert into tag_casual (pool_id, host_id, tee_at, course_id) values (pg_temp.pool(), pg_temp.mem('R9 Tdr'), now() + interval '1 day', (select id from courses where name = 'TD Rounds Park'));
insert into r_ctx select 'casual', id from tag_casual where pool_id = pg_temp.pool();
insert into tag_casual_players (invite_id, member_id, status, invited) values (pg_temp.v('casual'), pg_temp.mem('R9 Tdr'), 'in', false),
  (pg_temp.v('casual'), pg_temp.mem('R10 Tdr'), 'invited', true), (pg_temp.v('casual'), pg_temp.mem('R11 Tdr'), 'in', false);
set client_min_messages = notice;

-- gate
select set_config('request.jwt.claims', '', false); set role anon;
select pg_temp.ok(pg_temp.refused(format('select td_tag_rounds(%L)', pg_temp.pool()), 'permission denied'), 'players can''t call the TD list');
select pg_temp.claims('00000000-0000-4000-8000-000000000ee1', false); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select td_tag_rounds(%L)', pg_temp.pool()), 'forbidden'), 'signed-in non-admins are refused');
select pg_temp.ok(pg_temp.refused(format('select td_round_add(''challenge'', %L, %L)', pg_temp.v('challenge'), pg_temp.mem('R4 Tdr')), 'forbidden'), '...and can''t add players');
select pg_temp.claims('00000000-0000-4000-8000-000000000dd1', true);

-- the list
select pg_temp.ok(pg_temp.rnd('challenge') is not null and pg_temp.rnd('casual') is not null, 'TD sees the challenge round (past tee, still playing) and the casual round');
select pg_temp.ok(pg_temp.rnd('challenge')->>'title' = 'R2 Tdr vs R1 Tdr' and pg_temp.rnd('challenge')->>'course' = 'TD Rounds Park'
  and pg_temp.on_('challenge', 'R2 Tdr') = 'challenger' and pg_temp.on_('challenge', 'R1 Tdr') = 'challenged' and pg_temp.on_('challenge', 'R3 Tdr') = 'jumpin',
  'challenge card: both players + the jump-in');
select pg_temp.ok(pg_temp.on_('casual', 'R9 Tdr') = 'host' and pg_temp.on_('casual', 'R10 Tdr') = 'invited' and pg_temp.on_('casual', 'R11 Tdr') = 'in', 'casual card: host, invited, in');
select pg_temp.ok((select (r->>'tee_at')::timestamptz < (lead(r->>'tee_at') over ())::timestamptz from jsonb_array_elements(td_tag_rounds(pg_temp.pool())) r limit 1), 'soonest first');

-- add past every window
select td_round_add('challenge', pg_temp.v('challenge'), pg_temp.mem('R4 Tdr'));
select pg_temp.ok(pg_temp.on_('challenge', 'R4 Tdr') = 'jumpin', 'TD adds a jump-in after tee time');
select pg_temp.ok(pg_temp.refused(format('select td_round_add(''challenge'', %L, %L)', pg_temp.v('challenge'), pg_temp.mem('R4 Tdr')), 'td_already_on'), 'not twice');
select pg_temp.ok(pg_temp.refused(format('select td_round_add(''challenge'', %L, %L)', pg_temp.v('challenge'), pg_temp.mem('R1 Tdr')), 'td_already_on'), 'the challenged player is already on');
select pg_temp.ok(pg_temp.refused(format('select td_round_add(''challenge'', %L, %L)', pg_temp.v('challenge'), pg_temp.mem('Out Tdr')), 'td_not_in_set'), 'needs a tag in the set');
select td_round_add('challenge', pg_temp.v('challenge'), pg_temp.mem('R' || i || ' Tdr')) from generate_series(5, 10) i;
select pg_temp.ok(jsonb_array_length(pg_temp.rnd('challenge')->'players') = 10, 'a card of 10');
select pg_temp.ok(pg_temp.refused(format('select td_round_add(''challenge'', %L, %L)', pg_temp.v('challenge'), pg_temp.mem('R12 Tdr')), 'td_round_full'), 'the TD can''t go past 10 either');

-- remove
select td_round_remove('challenge', pg_temp.v('challenge'), pg_temp.mem('R3 Tdr'));
select pg_temp.ok(pg_temp.on_('challenge', 'R3 Tdr') is null, 'TD takes a jump-in off after tee time');
select pg_temp.ok(pg_temp.refused(format('select td_round_remove(''challenge'', %L, %L)', pg_temp.v('challenge'), pg_temp.mem('R1 Tdr')), 'td_main_player'), 'the two challenge players stay on');
select pg_temp.ok(pg_temp.refused(format('select td_round_remove(''challenge'', %L, %L)', pg_temp.v('challenge'), pg_temp.mem('R3 Tdr')), 'td_not_on'), 'can''t take off someone who isn''t on');

-- casual
select td_round_add('casual', pg_temp.v('casual'), pg_temp.mem('R10 Tdr'));
select td_round_add('casual', pg_temp.v('casual'), pg_temp.mem('R12 Tdr'));
select pg_temp.ok(pg_temp.on_('casual', 'R10 Tdr') = 'in' and pg_temp.on_('casual', 'R12 Tdr') = 'in', 'TD puts an invitee and a new player in');
select td_round_remove('casual', pg_temp.v('casual'), pg_temp.mem('R10 Tdr'));
select td_round_remove('casual', pg_temp.v('casual'), pg_temp.mem('R12 Tdr'));
select pg_temp.ok(pg_temp.on_('casual', 'R10 Tdr') = 'out' and pg_temp.on_('casual', 'R12 Tdr') is null, 'invitee goes to out, a jump-in is just gone');
select pg_temp.ok(pg_temp.refused(format('select td_round_remove(''casual'', %L, %L)', pg_temp.v('casual'), pg_temp.mem('R9 Tdr')), 'td_host'), 'the host stays on');
select pg_temp.ok(pg_temp.refused(format('select td_round_add(''nope'', %L, %L)', pg_temp.v('casual'), pg_temp.mem('R9 Tdr')), 'td_bad_kind'), 'kind is challenge or casual');
reset role;

-- the Board + pings
select pg_temp.ok((select count(*) = 9 from tag_chat where pool_id = pg_temp.pool() and event = 'jumpin' and body like '%was added to%by the TD.%'), 'every add posts "... by the TD"');
select pg_temp.ok((select body like 'R10 Tdr (#10) was added to R2 Tdr (#2) vs R1 Tdr (#1) (%at TD Rounds Park) by the TD. Card''s full.' from tag_chat where pool_id = pg_temp.pool() and event = 'jumpin' and body like 'R10 Tdr%vs%'), 'the 10th says card''s full');
select pg_temp.ok((select count(*) = 3 from tag_chat where pool_id = pg_temp.pool() and event = 'dropout' and body like '%was taken off%by the TD.'), 'removes post too (an invitee who never said IN doesn''t)');
select pg_temp.ok(pg_temp.pings('R4 Tdr') = 1 and pg_temp.pings('R3 Tdr') = 1 and pg_temp.pings('R12 Tdr') = 2, 'the player it''s about gets an @ ping');

-- over / called off
update tag_challenges set tee_at = now() - interval '7 hours' where id = pg_temp.v('challenge');
update tag_casual set cancelled_at = now() where id = pg_temp.v('casual');
select pg_temp.claims('00000000-0000-4000-8000-000000000dd1', true); set role authenticated;
select pg_temp.ok(pg_temp.rnd('challenge') is null and pg_temp.rnd('casual') is null, 'played-out and called-off rounds leave the list');
select pg_temp.ok(pg_temp.refused(format('select td_round_add(''challenge'', %L, %L)', pg_temp.v('challenge'), pg_temp.mem('R12 Tdr')), 'td_round_over'), 'over 6 h past tee is over');
select pg_temp.ok(pg_temp.refused(format('select td_round_add(''casual'', %L, %L)', pg_temp.v('casual'), pg_temp.mem('R12 Tdr')), 'not_found'), 'called-off rounds are gone');
reset role;
select set_config('request.jwt.claims', '', false);
rollback;
