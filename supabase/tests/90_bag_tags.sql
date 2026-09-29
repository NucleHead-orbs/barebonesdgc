-- Bag tag acceptance tests. Run after stub + all migrations.
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
create or replace function pg_temp.pool(s text) returns uuid language sql as $$ select id from tag_pools where slug = s $$;
create or replace function pg_temp.mem(n text) returns uuid language sql as $$ select id from tag_members where name = n $$;
create or replace function pg_temp.tok(n text) returns text language sql security definer as $$ select token from tag_members where name = n $$;
create or replace function pg_temp.num(p text, n text) returns int language sql as $$
  select number from tags where pool_id = pg_temp.pool(p) and holder_id = pg_temp.mem(n) $$;
grant execute on function pg_temp.pool(text), pg_temp.mem(text), pg_temp.tok(text), pg_temp.num(text, text) to anon, authenticated;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000a9', 't-boss@club.test', now()),
  ('00000000-0000-4000-8000-0000000000b9', 't-bone@club.test', now()),
  ('00000000-0000-4000-8000-0000000000c9', 't-rando@club.test', now())
on conflict do nothing;
insert into tag_pool_admins (pool_id, email) select id, 't-bone@club.test' from tag_pools where slug = 'lazy-boners';
insert into event_tds (event_id, email) select id, 't-bone@club.test' from events where slug = 'jewel-xi-2026';
set client_min_messages = notice;

select pg_temp.ok((select count(*) = 2 from tag_pools where slug in ('lazy-boners', 'rbfl')), 'seed: Lazy Boners and RBFL pools');

-- ===== who can issue =====
select pg_temp.claims('00000000-0000-4000-8000-0000000000c9', false); set role authenticated;
select pg_temp.ok(pg_temp.refused($q$select td_tag_issue(pg_temp.pool('lazy-boners'), null, 'Alice', null, null)$q$, 'forbidden'), 'a random account cannot issue tags');
select pg_temp.ok(pg_temp.refused($q$insert into tags (pool_id, number) values (pg_temp.pool('lazy-boners'), 1)$q$, 'permission denied'), 'nobody writes tags directly');
reset role;

select pg_temp.claims('00000000-0000-4000-8000-0000000000b9', false); set role authenticated;
select td_tag_issue(pg_temp.pool('lazy-boners'), null, 'Alice', 'Al', null);
select td_tag_issue(pg_temp.pool('lazy-boners'), null, 'Bob', null, null);
select td_tag_issue(pg_temp.pool('lazy-boners'), null, 'Cara', null, null);
select td_tag_issue(pg_temp.pool('lazy-boners'), null, 'Dan', null, null);
select pg_temp.ok(pg_temp.num('lazy-boners', 'Alice') = 1 and pg_temp.num('lazy-boners', 'Dan') = 4, 'pool admin issues next numbers at the bottom (1..4)');
select pg_temp.ok(pg_temp.refused($q$select td_tag_issue(pg_temp.pool('lazy-boners'), null, 'bob ', null, null)$q$, 'already_has_tag'), 'same person (any case) cannot hold two tags in one pool');
select pg_temp.ok(pg_temp.refused($q$select td_tag_issue(pg_temp.pool('lazy-boners'), null, 'Eve', null, 2)$q$, 'tag_taken'), 'a held number cannot be issued again');
select pg_temp.ok(pg_temp.refused($q$select td_tag_issue(pg_temp.pool('rbfl'), null, 'Alice', null, null)$q$, 'forbidden'), 'league TD cannot touch another league''s pool');
reset role;
select pg_temp.claims('00000000-0000-4000-8000-0000000000a9', true); set role authenticated;
select td_tag_issue(pg_temp.pool('rbfl'), pg_temp.mem('Alice'), null, null, null);
select td_tag_issue(pg_temp.pool('rbfl'), null, 'Eve', null, null);
select pg_temp.ok(pg_temp.num('rbfl', 'Alice') = 1 and pg_temp.num('rbfl', 'Eve') = 2, 'super admin runs every pool; a person can hold one tag per league');
select pg_temp.ok((select count(*) = 6 from tag_history where kind = 'issued'), 'every issue is in the history');
reset role;

