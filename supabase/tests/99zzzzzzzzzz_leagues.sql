-- Leagues as records: create, setup, TDs, weeks, attach. Run after stub + all migrations (and the earlier suites).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.claims(sub text, admin boolean) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', sub, 'app_metadata', case when admin then '{"role":"td"}'::json else '{}'::json end)::text, false) $$;
create temp table lg_ctx (k text primary key, v text);
grant all on lg_ctx to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from lg_ctx where k = key $$;
grant execute on function pg_temp.v(text) to anon, authenticated;
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-000000000aa1', 'lg-boss@lg.test', now()),
  ('00000000-0000-4000-8000-000000000ab1', 'lg-td@lg.test', now()),
  ('00000000-0000-4000-8000-000000000ac1', 'lg-other@lg.test', now())
on conflict do nothing;
set client_min_messages = notice;

-- seeded from the old site copy
select pg_temp.ok((select count(*) = 2 from leagues where slug in ('lazy-boners', 'rbfl')), 'Lazy Boners + RBFL are leagues now');
select pg_temp.ok((select award = 'Lazy Boner Safety Vest' and banner = '/assets/leagues/lazy-boners-banner.webp' from leagues where slug = 'lazy-boners'), 'site copy carried over');

-- only the super admin creates
select pg_temp.claims('00000000-0000-4000-8000-000000000ac1', false); set role authenticated;
select pg_temp.ok(pg_temp.refused('select td_create_league(''Thursday Thumpers'', ''thumpers'')', 'forbidden'), 'TDs can''t create leagues');
reset role;
select set_config('request.jwt.claims', '', false); set role anon;
select pg_temp.ok(pg_temp.refused('select td_create_league(''X'', ''xx'')', 'permission denied'), 'anon can''t either');
reset role;
select pg_temp.claims('00000000-0000-4000-8000-000000000aa1', true); set role authenticated;
insert into lg_ctx select 'lg', td_create_league('  Thursday Thumpers ', 'thumpers')::text;
select pg_temp.ok(pg_temp.refused('select td_create_league(''Again'', ''thumpers'')', 'slug_taken'), 'slugs are unique');
select pg_temp.ok(pg_temp.refused('select td_create_league(''Golden'', ''golden-boners'')', 'slug_taken'), 'can''t take an existing tag set''s slug');
select pg_temp.ok(pg_temp.refused('select td_create_league(''Bad'', ''Bad Slug'')', 'invalid_slug'), 'slug format checked');
reset role;
select pg_temp.ok((select l.name = 'Thursday Thumpers' and tp.slug = 'thumpers' and tp.name = 'Thursday Thumpers' and not tp.invite_only
  from leagues l join tag_pools tp on tp.id = l.tag_pool_id where l.id = pg_temp.v('lg')::uuid), 'a new league gets its own tag set, same slug + name');
insert into lg_ctx select 'pool', tag_pool_id::text from leagues where id = pg_temp.v('lg')::uuid;

-- league TDs = the tag set's admins (super admin adds them)
select pg_temp.claims('00000000-0000-4000-8000-000000000aa1', true); set role authenticated;
insert into tag_pool_admins (pool_id, email) values (pg_temp.v('pool')::uuid, 'lg-td@lg.test');
reset role;

select pg_temp.claims('00000000-0000-4000-8000-000000000ac1', false); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select td_save_league(%L, ''{"when_text":"Thursdays"}'')', pg_temp.v('lg')), 'forbidden'), 'only league TDs edit it');
select pg_temp.ok(jsonb_array_length(td_my_leagues()) = 0, 'a TD of nothing runs no leagues');
reset role;

select pg_temp.claims('00000000-0000-4000-8000-000000000ab1', false); set role authenticated;
select pg_temp.ok((select jsonb_agg(x->>'slug') = '["thumpers"]'::jsonb from jsonb_array_elements(td_my_leagues()) x), 'the league TD sees their league');
select td_save_league(pg_temp.v('lg')::uuid, '{"name":"Thumpers","when_text":" Thursdays · 5 PM ","award":"Golden Thumb","buy_in":"","hidden":true}');
select pg_temp.ok(pg_temp.refused(format('select td_save_league(%L, ''{"slug":"nope"}'')', pg_temp.v('lg')), 'unknown_field'), 'slug and tag set never change');
select pg_temp.ok(pg_temp.refused(format('select td_save_league(%L, ''{"banner":"https://evil.example/x.png"}'')', pg_temp.v('lg')), 'leagues_banner_check'), 'images are /assets/ or our own uploads');
select td_save_league(pg_temp.v('lg')::uuid, jsonb_build_object('banner', pg_temp.v('lg') || '/banner-1.webp'));
insert into storage.objects (bucket_id, name) values ('league-photos', pg_temp.v('lg') || '/banner-1.webp');
select pg_temp.ok(true, 'league TD uploads to the league''s folder');
reset role;
select pg_temp.ok((select name = 'Thumpers' and when_text = 'Thursdays · 5 PM' and award = 'Golden Thumb' and buy_in is null and hidden from leagues where id = pg_temp.v('lg')::uuid)
  and (select name = 'Thumpers' from tag_pools where id = pg_temp.v('pool')::uuid), 'setup saved; renaming renames the tag set');
select set_config('request.jwt.claims', '', false); set role anon;
select pg_temp.ok((select count(*) = 0 from leagues where slug = 'thumpers'), 'hidden leagues stay off the public site');
reset role;
select pg_temp.claims('00000000-0000-4000-8000-000000000ab1', false); set role authenticated;
select td_save_league(pg_temp.v('lg')::uuid, '{"hidden":false}');
reset role;
select set_config('request.jwt.claims', '', false); set role anon;
select pg_temp.ok((select count(*) = 1 from leagues where slug = 'thumpers'), 'shown again');
reset role;

