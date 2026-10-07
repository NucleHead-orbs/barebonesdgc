-- Handing the scoring phone around a card (2026-10-07). No schema change: this proves the card's QR token is enough.
-- Phone A scores the front, hands off; phone B picks up, fixes a hole; A's late offline tap can't undo B's fix;
-- either phone can finish, sign and submit. Runs in a transaction and rolls back (leaves the shared fixtures alone).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
begin;
create temp table h_ctx (k text primary key, v text) on commit drop;
grant all on h_ctx to anon, authenticated;
insert into h_ctx select 'tok', t.token from card_tokens t join events ev on ev.id = t.event_id where ev.slug = 'jewel-xi-2026' and t.label = '7A' and t.round = 1;
insert into h_ctx select 'card', c.id::text from cards c join events ev on ev.id = c.event_id where ev.slug = 'jewel-xi-2026' and c.label = '7A' and c.round = 1;
delete from scores s using card_players cp where cp.card_id = (select v::uuid from h_ctx where k = 'card') and s.player_id = cp.player_id and s.round = 1;
delete from signoffs where card_id = (select v::uuid from h_ctx where k = 'card');
set client_min_messages = notice;
set role anon;
-- phone A: holes 1-10 for everyone, 10 minutes ago
select pg_temp.ok((select bool_and(e->>'result' = 'applied') from jsonb_array_elements(score_sync((select v from h_ctx where k = 'tok'),
  (select jsonb_agg(jsonb_build_object('player_id', cp.player_id, 'hole', h.n, 'strokes', h.par, 'client_ts', now() - interval '10 minutes', 'device_id', 'phoneA'))
     from card_players cp cross join holes h join events ev on ev.id = h.event_id
    where cp.card_id = (select v::uuid from h_ctx where k = 'card') and ev.slug = 'jewel-xi-2026' and h.n <= 10))) e), 'phone A scores the front');
-- phone B (the handoff QR is the same card link): sees A's scores and keeps going
select pg_temp.ok(jsonb_array_length(get_card((select v from h_ctx where k = 'tok'))->'players') = 3
  and (select count(*) from scores s join card_players cp on cp.player_id = s.player_id where cp.card_id = (select v::uuid from h_ctx where k = 'card') and s.round = 1) = 30,
  'phone B opens the same card (public score read) with every score A saved');
select pg_temp.ok((select bool_and(e->>'result' = 'applied') from jsonb_array_elements(score_sync((select v from h_ctx where k = 'tok'),
  (select jsonb_agg(jsonb_build_object('player_id', cp.player_id, 'hole', h.n, 'strokes', h.par, 'client_ts', now() - interval '1 minute', 'device_id', 'phoneB'))
     from card_players cp cross join holes h join events ev on ev.id = h.event_id
    where cp.card_id = (select v::uuid from h_ctx where k = 'card') and ev.slug = 'jewel-xi-2026' and h.n > 10))) e), 'phone B scores the back');
-- B fixes hole 2 for the first player; then A's stale offline tap for hole 2 finally syncs
insert into h_ctx select 'p1', player_id::text from card_players where card_id = (select v::uuid from h_ctx where k = 'card') order by player_id limit 1;
select pg_temp.ok(score_upsert((select v from h_ctx where k = 'tok'), (select v::uuid from h_ctx where k = 'p1'), 2::smallint, 5::smallint, now(), 'phoneB') = 'applied', 'B corrects hole 2');
select pg_temp.ok(score_upsert((select v from h_ctx where k = 'tok'), (select v::uuid from h_ctx where k = 'p1'), 2::smallint, 2::smallint, now() - interval '5 minutes', 'phoneA') = 'stale', 'A''s older queued tap can''t undo B''s fix');
reset role;
select pg_temp.ok((select strokes = 5 and device_id = 'phoneB' from scores where player_id = (select v::uuid from h_ctx where k = 'p1') and round = 1 and hole = 2), 'the newest tap holds');
set role anon;
select pg_temp.ok((select bool_and(sign_card((select v from h_ctx where k = 'tok'), player_id, 'XX') = 'signed') from card_players where card_id = (select v::uuid from h_ctx where k = 'card')), 'everyone signs on phone B');
select pg_temp.ok(submit_card((select v from h_ctx where k = 'tok')) = 'submitted', 'and it submits');
reset role;
rollback;
