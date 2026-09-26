-- Acceptance tests. Run after stub + migration + seed. Any failure raises and stops.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create temp table t_ctx (k text primary key, v text);
grant all on t_ctx to anon, authenticated;

create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.as_td() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","app_metadata":{"role":"td"}}', false) $$;
create or replace function pg_temp.as_user() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000002","app_metadata":{}}', false) $$;
set client_min_messages = notice;

-- ===== 1. TD import (upsert, skips) =====
select pg_temp.as_td(); set role authenticated;
insert into t_ctx select 'event', id::text from events where slug = 'jewel-xi-2026';
insert into t_ctx select 'imp1', td_import_players((select v::uuid from t_ctx where k='event'), '[
 {"name":"Axl Anhyzer","div_code":"MA1","rating":910,"dgs_id":"d1","reg_order":1},
 {"name":"Vince Putt","div_code":"MA1","rating":900,"dgs_id":"d2","reg_order":2},
 {"name":"Slash Roller","div_code":"MA1","rating":890,"dgs_id":"d3","reg_order":3},
 {"name":"Lita Ford","div_code":"MA1","rating":880,"dgs_id":"d4","reg_order":4},
 {"name":"Ozzy Ace","div_code":"MA1","rating":870,"dgs_id":"d5","reg_order":5},
 {"name":"Rusty Hyzer","div_code":"MPO","rating":960,"dgs_id":"d6","pdga":"111","reg_order":6},
 {"name":"Chainz McGee","div_code":"MPO","rating":955,"dgs_id":"d7","reg_order":7},
 {"name":"Dee Skip","div_code":"MPO","rating":950,"dgs_id":"d8","reg_order":8},
 {"name":"Sponsor Guy","div_code":"SPON"},
 {"name":"Mystery","div_code":"ZZZ"},
 {"name":"  ","div_code":"MA1"}]')::text;
reset role;
select pg_temp.ok((select (v::jsonb->>'inserted')::int = 8 and jsonb_array_length(v::jsonb->'skipped') = 3 from t_ctx where k='imp1'),
  'import: 8 inserted, SPON/unknown div/blank name skipped');

set role authenticated;
insert into t_ctx select 'imp2', td_import_players((select v::uuid from t_ctx where k='event'), '[
 {"name":"Axl Anhyzer Jr","div_code":"MA1","rating":915,"dgs_id":"d1"},
 {"name":"Rusty H.","div_code":"MPO","rating":961,"pdga":"111"},
 {"name":"Walk Up","div_code":"MA2","rating":800}]')::text;
reset role;
select pg_temp.ok((select (v::jsonb->>'inserted')::int = 1 and (v::jsonb->>'updated')::int = 2 from t_ctx where k='imp2'),
  're-import upserts by dgs_id then pdga, never duplicates');
select pg_temp.ok((select count(*) = 9 from players), 'player count stable after re-import');

insert into t_ctx select 'p' || reg_order, id::text from players where reg_order is not null;

-- ===== 2. Publish R1; server-computed labels =====
set role authenticated;
insert into t_ctx select 'pub1', td_publish_round((select v::uuid from t_ctx where k='event'), 1::smallint, jsonb_build_array(
  jsonb_build_object('wave','AM','start_hole',7,'group_no',1,'player_ids',
    (select jsonb_agg(v) from t_ctx where k in ('p1','p2','p3','p4'))),
  jsonb_build_object('wave','AM','start_hole',7,'group_no',2,'player_ids',
    (select jsonb_agg(v) from t_ctx where k = 'p5')),
  jsonb_build_object('wave','PM','start_hole',1,'group_no',1,'player_ids',
    (select jsonb_agg(v) from t_ctx where k in ('p6','p7','p8')))))::text;
reset role;
select pg_temp.ok((select string_agg(e->>'wave' || '-' || (e->>'label'), ',' order by e->>'wave', e->>'label')
                   from t_ctx, jsonb_array_elements(v::jsonb) e where k='pub1') = 'AM-7A,AM-7B,PM-1',
  'labels: letter only when a wave shares a hole (7A,7B) and none otherwise (1)');
insert into t_ctx select 'tok_7b', e->>'token' from t_ctx, jsonb_array_elements(v::jsonb) e where k='pub1' and e->>'label'='7B';
insert into t_ctx select 'tok_7a', e->>'token' from t_ctx, jsonb_array_elements(v::jsonb) e where k='pub1' and e->>'label'='7A';

-- ===== 3. Anon lockdown =====
select set_config('request.jwt.claims', '', false);
set role anon;
do $$ begin perform 1 from card_tokens; raise exception 'FAIL: anon read tokens';
exception when insufficient_privilege then raise notice 'pass: anon cannot read card tokens'; end $$;
do $$ begin insert into scores values ((select id from players limit 1),1,1,3,now(),now(),'x'); raise exception 'FAIL: anon direct write';
exception when insufficient_privilege then raise notice 'pass: anon cannot write scores directly'; end $$;
do $$ begin perform td_unlock_card(gen_random_uuid()); raise exception 'FAIL: anon td rpc';
exception when insufficient_privilege then raise notice 'pass: anon cannot execute TD RPCs'; end $$;
do $$ begin perform score_upsert('nope', gen_random_uuid(), 1::smallint, 3::smallint); raise exception 'FAIL: bad token';
exception when raise_exception then
  if sqlerrm <> 'invalid_token' then raise; end if; raise notice 'pass: bad token rejected'; end $$;