-- weeks: first one blank, then each copies the newest
select pg_temp.claims('00000000-0000-4000-8000-000000000ac1', false); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select td_league_new_week(%L, ''2026-11-05'')', pg_temp.v('lg')), 'forbidden'), 'only league TDs add weeks');
reset role;
select pg_temp.claims('00000000-0000-4000-8000-000000000ab1', false); set role authenticated;
insert into lg_ctx select 'w1', td_league_new_week(pg_temp.v('lg')::uuid, '2026-11-05', null, true, 9, '[{"code":"MA1"},{"code":"MA3"}]')->>'id';
select pg_temp.ok((select name = 'Thumpers · Nov 5' and kind = 'league' and league_id = pg_temp.v('lg')::uuid and tag_pool_id = pg_temp.v('pool')::uuid
  and rounds = 1 and ends_on = starts_on from events where id = pg_temp.v('w1')::uuid), 'first week: blank, named for the league + date, in the league');
select pg_temp.ok((select count(*) = 9 from holes where event_id = pg_temp.v('w1')::uuid) and (select count(*) = 2 from divisions where event_id = pg_temp.v('w1')::uuid), 'with the holes + divisions given');
select pg_temp.ok(can_td(pg_temp.v('w1')::uuid), 'the league TD runs the week without being listed on it');
select pg_temp.ok((select count(*) = 1 from td_my_events() where id = pg_temp.v('w1')::uuid), 'and it''s in their events');
select td_set_ctp(pg_temp.v('w1')::uuid, 4, 'Ace pot');
reset role;
insert into players (event_id, name, div_code, checked_in) values (pg_temp.v('w1')::uuid, 'Thumb One', 'MA1', true), (pg_temp.v('w1')::uuid, 'Thumb Two', 'MA3', true);
update events set vest_player_id = (select id from players where name = 'Thumb One' and event_id = pg_temp.v('w1')::uuid) where id = pg_temp.v('w1')::uuid;

select pg_temp.claims('00000000-0000-4000-8000-000000000ab1', false); set role authenticated;
insert into lg_ctx select 'w2', td_league_new_week(pg_temp.v('lg')::uuid, '2026-11-12', 'Thumpers Week 2')->>'id';
reset role;
select pg_temp.ok((select name = 'Thumpers Week 2' and league_id = pg_temp.v('lg')::uuid and vest_player_id is null and group_photo is null from events where id = pg_temp.v('w2')::uuid),
  'next week copies the newest, without the vest');
select pg_temp.ok((select count(*) = 9 from holes where event_id = pg_temp.v('w2')::uuid)
  and (select ctp_prize = 'Ace pot' from holes where event_id = pg_temp.v('w2')::uuid and n = 4), 'course + CTPs carry');
select pg_temp.ok((select count(*) = 2 and bool_and(not checked_in) from players where event_id = pg_temp.v('w2')::uuid), 'players carry, nobody checked in');

-- DUPLICATE (td_create_event) keeps the copy in the league
select pg_temp.claims('00000000-0000-4000-8000-000000000ab1', false); set role authenticated;
insert into lg_ctx select 'w3', td_create_event('Thumpers dup', null, '2026-11-19', '2026-11-19', pg_temp.v('w2')::uuid)->>'id';
reset role;
select pg_temp.ok((select league_id = pg_temp.v('lg')::uuid from events where id = pg_temp.v('w3')::uuid), 'DUPLICATE stays in the league');

-- attach / detach
select pg_temp.claims('00000000-0000-4000-8000-000000000aa1', true); set role authenticated;
insert into lg_ctx select 'ev', td_create_event('LG Plain', 'Club', '2026-11-01', '2026-11-01', null, 9, '[{"code":"MA1"}]')->>'id';
insert into event_tds (event_id, email) select pg_temp.v('ev')::uuid, 'lg-other@lg.test';
reset role;
select pg_temp.claims('00000000-0000-4000-8000-000000000ac1', false); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select td_set_event_league(%L, %L)', pg_temp.v('ev'), pg_temp.v('lg')), 'forbidden'), 'attaching needs a TD of the league too');
reset role;
select pg_temp.claims('00000000-0000-4000-8000-000000000aa1', true); set role authenticated;
select td_set_event_league(pg_temp.v('ev')::uuid, pg_temp.v('lg')::uuid);
reset role;
select pg_temp.ok((select kind = 'league' and league_id = pg_temp.v('lg')::uuid and tag_pool_id = pg_temp.v('pool')::uuid from events where id = pg_temp.v('ev')::uuid), 'attached: a week of the league with its tag set');
select pg_temp.claims('00000000-0000-4000-8000-000000000aa1', true); set role authenticated;
select td_set_event_league(pg_temp.v('ev')::uuid, null);
reset role;
select pg_temp.ok((select kind = 'event' and league_id is null and tag_pool_id is null from events where id = pg_temp.v('ev')::uuid), 'detached: a plain event again');

-- vest wall follows the league
select set_config('request.jwt.claims', '', false); set role anon;
select pg_temp.ok((select (league_weeks('thumpers') -> 0 ->> 'vest') = 'Thumb One'), 'the vest wall reads the league''s weeks');
reset role;

-- the live data: Lazy Boners nights are in the league
select pg_temp.ok(not exists (select 1 from events e join leagues l on l.tag_pool_id = e.tag_pool_id where e.kind = 'league' and e.league_id is distinct from l.id),
  'every league-night event belongs to its league');
select set_config('request.jwt.claims', '', false);
