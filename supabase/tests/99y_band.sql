-- Meet the Band. Run after stub + all migrations.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.claims(sub text, admin boolean) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', sub, 'app_metadata', case when admin then '{"role":"td"}'::json else '{}'::json end)::text, false) $$;

set role anon;
select pg_temp.ok((select array_agg(name order by sort) = array['YT the Boneheaded Boy', 'WTF Jerry', 'Beard'] from band_members), 'the band is seeded in order');
select pg_temp.ok(pg_temp.refused($q$insert into band_members (name) values ('Rando')$q$, 'permission denied'), 'public cannot add members');
reset role;

select pg_temp.claims('00000000-0000-4000-8000-0000000000b9', false); set role authenticated;
select pg_temp.ok(pg_temp.refused($q$insert into band_members (name) values ('Rando')$q$, 'row-level security'), 'a signed-in non-admin cannot add members');
update band_members set hidden = true where name = 'Beard';
reset role;
select pg_temp.ok((select not hidden from band_members where name = 'Beard'), 'and cannot edit them');

select pg_temp.claims('00000000-0000-4000-8000-0000000000a9', true); set role authenticated;
insert into band_members (name, role, sort) values ('Zz Drummer', 'Manager', 4);
update band_members set hidden = true, card = 'band/0a1b2c3d-0000-4000-8000-000000000001.webp' where name = 'Zz Drummer';
select pg_temp.ok(pg_temp.refused($q$update band_members set card = 'https://evil.example/x.png' where name = 'Zz Drummer'$q$, 'band_members_card_check'), 'cards only come from the site or the band upload folder');
select pg_temp.ok(pg_temp.refused($q$update band_members set name = '   ' where name = 'Zz Drummer'$q$, 'band_members_name_check'), 'a member needs a name');
select pg_temp.ok((select count(*) = 4 from band_members), 'admin sees hidden members');
reset role;
select set_config('request.jwt.claims', '{}', false); set role anon;
select pg_temp.ok((select count(*) = 3 from band_members), 'public does not see hidden members');
reset role;
select pg_temp.claims('00000000-0000-4000-8000-0000000000a9', true); set role authenticated;
delete from band_members where name = 'Zz Drummer';
reset role;
select pg_temp.ok((select count(*) = 3 from band_members), 'admin can remove a member');
select 'PASSED 99y_band';
