-- Gallery acceptance tests. Run after stub + all migrations.
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
  ('00000000-0000-4000-8000-0000000000b8', 'g-eventtd@club.test', now())
on conflict do nothing;
-- g-eventtd runs an event but is not super admin: must still be locked out of the club gallery.
insert into event_tds (event_id, email) select id, 'g-eventtd@club.test' from events where slug = 'jewel-xi-2026';
set client_min_messages = notice;

-- ===== super admin adds items; they land hidden =====
select pg_temp.claims('00000000-0000-4000-8000-0000000000a8', true); set role authenticated;
insert into gallery_items (kind, category, title, storage_path, source_path) values
  ('image', 'meme', 'AMERICA!!', 'meme/america.webp', 'Funny Pics/america!.png');
insert into gallery_items (kind, category, title, youtube_id) values ('video', 'event', 'Pig Day', 'dQw4w9WgXcQ');
insert into gallery_items (kind, category, title, storage_path, jewel_no, year, hidden) values
  ('image', 'jewel', 'The Jewel III', 'jewel/2018.webp', 3, 2018, false);
select pg_temp.ok((select count(*) = 3 from gallery_items), 'admin: adds images and videos');
select pg_temp.ok((select hidden from gallery_items where title = 'AMERICA!!'), 'new items land hidden by default');
select pg_temp.ok(pg_temp.refused($q$insert into gallery_items (kind, category, title, storage_path, source_path) values ('image', 'meme', 'dupe', 'x.webp', 'Funny Pics/america!.png')$q$, 'duplicate key'),
  'same Drive file cannot be imported twice');
select pg_temp.ok(pg_temp.refused($q$insert into gallery_items (kind, category, title) values ('image', 'meme', 'no file')$q$, 'gallery_media'),
  'image without a file is refused');
select pg_temp.ok(pg_temp.refused($q$insert into gallery_items (kind, category, title, youtube_id, storage_path) values ('video', 'event', 'both', 'dQw4w9WgXcQ', 'x.webp')$q$, 'gallery_media'),
  'video with a file path is refused');
select pg_temp.ok(pg_temp.refused($q$insert into gallery_items (kind, category, title, youtube_id) values ('video', 'event', 'bad id', 'https://youtu.be/x')$q$, 'youtube_id'),
  'a full URL is not a YouTube id');
select pg_temp.ok(pg_temp.refused($q$insert into gallery_items (kind, category, title, storage_path, jewel_no) values ('image', 'meme', 'meme XI', 'x.webp', 11)$q$, 'gallery_jewel_no'),
  'jewel number only on Jewel items');
select pg_temp.ok(pg_temp.refused($q$insert into gallery_items (kind, category, title, storage_path) values ('image', 'selfies', 'x', 'x.webp')$q$, 'category'),
  'unknown category is refused');
update gallery_items set hidden = false where title = 'Pig Day';
select pg_temp.ok((select not hidden from gallery_items where title = 'Pig Day'), 'admin: approves an item');
reset role;

-- ===== public sees approved only =====
select set_config('request.jwt.claims', '{}', false); set role anon;
select pg_temp.ok((select count(*) = 2 from gallery_items), 'anon: sees only the 2 approved items');
select pg_temp.ok((select count(*) = 0 from gallery_items where title = 'AMERICA!!'), 'anon: hidden meme stays hidden');
select pg_temp.ok(pg_temp.refused($q$insert into gallery_items (kind, category, title, storage_path) values ('image', 'meme', 'spam', 'x.webp')$q$, 'permission denied'),
  'anon: cannot add');
reset role;

-- ===== an event TD is not a gallery admin =====
select pg_temp.claims('00000000-0000-4000-8000-0000000000b8', false); set role authenticated;
select pg_temp.ok((select count(*) = 2 from gallery_items), 'event TD: sees approved only');
select pg_temp.ok(pg_temp.refused($q$insert into gallery_items (kind, category, title, storage_path) values ('image', 'meme', 'x', 'x.webp')$q$, 'row-level security'),
  'event TD: cannot add');
update gallery_items set hidden = false where title = 'AMERICA!!';
delete from gallery_items where title = 'Pig Day';
reset role;
select pg_temp.ok((select hidden from gallery_items where title = 'AMERICA!!'), 'event TD: approve silently does nothing');
select pg_temp.ok((select count(*) = 1 from gallery_items where title = 'Pig Day'), 'event TD: delete silently does nothing');

-- ===== storage =====
select pg_temp.ok((select public and 'image/gif' = any(allowed_mime_types) and not ('image/svg+xml' = any(allowed_mime_types)) from storage.buckets where id = 'gallery'),
  'bucket: public read, gif allowed, svg not');
select pg_temp.claims('00000000-0000-4000-8000-0000000000b8', false); set role authenticated;
select pg_temp.ok(pg_temp.refused($q$insert into storage.objects (bucket_id, name) values ('gallery', 'meme/x.webp')$q$, 'row-level security'),
  'event TD: cannot upload to the gallery bucket');
reset role;
select pg_temp.claims('00000000-0000-4000-8000-0000000000a8', true); set role authenticated;
insert into storage.objects (bucket_id, name) values ('gallery', 'meme/x.webp');
reset role;
select pg_temp.ok((select count(*) = 1 from storage.objects where bucket_id = 'gallery'), 'admin: uploads to the gallery bucket');
select pg_temp.claims('00000000-0000-4000-8000-0000000000b8', false); set role authenticated;
select pg_temp.ok((select count(*) = 0 from storage.objects where bucket_id = 'gallery'), 'event TD: cannot list gallery objects');
delete from storage.objects where bucket_id = 'gallery';
reset role;
select pg_temp.ok((select count(*) = 1 from storage.objects where bucket_id = 'gallery'), 'event TD: delete silently does nothing');
select pg_temp.claims('00000000-0000-4000-8000-0000000000a8', true); set role authenticated;
select pg_temp.ok((select count(*) = 1 from storage.objects where bucket_id = 'gallery'), 'admin: can look objects up (remove() needs it)');
delete from storage.objects where bucket_id = 'gallery';
reset role;
select pg_temp.ok((select count(*) = 0 from storage.objects where bucket_id = 'gallery'), 'admin: deletes from the gallery bucket');

\echo ALL GALLERY TESTS PASSED
