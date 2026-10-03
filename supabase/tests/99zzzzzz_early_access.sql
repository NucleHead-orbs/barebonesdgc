-- Early access tag league + raffle. Run after stub + all migrations and the earlier suites (uses Rex from 99z).
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
create or replace function pg_temp.ev() returns uuid language sql as $$ select id from events where slug = 'jewel-xi-2026' $$;
create or replace function pg_temp.pl(n text) returns uuid language sql as $$ select id from players where event_id = pg_temp.ev() and name = n $$;
create or replace function pg_temp.mem(n text) returns uuid language sql as $$ select id from tag_members where name = n $$;
create or replace function pg_temp.tok(n text) returns text language sql security definer as $$ select token from tag_members where name = n $$;
create or replace function pg_temp.eapool() returns uuid language sql as $$ select id from tag_pools where slug = 'jewel-xi-ea' $$;
create temp table e_ctx (k text primary key, v text);
grant all on e_ctx to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from e_ctx where k = key $$;
create or replace function pg_temp.put(key text, val text) returns void language sql as $$
  insert into e_ctx values (key, val) on conflict (k) do update set v = excluded.v $$;
/** standings row field for a member, as the TD sees it */
create or replace function pg_temp.st(n text, f text) returns int language sql security definer as $$
  select (x ->> f)::int from jsonb_array_elements(_ea_standings(pg_temp.ev())) x where x ->> 'name' = n $$;
create or replace function pg_temp.card() returns jsonb language sql as $$ select jsonb_agg(3) from generate_series(1, 18) $$;
/** save a round as the first name's link, everyone on it a member (or 'guest:<name>') */
create or replace function pg_temp.round(who text[], day date) returns uuid language sql security definer as $$
  select round_save(pg_temp.tok(who[1]), jsonb_build_object('course', 'Freedom', 'played_on', day,
    'pars', pg_temp.card(), 'players', (select jsonb_agg(case when w like 'guest:%' then jsonb_build_object('guest_name', substr(w, 7), 'scores', pg_temp.card())
                                                     else jsonb_build_object('member_id', pg_temp.mem(w), 'scores', pg_temp.card()) end) from unnest(who) w))) $$;
create or replace function pg_temp.confirm(n text, r uuid) returns void language sql security definer as $$ select round_confirm(pg_temp.tok(n), r, true) $$;
/** read private tables in a check while acting as a client role */
create or replace function pg_temp.q(sql text) returns text language plpgsql security definer as $$
declare r text; begin execute sql into r; return r; end $$;
grant execute on function pg_temp.q(text) to anon, authenticated;
grant execute on function pg_temp.ev(), pg_temp.pl(text), pg_temp.mem(text), pg_temp.tok(text), pg_temp.eapool(), pg_temp.v(text),
  pg_temp.put(text, text), pg_temp.st(text, text), pg_temp.card(), pg_temp.round(text[], date), pg_temp.confirm(text, uuid) to anon, authenticated;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000ea0a1', 'ea-boss@club.test', now()),
  ('00000000-0000-4000-8000-0000000ea0b1', 'ea-rando@club.test', now())
on conflict do nothing;
-- Dee Skip is already a club member before early access
insert into tag_members (name) values ('Dee Skip') on conflict do nothing;
select set_config('request.jwt.claims', '', false);
set client_min_messages = notice;

