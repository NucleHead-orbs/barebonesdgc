-- Club gallery (locked 2026-09-29, Mike: option 1 + 3)
-- Source of truth:
--   gallery_items : one row per thing on /gallery. Images live in the public `gallery` bucket;
--                   videos live on YouTube (@barebonesdiscgolfclub) and are stored as the 11-char video id.
--   Google Drive "Disc Golf/Bare Bones" stays the raw archive. Nothing reads Drive at runtime.
-- Rules:
--   * Club-wide, not per event: only the super admin (is_td) adds, edits, approves or deletes.
--   * Everything lands HIDDEN. The public sees approved rows only (same rule as sponsors).
--   * kind = 'image' needs storage_path and no youtube_id; kind = 'video' the reverse.
--   * category drives the /gallery filter: jewel | meme | photo | event.
--   * jewel_no (1..99) is only for category 'jewel' (the "Every Jewel" rail: 2016 = I, 2026 = XI).
--   * source_path (the Drive path) is unique, so re-running the Drive import never duplicates a file.
--   * Safe to re-run.
-- =====================================================================

create table if not exists public.gallery_items (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('image', 'video')),
  category     text not null check (category in ('jewel', 'meme', 'photo', 'event')),
  title        text not null check (length(btrim(title)) between 1 and 120),
  caption      text check (caption is null or length(caption) <= 300),
  year         smallint check (year is null or year between 2000 and 2100),
  jewel_no     smallint check (jewel_no is null or jewel_no between 1 and 99),
  event_label  text check (event_label is null or length(btrim(event_label)) between 1 and 80),
  storage_path text check (storage_path is null or length(storage_path) <= 300),
  youtube_id   text check (youtube_id is null or youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  source_path  text check (source_path is null or length(source_path) <= 500),
  hidden       boolean not null default true,
  sort         integer not null default 0,
  created_at   timestamptz not null default now(),
  constraint gallery_media check (
    (kind = 'image' and storage_path is not null and youtube_id is null) or
    (kind = 'video' and youtube_id is not null and storage_path is null)),
  constraint gallery_jewel_no check (jewel_no is null or category = 'jewel')
);
create unique index if not exists gallery_items_source_uq on public.gallery_items (source_path) where source_path is not null;
create index if not exists gallery_items_public_idx on public.gallery_items (category, sort) where not hidden;

alter table public.gallery_items enable row level security;
revoke all on public.gallery_items from anon, authenticated;
grant select on public.gallery_items to anon, authenticated;
grant insert, update, delete on public.gallery_items to authenticated;
drop policy if exists "public read" on public.gallery_items;
create policy "public read" on public.gallery_items for select to anon, authenticated using (not hidden or public.is_td());
drop policy if exists "admin insert" on public.gallery_items;
create policy "admin insert" on public.gallery_items for insert to authenticated with check (public.is_td());
drop policy if exists "admin update" on public.gallery_items;
create policy "admin update" on public.gallery_items for update to authenticated using (public.is_td()) with check (public.is_td());
drop policy if exists "admin delete" on public.gallery_items;
create policy "admin delete" on public.gallery_items for delete to authenticated using (public.is_td());

-- Image storage: public read by URL, super-admin-only writes. 8 MB cap, raster only (no SVG: it can carry script).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gallery', 'gallery', true, 8388608, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage's remove() looks the object up first, so the admin needs a select policy too (the public reads by URL, no policy needed).
drop policy if exists "admin reads gallery" on storage.objects;
create policy "admin reads gallery" on storage.objects for select to authenticated
  using (bucket_id = 'gallery' and public.is_td());
drop policy if exists "admin writes gallery" on storage.objects;
create policy "admin writes gallery" on storage.objects for insert to authenticated
  with check (bucket_id = 'gallery' and public.is_td());
drop policy if exists "admin updates gallery" on storage.objects;
create policy "admin updates gallery" on storage.objects for update to authenticated
  using (bucket_id = 'gallery' and public.is_td()) with check (bucket_id = 'gallery' and public.is_td());
drop policy if exists "admin deletes gallery" on storage.objects;
create policy "admin deletes gallery" on storage.objects for delete to authenticated
  using (bucket_id = 'gallery' and public.is_td());