select pg_temp.ok((select count(*) = 9 from leaderboard), 'anon can read leaderboard');
select pg_temp.ok(get_card((select v from t_ctx where k='tok_7b'))->'card'->>'label' = '7B', 'get_card resolves token');
select pg_temp.ok(score_upsert((select v from t_ctx where k='tok_7b'), (select v::uuid from t_ctx where k='p1'), 1::smallint, 3::smallint)
                  = 'rejected_not_on_card', 'token cannot score a player on another card');
reset role;

-- ===== 4. Offline sync, sign-off, clear-on-change =====
set role anon;
select pg_temp.ok((select bool_and(e->>'result' = 'applied') from jsonb_array_elements(
  score_sync((select v from t_ctx where k='tok_7b'),
    (select jsonb_agg(jsonb_build_object('player_id', (select v from t_ctx where k='p5'), 'hole', n,
                                         'strokes', par, 'client_ts', now() - interval '1 hour', 'device_id','phoneA'))
     from holes h join events e on e.id=h.event_id where e.slug='jewel-xi-2026'))) e),
  'score_sync applies a full 20-hole queue');
select pg_temp.ok(submit_card((select v from t_ctx where k='tok_7b')) = 'missing_signatures', 'submit blocked until everyone signs');
select pg_temp.ok(sign_card((select v from t_ctx where k='tok_7b'), (select v::uuid from t_ctx where k='p5'), 'oa') = 'signed', 'sign when complete');
select pg_temp.ok(score_upsert((select v from t_ctx where k='tok_7b'), (select v::uuid from t_ctx where k='p5'), 3::smallint, 3::smallint, now())
                  = 'applied', 're-save same value');
select pg_temp.ok((select count(*) = 1 from signoffs), 're-saving the same value keeps signatures');
select pg_temp.ok(score_upsert((select v from t_ctx where k='tok_7b'), (select v::uuid from t_ctx where k='p5'), 3::smallint, 4::smallint, now())
                  = 'applied', 'change a score');
select pg_temp.ok((select count(*) = 0 from signoffs), 'changing a score clears signatures');
select pg_temp.ok(score_upsert((select v from t_ctx where k='tok_7b'), (select v::uuid from t_ctx where k='p5'), 3::smallint, 9::smallint, now() - interval '2 hours')
                  = 'stale', 'older queued write loses (LWW)');
select pg_temp.ok(score_upsert((select v from t_ctx where k='tok_7b'), (select v::uuid from t_ctx where k='p5'), 4::smallint, 3::smallint, '2031-01-01')
                  = 'applied', 'future-dated write accepted...');
reset role;
select pg_temp.ok((select client_ts <= now() + interval '2 minutes' from scores s join t_ctx c on c.k='p5' and s.player_id=c.v::uuid where hole=4 and round=1),
  '...but clamped to now()+2min');
set role anon;
select pg_temp.ok(score_upsert((select v from t_ctx where k='tok_7b'), (select v::uuid from t_ctx where k='p5'), 5::smallint, 13::smallint) = 'rejected_invalid', 'strokes > 12 rejected');
select pg_temp.ok(sign_card((select v from t_ctx where k='tok_7a'), (select v::uuid from t_ctx where k='p1'), 'AA') = 'incomplete', 'cannot sign an incomplete card');

-- ===== 5. Submit and freeze =====
select sign_card((select v from t_ctx where k='tok_7b'), (select v::uuid from t_ctx where k='p5'), 'OA');
select pg_temp.ok(submit_card((select v from t_ctx where k='tok_7b')) = 'submitted', 'submit after all sign');
select pg_temp.ok(submit_card((select v from t_ctx where k='tok_7b')) = 'already_submitted', 'double-tap submit is safe');
select pg_temp.ok(score_upsert((select v from t_ctx where k='tok_7b'), (select v::uuid from t_ctx where k='p5'), 1::smallint, 5::smallint, now())
                  = 'rejected_submitted', 'submitted card rejects score writes');
select pg_temp.ok(sign_card((select v from t_ctx where k='tok_7b'), (select v::uuid from t_ctx where k='p5'), 'X') = 'rejected_submitted', 'submitted card rejects signatures');
select pg_temp.ok((select r1_official and r1_holes = 20 from leaderboard l join t_ctx c on c.k='p5' and l.player_id=c.v::uuid), 'leaderboard: submitted round is official');
reset role;

-- TD direct edits are frozen too
select pg_temp.as_td(); set role authenticated;
do $$ begin update scores set strokes = 2 where player_id = (select v::uuid from t_ctx where k='p5') and hole = 1;
  raise exception 'FAIL: TD edited submitted card';
exception when raise_exception then if sqlerrm <> 'card_submitted' then raise; end if;
  raise notice 'pass: even the TD must unlock before editing'; end $$;

