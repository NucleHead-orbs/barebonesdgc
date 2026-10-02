-- Tee-sign bubble text fits in proof_opts. Run after stub + all migrations.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
create temp table q_ev as select id from events limit 1;
insert into design_assets (event_id, category, title, proof, proof_opts)
select id, 'tee_signs', 'zz quotes', 'tee_signs',
  (select jsonb_object_agg('q' || n, repeat('x', 140)) from generate_series(1, 20) n) || '{"palette":"Electric","bg":"Navy"}'
from q_ev;
select pg_temp.ok((select length(proof_opts::text) > 2900 from design_assets where title = 'zz quotes'), 'all 20 full-length bubble quotes fit');
select pg_temp.ok(pg_temp.refused($q$update design_assets set proof_opts = jsonb_build_object('x', repeat('y', 7000)) where title = 'zz quotes'$q$, 'design_assets_proof_opts_check'), 'still capped');
select pg_temp.ok(pg_temp.refused($q$update design_assets set proof_opts = '[1]' where title = 'zz quotes'$q$, 'design_assets_proof_opts_check'), 'still must be an object');
delete from design_assets where title = 'zz quotes';
select 'PASSED 99x_proof_quotes';
