-- Board replies (threads) + My Tag MY ROUNDS. Runs in a transaction, rolls back.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
begin;
create temp table q_ctx (k text primary key, v text) on commit drop;
grant all on q_ctx to anon, authenticated;
create or replace function pg_temp.v(key text) returns bigint language sql as $$ select v::bigint from q_ctx where k = key $$;
create or replace function pg_temp.pool() returns uuid language sql security definer as $$ select id from tag_pools where slug = 'reply-test' $$;
create or replace function pg_temp.pool2() returns uuid language sql security definer as $$ select id from tag_pools where slug = 'reply-test-2' $$;
create or replace function pg_temp.mem(n text) returns uuid language sql security definer as $$ select id from tag_members where name = n $$;
create or replace function pg_temp.tok(n text) returns text language sql security definer as $$ select token from tag_members where name = n $$;
create or replace function pg_temp.line(id bigint) returns jsonb language sql security definer as $$
  select l from jsonb_array_elements((tag_board_read(pg_temp.tok('Al Rep'), pg_temp.pool(), 0))->'lines') l where (l->>'id')::bigint = id $$;
grant execute on function pg_temp.v(text), pg_temp.pool(), pg_temp.pool2(), pg_temp.mem(text), pg_temp.tok(text), pg_temp.line(bigint) to anon, authenticated;
insert into tag_pools (slug, name, sort, chat) values ('reply-test', 'Reply Test', 97, true), ('reply-test-2', 'Reply Two', 98, true);
insert into tag_members (name, nickname) values ('Al Rep', null), ('Bo Rep', 'Bomber'), ('Cy Rep', null), ('Ex Rep', null);
insert into tags (pool_id, number, holder_id, status) values (pg_temp.pool(), 1, pg_temp.mem('Al Rep'), 'held'), (pg_temp.pool(), 2, pg_temp.mem('Bo Rep'), 'held'),
  (pg_temp.pool(), 3, pg_temp.mem('Cy Rep'), 'held'), (pg_temp.pool2(), 1, pg_temp.mem('Al Rep'), 'held');
select set_config('request.jwt.claims', '', false);
set client_min_messages = notice;

