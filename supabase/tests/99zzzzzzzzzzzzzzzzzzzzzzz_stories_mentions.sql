-- Round stories (SETTLED / RESULTS posts) + @mentions. Run after stub + all migrations.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.pool(s text default 'story-test') returns uuid language sql as $$ select id from tag_pools where slug = s $$;
create or replace function pg_temp.mem(n text) returns uuid language sql as $$ select id from tag_members where name = n $$;
create or replace function pg_temp.tok(n text) returns text language sql security definer as $$ select token from tag_members where name = n $$;
grant execute on function pg_temp.pool(text), pg_temp.mem(text), pg_temp.tok(text) to anon, authenticated;
create temp table s_ctx (k text primary key, v text);
grant all on s_ctx to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from s_ctx where k = key $$;
grant execute on function pg_temp.v(text) to anon, authenticated;
/** A tag round straight from the Scorecard's tables: players (name, hole scores) in seat order, applied. */
create or replace function pg_temp.round(p_pool uuid, p_course text, p_pars int[], p_players text[], p_scores int[][]) returns uuid language plpgsql as $$
declare rid uuid; mid uuid; i int;
begin
  insert into club_rounds (course, played_on, pars, created_by) values (p_course, current_date, p_pars::smallint[], pg_temp.mem(p_players[1])) returning id into rid;
  insert into tag_matches (pool_id, source, course, round_id, created_by) values (p_pool, 'casual', p_course, rid, pg_temp.mem(p_players[1])) returning id into mid;
  for i in 1 .. cardinality(p_players) loop
    insert into club_round_players (round_id, seq, member_id, scores, strokes, to_par)
    values (rid, i, pg_temp.mem(p_players[i]), (select array_agg(x::smallint order by o) from unnest(p_scores[i:i]) with ordinality u(x, o)),
            (select sum(x) from unnest(p_scores[i:i]) x), (select sum(x) from unnest(p_scores[i:i]) x) - (select sum(x) from unnest(p_pars) x));
    insert into tag_match_players (match_id, member_id, score) values (mid, pg_temp.mem(p_players[i]), (select sum(x) from unnest(p_scores[i:i]) x));
  end loop;
  perform _tag_apply(mid);
  return mid;
end $$;

insert into tag_pools (slug, name, sort, chat, challenges) values ('story-test', 'Story Test', 96, true, true), ('story-quiet', 'Story Quiet', 95, false, true);
insert into tag_members (name, nickname) values ('Al Story', null), ('Bo Story', 'Bomber'), ('Cy Story', null), ('Danny Story', null), ('Danny Story Walden', null), ('Ed Story', null), ('Out Story', null);
insert into tags (pool_id, number, holder_id, status, issued_at)
select pg_temp.pool(), i, pg_temp.mem(n), 'held', now() - interval '20 days'
  from unnest(array['Al Story', 'Bo Story', 'Cy Story', 'Danny Story', 'Danny Story Walden', 'Ed Story']) with ordinality as x(n, i);
insert into tags (pool_id, number, holder_id, status) values (pg_temp.pool('story-quiet'), 1, pg_temp.mem('Al Story'), 'held'), (pg_temp.pool('story-quiet'), 2, pg_temp.mem('Bo Story'), 'held');
set client_min_messages = notice;

-- ---------- the engine ----------
select pg_temp.ok(_bb_pick('x', array['a', 'b', 'c']) = _bb_pick('x', array['a', 'b', 'c']) and _bb_pick('y', array['only']) = 'only', 'a pick is stable and always lands in the bank');
select pg_temp.ok(_bb_fill('{w} by {m}', array['w', 'm'], array['Al', '3']) = 'Al by 3', 'placeholders fill');

