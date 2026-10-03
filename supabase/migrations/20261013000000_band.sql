-- Meet the Band (/jewel-xi/band): the admin team and event managers, each shown as their character card.
-- One row per member. `card` is the card image: a site asset (/assets/band/…, the seeded three) or an upload in the
-- public `gallery` bucket under band/ (super admin, from /td → THE BAND). Public sees visible members; super admin
-- (is_td) sees and edits all.
create table if not exists public.band_members (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 60),
  role       text not null default '' check (length(role) <= 60),
  card       text check (card is null or card ~ '^/assets/band/[a-z0-9-]+\.(webp|png|jpg)$' or card ~ '^band/[0-9a-f-]+\.(webp|png|jpg|gif)$'),
  sort       integer not null default 0,
  hidden     boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists band_members_sort on public.band_members (sort, created_at);

alter table public.band_members enable row level security;
revoke all on public.band_members from anon, authenticated;
grant select on public.band_members to anon, authenticated;
grant insert, update, delete on public.band_members to authenticated;
drop policy if exists "public read" on public.band_members;
create policy "public read" on public.band_members for select to anon, authenticated using (not hidden or public.is_td());
drop policy if exists "admin insert" on public.band_members;
create policy "admin insert" on public.band_members for insert to authenticated with check (public.is_td());
drop policy if exists "admin update" on public.band_members;
create policy "admin update" on public.band_members for update to authenticated using (public.is_td()) with check (public.is_td());
drop policy if exists "admin delete" on public.band_members;
create policy "admin delete" on public.band_members for delete to authenticated using (public.is_td());

insert into public.band_members (name, role, card, sort)
select * from (values
  ('YT the Boneheaded Boy', 'Tournament Director', '/assets/band/yt-the-boneheaded-boy.webp', 1),
  ('WTF Jerry', 'Admin', '/assets/band/wtf-jerry.webp', 2),
  ('Beard', 'Admin', '/assets/band/beard.webp', 3)
) v(name, role, card, sort)
where not exists (select 1 from public.band_members);
