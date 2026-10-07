-- Round 2 confirm: self-confirm from a submitted Round 1 card, the check-in desk, closing once Round 2 cards exist.
-- Runs in a transaction and rolls back.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
begin;
create temp table r_ctx (k text primary key, v text) on commit drop;
grant all on r_ctx to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from r_ctx where k = key $$;
create or replace function pg_temp.pid(n text) returns uuid language sql as $$ select id from players where name = n and event_id = (select id from events where slug = 'jewel-xi-2026') $$;
create or replace function pg_temp.r2(n text) returns boolean language sql security definer as $$ select r2_in from players where id = pg_temp.pid(n) $$;
grant execute on function pg_temp.v(text), pg_temp.pid(text), pg_temp.r2(text) to anon, authenticated;
insert into r_ctx select 'ev', id::text from events where slug = 'jewel-xi-2026';
update events set use_checkin = true, rounds = 2 where id = pg_temp.v('ev')::uuid;
delete from cards where event_id = pg_temp.v('ev')::uuid and round = 2;
update players set r2_in = null, r2_in_at = null, r2_in_by = null where event_id = pg_temp.v('ev')::uuid;
insert into submissions (card_id) select id from cards where event_id = pg_temp.v('ev')::uuid and round = 1 and label = '7B' on conflict do nothing;
delete from submissions where card_id = (select id from cards where event_id = pg_temp.v('ev')::uuid and round = 1 and label = '7A');
insert into r_ctx select 'b', token from card_tokens where event_id = pg_temp.v('ev')::uuid and round = 1 and label = '7B';
insert into r_ctx select 'a', token from card_tokens where event_id = pg_temp.v('ev')::uuid and round = 1 and label = '7A';
set client_min_messages = notice;

set role anon;
select pg_temp.ok((select (s->>'asks')::boolean and (s->>'open')::boolean and jsonb_array_length(s->'players') = 2 from (select card_r2_status(pg_temp.v('b')) s) x), 'a submitted Round 1 card asks about Round 2');
select pg_temp.ok((select (s->>'asks')::boolean and not (s->>'open')::boolean from (select card_r2_status(pg_temp.v('a')) s) x), 'not until the card is submitted');
select pg_temp.ok(card_r2_set(pg_temp.v('a'), pg_temp.pid('Vince Putt'), true) = 'not_open', '...so an unsubmitted card can''t answer yet');
select pg_temp.ok(card_r2_set(pg_temp.v('b'), pg_temp.pid('Lita Ford'), true) = 'saved' and card_r2_set(pg_temp.v('b'), pg_temp.pid('Ozzy Ace'), false) = 'saved', 'players say in / out');
select pg_temp.ok(pg_temp.r2('Lita Ford') and not pg_temp.r2('Ozzy Ace'), 'answers stored');
select pg_temp.ok(card_r2_set(pg_temp.v('b'), pg_temp.pid('Vince Putt'), true) = 'rejected_not_on_card', 'only for people on that card');
select pg_temp.ok(card_r2_set(pg_temp.v('b'), pg_temp.pid('Lita Ford'), null) = 'not_open', 'self-confirm is in or out, never blank');
reset role;
select pg_temp.ok((select r2_in_by = 'self' and r2_in_at is not null from players where id = pg_temp.pid('Lita Ford')), 'marked as self-confirmed');
-- Round 2 published with Lita on it: her own answer locks (the desk/TD handle changes from here)
insert into cards (event_id, round, wave, start_hole, group_no, label) values (pg_temp.v('ev')::uuid, 2, 'AM', 1, 1, '1') returning id \gset r2card_
insert into card_players (card_id, round, player_id, seat) values (:'r2card_id', 2, pg_temp.pid('Lita Ford'), 1);
set role anon;
select pg_temp.ok(card_r2_set(pg_temp.v('b'), pg_temp.pid('Lita Ford'), false) = 'r2_closed', 'on a Round 2 card: closed to self-changes');
select pg_temp.ok((select bool_or((p->>'locked')::boolean) and not bool_and((p->>'locked')::boolean) from jsonb_array_elements(card_r2_status(pg_temp.v('b'))->'players') p), 'status shows who is locked');
reset role;

-- the check-in desk
insert into crew (event_id, name, roles) values (pg_temp.v('ev')::uuid, 'Desk Dee', array['checkin']), (pg_temp.v('ev')::uuid, 'Raffle Rae', array['raffle']);
insert into r_ctx select 'desk', token from crew where name = 'Desk Dee';
insert into r_ctx select 'raffle', token from crew where name = 'Raffle Rae';
set role anon;
select crew_r2_set(pg_temp.v('desk'), pg_temp.pid('Ozzy Ace'), true);
select pg_temp.ok(pg_temp.r2('Ozzy Ace'), 'the desk can flip someone back in');
select pg_temp.ok((select (s->>'asks')::boolean and (s->'r2'->>pg_temp.pid('Ozzy Ace')::text)::boolean and not (s->'r2' ? pg_temp.pid('Vince Putt')::text) from (select crew_r2_status(pg_temp.v('desk')) s) x), 'desk sees answers; no answer = missing');
select crew_r2_set(pg_temp.v('desk'), pg_temp.pid('Ozzy Ace'), null);
select pg_temp.ok(pg_temp.r2('Ozzy Ace') is null, 'and clear an answer');
select pg_temp.ok(pg_temp.refused(format('select crew_r2_set(%L, %L, true)', pg_temp.v('raffle'), pg_temp.pid('Ozzy Ace')), 'forbidden'), 'only the check-in crew');
select pg_temp.ok(pg_temp.refused(format('select crew_r2_set(%L, %L, true)', pg_temp.v('desk'), gen_random_uuid()), 'not_found'), 'only this event''s players');
reset role;
select pg_temp.ok((select r2_in_by is null from players where id = pg_temp.pid('Ozzy Ace')), 'clearing clears who did it');

-- one-round events never ask
update events set rounds = 1 where id = pg_temp.v('ev')::uuid;
set role anon;
select pg_temp.ok(not (card_r2_status(pg_temp.v('b'))->>'asks')::boolean and card_r2_set(pg_temp.v('b'), pg_temp.pid('Lita Ford'), true) = 'not_open', 'one-round events don''t ask');
reset role;
rollback;
