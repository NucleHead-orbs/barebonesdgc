-- Phone alerts: subscriptions, prefs, every producer, the sender's claim/report loop. Runs in a transaction, rolls back.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
begin;
create or replace function pg_temp.pool() returns uuid language sql security definer as $$ select id from tag_pools where slug = 'push-test' $$;
create or replace function pg_temp.mem(n text) returns uuid language sql security definer as $$ select id from tag_members where name = n $$;
create or replace function pg_temp.tok(n text) returns text language sql security definer as $$ select token from tag_members where name = n $$;
create or replace function pg_temp.q(n text, k text) returns int language sql security definer as $$ select count(*)::int from tag_push_queue where member_id = pg_temp.mem(n) and kind = k $$;
create or replace function pg_temp.last(n text, k text) returns tag_push_queue language sql security definer as $$ select * from tag_push_queue where member_id = pg_temp.mem(n) and kind = k order by id desc limit 1 $$;
grant execute on function pg_temp.pool(), pg_temp.mem(text), pg_temp.tok(text), pg_temp.q(text, text), pg_temp.last(text, text) to anon, authenticated;
insert into tag_pools (slug, name, sort, chat, challenges, bombs) values ('push-test', 'Push Test', 99, true, true, true);
insert into tag_members (name) values ('Al Push'), ('Bo Push'), ('Cy Push'), ('No Phone');
insert into tags (pool_id, number, holder_id, status) values (pg_temp.pool(), 1, pg_temp.mem('Al Push'), 'held'), (pg_temp.pool(), 2, pg_temp.mem('Bo Push'), 'held'),
  (pg_temp.pool(), 3, pg_temp.mem('Cy Push'), 'held'), (pg_temp.pool(), 4, pg_temp.mem('No Phone'), 'held');
insert into courses (name) values ('Push Park');
select set_config('request.jwt.claims', '', false);
set client_min_messages = notice;

-- ---------- subscribe / prefs ----------
set role anon;
select pg_temp.ok(pg_temp.refused(format('select tag_push_subscribe(%L, %L, %L, %L, null)', pg_temp.tok('Al Push'), 'http://evil', repeat('k', 40), 'authauth1'), 'invalid_subscription'), 'endpoints are https');
select pg_temp.ok(pg_temp.refused(format('select tag_push_test(%L)', pg_temp.tok('Al Push')), 'no_phone'), 'a test needs a phone first');
select tag_push_subscribe(pg_temp.tok(n), 'https://push.example/' || n, repeat('k', 40), 'authauth1', 'test') from unnest(array['Al Push', 'Bo Push', 'Cy Push']) n;
select pg_temp.ok((tag_push_status(pg_temp.tok('Al Push'), 'https://push.example/Al Push')->>'device')::boolean
  and (tag_push_status(pg_temp.tok('Al Push'), 'https://push.example/other')->>'device') = 'false'
  and (tag_push_status(pg_temp.tok('Al Push'), null)->>'devices')::int = 1, 'status: this phone + phone count');
select tag_push_subscribe(pg_temp.tok('Bo Push'), 'https://push.example/shared', repeat('k', 40), 'authauth1', null);
select tag_push_subscribe(pg_temp.tok('Cy Push'), 'https://push.example/shared', repeat('k', 40), 'authauth1', null);
select pg_temp.ok((tag_push_status(pg_temp.tok('Bo Push'), null)->>'devices')::int = 1 and (tag_push_status(pg_temp.tok('Cy Push'), null)->>'devices')::int = 2, 'a phone belongs to the latest link');
select tag_push_unsubscribe(pg_temp.tok('Cy Push'), 'https://push.example/shared');
select pg_temp.ok(pg_temp.refused(format('select tag_push_prefs(%L, %L)', pg_temp.tok('Al Push'), '{nope}'), 'invalid_kind'), 'only real kinds');
select tag_push_prefs(pg_temp.tok('Cy Push'), '{mention,mention}');
select pg_temp.ok(tag_push_status(pg_temp.tok('Cy Push'), null)->'off' = '["mention"]'::jsonb, 'prefs saved (deduped)');
select pg_temp.ok(tag_push_test(pg_temp.tok('Al Push')) and not tag_push_test(pg_temp.tok('Al Push')), 'test: once a minute');
reset role;
select pg_temp.ok((pg_temp.last('Al Push', 'test')).url = '/tag/' || pg_temp.tok('Al Push'), 'alerts link to the player''s own My Tag');

