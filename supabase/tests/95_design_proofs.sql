-- Design proofs + crew design access. Run after stub + all migrations.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;

-- fixtures (as owner): a second event, a crew member on each, designs on Jewel
insert into events (slug, name, starts_on, ends_on) values ('zz-proof-other', 'ZZ Other', '2026-12-01', '2026-12-01') on conflict do nothing;
insert into crew (event_id, name, token) select id, 'Proof Crew', 'proofcrewtoken000000000000000001' from events where slug = 'jewel-xi-2026';
insert into crew (event_id, name, token) select id, 'Other Crew', 'proofcrewtoken000000000000000002' from events where slug = 'zz-proof-other';
insert into crew (event_id, name, token, revoked_at) select id, 'Gone Crew', 'proofcrewtoken000000000000000003', now() from events where slug = 'jewel-xi-2026';
insert into design_assets (event_id, category, title, proof, proof_opts, crew_visible)
  select id, 'disc', 'Tour disc', 'disc', '{"foil":"Electric","plastic":"Black"}', true from events where slug = 'jewel-xi-2026';
insert into design_assets (event_id, category, title, crew_visible) select id, 'shirts', 'Shirt front', true from events where slug = 'jewel-xi-2026';
insert into design_assets (event_id, category, title, crew_visible) select id, 'flyer', 'Secret flyer', false from events where slug = 'jewel-xi-2026';
insert into design_files (asset_id, version, path, file_name) select id, 1, 'x/shirts/' || id || '/v1-front.png', 'front.png' from design_assets where title = 'Shirt front';
insert into design_files (asset_id, version, path, file_name) select id, 2, 'x/shirts/' || id || '/v2-front.png', 'front2.png' from design_assets where title = 'Shirt front';
insert into design_files (asset_id, version, path, file_name) select id, 1, 'x/flyer/' || id || '/v1.png', 'flyer.png' from design_assets where title = 'Secret flyer';
set client_min_messages = notice;

select pg_temp.ok(pg_temp.refused($q$update design_assets set proof = 'poster' where title = 'Tour disc'$q$, 'design_assets_proof_check'), 'unknown proof kind refused');
select pg_temp.ok(pg_temp.refused($q$update design_assets set proof_opts = '[1]' where title = 'Tour disc'$q$, 'design_assets_proof_opts_check'), 'proof picks must be an object');
select pg_temp.ok((select crew_visible = false from design_assets where title = 'Secret flyer'), 'designs are TD-only by default');

set role anon;
select pg_temp.ok(jsonb_array_length(crew_designs('proofcrewtoken000000000000000001')) = 2, 'crew see the 2 crew-visible designs');
select pg_temp.ok(not (crew_designs('proofcrewtoken000000000000000001')::text like '%Secret flyer%'), 'hidden design stays hidden');
select pg_temp.ok((select (x -> 'file' ->> 'version')::int = 2 from jsonb_array_elements(crew_designs('proofcrewtoken000000000000000001')) x where x ->> 'title' = 'Shirt front'), 'crew get the latest version');
select pg_temp.ok((select x -> 'proof_opts' ->> 'foil' = 'Electric' from jsonb_array_elements(crew_designs('proofcrewtoken000000000000000001')) x where x ->> 'proof' = 'disc'), 'crew see the TD''s proof picks');
select pg_temp.ok(not (crew_designs('proofcrewtoken000000000000000001')::text like '%/v1-front.png%'), 'paths never leave crew_designs');
select pg_temp.ok(jsonb_array_length(crew_designs('proofcrewtoken000000000000000002')) = 0, 'another event''s crew sees none of these');
select pg_temp.ok(pg_temp.refused($q$select crew_designs('proofcrewtoken000000000000000003')$q$, 'invalid_link'), 'revoked link refused');
select pg_temp.ok(pg_temp.refused($q$select * from design_assets$q$, 'permission denied'), 'anon cannot read the design table directly');
reset role;

create temp table ids as select (select f.id from design_files f join design_assets a on a.id = f.asset_id where a.title = 'Shirt front' and f.version = 1) shirt_v1,
  (select f.id from design_files f join design_assets a on a.id = f.asset_id where a.title = 'Secret flyer') flyer;
grant select on ids to anon;
set role anon;
select pg_temp.ok(crew_design_file('proofcrewtoken000000000000000001', (select shirt_v1 from ids)) ->> 'path' like 'x/shirts/%', 'signing lookup: visible file returns its path');
select pg_temp.ok(pg_temp.refused(format('select crew_design_file(%L, %L)', 'proofcrewtoken000000000000000001', (select flyer from ids)), 'not_found'), 'signing lookup: hidden design refused');
select pg_temp.ok(pg_temp.refused(format('select crew_design_file(%L, %L)', 'proofcrewtoken000000000000000002', (select shirt_v1 from ids)), 'not_found'), 'signing lookup: other event''s crew refused');
reset role;

\echo ALL DESIGN PROOF TESTS PASSED
