-- Design votes acceptance tests. Run after stub + all migrations.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create temp table v_ctx (k text primary key, v text);
grant all on v_ctx to anon, authenticated;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.claims(sub text, email text, admin boolean) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', sub, 'email', email, 'app_metadata', case when admin then '{"role":"td"}'::json else '{}'::json end)::text, false) $$;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from v_ctx where k = key $$;
grant execute on function pg_temp.v(text) to anon, authenticated;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000a6', 'v-boss@vt.test', now()),
  ('00000000-0000-4000-8000-0000000000b6', 'v-td@vt.test', now()),
  ('00000000-0000-4000-8000-0000000000c6', 'v-other@vt.test', now())
on conflict do nothing;

select pg_temp.claims('00000000-0000-4000-8000-0000000000a6', 'v-boss@vt.test', true); set role authenticated;
insert into v_ctx select 'ev', td_create_event('Vote Weekend', 'Club', '2026-11-21', '2026-11-22', null, 9, '[{"code":"MA1"}]')->>'id';
insert into v_ctx select 'evB', td_create_event('Other Vote', 'Club', '2026-11-21', '2026-11-21', null, 9, '[{"code":"MA1"}]')->>'id';
insert into event_tds (event_id, email) select v::uuid, 'v-td@vt.test' from v_ctx where k = 'ev';
insert into event_tds (event_id, email) select v::uuid, 'v-other@vt.test' from v_ctx where k = 'evB';
reset role;
set client_min_messages = notice;

-- TD builds the ballot: three trophy designs, one hidden from the crew design board
select pg_temp.claims('00000000-0000-4000-8000-0000000000b6', 'v-td@vt.test', false); set role authenticated;
with x as (insert into design_assets (event_id, category, title) values (pg_temp.v('ev')::uuid, 'trophies', 'The Horns') returning id) insert into v_ctx select 'horns', id::text from x;
with x as (insert into design_assets (event_id, category, title) values (pg_temp.v('ev')::uuid, 'trophies', 'The Jewel Skull') returning id) insert into v_ctx select 'skull', id::text from x;
with x as (insert into design_assets (event_id, category, title) values (pg_temp.v('ev')::uuid, 'trophies', 'Turn It to 11') returning id) insert into v_ctx select 'amp', id::text from x;
with x as (insert into design_files (asset_id, version, path, file_name, mime) values (pg_temp.v('horns')::uuid, 1, pg_temp.v('ev') || '/trophies/horns-v1.jpg', 'horns.jpg', 'image/jpeg') returning id) insert into v_ctx select 'hornsFile', id::text from x;
select pg_temp.ok(true, 'trophies is a design category');
with x as (insert into design_polls (event_id, title, question, created_by) values (pg_temp.v('ev')::uuid, '1st place trophy', 'Which one wins?', 'v-td@vt.test') returning id) insert into v_ctx select 'poll', id::text from x;
with x as (insert into design_poll_options (poll_id, asset_id, sort) values (pg_temp.v('poll')::uuid, pg_temp.v('horns')::uuid, 0) returning id) insert into v_ctx select 'oHorns', id::text from x;
with x as (insert into design_poll_options (poll_id, asset_id, sort) values (pg_temp.v('poll')::uuid, pg_temp.v('skull')::uuid, 1) returning id) insert into v_ctx select 'oSkull', id::text from x;
with x as (insert into design_poll_options (poll_id, asset_id, sort) values (pg_temp.v('poll')::uuid, pg_temp.v('amp')::uuid, 2) returning id) insert into v_ctx select 'oAmp', id::text from x;
-- an empty poll (no options) stays off the crew ballot
insert into design_polls (event_id, title) values (pg_temp.v('ev')::uuid, 'Empty draft');
select pg_temp.ok(pg_temp.refused(format('insert into design_poll_options (poll_id, asset_id) values (%L, %L)', pg_temp.v('poll'), pg_temp.v('horns')), 'duplicate'), 'a design is on a ballot once');
with x as (insert into crew (event_id, name, roles) values (pg_temp.v('ev')::uuid, 'Amy', '{}') returning id) insert into v_ctx select 'amy', id::text from x;
with x as (insert into crew (event_id, name, roles) values (pg_temp.v('ev')::uuid, 'Bo', '{}') returning id) insert into v_ctx select 'bo', id::text from x;
reset role;
insert into v_ctx select 'tokA', token from crew where id = pg_temp.v('amy')::uuid;
insert into v_ctx select 'tokB', token from crew where id = pg_temp.v('bo')::uuid;