-- ---------- challenges ----------
insert into tag_challenges (pool_id, challenger_id, challenged_id, from_number, to_number) values (pg_temp.pool(), pg_temp.mem('Bo Push'), pg_temp.mem('Al Push'), 2, 1);
select pg_temp.ok(pg_temp.q('Al Push', 'challenge') = 1 and (pg_temp.last('Al Push', 'challenge')).body like 'Bo Push (#2) challenged you for #1.%', 'challenged: pinged');
update tag_challenges set status = 'accepted', responded_at = now(), due_at = now() + interval '7 days' where challenger_id = pg_temp.mem('Bo Push');
select pg_temp.ok(pg_temp.q('Bo Push', 'answer') = 1 and (pg_temp.last('Bo Push', 'answer')).title like 'Challenge accepted%', 'challenger hears the answer');
update tag_challenges set tee_at = now() + interval '1 day', course_id = (select id from courses where name = 'Push Park'), slot_by = pg_temp.mem('Al Push') where challenger_id = pg_temp.mem('Bo Push');
select pg_temp.ok(pg_temp.q('Bo Push', 'slot') = 1 and pg_temp.q('Al Push', 'slot') = 0 and (pg_temp.last('Bo Push', 'slot')).body like 'Al Push (#1) picked %at Push Park. OK it%', 'a proposed time goes to the other player');
update tag_challenges set locked_at = now() where challenger_id = pg_temp.mem('Bo Push');
select pg_temp.ok(pg_temp.q('Al Push', 'slot') = 1 and (pg_temp.last('Al Push', 'slot')).title like 'Locked in%', 'locked: the picker hears it');
update tag_challenges set locked_at = now() + interval '1 second' where challenger_id = pg_temp.mem('Bo Push');
select pg_temp.ok(pg_temp.q('Al Push', 'slot') = 1 and pg_temp.q('Bo Push', 'slot') = 1, 'no repeats on unrelated updates');
insert into tag_challenges (pool_id, challenger_id, challenged_id, status) values (pg_temp.pool(), pg_temp.mem('Cy Push'), pg_temp.mem('No Phone'), 'open');
select pg_temp.ok(not exists (select 1 from tag_push_queue where member_id = pg_temp.mem('No Phone')), 'no phone, no queue rows');
update tag_challenges set status = 'expired' where challenger_id = pg_temp.mem('Cy Push');
select pg_temp.ok((pg_temp.last('Cy Push', 'answer')).body like '%didn''t answer in 48 hours%', 'silence counts as a decline (and says so)');

-- ---------- mentions / replies ----------
set role anon;
select tag_chat_post(pg_temp.tok('Bo Push'), pg_temp.pool(), 'hey @Al Push and @Cy Push');
reset role;
select pg_temp.ok(pg_temp.q('Al Push', 'mention') = 1 and (pg_temp.last('Al Push', 'mention')).title = 'Bo Push mentioned you · Push Test'
  and (pg_temp.last('Al Push', 'mention')).url like '/tag/%?tab=board&pool=push-test&chat=%', '@mention: pinged, deep link to the message');
select pg_temp.ok(pg_temp.q('Cy Push', 'mention') = 0, 'switched-off kinds are skipped');
update tag_chat set at = now() - interval '1 minute';
create temp table p_ctx as select max(id) v from tag_chat where body like 'hey @%';
grant select on p_ctx to anon;
set role anon;
select tag_chat_post(pg_temp.tok('Al Push'), pg_temp.pool(), 'sup', (select v from p_ctx));
reset role;
select pg_temp.ok((pg_temp.last('Bo Push', 'mention')).title = 'Al Push replied to you · Push Test', 'replies say replied');

-- ---------- invites ----------
set role anon;
select tag_casual_create(pg_temp.tok('Al Push'), pg_temp.pool(), now() + interval '1 day', (select id from courses where name = 'Push Park'), array[pg_temp.mem('Bo Push')], 'tacos');
reset role;
select pg_temp.ok(pg_temp.q('Bo Push', 'invite') = 1 and pg_temp.q('Al Push', 'invite') = 0 and (pg_temp.last('Bo Push', 'invite')).body like '%at Push Park.%"tacos"', 'invited: pinged (not the host)');

