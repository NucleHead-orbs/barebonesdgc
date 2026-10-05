-- Skull reporter + Bug Squasher + versions. Run after stub + all migrations.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
create or replace function pg_temp.as_user(sub text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', sub, 'role', 'authenticated')::text, false) $$;
create temp table bs_ctx (k text primary key, v text);
grant all on bs_ctx to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from bs_ctx where k = key $$;
grant execute on function pg_temp.v(text) to anon, authenticated;
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-000000000f01', 'Mike@YourMindsite.me', now()),
  ('00000000-0000-4000-8000-000000000f02', 'bs-td@bs.test', now())
on conflict do nothing;
insert into tag_members (name, nickname) values ('Bug Finder', 'Finder');
insert into bs_ctx select 'tok', token from tag_members where name = 'Bug Finder';
insert into bs_ctx select 'mem', id::text from tag_members where name = 'Bug Finder';
set client_min_messages = notice;

select pg_temp.ok((select count(*) = 1 and max(version) = '1.0.0' from app_releases), 'starts at v1.0.0');

-- anyone can report
select set_config('request.jwt.claims', '', false);
set role anon;
select pg_temp.ok(pg_temp.refused($$select feedback_submit('{"kind":"rant","body":"x"}')$$, 'invalid_kind'), 'kind is bug, idea or feedback');
select pg_temp.ok(pg_temp.refused($$select feedback_submit('{"kind":"bug","body":"   "}')$$, 'invalid_body'), 'empty report refused');
select pg_temp.ok(pg_temp.refused(format('select feedback_submit(%L)', jsonb_build_object('kind', 'bug', 'body', repeat('x', 2001))), 'invalid_body'), '2000 characters max');
insert into bs_ctx select 'r1', feedback_submit('{"kind":"bug","body":"Scorecard ate my birdie","page_url":"/c/abc","page_title":"Card","name":"Guest Gary","app_version":"1.0.0"}')::text;
insert into bs_ctx select 'r2', feedback_submit(jsonb_build_object('kind', 'idea', 'body', 'Make the skull dance', 'token', pg_temp.v('tok'), 'name', 'ignored'))::text;
select pg_temp.ok(pg_temp.refused('select * from feedback_reports', 'permission denied'), 'anon can''t read reports');
select pg_temp.ok(pg_temp.refused('select owner_feedback()', 'permission denied'), 'anon can''t open the squasher');
-- photos
select pg_temp.ok(pg_temp.refused($$insert into storage.objects (bucket_id, name) values ('feedback', 'elsewhere/x.png')$$, 'row-level security'), 'photos only under reports/');
insert into storage.objects (bucket_id, name) values ('feedback', 'reports/abcdef12-photo.png');
select pg_temp.ok(not exists (select 1 from storage.objects where bucket_id = 'feedback'), 'anon can''t list feedback photos');
select pg_temp.ok(pg_temp.refused($$select feedback_submit('{"kind":"bug","body":"pic","photo_path":"reports/nope0000.png"}')$$, 'photo_missing'), 'photo must exist');
insert into bs_ctx select 'r3', feedback_submit('{"kind":"feedback","body":"Love it","photo_path":"reports/abcdef12-photo.png"}')::text;
select pg_temp.ok(pg_temp.refused($$select feedback_submit('{"kind":"bug","body":"pic again","photo_path":"reports/abcdef12-photo.png"}')$$, 'photo_used'), 'one photo, one report');
reset role;

select pg_temp.ok((select reporter_name = 'Guest Gary' and member_id is null and page_url = '/c/abc' from feedback_reports where id = pg_temp.v('r1')::uuid), 'typed name kept for guests');
select pg_temp.ok((select reporter_name = 'Bug Finder' and member_id = pg_temp.v('mem')::uuid from feedback_reports where id = pg_temp.v('r2')::uuid), 'My Tag token names the member (typed name ignored)');

-- a TD's report carries their email; a TD isn't the owner
select pg_temp.as_user('00000000-0000-4000-8000-000000000f02'); set role authenticated;
insert into bs_ctx select 'r4', feedback_submit('{"kind":"bug","body":"Winners panel wonky"}')::text;
select pg_temp.ok(not is_owner(), 'a TD is not the owner');
select pg_temp.ok(pg_temp.refused('select owner_feedback()', 'forbidden'), 'other signed-in users can''t open the squasher');
select pg_temp.ok(pg_temp.refused(format('select owner_feedback_set(%L, ''squashed'', null)', pg_temp.v('r1')), 'forbidden'), 'or squash');
select pg_temp.ok(pg_temp.refused($$select owner_release_publish('patch', 'x', 'y')$$, 'forbidden'), 'or publish a version');
select pg_temp.ok(not exists (select 1 from storage.objects where bucket_id = 'feedback'), 'or see photos');
reset role;
select pg_temp.ok((select reporter_email = 'bs-td@bs.test' from feedback_reports where id = pg_temp.v('r4')::uuid), 'TD report carries their email');

-- the owner
select pg_temp.as_user('00000000-0000-4000-8000-000000000f01'); set role authenticated;
select pg_temp.ok(is_owner(), 'Mike is the owner (email case doesn''t matter)');
select pg_temp.ok(jsonb_array_length(owner_feedback()) = 4, 'squasher lists every report');
select pg_temp.ok((select r->>'member' = 'Finder' from jsonb_array_elements(owner_feedback()) r where r->>'id' = pg_temp.v('r2')), 'shows the member''s nickname');
select pg_temp.ok(exists (select 1 from storage.objects where bucket_id = 'feedback'), 'owner sees photos');
select pg_temp.ok(pg_temp.refused(format('select owner_feedback_set(%L, ''smashed'', null)', pg_temp.v('r1')), 'invalid_status'), 'status is checked');
select owner_feedback_set(pg_temp.v('r1')::uuid, 'squashed', ' Birdies are safe now ');
select owner_feedback_set(pg_temp.v('r2')::uuid, 'squashed', null);
select owner_feedback_set(pg_temp.v('r4')::uuid, 'wontfix', 'Working as intended');
select owner_feedback_set(pg_temp.v('r3')::uuid, 'squashed', null);
select owner_feedback_set(pg_temp.v('r3')::uuid, 'new', null);
reset role;
select pg_temp.ok((select squash_note = 'Birdies are safe now' and squashed_at is not null from feedback_reports where id = pg_temp.v('r1')::uuid), 'squashed with a note');
select pg_temp.ok((select status = 'new' and squashed_at is null from feedback_reports where id = pg_temp.v('r3')::uuid), 'reopen clears the squash');

select pg_temp.as_user('00000000-0000-4000-8000-000000000f01'); set role authenticated;
select pg_temp.ok(pg_temp.refused($$select owner_release_draft('mega')$$, 'invalid_bump'), 'bump is patch, minor or major');
select pg_temp.ok((select owner_release_draft('patch')->>'version' = '1.0.1' and owner_release_draft('minor')->>'version' = '1.1.0'
  and owner_release_draft('major')->>'version' = '2.0.0' and owner_release_draft('patch')->>'current' = '1.0.0'), 'bump math from 1.0.0');
select pg_temp.ok(jsonb_array_length(owner_release_draft('minor')->'items') = 2, 'draft holds the squashed reports only');
select pg_temp.ok(pg_temp.refused($$select owner_release_publish('minor', '  ', 'body')$$, 'invalid_title'), 'a version needs a title');
insert into bs_ctx select 'rel', owner_release_publish('minor', 'Skull time', 'Fixed: birdies. New: dancing skull.')::text;
select pg_temp.ok(owner_release_draft('patch')->>'version' = '1.1.1' and jsonb_array_length(owner_release_draft('patch')->'items') = 0, 'next draft starts clean at 1.1.1');
select pg_temp.ok(pg_temp.refused(format('select owner_feedback_set(%L, ''new'', null)', pg_temp.v('r1')), 'already_released'), 'shipped reports stay shipped');
select pg_temp.ok((select r->>'version' = '1.1.0' from jsonb_array_elements(owner_feedback()) r where r->>'id' = pg_temp.v('r1')), 'squasher shows the version it shipped in');
select owner_release_publish('patch', 'Tiny', 'Small stuff');
select owner_release_publish('major', 'Big', 'Big stuff');
select pg_temp.ok(owner_release_draft('minor')->>'version' = '2.1.0', 'versions keep counting (1.1.1 then 2.0.0)');
reset role;
select pg_temp.ok((select count(*) = 2 from feedback_reports where release_id = pg_temp.v('rel')::uuid), 'publishing claims the squashed reports');
select pg_temp.ok((select status = 'new' and release_id is null from feedback_reports where id = pg_temp.v('r3')::uuid), 'open reports wait for a later version');

-- public dev reports
select set_config('request.jwt.claims', '', false);
set role anon;
select pg_temp.ok((select count(*) = 4 from app_releases), 'anyone reads the dev reports');
select pg_temp.ok(pg_temp.refused('select published_by from app_releases', 'permission denied'), 'but not who published');
select pg_temp.ok(pg_temp.refused('select * from app_owners', 'permission denied'), 'owner list is private');
reset role;
select pg_temp.ok((select array_agg(email) = array['mike@yourmindsite.me'] from app_owners), 'one owner: Mike''s TD login');