-- ===== public view =====
select set_config('request.jwt.claims', '{}', false); set role anon;
select pg_temp.ok((select count(*) = 6 from tags), 'anon: reads the tag board');
select pg_temp.ok((select count(*) = 5 from tag_members), 'anon: reads names');
select pg_temp.ok(pg_temp.refused($q$select token from tag_members$q$, 'permission denied'), 'anon: can never read link tokens');
select pg_temp.ok(pg_temp.refused($q$select tag_me('nope-not-a-real-token-at-all')$q$, 'invalid_link'), 'bad link is refused');
reset role;

-- ===== casual round: log, confirm, swap =====
set role anon;
select pg_temp.ok((tag_me(pg_temp.tok('Alice')) -> 'holdings') @> '[{"pool":"lazy-boners","number":1},{"pool":"rbfl","number":1}]', 'My Tag shows both of Alice''s tags');
select pg_temp.ok(pg_temp.refused(format($q$select tag_log(%L, pg_temp.pool('lazy-boners'), '[{"member_id":"%s","score":50},{"member_id":"%s","score":52}]', null, null)$q$,
  pg_temp.tok('Cara'), pg_temp.mem('Cara'), pg_temp.mem('Eve')), 'no_tag_in_pool'), 'cannot log against someone without a tag in that pool');
select pg_temp.ok(pg_temp.refused(format($q$select tag_log(%L, pg_temp.pool('lazy-boners'), '[{"member_id":"%s","score":50},{"member_id":"%s","score":52}]', null, null)$q$,
  pg_temp.tok('Cara'), pg_temp.mem('Alice'), pg_temp.mem('Bob')), 'must_include_you'), 'you can only log rounds you played');
