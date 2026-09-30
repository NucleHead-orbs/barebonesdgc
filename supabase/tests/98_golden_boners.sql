-- Golden Boners pool: exists, invite-only, public can read it, same issue/swap rules. Run after stub + all migrations.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.claims(sub text, admin boolean) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', sub, 'app_metadata', case when admin then '{"role":"td"}'::json else '{}'::json end)::text, false) $$;
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000a8', 'g-boss@club.test', now()),
  ('00000000-0000-4000-8000-0000000000b8', 'g-league@club.test', now())
on conflict do nothing;
insert into tag_pool_admins (pool_id, email) select id, 'g-league@club.test' from tag_pools where slug = 'lazy-boners';
set client_min_messages = notice;

select pg_temp.ok((select invite_only and sort = 3 and name = 'Golden Boners' from tag_pools where slug = 'golden-boners'), 'Golden Boners pool exists, invite only');
select pg_temp.ok((select count(*) = 2 from tag_pools where not invite_only), 'league pools stay open');
set role anon;
select pg_temp.ok((select count(*) = 1 from tag_pools where slug = 'golden-boners' and invite_only), 'public can see the pool and its invite-only flag');
reset role;

-- a league admin can't hand out golden tags; the super admin can
select pg_temp.claims('00000000-0000-4000-8000-0000000000b8', false); set role authenticated;
select pg_temp.ok(pg_temp.refused($q$select td_tag_issue((select id from tag_pools where slug = 'golden-boners'), null, 'Sneaky', null, null)$q$, 'forbidden'),
  'a league admin cannot issue Golden Boners');
reset role;
select pg_temp.claims('00000000-0000-4000-8000-0000000000a8', true); set role authenticated;
select td_tag_issue((select id from tag_pools where slug = 'golden-boners'), null, 'Gold One', null, null);
select td_tag_issue((select id from tag_pools where slug = 'golden-boners'), null, 'Gold Two', null, null);
reset role;
select pg_temp.ok((select array_agg(number order by number) = '{1,2}' from tags t join tag_pools p on p.id = t.pool_id where p.slug = 'golden-boners'),
  'super admin issues #1 then #2 (next number at the bottom)');
\echo ALL GOLDEN BONERS TESTS PASSED