-- the other event's TD: no access, no cross-event ballot
select pg_temp.claims('00000000-0000-4000-8000-0000000000c6', 'v-other@vt.test', false); set role authenticated;
with x as (insert into design_assets (event_id, category, title) values (pg_temp.v('evB')::uuid, 'trophies', 'Foreign trophy') returning id) insert into v_ctx select 'foreign', id::text from x;
with x as (insert into crew (event_id, name, roles) values (pg_temp.v('evB')::uuid, 'Zed', '{}') returning id) insert into v_ctx select 'zed', id::text from x;
select pg_temp.ok((select count(*) = 0 from design_polls where event_id = pg_temp.v('ev')::uuid), 'other event''s TD sees no polls');
select pg_temp.ok(pg_temp.refused(format('select td_vote(%L, %L)', pg_temp.v('poll'), pg_temp.v('oHorns')), 'not_found'), 'other event''s TD cannot vote');
reset role;
insert into v_ctx select 'tokZ', token from crew where id = pg_temp.v('zed')::uuid;
select pg_temp.ok(pg_temp.refused(format('insert into design_poll_options (poll_id, asset_id) values (%L, %L)', pg_temp.v('poll'), pg_temp.v('foreign')), 'wrong_event'),
  'another event''s design can''t go on the ballot');

-- crew: ballot before voting has no totals
set role anon;
select pg_temp.ok(jsonb_array_length(crew_polls(pg_temp.v('tokA'))) = 1, 'crew see the one poll with a ballot');
select pg_temp.ok((select jsonb_array_length(p -> 'options') = 3 and p -> 'mine' = 'null'::jsonb and p -> 'total' = 'null'::jsonb
  and (select bool_and(o -> 'votes' = 'null'::jsonb) from jsonb_array_elements(p -> 'options') o)
  from jsonb_array_elements(crew_polls(pg_temp.v('tokA'))) p), 'before voting: 3 options, no totals');
select pg_temp.ok((select (p -> 'options' -> 0 -> 'file' ->> 'mime') = 'image/jpeg' from jsonb_array_elements(crew_polls(pg_temp.v('tokA'))) p), 'options carry their latest file');
select pg_temp.ok(not (crew_polls(pg_temp.v('tokA'))::text like '%horns-v1.jpg%'), 'storage paths never leave crew_polls');
select pg_temp.ok((crew_design_file(pg_temp.v('tokA'), pg_temp.v('hornsFile')::uuid) ->> 'file_name') = 'horns.jpg', 'a ballot design can be opened by the crew even when not crew_visible');
select pg_temp.ok(pg_temp.refused(format('select crew_design_file(%L, %L)', pg_temp.v('tokZ'), pg_temp.v('hornsFile')), 'not_found'), 'another event''s crew cannot open it');
select pg_temp.ok(jsonb_array_length(crew_polls(pg_temp.v('tokZ'))) = 0, 'another event''s crew see no polls');
select pg_temp.ok(pg_temp.refused(format('select crew_vote(%L, %L, %L)', pg_temp.v('tokZ'), pg_temp.v('poll'), pg_temp.v('oHorns')), 'not_found'), 'another event''s crew cannot vote');
select pg_temp.ok(pg_temp.refused(format('select crew_vote(%L, %L, %L)', 'nope-nope-nope-nope-nope', pg_temp.v('poll'), pg_temp.v('oHorns')), 'invalid_link'), 'bad link refused');

