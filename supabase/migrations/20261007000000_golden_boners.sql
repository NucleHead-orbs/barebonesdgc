-- Golden Boners (locked 2026-09-29, Mike): a third numbered tag set, not tied to a league. Only admins and core
-- members carry one, for bragging rights. Same rules as every pool (swap on rounds, ties keep order, admins issue).
--   tag_pools.invite_only : the public board says "invite only" instead of "ask your league TD".
-- Safe to re-run.
alter table public.tag_pools add column if not exists invite_only boolean not null default false;
insert into public.tag_pools (slug, name, sort, invite_only) values ('golden-boners', 'Golden Boners', 3, true)
on conflict (slug) do update set invite_only = excluded.invite_only;
