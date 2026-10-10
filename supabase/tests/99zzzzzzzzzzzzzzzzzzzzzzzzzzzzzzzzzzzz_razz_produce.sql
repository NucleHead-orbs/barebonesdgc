-- Eggplant + pickle razzes on a live round. Rolls back.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
begin;
insert into tag_members (name) values ('Egg Razz'), ('Pickle Razz');
select round_live_push('b1111111-1111-4111-8111-111111111111', repeat('e', 24), null,
  '{"course":"Produce Park","pars":[3,3],"labels":null,"players":[{"name":"Blake","member_id":null,"scores":[3]}]}');
set client_min_messages = notice;
select pg_temp.ok(live_react('b1111111-1111-4111-8111-111111111111', (select token from tag_members where name = 'Egg Razz'), 'eggplant', 'Blake') is not null, 'eggplant razz sends');
select pg_temp.ok(live_react('b1111111-1111-4111-8111-111111111111', (select token from tag_members where name = 'Pickle Razz'), 'pickle', null) is not null, 'pickle razz sends');
select pg_temp.ok((select array_agg(x ->> 'kind' order by (x ->> 'id')::bigint) from jsonb_array_elements(live_reactions('b1111111-1111-4111-8111-111111111111', 0) -> 'list') x) = '{eggplant,pickle}', 'both play for everyone');
rollback;