-- ---------- replies ----------
set role anon;
insert into q_ctx values ('q', tag_chat_post(pg_temp.tok('Bo Rep'), pg_temp.pool(), 'What time Sunday?')::text);
select pg_temp.ok(pg_temp.line(pg_temp.v('q'))->>'reply_to' is null, 'a plain post has no thread');
reset role; update tag_chat set at = now() - interval '1 minute' where member_id in (select id from tag_members where name like '% Rep'); set role anon;
insert into q_ctx values ('a1', tag_chat_post(pg_temp.tok('Al Rep'), pg_temp.pool(), '7:30 at Freestone', pg_temp.v('q'))::text);
select pg_temp.ok((pg_temp.line(pg_temp.v('a1'))->>'reply_to')::bigint = pg_temp.v('q'), 'a reply points at the message');
select pg_temp.ok(exists (select 1 from jsonb_array_elements(tag_mentions(pg_temp.tok('Bo Rep'))) m where (m->>'chat_id')::bigint = pg_temp.v('a1') and (m->>'reply')::boolean), 'the asker gets a reply ping in the bell');
insert into q_ctx values ('a2', tag_chat_post(pg_temp.tok('Cy Rep'), pg_temp.pool(), 'count me in @Al Rep', pg_temp.v('a1'))::text);
select pg_temp.ok((pg_temp.line(pg_temp.v('a2'))->>'reply_to')::bigint = pg_temp.v('q'), 'replying to a reply joins the same thread');
select pg_temp.ok(exists (select 1 from jsonb_array_elements(tag_mentions(pg_temp.tok('Al Rep'))) m where (m->>'chat_id')::bigint = pg_temp.v('a2') and not (m->>'reply')::boolean), 'an @ that is also a reply pings once, as an @');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(tag_mentions(pg_temp.tok('Bo Rep'))) m where (m->>'chat_id')::bigint = pg_temp.v('a2')), 'only the author of the message tapped gets the ping');
reset role; update tag_chat set at = now() - interval '1 minute' where member_id in (select id from tag_members where name like '% Rep'); set role anon;
insert into q_ctx values ('self', tag_chat_post(pg_temp.tok('Bo Rep'), pg_temp.pool(), 'cool', pg_temp.v('q'))::text);
reset role;
select pg_temp.ok(not exists (select 1 from tag_chat_mentions where chat_id = pg_temp.v('self')), 'no ping for replying to yourself');
insert into q_ctx select 'news', _tag_news(pg_temp.pool(), 'challenge', 'House post')::text;
update tag_chat set at = now() - interval '1 minute' where member_id in (select id from tag_members where name like '% Rep');
insert into q_ctx select 'other', _tag_news(pg_temp.pool2(), 'challenge', 'Other set')::text;
set role anon;
select pg_temp.ok(tag_chat_post(pg_temp.tok('Cy Rep'), pg_temp.pool(), 'lol', pg_temp.v('news')) > 0, 'house posts can start a thread');
select pg_temp.ok(pg_temp.refused(format('select tag_chat_post(%L, %L, %L, %s)', pg_temp.tok('Al Rep'), pg_temp.pool(), 'x', pg_temp.v('other')), 'reply_gone'), 'can''t reply across sets');
select pg_temp.ok(pg_temp.refused(format('select tag_chat_post(%L, %L, %L, %s)', pg_temp.tok('Al Rep'), pg_temp.pool(), 'x', 999999999), 'reply_gone'), 'can''t reply to nothing');
reset role;
update tag_chat set hidden = true where id = pg_temp.v('news');
update tag_chat set at = now() - interval '1 minute' where member_id in (select id from tag_members where name like '% Rep');
set role anon;
select pg_temp.ok(pg_temp.refused(format('select tag_chat_post(%L, %L, %L, %s)', pg_temp.tok('Al Rep'), pg_temp.pool(), 'x', pg_temp.v('news')), 'reply_gone'), 'can''t reply to a hidden message');
select pg_temp.ok(tag_chat_post(pg_temp.tok('Al Rep'), pg_temp.pool(), 'still works') > 0, 'old 3-argument posts still work');
-- an old thread outside the 150-line window still comes with its reply
reset role;
insert into tag_chat (pool_id, member_id, body, at) select pg_temp.pool(), pg_temp.mem('Cy Rep'), 'filler ' || i, now() - interval '1 hour' from generate_series(1, 160) i;
insert into tag_chat (pool_id, member_id, body, reply_to) values (pg_temp.pool(), pg_temp.mem('Al Rep'), 'late answer', pg_temp.v('q'));
insert into q_ctx select 'last', (max(id) - 1)::text from tag_chat;
set role anon;
select pg_temp.ok(pg_temp.line(pg_temp.v('q')) is not null and pg_temp.line(pg_temp.v('a1')) is null, 'a thread''s first message rides along past the 150-line window');
select pg_temp.ok((select count(*) from jsonb_array_elements((tag_board_read(pg_temp.tok('Al Rep'), pg_temp.pool(), pg_temp.v('last')))->'lines') l
  where (l->>'id')::bigint = pg_temp.v('q')) = 1, '...in incremental reads too');
reset role;

-- ---------- my rounds ----------
insert into club_rounds (course, played_on, pars, created_by) values ('Card Park', current_date - 1, '{3,3,4}', pg_temp.mem('Al Rep'));
insert into q_ctx select 'r1', null; update q_ctx set v = (select id::text from club_rounds where course = 'Card Park') where k = 'r1';
insert into club_round_players (round_id, seq, member_id, guest_name, scores, strokes, to_par, confirmed_at) values
  ((select id from club_rounds where course = 'Card Park'), 1, pg_temp.mem('Al Rep'), null, '{3,2,4}', 9, -1, now()),
  ((select id from club_rounds where course = 'Card Park'), 2, null, 'Guesty', '{4,4,5}', 13, 3, null),
  ((select id from club_rounds where course = 'Card Park'), 3, pg_temp.mem('Bo Rep'), null, '{3,3,4}', 10, 0, null);
