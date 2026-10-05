-- Skull reporter + Bug Squasher + dev reports (locked 2026-10-05, Mike: "add our feedback bug reporter tool ... make that button a
-- little mascot skull ... its bug squasher companion page, where the feedback and bug reports land and get squashed ... a
-- 'generate version update' feature that adds dev reports to the various home pages and updates the version number. That page
-- should only be available to me." Answers: skull everywhere; type + optional photo + who sent it; dev reports on the club
-- home, TD home and My Tag; semver, Mike picks the bump).
-- Source of truth:
--   app_owners        : the email(s) that own the Bug Squasher (Mike). is_owner() checks the signed-in TD against it.
--   feedback_reports  : every report from the skull. kind bug | idea | feedback. status new -> squashed | wontfix | dupe
--                       (and back to new). release_id = the version it shipped in (set when a version is published).
--   app_releases      : published versions (semver, newest = the app's version) with the dev report text. Public.
-- Rules:
--   * Anyone can send a report (feedback_submit). Who sent it is attached by the server: the signed-in TD's email, or the
--     My Tag member when their link token is passed; otherwise the optional typed name. Page, title, device, app version
--     come from the client. Crude flood guard: 60 reports per 10 minutes site-wide; 2000 characters max.
--   * Photos go to the private `feedback` bucket under reports/<random>.<ext> (anyone can upload there; only the owner
--     can read). A report may point at one photo that exists and isn't used by another report.
--   * Everything else is owner-only: list, squash/unsquash, draft a version, publish a version.
--   * Publishing: version must be exactly the next patch/minor/major after the latest; it claims every squashed report
--     not yet in a release. Safe to re-run.
-- =====================================================================

create table if not exists public.app_owners (email text primary key check (email = lower(btrim(email))));
alter table public.app_owners enable row level security;
revoke all on public.app_owners from anon, authenticated;
insert into public.app_owners (email) values ('superwhite14@gmail.com') on conflict do nothing;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.app_owners where email = public.my_email())
$$;
grant execute on function public.is_owner() to anon, authenticated;

create table if not exists public.app_releases (
  id           uuid primary key default gen_random_uuid(),
  version      text not null unique check (version ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,4}$'),
  title        text not null check (length(btrim(title)) between 1 and 120),
  body         text not null check (length(body) between 1 and 8000),
  published_at timestamptz not null default now(),
  published_by text
);
alter table public.app_releases enable row level security;
revoke all on public.app_releases from anon, authenticated;
grant select (id, version, title, body, published_at) on public.app_releases to anon, authenticated;
drop policy if exists "public read" on public.app_releases;
create policy "public read" on public.app_releases for select to anon, authenticated using (true);

create table if not exists public.feedback_reports (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('bug', 'idea', 'feedback')),
  body           text not null check (length(btrim(body)) between 1 and 2000),
  page_url       text check (page_url is null or length(page_url) <= 500),
  page_title     text check (page_title is null or length(page_title) <= 200),
  user_agent     text check (user_agent is null or length(user_agent) <= 400),
  app_version    text check (app_version is null or length(app_version) <= 20),
  reporter_name  text check (reporter_name is null or length(btrim(reporter_name)) between 1 and 80),
  reporter_email text,
  member_id      uuid references public.tag_members(id) on delete set null,
  photo_path     text unique check (photo_path is null or photo_path ~ '^reports/[A-Za-z0-9-]{8,64}\.(jpg|png|webp)$'),
  status         text not null default 'new' check (status in ('new', 'squashed', 'wontfix', 'dupe')),
  squash_note    text check (squash_note is null or length(squash_note) <= 300),
  squashed_at    timestamptz,
  release_id     uuid references public.app_releases(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists feedback_reports_status on public.feedback_reports (status, created_at desc);
alter table public.feedback_reports enable row level security;
revoke all on public.feedback_reports from anon, authenticated;

-- photos: anyone uploads to reports/, only the owner reads or removes
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback', 'feedback', false, 6291456, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "anyone uploads feedback photos" on storage.objects;
create policy "anyone uploads feedback photos" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'feedback' and name ~ '^reports/[A-Za-z0-9-]{8,64}\.(jpg|png|webp)$');
drop policy if exists "owner reads feedback photos" on storage.objects;
create policy "owner reads feedback photos" on storage.objects for select to authenticated
  using (bucket_id = 'feedback' and public.is_owner());
drop policy if exists "owner removes feedback photos" on storage.objects;
create policy "owner removes feedback photos" on storage.objects for delete to authenticated
  using (bucket_id = 'feedback' and public.is_owner());