-- ---------- RESULTS: a Scorecard round (no challenge) ----------
-- 9 holes, par 27. Cy (#3): ace on 2, birdies on 3, 4, 5, bogey-free = 22. Al (#1): 30 with an 8 on hole 7.
insert into s_ctx select 'r1', pg_temp.round(pg_temp.pool(), 'Story Park', array[3,3,3,3,3,3,3,3,3], array['Al Story', 'Cy Story'],
  array[[3,3,3,3,3,3,8,2,2], [3,1,2,2,2,3,3,3,3]])::text;
select pg_temp.ok((select count(*) = 1 from tag_chat where pool_id = pg_temp.pool() and event = 'result'), 'an applied tag round posts RESULTS');
select pg_temp.ok((select body like 'Tag round at Story Park: Cy Story 22, Al Story 30. %' from tag_chat where pool_id = pg_temp.pool() and event = 'result'), 'scores lead, best first');
select pg_temp.ok((select body ~ '(by 8\.|8 strokes)' from tag_chat where pool_id = pg_temp.pool() and event = 'result'), 'blowout margin (8)');
select pg_temp.ok((select body ~ 'ACE' and body ~ 'hole 2' from tag_chat where pool_id = pg_temp.pool() and event = 'result'), 'the ace makes it in');
select pg_temp.ok((select body ~ 'birdies' and body ~ '\m3\M' from tag_chat where pool_id = pg_temp.pool() and event = 'result'), 'birdie leader (3)');
select pg_temp.ok((select body ~ 'Al Story (took|carded) an 8 on hole 7' from tag_chat where pool_id = pg_temp.pool() and event = 'result'), 'the blow-up hole gets called out');
select pg_temp.ok((select body like '%Cy Story climbs from #3 to #1.' from tag_chat where pool_id = pg_temp.pool() and event = 'result'), 'ends on the tag move');
select pg_temp.ok((select body !~ 'bogey-free|Not one bogey' from tag_chat where pool_id = pg_temp.pool() and event = 'result'), 'three extras max (bogey-free left out)');
select pg_temp.ok(_tag_round_story(pg_temp.v('r1')::uuid) = _tag_round_story(pg_temp.v('r1')::uuid), 'same round, same story');
select pg_temp.ok((select length(body) <= 500 and body not like '%{%' from tag_chat where pool_id = pg_temp.pool() and event = 'result'), 'fits a post, no unfilled placeholders');

-- a manual submission (no Scorecard card): margin + tag line only; a 3-way with a lone last place
set role anon;
insert into s_ctx select 'm2', tag_log(pg_temp.tok('Danny Story'), pg_temp.pool(), jsonb_build_array(
  jsonb_build_object('member_id', pg_temp.mem('Danny Story'), 'score', 50), jsonb_build_object('member_id', pg_temp.mem('Ed Story'), 'score', 51),
  jsonb_build_object('member_id', pg_temp.mem('Danny Story Walden'), 'score', 60)), 'Story Hills', current_date)::text;
select tag_confirm(pg_temp.tok('Ed Story'), pg_temp.v('m2')::uuid, true);
select tag_confirm(pg_temp.tok('Danny Story Walden'), pg_temp.v('m2')::uuid, true);
reset role;
select pg_temp.ok((select status = 'applied' from tag_matches where id = pg_temp.v('m2')::uuid), 'manual round applied');
select pg_temp.ok((select body like 'Tag round at Story Hills: Danny Story 50, Ed Story 51, Danny Story Walden 60. %' and body ~ '\m1\M'
                     and body ~ 'Danny Story Walden (brought up the rear|finished last)' and body like '%Danny Story keeps #4.'
                     and body !~ 'ACE|birdies|hole' from tag_chat where pool_id = pg_temp.pool() and event = 'result' and body like '%Story Hills%'), 'manual: nail-biter, last place, keeps the tag, no hole talk');

-- a 2-way tie at the bottom: no last-place roast
select pg_temp.round(pg_temp.pool(), 'Story Flats', array[3,3,3,3,3,3,3,3,3], array['Al Story', 'Bo Story', 'Ed Story'],
  array[[3,3,3,3,3,3,3,3,2], [3,3,3,3,3,3,3,3,3], [3,3,3,3,3,3,3,3,3]]);
select pg_temp.ok((select body !~ 'rear|finished last' from tag_chat where pool_id = pg_temp.pool() and event = 'result' and body like '%Story Flats%'), 'tied for last: nobody gets roasted alone');

-- ---------- SETTLED: the challenge post carries the story, no extra RESULTS ----------
set role anon;
insert into s_ctx select 'c1', tag_challenge(pg_temp.tok('Ed Story'), pg_temp.pool(), pg_temp.mem('Bo Story'))::text;
select tag_challenge_respond(pg_temp.tok('Bo Story'), pg_temp.v('c1')::uuid, true);
reset role;
select pg_temp.ok((select count(*) from tag_chat where pool_id = pg_temp.pool() and event = 'result') = 3, '(3 RESULTS so far)');
select pg_temp.round(pg_temp.pool(), 'Story Canyon', array[3,3,3], array['Bo Story', 'Ed Story'], array[[3,3,3], [2,3,3]]);
select pg_temp.ok((select body like 'Challenge settled: %. %' and body ~ 'Ed Story' from tag_chat where pool_id = pg_temp.pool() and event = 'played'), 'SETTLED keeps its headline and gains the story');
select pg_temp.ok((select count(*) from tag_chat where pool_id = pg_temp.pool() and event = 'result') = 3, 'a settled challenge doesn''t double-post RESULTS');

-- ---------- a set with the Board off stays quiet ----------
select pg_temp.round(pg_temp.pool('story-quiet'), 'Story Quiet', array[3,3,3], array['Al Story', 'Bo Story'], array[[3,3,3], [2,3,3]]);
select pg_temp.ok(not exists (select 1 from tag_chat where pool_id = pg_temp.pool('story-quiet')), 'Board off: no RESULTS');
select pg_temp.ok(pg_temp.refused($$insert into tag_chat (pool_id, member_id, body, kind, event) values ((select id from tag_pools where slug = 'story-test'), (select id from tag_members where name = 'Al Story'), 'x', 'system', 'result')$$, 'tag_chat_kind_check'), 'RESULTS posts have no author');

-- ---------- @mentions ----------
set role anon;
insert into s_ctx select 'p1', tag_chat_post(pg_temp.tok('Al Story'), pg_temp.pool(), '@bomber you''re next. @Danny Story Walden too. @Out Story and @Al Story can watch.')::text;
reset role;
select pg_temp.ok((select array_agg(member_id order by label) = array[pg_temp.mem('Bo Story'), pg_temp.mem('Danny Story Walden')] from tag_chat_mentions where chat_id = pg_temp.v('p1')::bigint),
  'nickname (any case) + the longest full name; not a shorter name inside it, not outsiders, not yourself');
select pg_temp.ok((select label from tag_chat_mentions where chat_id = pg_temp.v('p1')::bigint and member_id = pg_temp.mem('Bo Story')) = 'Bomber', 'stored with the name as the club knows it');
select set_config('request.jwt.claims', '', false);
set role anon;
select pg_sleep(3.1);
insert into s_ctx select 'p2', tag_chat_post(pg_temp.tok('Al Story'), pg_temp.pool(), 'email me at al@Danny Story.com, @Danny Storyteller, @Danny Story!')::text;
reset role;
select pg_temp.ok((select array_agg(member_id) = array[pg_temp.mem('Danny Story')] from tag_chat_mentions where chat_id = pg_temp.v('p2')::bigint),
  'needs a clean edge: not inside an email, not a longer word; punctuation after is fine');
set role anon;
select pg_temp.ok((select (l->'mentions') = jsonb_build_array(jsonb_build_object('id', pg_temp.mem('Bo Story'), 'label', 'Bomber'), jsonb_build_object('id', pg_temp.mem('Danny Story Walden'), 'label', 'Danny Story Walden'))
  from jsonb_array_elements((tag_board_read(pg_temp.tok('Cy Story'), pg_temp.pool(), 0))->'lines') l where (l->>'id')::bigint = pg_temp.v('p1')::bigint), 'the Board returns each line''s mentions');
select pg_temp.ok((select jsonb_array_length(m) = 1 and m->0->>'pool' = 'story-test' and m->0->>'from' = 'Al Story' and (m->0->>'chat_id')::bigint = pg_temp.v('p1')::bigint
  from (select tag_mentions(pg_temp.tok('Bo Story')) m) x), 'tag_mentions: my pings');
select pg_temp.ok(jsonb_array_length(tag_mentions(pg_temp.tok('Cy Story'))) = 0, 'nothing for people not mentioned');
select pg_temp.ok(pg_temp.refused($$select tag_mentions('nope-nope-nope-nope-nope')$$, 'invalid_link'), 'needs a real My Tag link');
select pg_temp.ok(pg_temp.refused('select * from tag_chat_mentions', 'permission denied'), 'mentions aren''t readable directly');
reset role;
update tag_chat set hidden = true where id = pg_temp.v('p1')::bigint;
set role anon;
select pg_temp.ok(jsonb_array_length(tag_mentions(pg_temp.tok('Bo Story'))) = 0, 'a hidden message stops pinging');
reset role;
update tag_chat set hidden = false where id = pg_temp.v('p1')::bigint;
update tags set holder_id = null, status = 'retired' where pool_id = pg_temp.pool() and holder_id = pg_temp.mem('Bo Story');
set role anon;
select pg_temp.ok(jsonb_array_length(tag_mentions(pg_temp.tok('Bo Story'))) = 0, 'out of the set: no pings from its Board');
reset role;
select pg_temp.ok((select count(*) = 0 from tag_chat c join tag_chat_mentions m on m.chat_id = c.id where c.kind = 'system'), 'house posts never mention');
