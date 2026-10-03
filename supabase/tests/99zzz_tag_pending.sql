-- Scorecard tag swaps + pending board. Run after stub + all migrations and the 99z suite (uses Rex/Moe/Kit/Zed).
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
grant execute on function pg_temp.tok(text), pg_temp.mem(text), pg_temp.pool(text) to anon, authenticated;
create temp table p_ctx (k text primary key, v text);
grant all on p_ctx to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from p_ctx where k = key $$;
grant execute on function pg_temp.v(text) to anon, authenticated;
select set_config('request.jwt.claims', '', false);
-- Moe still has a waiting exchange count of 0 (his earlier one was voided); clear old open ones for a clean board
update tag_matches set status = 'void' where status in ('pending', 'disputed');
insert into p_ctx select 'gRex', (select number from tags where pool_id = pg_temp.pool('golden-boners') and holder_id = pg_temp.mem('Rex'))::text;
set client_min_messages = notice;

set role anon;
-- all or nothing: Zed has no Golden Boner, so saving his round with a Golden swap saves nothing
select pg_temp.ok(pg_temp.refused(format($q$select round_save_swap(%L, jsonb_build_object('course', 'Papago', 'played_on', current_date, 'pars', '[3,3]'::jsonb,
  'players', jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Zed'), 'scores', '[3,3]'::jsonb), jsonb_build_object('member_id', pg_temp.mem('Rex'), 'scores', '[3,4]'::jsonb))),
  array[pg_temp.pool('golden-boners')])$q$, pg_temp.tok('Zed')), 'no_tag_in_pool'), 'a swap that can''t start refuses the save too');
select pg_temp.ok((select count(*) = 0 from club_rounds where course = 'Papago' and created_by = pg_temp.mem('Zed')), '... and nothing was saved');

-- Moe 2, Rex 3, Kit 3 (tie) on two holes: one call saves + puts Golden Boners on the line
insert into p_ctx select 'res', round_save_swap(pg_temp.tok('Moe'), jsonb_build_object('course', 'Papago', 'played_on', current_date, 'pars', '[3]'::jsonb,
  'players', jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Moe'), 'scores', '[2]'::jsonb),
    jsonb_build_object('member_id', pg_temp.mem('Rex'), 'scores', '[3]'::jsonb), jsonb_build_object('member_id', pg_temp.mem('Kit'), 'scores', '[3]'::jsonb))),
  array[pg_temp.pool('golden-boners')])::text;
select pg_temp.ok((pg_temp.v('res')::jsonb -> 'exchanges' -> 0 ->> 'match_id') is not null, 'save + swap in one call returns the round and its exchange');
select pg_temp.ok(round_save_swap(pg_temp.tok('Rex'), jsonb_build_object('course', 'Papago', 'played_on', current_date, 'pars', '[3]'::jsonb,
  'players', jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Rex'), 'scores', '[3]'::jsonb))), null) -> 'exchanges' = '[]'::jsonb,
  'no tag sets = a plain save');

-- the pending board
select pg_temp.ok((select jsonb_array_length(x) = 1 and (x -> 0 ->> 'status') = 'pending' from (select tag_pending(pg_temp.pool('golden-boners')) x) z), 'board sees one pending swap');
select pg_temp.ok((select array_agg((p ->> 'place')::int order by (p ->> 'place')::int) = '{1,2,2}'
   from jsonb_array_elements(tag_pending(pg_temp.pool('golden-boners')) -> 0 -> 'players') p), 'places: best is 1, ties share a place');
select pg_temp.ok((select bool_and((p ->> 'confirmed')::boolean = ((p ->> 'member_id')::uuid = pg_temp.mem('Moe')))
   from jsonb_array_elements(tag_pending(pg_temp.pool('golden-boners')) -> 0 -> 'players') p), 'only the saver is confirmed so far');
select pg_temp.ok(not (tag_pending(pg_temp.pool('golden-boners'))::text like '%score%'), 'no scores on the public pending list');
select pg_temp.ok((select number from tags where pool_id = pg_temp.pool('golden-boners') and holder_id = pg_temp.mem('Rex')) = pg_temp.v('gRex')::int, 'nothing moved yet');
-- last confirmations apply it and it leaves the pending list
select round_confirm(pg_temp.tok('Rex'), (pg_temp.v('res')::jsonb ->> 'round_id')::uuid, true);
select round_confirm(pg_temp.tok('Kit'), (pg_temp.v('res')::jsonb ->> 'round_id')::uuid, true);
select pg_temp.ok(jsonb_array_length(tag_pending(pg_temp.pool('golden-boners'))) = 0, 'applied swaps leave the pending list');
reset role;
select pg_temp.ok((select status = 'applied' from tag_matches where id = (pg_temp.v('res')::jsonb -> 'exchanges' -> 0 ->> 'match_id')::uuid), 'the swap applied');