select tag_log(pg_temp.tok('Cara'), pg_temp.pool('lazy-boners'),
  jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Cara'), 'score', 50), jsonb_build_object('member_id', pg_temp.mem('Alice'), 'score', 52)), 'Emerald', null);
select pg_temp.ok(pg_temp.num('lazy-boners', 'Cara') = 3, 'nothing moves until everyone confirms');
select pg_temp.ok(jsonb_array_length(tag_me(pg_temp.tok('Alice')) -> 'open') = 1, 'Alice sees the round waiting for her');
select pg_temp.ok((select count(*) = 0 from tag_matches), 'anon: pending rounds are not public');
select pg_temp.ok(tag_confirm(pg_temp.tok('Alice'), (select (tag_me(pg_temp.tok('Alice')) -> 'open' -> 0 ->> 'id')::uuid), true) = 'applied', 'last confirmation applies it');
select pg_temp.ok(pg_temp.num('lazy-boners', 'Cara') = 1 and pg_temp.num('lazy-boners', 'Alice') = 3, 'winner takes the better tag (Cara 3->1, Alice 1->3)');
select pg_temp.ok(pg_temp.num('lazy-boners', 'Bob') = 2, 'players not on the round keep theirs');
select pg_temp.ok((select count(*) = 1 from tag_matches where status = 'applied'), 'anon: applied rounds are public history');
reset role;
select pg_temp.ok((select count(*) = 2 from tag_history where kind = 'moved') and (select moves = 1 from tags where pool_id = pg_temp.pool('lazy-boners') and number = 1),
  'history + move count recorded');

-- tie keeps order
set role anon;
select tag_log(pg_temp.tok('Alice'), pg_temp.pool('lazy-boners'),
  jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Alice'), 'score', 48), jsonb_build_object('member_id', pg_temp.mem('Bob'), 'score', 48)), null, null);
select tag_confirm(pg_temp.tok('Bob'), (select (tag_me(pg_temp.tok('Bob')) -> 'open' -> 0 ->> 'id')::uuid), true);
select pg_temp.ok(pg_temp.num('lazy-boners', 'Bob') = 2 and pg_temp.num('lazy-boners', 'Alice') = 3, 'tie: the better tag stays better');

-- dispute -> admin
select tag_log(pg_temp.tok('Dan'), pg_temp.pool('lazy-boners'),
  jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Dan'), 'score', 40), jsonb_build_object('member_id', pg_temp.mem('Bob'), 'score', 45)), null, null);
select pg_temp.ok(tag_confirm(pg_temp.tok('Bob'), (select (tag_me(pg_temp.tok('Bob')) -> 'open' -> 0 ->> 'id')::uuid), false) = 'disputed', 'a player can dispute');
select pg_temp.ok(pg_temp.num('lazy-boners', 'Dan') = 4, 'disputed round moves nothing');
reset role;
select pg_temp.claims('00000000-0000-4000-8000-0000000000b9', false); set role authenticated;
select pg_temp.ok(td_tag_resolve((select id from tag_matches where status = 'disputed'), true) = 'applied', 'pool admin settles the dispute');
select pg_temp.ok(pg_temp.num('lazy-boners', 'Dan') = 2 and pg_temp.num('lazy-boners', 'Bob') = 4, 'settled round swaps (Dan 4->2)');
reset role;

-- withdraw, expiry, limits
set role anon;
select tag_log(pg_temp.tok('Alice'), pg_temp.pool('lazy-boners'),
  jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Alice'), 'score', 1), jsonb_build_object('member_id', pg_temp.mem('Cara'), 'score', 99)), null, null);
select pg_temp.ok(pg_temp.refused(format('select tag_withdraw(%L, %L)', pg_temp.tok('Cara'), (select (tag_me(pg_temp.tok('Alice')) -> 'open' -> 0 ->> 'id'))), 'cannot_withdraw'),
  'only the logger can withdraw');
select tag_withdraw(pg_temp.tok('Alice'), (select (tag_me(pg_temp.tok('Alice')) -> 'open' -> 0 ->> 'id')::uuid));
select pg_temp.ok(jsonb_array_length(tag_me(pg_temp.tok('Cara')) -> 'open') = 0, 'withdrawn round disappears');
select tag_log(pg_temp.tok('Alice'), pg_temp.pool('lazy-boners'),
  jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Alice'), 'score', 1), jsonb_build_object('member_id', pg_temp.mem('Cara'), 'score', 99)), null, null);
reset role;
update tag_matches set created_at = now() - interval '8 days' where status = 'pending';
set role anon;
select pg_temp.ok(pg_temp.refused(format('select tag_confirm(%L, %L, true)', pg_temp.tok('Cara'), (select (tag_me(pg_temp.tok('Cara')) -> 'open' -> 0 ->> 'id'))), 'round_expired'),
  'a round nobody confirmed in 7 days expires');
select tag_log(pg_temp.tok('Alice'), pg_temp.pool('lazy-boners'), jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Alice'), 'score', 1), jsonb_build_object('member_id', pg_temp.mem('Bob'), 'score', 2)), null, null);
select tag_log(pg_temp.tok('Alice'), pg_temp.pool('lazy-boners'), jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Alice'), 'score', 1), jsonb_build_object('member_id', pg_temp.mem('Bob'), 'score', 2)), null, null);
select tag_log(pg_temp.tok('Alice'), pg_temp.pool('lazy-boners'), jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Alice'), 'score', 1), jsonb_build_object('member_id', pg_temp.mem('Bob'), 'score', 2)), null, null);
select pg_temp.ok(pg_temp.refused(format($q$select tag_log(%L, pg_temp.pool('lazy-boners'), '[{"member_id":"%s","score":1},{"member_id":"%s","score":2}]', null, null)$q$,
  pg_temp.tok('Alice'), pg_temp.mem('Alice'), pg_temp.mem('Bob')), 'too_many_open'), 'max 3 open rounds per logger');
reset role;
update tag_matches set status = 'void' where status = 'pending';

-- ===== league night from the scorecard =====
select pg_temp.claims('00000000-0000-4000-8000-0000000000b9', false); set role authenticated;
-- before: Cara 1, Dan 2, Alice 3, Bob 4
select td_tag_record(pg_temp.pool('lazy-boners'), (select id from events where slug = 'jewel-xi-2026'),
  jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Bob'), 'score', -6), jsonb_build_object('member_id', pg_temp.mem('Alice'), 'score', -2),
                    jsonb_build_object('member_id', pg_temp.mem('Cara'), 'score', 3), jsonb_build_object('member_id', pg_temp.mem('Eve'), 'score', -9)), null, null);
select pg_temp.ok(pg_temp.num('lazy-boners', 'Bob') = 1 and pg_temp.num('lazy-boners', 'Alice') = 3 and pg_temp.num('lazy-boners', 'Cara') = 4 and pg_temp.num('lazy-boners', 'Dan') = 2,
  'event round: the three holders reshuffle 1/3/4; Dan (not playing) keeps 2; Eve (no tag here) ignored');
select pg_temp.ok(pg_temp.refused($q$select td_tag_record(pg_temp.pool('lazy-boners'), (select id from events where slug = 'jewel-xi-2026'), '[{"member_id":"00000000-0000-4000-8000-000000000001","score":1},{"member_id":"00000000-0000-4000-8000-000000000002","score":2}]', null, null)$q$, 'unknown_member'),
  'unknown people are refused');
select pg_temp.ok(pg_temp.refused(format($q$select td_tag_record(pg_temp.pool('lazy-boners'), (select id from events where slug = 'jewel-xi-2026'), '[{"member_id":"%s","score":1},{"member_id":"%s","score":2}]', null, null)$q$,
  pg_temp.mem('Alice'), pg_temp.mem('Bob')), 'event_already_recorded'), 'an event is recorded once per pool');

-- ===== undo =====
select td_tag_undo(pg_temp.pool('lazy-boners'));
select pg_temp.ok(pg_temp.num('lazy-boners', 'Cara') = 1 and pg_temp.num('lazy-boners', 'Alice') = 3 and pg_temp.num('lazy-boners', 'Bob') = 4,
  'undo puts the latest round back');
select td_tag_undo(pg_temp.pool('lazy-boners'));   -- undoes the settled dispute: Dan 2->4, Bob 4->2
select pg_temp.ok(pg_temp.num('lazy-boners', 'Dan') = 4 and pg_temp.num('lazy-boners', 'Bob') = 2, 'undo walks back one round at a time');
select td_tag_release(pg_temp.pool('lazy-boners'), 3, false);  -- Alice gives her tag back
select pg_temp.ok(pg_temp.refused($q$select td_tag_undo(pg_temp.pool('lazy-boners'))$q$, 'tags_changed_since'), 'undo refused once a tag in it changed since');

-- ===== release / reissue =====
select pg_temp.ok((select status = 'available' and holder_id is null from tags where pool_id = pg_temp.pool('lazy-boners') and number = 3), 'released tag is available');
select td_tag_issue(pg_temp.pool('lazy-boners'), null, 'Finn', null, null);
select pg_temp.ok(pg_temp.num('lazy-boners', 'Finn') = 5, 'a new player starts at the bottom, not in a freed hole');
select td_tag_issue(pg_temp.pool('lazy-boners'), pg_temp.mem('Alice'), null, null, 3);
select pg_temp.ok(pg_temp.num('lazy-boners', 'Alice') = 3, 'a freed number can be handed out on purpose');
select pg_temp.ok(jsonb_array_length(td_tag_members()) = 6, 'admin sees everyone with their links');
reset role;
select pg_temp.claims('00000000-0000-4000-8000-0000000000c9', false); set role authenticated;
select pg_temp.ok(pg_temp.refused($q$select td_tag_members()$q$, 'forbidden'), 'random account cannot read links');
select pg_temp.ok(pg_temp.refused($q$insert into tag_pool_admins (pool_id, email) values (pg_temp.pool('rbfl'), 't-rando@club.test')$q$, 'row-level security'), 'only super admin names league admins');
reset role;

-- ===== new link kills the old one =====
select pg_temp.claims('00000000-0000-4000-8000-0000000000b9', false); set role authenticated;
select pg_temp.tok('Dan') as old_tok \gset
select td_tag_new_link(pg_temp.mem('Dan'));
reset role;
set role anon;
select pg_temp.ok(pg_temp.refused(format('select tag_me(%L)', :'old_tok'), 'invalid_link'), 'reissued link: old one is dead');
reset role;

\echo ALL BAG TAG TESTS PASSED