-- Amy votes Skull, then sees totals
select pg_temp.ok((select (r -> 'mine' ->> 'option_id') = pg_temp.v('oSkull') and (r ->> 'total')::int = 1
   from (select crew_vote(pg_temp.v('tokA'), pg_temp.v('poll')::uuid, pg_temp.v('oSkull')::uuid, '  the gem glows  ') r) x), 'crew vote returns their pick + totals');
select pg_temp.ok((select (p -> 'mine' ->> 'comment') = 'the gem glows' from jsonb_array_elements(crew_polls(pg_temp.v('tokA'))) p), 'comment trimmed and kept');
select pg_temp.ok((select p -> 'total' = 'null'::jsonb from jsonb_array_elements(crew_polls(pg_temp.v('tokB'))) p), 'Bo has not voted: still no totals for him');
select pg_temp.ok(pg_temp.refused(format('select crew_vote(%L, %L, %L)', pg_temp.v('tokB'), pg_temp.v('poll'), gen_random_uuid()), 'not_an_option'), 'pick must be on the ballot');
select pg_temp.ok(pg_temp.refused(format('select crew_vote(%L, %L, %L, %L)', pg_temp.v('tokB'), pg_temp.v('poll'), pg_temp.v('oHorns'), repeat('x', 281)), 'comment_too_long'), 'comment capped at 280');
select crew_vote(pg_temp.v('tokB'), pg_temp.v('poll')::uuid, pg_temp.v('oHorns')::uuid, null);
-- Amy changes her mind: still one vote
select crew_vote(pg_temp.v('tokA'), pg_temp.v('poll')::uuid, pg_temp.v('oHorns')::uuid, '');
select pg_temp.ok((select (p ->> 'total')::int = 2 and (p -> 'mine' -> 'comment') = 'null'::jsonb
  and (select (o ->> 'votes')::int from jsonb_array_elements(p -> 'options') o where o ->> 'id' = pg_temp.v('oHorns')) = 2
  from jsonb_array_elements(crew_polls(pg_temp.v('tokA'))) p), 'changing a vote replaces it (one vote per person)');
select pg_temp.ok(not (crew_polls(pg_temp.v('tokA'))::text like '%Bo%'), 'crew never see who voted for what');
select pg_temp.ok(pg_temp.refused('select * from design_poll_votes', 'permission denied'), 'anon cannot read votes');
select pg_temp.ok(pg_temp.refused(format('select td_vote(%L, %L)', pg_temp.v('poll'), pg_temp.v('oHorns')), 'permission denied'), 'anon cannot td_vote');
reset role;

-- TD votes + sees names; can't write votes directly
select pg_temp.claims('00000000-0000-4000-8000-0000000000b6', 'v-td@vt.test', false); set role authenticated;
select pg_temp.ok((select (r ->> 'total')::int = 3 from (select td_vote(pg_temp.v('poll')::uuid, pg_temp.v('oAmp')::uuid, 'Turn it up') r) x), 'TD votes too');
select td_vote(pg_temp.v('poll')::uuid, pg_temp.v('oSkull')::uuid, 'changed');
select pg_temp.ok((select count(*) = 3 from design_poll_votes where poll_id = pg_temp.v('poll')::uuid), 'TD sees every vote (3)');
select pg_temp.ok((select td_email = 'v-td@vt.test' and comment = 'changed' from design_poll_votes where td_email is not null), 'TD vote is tied to their email and changeable');
select pg_temp.ok((select count(*) = 2 from design_poll_votes v join crew c on c.id = v.crew_id where c.name in ('Amy', 'Bo')), 'TD can see which crew member voted');
select pg_temp.ok(pg_temp.refused(format('insert into design_poll_votes (poll_id, option_id, td_email) values (%L, %L, ''x@y.z'')', pg_temp.v('poll'), pg_temp.v('oAmp')), 'permission denied'), 'no direct vote writes');
select pg_temp.ok(pg_temp.refused(format('delete from design_poll_options where id = %L', pg_temp.v('oHorns')), 'foreign key'), 'an option with votes can''t be removed');
delete from design_poll_options where id = pg_temp.v('oAmp')::uuid;
select pg_temp.ok((select count(*) = 2 from design_poll_options where poll_id = pg_temp.v('poll')::uuid), 'an option with no votes can be removed');
select pg_temp.ok(pg_temp.refused(format('update design_polls set winner_option_id = %L where id = %L', gen_random_uuid(), pg_temp.v('poll')), 'winner_not_an_option'), 'winner must be on the ballot');
update design_polls set closed_at = now(), winner_option_id = pg_temp.v('oHorns')::uuid where id = pg_temp.v('poll')::uuid;
select pg_temp.ok(pg_temp.refused(format('select td_vote(%L, %L)', pg_temp.v('poll'), pg_temp.v('oHorns')), 'poll_closed'), 'closed poll refuses TD votes');
reset role;