/** The skull: send a report. p: {kind, body, page_url, page_title, user_agent, app_version, name, token, photo_path}. */
create or replace function public.feedback_submit(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_kind text := p->>'kind'; v_body text := btrim(coalesce(p->>'body', '')); mem public.tag_members; v_photo text := nullif(p->>'photo_path', ''); v_id uuid;
begin
  if v_kind not in ('bug', 'idea', 'feedback') then raise exception 'invalid_kind'; end if;
  if length(v_body) not between 1 and 2000 then raise exception 'invalid_body'; end if;
  if (select count(*) from public.feedback_reports where created_at > now() - interval '10 minutes') >= 60 then raise exception 'busy'; end if;
  if nullif(p->>'token', '') is not null then
    select * into mem from public.tag_members where token = p->>'token';
  end if;
  if v_photo is not null then
    if not exists (select 1 from storage.objects where bucket_id = 'feedback' and name = v_photo) then raise exception 'photo_missing'; end if;
    if exists (select 1 from public.feedback_reports where photo_path = v_photo) then raise exception 'photo_used'; end if;
  end if;
  insert into public.feedback_reports (kind, body, page_url, page_title, user_agent, app_version, reporter_name, reporter_email, member_id, photo_path)
  values (v_kind, v_body, left(p->>'page_url', 500), left(p->>'page_title', 200), left(p->>'user_agent', 400), left(p->>'app_version', 20),
          coalesce(mem.name, nullif(left(btrim(coalesce(p->>'name', '')), 80), '')), public.my_email(), mem.id, v_photo)
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.feedback_submit(jsonb) to anon, authenticated;

create or replace function public._need_owner() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin if not public.is_owner() then raise exception 'forbidden'; end if; end $$;

/** Bug Squasher: every report, newest first, with who sent it and which version it shipped in. */
create or replace function public.owner_feedback() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._need_owner();
  return coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'body', f.body, 'page_url', f.page_url, 'page_title', f.page_title,
      'user_agent', f.user_agent, 'app_version', f.app_version, 'reporter_name', f.reporter_name, 'reporter_email', f.reporter_email,
      'member', (select coalesce(m.nickname, m.name) from public.tag_members m where m.id = f.member_id), 'photo_path', f.photo_path, 'status', f.status,
      'squash_note', f.squash_note, 'squashed_at', f.squashed_at, 'version', (select r.version from public.app_releases r where r.id = f.release_id),
      'created_at', f.created_at) order by f.created_at desc)
    from (select * from public.feedback_reports order by created_at desc limit 500) f), '[]');
end $$;

/** Squash (or wontfix / dupe / reopen) a report. A report that already shipped in a version stays put. */
create or replace function public.owner_feedback_set(p_id uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._need_owner();
  if p_status not in ('new', 'squashed', 'wontfix', 'dupe') then raise exception 'invalid_status'; end if;
  if length(coalesce(p_note, '')) > 300 then raise exception 'note_too_long'; end if;
  update public.feedback_reports set status = p_status, squash_note = nullif(btrim(coalesce(p_note, '')), ''),
    squashed_at = case when p_status = 'new' then null else coalesce(squashed_at, now()) end
   where id = p_id and release_id is null;
  if not found then raise exception 'already_released'; end if;
end $$;

create or replace function public._next_version(p_bump text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare cur text; a int; b int; c int;
begin
  select version into cur from public.app_releases order by string_to_array(version, '.')::int[] desc limit 1;
  if cur is null then return '1.0.0'; end if;
  a := split_part(cur, '.', 1)::int; b := split_part(cur, '.', 2)::int; c := split_part(cur, '.', 3)::int;
  return case p_bump when 'major' then (a + 1) || '.0.0' when 'minor' then a || '.' || (b + 1) || '.0' when 'patch' then a || '.' || b || '.' || (c + 1)
    else null end;
end $$;

/** Draft the next version: its number for this bump + every squashed report not in a version yet. */
create or replace function public.owner_release_draft(p_bump text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._need_owner();
  if p_bump not in ('patch', 'minor', 'major') then raise exception 'invalid_bump'; end if;
  return jsonb_build_object('version', public._next_version(p_bump),
    'current', (select version from public.app_releases order by string_to_array(version, '.')::int[] desc limit 1),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'body', body, 'squash_note', squash_note) order by squashed_at)
                from public.feedback_reports where status = 'squashed' and release_id is null), '[]'));
end $$;

/** Publish the next version. Claims every squashed report not in a version yet. Returns the release id. */
create or replace function public.owner_release_publish(p_bump text, p_title text, p_body text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v text; rid uuid;
begin
  perform public._need_owner();
  if p_bump not in ('patch', 'minor', 'major') then raise exception 'invalid_bump'; end if;
  perform 1 from public.app_releases for update;
  v := public._next_version(p_bump);
  if length(btrim(coalesce(p_title, ''))) not between 1 and 120 then raise exception 'invalid_title'; end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 8000 then raise exception 'invalid_body'; end if;
  insert into public.app_releases (version, title, body, published_by) values (v, btrim(p_title), btrim(p_body), public.my_email()) returning id into rid;
  update public.feedback_reports set release_id = rid where status = 'squashed' and release_id is null;
  return rid;
end $$;

revoke execute on function public.owner_feedback(), public.owner_feedback_set(uuid, text, text), public.owner_release_draft(text),
  public.owner_release_publish(text, text, text), public._next_version(text), public._need_owner() from public, anon;
grant execute on function public.owner_feedback(), public.owner_feedback_set(uuid, text, text), public.owner_release_draft(text),
  public.owner_release_publish(text, text, text) to authenticated;

-- ---------- data: the starting line ----------
insert into public.app_releases (version, title, body, published_at, published_by)
values ('1.0.0', 'The Bone Lab opens',
  E'Everything built so far counts as 1.0: the Jewel XI site, the TD tool (events, leagues, cards, phone scoring, winners), Boner Rounds, digital bag tags with time bombs, challenges and group chat, Early Access, and the Leagues pages.\nFrom here on, every fix and new thing lands in a dev report like this one. See something busted? Tap the skull.',
  now(), 'superwhite14@gmail.com')
on conflict (version) do nothing;