-- ---------- confirms ----------
set role anon;
select tag_log(pg_temp.tok('Al Push'), pg_temp.pool(), jsonb_build_array(jsonb_build_object('member_id', pg_temp.mem('Al Push'), 'score', 50), jsonb_build_object('member_id', pg_temp.mem('Bo Push'), 'score', 52)), 'Push Park', current_date);
reset role;
select pg_temp.ok(pg_temp.q('Bo Push', 'confirm') = 1 and pg_temp.q('Al Push', 'confirm') = 0, 'manual tag round: the others confirm');
insert into club_rounds (course, played_on, pars, created_by) values ('Card Push', current_date, '{3}', pg_temp.mem('Al Push'));
insert into club_round_players (round_id, seq, member_id, scores, strokes, to_par, confirmed_at) select id, 1, pg_temp.mem('Al Push'), '{3}', 3, 0, now() from club_rounds where course = 'Card Push';
insert into club_round_players (round_id, seq, member_id, scores, strokes, to_par) select id, 2, pg_temp.mem('Bo Push'), '{4}', 4, 1 from club_rounds where course = 'Card Push';
select pg_temp.ok(pg_temp.q('Bo Push', 'confirm') = 2 and (pg_temp.last('Bo Push', 'confirm')).url like '/tag/%?tab=rounds&round=%', 'Scorecard round: confirm opens MY ROUNDS on My Tag');

-- ---------- fuse sweep ----------
insert into tag_fuse (pool_id, member_id, top_since) values (pg_temp.pool(), pg_temp.mem('Cy Push'), now() - interval '6 days 2 hours');
update tag_pools set bombs_since = now() - interval '30 days' where id = pg_temp.pool();
create or replace function pg_temp.sweep() returns void language plpgsql as $$
declare f record; begin
  -- same as the 15-minute branch of _tag_push_tick, minus the clock
  for f in select t.pool_id, t.member_id, public._tag_active_at(t.pool_id, t.member_id) + interval '7 days' fuse_at from tag_fuse t where t.pool_id = pg_temp.pool() loop
    if f.fuse_at > now() and f.fuse_at <= now() + interval '24 hours' then
      perform public._tag_push(f.member_id, 'fuse', f.pool_id || ':' || to_char(f.fuse_at, 'YYYYMMDDHH24MI'), 'x', 'y', '');
    end if;
  end loop; end $$;
select pg_temp.sweep(); select pg_temp.sweep();
select pg_temp.ok(pg_temp.q('Cy Push', 'fuse') = 1, 'fuse under 24 hours: one alert, no repeats');
select _tag_push_tick();
select pg_temp.ok(true, 'the cron tick runs clean without pg_net / Vault');

-- ---------- sender loop ----------
select pg_temp.ok(jsonb_array_length(tag_push_claim()) = (select count(*) from tag_push_queue where sent_at is null)::int, 'claim takes what''s waiting');
select pg_temp.ok(tag_push_claim() = '[]'::jsonb, '...and holds it from a second run');
select tag_push_report((select array_agg(id) from tag_push_queue where member_id = pg_temp.mem('Al Push')),
  jsonb_build_object((select min(id) from tag_push_queue where member_id = pg_temp.mem('Bo Push'))::text, 'boom'),
  array['https://push.example/Al Push'], array['https://push.example/shared']);
select pg_temp.ok(not exists (select 1 from tag_push_queue where member_id = pg_temp.mem('Al Push') and sent_at is null), 'reported sent');
select pg_temp.ok((select error = 'boom' and claimed_at is null from tag_push_queue where id = (select min(id) from tag_push_queue where member_id = pg_temp.mem('Bo Push'))), 'failures go back for a retry');
select pg_temp.ok(not exists (select 1 from tag_push_subs where endpoint = 'https://push.example/shared') and (select last_ok_at is not null from tag_push_subs where endpoint = 'https://push.example/Al Push'), 'dead phones are dropped, good ones stamped');
set role anon;
select pg_temp.ok(pg_temp.refused('select tag_push_claim()', 'permission denied'), 'the sender functions aren''t public');
select pg_temp.ok(pg_temp.refused('select tag_push_config()', 'permission denied'), '...nor the keys');
reset role;
rollback;