insert into tag_matches (pool_id, source, status, course, played_on, round_id) values (pg_temp.pool(), 'casual', 'applied', 'Card Park', current_date - 1, (select id from club_rounds where course = 'Card Park'));
insert into tag_match_players (match_id, member_id, score, tag_before, tag_after) select id, pg_temp.mem('Al Rep'), 9, 2, 1 from tag_matches where course = 'Card Park';
insert into tag_match_players (match_id, member_id, score, tag_before, tag_after) select id, pg_temp.mem('Bo Rep'), 10, 1, 2 from tag_matches where course = 'Card Park';
insert into tag_matches (pool_id, source, status, course, played_on) values (pg_temp.pool(), 'casual', 'applied', 'Manual Park', current_date - 3), (pg_temp.pool(), 'casual', 'pending', 'Pending Park', current_date);
insert into tag_match_players (match_id, member_id, score, tag_before, tag_after) select id, pg_temp.mem('Al Rep'), 54, 1, 1 from tag_matches where course in ('Manual Park', 'Pending Park');
insert into tag_match_players (match_id, member_id, score, tag_before, tag_after) select id, pg_temp.mem('Cy Rep'), 58, 3, 3 from tag_matches where course in ('Manual Park', 'Pending Park');
insert into club_rounds (course, played_on, pars, created_by, status) values ('Void Park', current_date, '{3}', pg_temp.mem('Al Rep'), 'void');
insert into club_round_players (round_id, seq, member_id, scores, strokes, to_par) select id, 1, pg_temp.mem('Al Rep'), '{3}', 3, 0 from club_rounds where course = 'Void Park';
set role anon;
select pg_temp.ok((select jsonb_agg(r->>'course') from jsonb_array_elements(tag_my_rounds(pg_temp.tok('Al Rep'))->'rounds') r) = '["Card Park", "Manual Park"]'::jsonb,
  'my rounds: the saved card + the manual tag round, newest first (no void, no pending)');
select pg_temp.ok((select r->>'kind' = 'card' and jsonb_array_length(r->'players') = 3 and r->'pars' = '[3,3,4]'::jsonb
  and r->'players'->0->>'name' = 'Al Rep' and r->'players'->0->'scores' = '[3,2,4]'::jsonb and (r->'players'->1->>'guest') = 'false'
  and r->'players'->2->>'name' = 'Guesty' and (r->'players'->2->>'guest')::boolean
  from jsonb_array_elements(tag_my_rounds(pg_temp.tok('Al Rep'))->'rounds') r where r->>'course' = 'Card Park'), 'the full card: pars, everyone''s holes, guests, best first');
select pg_temp.ok((select r->'tags' = '[{"pool_name": "Reply Test", "status": "applied", "before": 2, "after": 1}]'::jsonb
  from jsonb_array_elements(tag_my_rounds(pg_temp.tok('Al Rep'))->'rounds') r where r->>'course' = 'Card Park'), '...with my tag move on it');
select pg_temp.ok((select r->>'kind' = 'tag' and r->>'pool_name' = 'Reply Test' and jsonb_array_length(r->'players') = 2 and (r->'players'->0->>'score')::int = 54
  from jsonb_array_elements(tag_my_rounds(pg_temp.tok('Al Rep'))->'rounds') r where r->>'course' = 'Manual Park'), 'manual tag rounds: totals + tags');
select pg_temp.ok(jsonb_array_length(tag_my_rounds(pg_temp.tok('Cy Rep'))->'rounds') = 1 and jsonb_array_length(tag_my_rounds(pg_temp.tok('Ex Rep'))->'rounds') = 0, 'only rounds you played');
select pg_temp.ok(jsonb_array_length(tag_my_rounds(pg_temp.tok('Al Rep'), 1)->'rounds') = 1 and not (tag_my_rounds(pg_temp.tok('Al Rep'))->>'more')::boolean, 'pages');
select pg_temp.ok(pg_temp.refused('select tag_my_rounds(''nope'')', 'invalid_link'), 'needs a real My Tag link');
reset role;
-- paging past 25
insert into tag_matches (pool_id, source, status, course, played_on) select pg_temp.pool(), 'casual', 'applied', 'Bulk ' || i, current_date - 10 - i from generate_series(1, 30) i;
insert into tag_match_players (match_id, member_id, score) select id, pg_temp.mem('Al Rep'), 50 from tag_matches where course like 'Bulk %';
set role anon;
select pg_temp.ok(jsonb_array_length(tag_my_rounds(pg_temp.tok('Al Rep'))->'rounds') = 25 and (tag_my_rounds(pg_temp.tok('Al Rep'))->>'more')::boolean
  and jsonb_array_length(tag_my_rounds(pg_temp.tok('Al Rep'), 25)->'rounds') = 7 and not (tag_my_rounds(pg_temp.tok('Al Rep'), 25)->>'more')::boolean, '25 a page, then the rest');
reset role;
rollback;