-- ---------- public page + claims ----------
set role anon;
select pg_temp.ok((ea_public('jewel-xi-2026') ->> 'pool') = 'jewel-xi-ea', 'Jewel XI early access is on with its own tag set');
select pg_temp.ok(jsonb_array_length(ea_public('jewel-xi-2026') -> 'roster') = (select count(*) from players where event_id = pg_temp.ev()), 'roster lists every registrant');
select pg_temp.ok(pg_temp.refused('select * from ea_claims', 'permission denied'), 'claims table is private');
select pg_temp.ok(pg_temp.refused('select * from early_access', 'permission denied'), 'settings table is private');
select pg_temp.ok(pg_temp.refused(format('select ea_claim(%L, %L, null)', 'jewel-xi-2026', gen_random_uuid()), 'unknown_player'), 'claim must be a registrant');
select pg_temp.ok(pg_temp.refused(format('select ea_claim(%L, %L, %L)', 'jewel-xi-2026', pg_temp.pl('Axl Anhyzer Jr'), repeat('x', 41)), 'invalid_nickname'), 'nickname capped');
select pg_temp.put('a1', ea_claim('jewel-xi-2026', pg_temp.pl('Axl Anhyzer Jr'), 'Axl'));
select pg_temp.put('a2', ea_claim('jewel-xi-2026', pg_temp.pl('Axl Anhyzer Jr'), 'imposter'));
select pg_temp.put('c1', ea_claim('jewel-xi-2026', pg_temp.pl('Dee Skip'), null));
select pg_temp.ok((ea_claim_status(pg_temp.v('a1')) ->> 'status') = 'pending' and (ea_claim_status(pg_temp.v('a1')) ->> 'token') is null, 'waiting claim shows no link');
select pg_temp.ok(pg_temp.refused('select ea_claim_status(''nope'')', 'invalid_claim'), 'bad secret refused');
select pg_temp.ok(pg_temp.refused(format('select td_ea_get(%L)', pg_temp.ev()), 'permission denied'), 'anon can''t open the TD view');
select ea_claim_mine(pg_temp.tok('Rex'), 'jewel-xi-2026', pg_temp.pl('Chainz McGee'));
select pg_temp.ok(pg_temp.refused(format('select ea_claim_mine(%L, %L, %L)', pg_temp.tok('Rex'), 'jewel-xi-2026', pg_temp.pl('Lita Ford')), 'already_claimed'), 'one claim per member');
select pg_temp.ok((select x ->> 'status' from jsonb_array_elements(ea_me(pg_temp.tok('Rex'))) x where x ->> 'slug' = 'jewel-xi-2026') = 'pending', 'My Tag shows the claim waiting');
reset role;

-- ---------- TD approves ----------
select pg_temp.claims('00000000-0000-4000-8000-0000000ea0b1', false); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select td_ea_get(%L)', pg_temp.ev()), 'forbidden'), 'only the event''s TDs see claims');
select pg_temp.ok(pg_temp.refused(format('select td_ea_approve(%L, null)', pg_temp.q(format('select id from ea_claims where secret = %L', pg_temp.v('a1')))), 'forbidden'), 'non-TD can''t approve');
reset role;
select pg_temp.claims('00000000-0000-4000-8000-0000000ea0a1', true); set role authenticated;
select pg_temp.ok(jsonb_array_length(td_ea_get(pg_temp.ev()) -> 'claims') = 4, 'TD sees the 4 waiting claims');
select pg_temp.ok((select (x -> 'member' ->> 'name') from jsonb_array_elements(td_ea_get(pg_temp.ev()) -> 'claims') x where x ->> 'player' = 'Dee Skip') = 'Dee Skip',
  'TD sees a page claim matches an existing club member');