-- ===== 6. Regression: R1 official survives R2 publish (prototype bug #1) =====
insert into t_ctx select 'pub2', td_publish_round((select v::uuid from t_ctx where k='event'), 2::smallint, jsonb_build_array(
  jsonb_build_object('wave','AM','start_hole',12,'group_no',1,'player_ids',
    (select jsonb_agg(v) from t_ctx where k in ('p1','p2','p3','p4','p5')))))::text;
reset role;
select pg_temp.ok((select r1_official from leaderboard l join t_ctx c on c.k='p5' and l.player_id=c.v::uuid), 'R1 stays official after R2 cards publish');

-- ===== 7. Paper override, seeding =====
select pg_temp.as_td(); set role authenticated;
insert into paper_totals (player_id, round, strokes) values ((select v::uuid from t_ctx where k='p1'), 1, 60);
reset role;
select pg_temp.ok((select r1_official and r1_to_par = -2 and r1_holes = 20 from leaderboard l join t_ctx c on c.k='p1' and l.player_id=c.v::uuid),
  'paper total is official and overrides app scores (60 = -2)');
select pg_temp.ok((select count(*) = 2 from r2_seed), 'R2 seed only includes official, complete R1 rounds');

-- ===== 8. Non-TD authenticated users are not TD =====
select pg_temp.as_user(); set role authenticated;
do $$ begin perform td_unlock_card(gen_random_uuid()); raise exception 'FAIL: non-TD unlock';
exception when raise_exception then if sqlerrm <> 'forbidden' then raise; end if; raise notice 'pass: non-TD login cannot use TD RPCs'; end $$;
do $$ begin insert into paper_totals (player_id, round, strokes) values ((select id from players limit 1), 2, 60);
  raise exception 'FAIL: non-TD paper';
exception when insufficient_privilege then raise notice 'pass: non-TD login cannot enter paper totals'; end $$;
reset role;

-- ===== 9. Unlock; republish guards; token stability =====
select pg_temp.as_td(); set role authenticated;
select td_unlock_card((select id from cards where round = 1 and label = '7B'));
reset role;
select pg_temp.ok((select count(*) = 0 from submissions) and (select count(*) = 0 from signoffs), 'TD unlock clears submission and signatures');

set role authenticated;
do $$ begin perform td_publish_round((select v::uuid from t_ctx where k='event'), 1::smallint, '[]'::jsonb);
  raise exception 'FAIL: republish over scores';
exception when raise_exception then if sqlerrm <> 'round_has_scores' then raise; end if;
  raise notice 'pass: republish refused once a round has scores'; end $$;
do $$ begin perform td_publish_round((select v::uuid from t_ctx where k='event'), 2::smallint, jsonb_build_array(
    jsonb_build_object('wave','AM','start_hole',1,'group_no',1,'player_ids', (select jsonb_agg(v) from t_ctx where k in ('p1','p2'))),
    jsonb_build_object('wave','AM','start_hole',2,'group_no',1,'player_ids', (select jsonb_agg(v) from t_ctx where k in ('p2','p3')))));
  raise exception 'FAIL: player on two cards';
exception when unique_violation then raise notice 'pass: a player cannot be on two cards in one round'; end $$;
insert into t_ctx select 'pub1b', td_publish_round((select v::uuid from t_ctx where k='event'), 1::smallint, jsonb_build_array(
  jsonb_build_object('wave','AM','start_hole',7,'group_no',1,'player_ids', (select jsonb_agg(v) from t_ctx where k in ('p1','p2','p3'))),
  jsonb_build_object('wave','AM','start_hole',7,'group_no',2,'player_ids', (select jsonb_agg(v) from t_ctx where k in ('p4','p5')))), true)::text;
reset role;
select pg_temp.ok((select e->>'token' from t_ctx, jsonb_array_elements(v::jsonb) e where k='pub1b' and e->>'label'='7B')
                  = (select v from t_ctx where k='tok_7b'), 'printed QR tokens survive a regenerate');
select pg_temp.ok((select count(*) = 20 from scores s join t_ctx c on c.k='p5' and s.player_id=c.v::uuid where round=1),
  'forced republish keeps scores (they belong to players, not cards)');

-- ===== 10. Re-import without PDGA# matches by name (DGS has no registration id) =====
select pg_temp.as_td(); set role authenticated;
insert into t_ctx select 'imp3', td_import_players((select v::uuid from t_ctx where k='event'), '[
 {"name":"walk  up","div_code":"MA3","reg_order":99},
 {"name":"Brand New","div_code":"MA3"}]')::text;
reset role;
select pg_temp.ok((select (v::jsonb->>'inserted')::int = 1 and (v::jsonb->>'updated')::int = 1 from t_ctx where k='imp3'),
  're-import: no-PDGA player matched by name (case/space-insensitive), not duplicated');
select pg_temp.ok((select div_code = 'MA3' and rating = 800 from players where lower(name) = 'walk up'),
  're-import updates division but never wipes an existing rating');

\echo ALL ACCEPTANCE TESTS PASSED