-- closed: no more votes, everyone sees totals + winner
set role anon;
select pg_temp.ok(pg_temp.refused(format('select crew_vote(%L, %L, %L)', pg_temp.v('tokB'), pg_temp.v('poll'), pg_temp.v('oSkull')), 'poll_closed'), 'closed poll refuses crew votes');
reset role;
with x as (insert into crew (event_id, name, roles) values (pg_temp.v('ev')::uuid, 'Cy', '{}') returning token) insert into v_ctx select 'tokC', token from x;
set role anon;
select pg_temp.ok((select (p ->> 'open')::boolean = false and (p ->> 'total')::int = 3 and p ->> 'winner_option_id' = pg_temp.v('oHorns')
  from jsonb_array_elements(crew_polls(pg_temp.v('tokC'))) p), 'after close, a non-voter sees totals + winner');
reset role;

-- closes_at in the past also closes it; reopening works
update design_polls set closed_at = null, closes_at = now() - interval '1 minute' where id = pg_temp.v('poll')::uuid;
set role anon;
select pg_temp.ok(pg_temp.refused(format('select crew_vote(%L, %L, %L)', pg_temp.v('tokB'), pg_temp.v('poll'), pg_temp.v('oSkull')), 'poll_closed'), 'a passed deadline closes voting');
reset role;
update design_polls set closes_at = now() + interval '1 day' where id = pg_temp.v('poll')::uuid;
set role anon;
select pg_temp.ok((select (r -> 'mine' ->> 'option_id') = pg_temp.v('oSkull') from (select crew_vote(pg_temp.v('tokB'), pg_temp.v('poll')::uuid, pg_temp.v('oSkull')::uuid) r) x), 'reopened: votes change again');
select pg_temp.ok((select p -> 'winner_option_id' = 'null'::jsonb from jsonb_array_elements(crew_polls(pg_temp.v('tokB'))) p), 'winner hidden while open');
reset role;

-- revoked link can't vote; deleting the poll removes its votes
update crew set revoked_at = now() where id = pg_temp.v('amy')::uuid;
set role anon;
select pg_temp.ok(pg_temp.refused(format('select crew_vote(%L, %L, %L)', pg_temp.v('tokA'), pg_temp.v('poll'), pg_temp.v('oSkull')), 'invalid_link'), 'revoked link cannot vote');
reset role;
select pg_temp.claims('00000000-0000-4000-8000-0000000000b6', 'v-td@vt.test', false); set role authenticated;
delete from design_polls where id = pg_temp.v('poll')::uuid;
reset role;
select pg_temp.ok((select count(*) = 0 from design_poll_votes where poll_id = pg_temp.v('poll')::uuid), 'deleting a poll removes its votes');
select pg_temp.ok((select count(*) = 3 from design_assets where category = 'trophies' and event_id = pg_temp.v('ev')::uuid), 'deleting a poll keeps the designs');