select pg_temp.put('n1', (td_ea_approve(pg_temp.q(format('select id from ea_claims where secret = %L', pg_temp.v('a1')))::uuid, null) ->> 'number'));
select pg_temp.ok(pg_temp.v('n1') = '1', 'first approved gets tag #1');
select pg_temp.put('n2', (td_ea_approve(pg_temp.q(format('select id from ea_claims where via = %L and player_id = %L', 'mytag', pg_temp.pl('Chainz McGee')))::uuid, null) ->> 'number'));
select pg_temp.put('n3', (td_ea_approve(pg_temp.q(format('select id from ea_claims where secret = %L', pg_temp.v('c1')))::uuid, null) ->> 'number'));
select pg_temp.ok(pg_temp.v('n2') = '2' and pg_temp.v('n3') = '3', 'tags go out in join order');
select pg_temp.ok((select count(*) from tag_members where lower(name) = 'dee skip') = 1, 'existing member reused, no duplicate');
select pg_temp.ok(pg_temp.q(format('select status from ea_claims where secret = %L', pg_temp.v('a2'))) = 'declined', 'other claims for that player are declined');
select pg_temp.ok(pg_temp.refused(format('select td_ea_approve(%L, null)', pg_temp.q(format('select id from ea_claims where secret = %L', pg_temp.v('a2')))), 'already_declined'), 'can''t approve a declined claim');
reset role;
set role anon;
select pg_temp.ok((ea_claim_status(pg_temp.v('a1')) ->> 'token') = pg_temp.tok('Axl Anhyzer Jr'), 'approved device gets its My Tag link');
select pg_temp.ok((ea_claim_status(pg_temp.v('a2')) ->> 'token') is null, 'declined device gets nothing');
select pg_temp.ok((select nickname from tag_members where name = 'Axl Anhyzer Jr') = 'Axl', 'nickname carried to the new member');
select pg_temp.ok(pg_temp.refused(format('select ea_claim(%L, %L, null)', 'jewel-xi-2026', pg_temp.pl('Axl Anhyzer Jr')), 'already_joined'), 'joined player can''t be claimed again');
select pg_temp.ok((select count(*) from jsonb_array_elements(ea_public('jewel-xi-2026') -> 'roster') x where (x ->> 'joined')::boolean) = 3, 'roster shows 3 joined');
reset role;

-- ---------- tickets ----------
select pg_temp.put('r1', pg_temp.round(array['Axl Anhyzer Jr', 'Rex', 'Dee Skip', 'guest:Buddy'], current_date)::text);
select pg_temp.ok(coalesce(pg_temp.st('Axl Anhyzer Jr', 'tickets'), -1) = 0, 'unconfirmed round earns nothing');
select pg_temp.confirm('Rex', pg_temp.v('r1')::uuid);
select pg_temp.confirm('Dee Skip', pg_temp.v('r1')::uuid);
select pg_temp.ok(pg_temp.st('Axl Anhyzer Jr', 'round_tickets') = 1 and pg_temp.st('Axl Anhyzer Jr', 'partners') = 2
  and pg_temp.st('Axl Anhyzer Jr', 'tickets') = 3, 'confirmed round of 3: 1 round ticket + 2 new partners (guest ignored)');
select pg_temp.put('r2', pg_temp.round(array['Axl Anhyzer Jr', 'Rex'], current_date)::text);
select pg_temp.confirm('Rex', pg_temp.v('r2')::uuid);
select pg_temp.ok(pg_temp.st('Axl Anhyzer Jr', 'rounds') = 1, 'a round with only 2 Jewel players doesn''t count');
select pg_temp.put('r3', pg_temp.round(array['Axl Anhyzer Jr', 'Rex', 'Dee Skip'], current_date + 1)::text);
select pg_temp.put('r4', pg_temp.round(array['Axl Anhyzer Jr', 'Rex', 'Dee Skip'], current_date + 1)::text);
select pg_temp.confirm('Rex', pg_temp.v('r3')::uuid); select pg_temp.confirm('Dee Skip', pg_temp.v('r3')::uuid);
select pg_temp.confirm('Rex', pg_temp.v('r4')::uuid); select pg_temp.confirm('Dee Skip', pg_temp.v('r4')::uuid);
select pg_temp.ok(pg_temp.st('Axl Anhyzer Jr', 'rounds') = 3 and pg_temp.st('Axl Anhyzer Jr', 'round_tickets') = 2
  and pg_temp.st('Axl Anhyzer Jr', 'partners') = 2, 'weekly cap: 3 rounds in a week earn 2; partners count once each');
select round_confirm(pg_temp.tok('Dee Skip'), pg_temp.v('r4')::uuid, false);
select pg_temp.ok(pg_temp.st('Axl Anhyzer Jr', 'rounds') = 2, 'a disputed round stops counting');
select pg_temp.claims('00000000-0000-4000-8000-0000000ea0a1', true); set role authenticated;
select td_round_void(pg_temp.v('r3')::uuid);
reset role;
select pg_temp.ok(pg_temp.st('Axl Anhyzer Jr', 'rounds') = 1, 'a voided round stops counting');
select pg_temp.confirm('Dee Skip', pg_temp.v('r4')::uuid);
select pg_temp.ok(pg_temp.st('Axl Anhyzer Jr', 'rounds') = 2, 'confirming after a dispute counts again');

