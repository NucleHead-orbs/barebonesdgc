-- Scorecard flow: one saved card per scheduled round; PULL OUT = DNF (par +3, last on tags). Runs in a transaction, rolls back.
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
create or replace function pg_temp.pool() returns uuid language sql security definer as $$ select id from tag_pools where slug = 'flow-test' $$;
create or replace function pg_temp.mem(n text) returns uuid language sql security definer as $$ select id from tag_members where name = n $$;
create or replace function pg_temp.tok(n text) returns text language sql security definer as $$ select token from tag_members where name = n $$;
create or replace function pg_temp.card(src text, salty jsonb) returns jsonb language sql as $$
  select jsonb_build_object('course', 'Flow Park', 'played_on', current_date, 'pars', '[3,3,3,3]'::jsonb, 'source', src,
    'players', jsonb_build_array(
      jsonb_build_object('member_id', pg_temp.mem('Al Flow'), 'scores', '[4,4,4,4]'::jsonb),
      jsonb_build_object('member_id', pg_temp.mem('Salty Flow'), 'scores', salty, 'dnf_after', 2),
      jsonb_build_object('member_id', pg_temp.mem('Cy Flow'), 'scores', '[5,5,5,5]'::jsonb))) $$;
grant execute on function pg_temp.v(text), pg_temp.pool(), pg_temp.mem(text), pg_temp.tok(text), pg_temp.card(text, jsonb) to anon, authenticated;
insert into tag_pools (slug, name, sort) values ('flow-test', 'Flow Test', 91);
insert into tag_members (name) values ('Al Flow'), ('Salty Flow'), ('Cy Flow');
insert into tags (pool_id, number, holder_id, status) values (pg_temp.pool(), 1, pg_temp.mem('Salty Flow'), 'held'), (pg_temp.pool(), 2, pg_temp.mem('Al Flow'), 'held'), (pg_temp.pool(), 3, pg_temp.mem('Cy Flow'), 'held');
insert into f_ctx values ('src', 'casual:' || gen_random_uuid());
select set_config('request.jwt.claims', '', false);
set client_min_messages = notice;

set role anon;
-- Salty: 2 + 2 then pulls out; the phone sends nulls for the rest (or anything): the server writes par +3
insert into f_ctx select 'r', round_save_swap(pg_temp.tok('Al Flow'), pg_temp.card(pg_temp.v('src'), '[2,2,null,null]'), array[pg_temp.pool()]) ->> 'round_id';
reset role;
select pg_temp.ok((select scores = '{2,2,6,6}' and strokes = 16 and dnf_after = 2 from club_round_players where round_id = pg_temp.v('r')::uuid and member_id = pg_temp.mem('Salty Flow')),
  'DNF after 2: holes 3-4 saved as par +3 (16), even with blanks sent');
select pg_temp.ok((select dnf_after is null from club_round_players where round_id = pg_temp.v('r')::uuid and member_id = pg_temp.mem('Al Flow')), 'finishers have no DNF');
select pg_temp.ok((select source = pg_temp.v('src') from club_rounds where id = pg_temp.v('r')::uuid), 'the card remembers the scheduled round');
select pg_temp.ok((select dnf from tag_match_players p join tag_matches m on m.id = p.match_id where m.round_id = pg_temp.v('r')::uuid and p.member_id = pg_temp.mem('Salty Flow'))
  and not (select dnf from tag_match_players p join tag_matches m on m.id = p.match_id where m.round_id = pg_temp.v('r')::uuid and p.member_id = pg_temp.mem('Cy Flow')), 'the tag round knows who DNF''d');
-- everyone confirms: Salty's 16 ties Al's 16 and beats Cy's 20, but a DNF still finishes last
insert into f_ctx select 'm', id::text from tag_matches where round_id = pg_temp.v('r')::uuid;
set role anon;
select tag_confirm(pg_temp.tok('Salty Flow'), pg_temp.v('m')::uuid, true);
select tag_confirm(pg_temp.tok('Cy Flow'), pg_temp.v('m')::uuid, true);
reset role;
select pg_temp.ok((select array_agg(p.name order by t.number) from tags t join tag_members p on p.id = t.holder_id where t.pool_id = pg_temp.pool()) = '{Al Flow,Cy Flow,Salty Flow}',
  'tags: a DNF finishes last, behind a worse total');
-- one card per scheduled round
set role anon;
select pg_temp.ok(pg_temp.refused(format('select round_save(%L, %L)', pg_temp.tok('Cy Flow'), pg_temp.card(pg_temp.v('src'), '[2,2,2,2]')), 'already_saved:' || pg_temp.v('r')), 'a second card for the same round is refused (with the saved round)');
select pg_temp.ok(round_save(pg_temp.tok('Cy Flow'), pg_temp.card(null, '[2,2,2,2]')) is not null, 'cards without a source save as always');
select pg_temp.ok(round_save(pg_temp.tok('Cy Flow'), pg_temp.card('nonsense', '[2,2,2,2]')) is not null, 'a junk source is ignored, not an error');
reset role;
update club_rounds set status = 'void' where id = pg_temp.v('r')::uuid;
set role anon;
select pg_temp.ok(round_save(pg_temp.tok('Cy Flow'), pg_temp.card(pg_temp.v('src'), '[2,2,2,2]')) is not null, 'voided: the round can be saved again');
select pg_temp.ok((select (r -> 'players' -> -1 ->> 'dnf_after')::int = 2 from jsonb_array_elements(tag_my_rounds(pg_temp.tok('Cy Flow')) -> 'rounds') r limit 1), 'My Rounds shows the DNF (and lists it last)');
reset role;
rollback;