-- a round before the window doesn't count; moving the window open does
update club_rounds set played_on = current_date - 8 where id = pg_temp.v('r4')::uuid;
select pg_temp.ok(pg_temp.st('Axl Anhyzer Jr', 'rounds') = 1, 'rounds before the window don''t count');
select pg_temp.claims('00000000-0000-4000-8000-0000000ea0a1', true); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select td_ea_settings(%L, %L, %L, 3, 2)', pg_temp.ev(), current_date, '2026-11-21'), 'invalid_dates'), 'window must close before the event');
select td_ea_settings(pg_temp.ev(), current_date - 10, (select starts_on - 1 from events where id = pg_temp.ev()), 3, 2);
reset role;
select pg_temp.ok(pg_temp.st('Axl Anhyzer Jr', 'rounds') = 2 and pg_temp.st('Axl Anhyzer Jr', 'round_tickets') = 2, 'earlier week has its own cap');

-- ---------- bonus tickets ----------
select pg_temp.claims('00000000-0000-4000-8000-0000000ea0a1', true); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select td_ea_bonus(%L, %L, 2, %L)', pg_temp.ev(), pg_temp.mem('Moe'), 'bug'), 'not_joined'), 'bonus only for joined players');
select pg_temp.ok(pg_temp.refused(format('select td_ea_bonus(%L, %L, 2, %L)', pg_temp.ev(), pg_temp.mem('Rex'), ' '), 'reason_required'), 'bonus needs a reason');
select td_ea_bonus(pg_temp.ev(), pg_temp.mem('Rex'), 2, 'Found the scorecard back-button bug');
select pg_temp.ok((td_ea_get(pg_temp.ev()) -> 'bonus' -> 0 ->> 'reason') like 'Found%', 'bonus logged with its reason');
reset role;
select pg_temp.ok(pg_temp.st('Rex', 'bonus') = 2, 'bonus adds to tickets');
select pg_temp.claims('00000000-0000-4000-8000-0000000ea0a1', true); set role authenticated;
select td_ea_bonus_void(pg_temp.q('select max(id) from ea_bonus')::bigint);
reset role;
select pg_temp.ok(pg_temp.st('Rex', 'bonus') = 0, 'voided bonus drops off');

-- ---------- what each audience sees ----------
set role anon;
select pg_temp.ok((select bool_and(not (x ? 'rounds') and not (x ? 'partners') and not (x ? 'member_id')) from jsonb_array_elements(ea_public('jewel-xi-2026') -> 'standings') x),
  'public standings show ticket totals only');
select pg_temp.ok((select (x -> 'me' ->> 'tickets')::int from jsonb_array_elements(ea_me(pg_temp.tok('Axl Anhyzer Jr'))) x where x ->> 'slug' = 'jewel-xi-2026')
  = pg_temp.st('Axl Anhyzer Jr', 'tickets'), 'My Tag shows my own breakdown');
reset role;

-- secret awards: Dee Skip climbs #3 -> #1
update tags set holder_id = case number when 1 then pg_temp.mem('Dee Skip') else pg_temp.mem('Axl Anhyzer Jr') end
 where pool_id = pg_temp.eapool() and number in (1, 3);
select pg_temp.claims('00000000-0000-4000-8000-0000000ea0a1', true); set role authenticated;
select pg_temp.ok((td_ea_get(pg_temp.ev()) -> 'awards' -> 'climb' -> 0 ->> 'name') = 'Dee Skip', 'biggest climb award');
select pg_temp.ok((td_ea_get(pg_temp.ev()) -> 'awards' -> 'iron' -> 0 ->> 'rounds')::int >= 2, 'iron bones award lists most rounds');
select pg_temp.ok((td_ea_get(pg_temp.ev()) -> 'awards' -> 'collector' -> 0 ->> 'partners')::int = 2, 'bone collector award lists partners');

-- ---------- the draw ----------
select pg_temp.ok(pg_temp.refused(format('select td_ea_draw(%L)', pg_temp.ev()), 'window_open'), 'no draw while the window is open');
reset role;
update early_access set opens_on = current_date - 20, closes_on = current_date - 1 where event_id = pg_temp.ev();
set role anon;
select pg_temp.ok(pg_temp.refused(format('select ea_claim(%L, %L, null)', 'jewel-xi-2026', pg_temp.pl('Lita Ford')), 'window_closed'), 'no claims after the window closes');
reset role;
-- rounds now sit after the closed window: put them inside it
update club_rounds set played_on = current_date - 2 where id in (pg_temp.v('r1')::uuid);
update club_rounds set played_on = current_date - 9 where id in (pg_temp.v('r4')::uuid);
select pg_temp.claims('00000000-0000-4000-8000-0000000ea0a1', true); set role authenticated;
select pg_temp.put('w1', td_ea_draw(pg_temp.ev()) ->> 'member_id');
select pg_temp.put('w2', td_ea_draw(pg_temp.ev()) ->> 'member_id');
select pg_temp.put('w3', td_ea_draw(pg_temp.ev()) ->> 'member_id');
select pg_temp.ok(pg_temp.v('w1') <> pg_temp.v('w2') and pg_temp.v('w2') <> pg_temp.v('w3') and pg_temp.v('w1') <> pg_temp.v('w3'), 'nobody wins twice');
select pg_temp.ok(pg_temp.refused(format('select td_ea_draw(%L)', pg_temp.ev()), 'nobody_left'), 'draw stops when everyone with tickets has won');
select td_ea_draw_void(pg_temp.q('select max(id) from ea_draws')::bigint);
select pg_temp.ok((td_ea_draw(pg_temp.ev()) ->> 'member_id') = pg_temp.v('w3'), 'voided winner goes back in the hat');
reset role;
set role anon;
select pg_temp.ok(jsonb_array_length(ea_public('jewel-xi-2026') -> 'winners') = 3, 'winners are public once drawn');
reset role;

-- ---------- remove a wrong link ----------
select pg_temp.claims('00000000-0000-4000-8000-0000000ea0a1', true); set role authenticated;
select td_ea_remove(pg_temp.q(format('select id from ea_claims where status = %L and member_id = %L', 'approved', pg_temp.mem('Rex')))::uuid);
select pg_temp.ok(jsonb_array_length(td_ea_get(pg_temp.ev()) -> 'linked') = 2, 'removed link drops off');
reset role;
select pg_temp.ok((select status from tags where pool_id = pg_temp.eapool() and number = 2) = 'available', 'removed player''s tag goes back as available');
select pg_temp.ok(pg_temp.st('Rex', 'tickets') is null, 'removed player has no standing');

-- ---------- turning it on for another event ----------
select pg_temp.claims('00000000-0000-4000-8000-0000000ea0a1', true); set role authenticated;
select td_ea_start((select id from events where slug = 'pad-open-2026-12-05'));
select pg_temp.ok((td_ea_get((select id from events where slug = 'pad-open-2026-12-05')) ->> 'closes_on')::date
  = (select starts_on - 1 from events where slug = 'pad-open-2026-12-05'), 'start: window closes the day before');
select pg_temp.ok(pg_temp.refused(format('select td_ea_start(%L)', (select id from events where slug = 'pad-open-2026-12-05')), 'already_on'), 'start once');
select pg_temp.ok(pg_temp.q('select invite_only from tag_pools p join early_access ea on ea.pool_id = p.id join events e on e.id = ea.event_id where e.slug = ''pad-open-2026-12-05''')::boolean, 'its tag set is invite only');
reset role;
select set_config('request.jwt.claims', '', false);
\echo PASSED 99zzzzzz_early_access
