-- League week: the weekly award (Lazy Boner Safety Vest) + the group photo (locked 2026-10-04, Mike: "award the Lazy Boner
-- Safety Vest to the winner, which should also be proudly displayed each week. He takes a group photo at the end of every
-- round, so let's give him a place to load it.")
-- Source of truth:
--   events.vest_player_id : who wears the league's weekly award for this week (a player of THIS event). null = not awarded yet.
--   events.vest_note      : optional one-liner shout-out shown with it.
--   events.group_photo    : storage path of the week's group photo in the public `league-photos` bucket (<event_id>/<file>).
--   The award's NAME is site copy (src/lib/leagues/leagues.ts, League.award), not data.
-- Rules:
--   * td_set_vest / td_set_group_photo: any TD of the event. The vest goes to one of the event's players (a trigger also
--     enforces it on direct writes). No FK to players on purpose: a second events<->players relationship would make
--     PostgREST embeds ambiguous (PGRST201).
--   * The photo path must sit under the event's own folder. Bucket: public read by URL, writes only by that event's TDs.
--   * league_weeks(slug): public. Every league week of that tag set with a vest or a photo, newest first (archived weeks too:
--     it's the history wall). A vest whose player was removed reads as not awarded.
--   * Duplicating an event (next week) does NOT carry the vest or photo (td_create_event lists its columns).
--   * Safe to re-run.
-- =====================================================================

alter table public.events add column if not exists vest_player_id uuid;
alter table public.events add column if not exists vest_note text;
alter table public.events add column if not exists group_photo text;
alter table public.events drop constraint if exists events_vest_note_check;
alter table public.events add constraint events_vest_note_check check (vest_note is null or length(btrim(vest_note)) between 1 and 120);
alter table public.events drop constraint if exists events_group_photo_check;
alter table public.events add constraint events_group_photo_check
  check (group_photo is null or (starts_with(group_photo, id::text || '/') and length(group_photo) <= 200 and group_photo !~ '\.\.'));

create or replace function public._events_vest_check() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.vest_player_id is not null and not exists (select 1 from public.players where id = new.vest_player_id and event_id = new.id) then
    raise exception 'unknown_player';
  end if;
  return new;
end $$;
drop trigger if exists events_vest_check on public.events;
create trigger events_vest_check before insert or update of vest_player_id on public.events
  for each row execute function public._events_vest_check();

/** Award the week's vest (null player = take it back). */
create or replace function public.td_set_vest(p_event uuid, p_player uuid, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform public._require_event_td(p_event);
  if v is not null and length(v) > 120 then raise exception 'vest_note_too_long'; end if;
  update public.events set vest_player_id = p_player, vest_note = case when p_player is null then null else v end where id = p_event;
end $$;

/** Point the week at its group photo (already uploaded to league-photos/<event_id>/...). null = no photo. */
create or replace function public.td_set_group_photo(p_event uuid, p_path text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._require_event_td(p_event);
  if p_path is not null and not (starts_with(p_path, p_event::text || '/') and length(p_path) <= 200 and p_path !~ '\.\.') then
    raise exception 'invalid_path';
  end if;
  update public.events set group_photo = p_path where id = p_event;
end $$;

revoke execute on function public.td_set_vest(uuid, uuid, text), public.td_set_group_photo(uuid, text) from public, anon;
grant execute on function public.td_set_vest(uuid, uuid, text), public.td_set_group_photo(uuid, text) to authenticated;

/** The weekly wall for one league tag set (public). */
create or replace function public.league_weeks(p_pool_slug text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(w order by (w->>'starts_on') desc, w->>'name'), '[]'::jsonb)
  from (
    select jsonb_build_object('slug', e.slug, 'name', e.name, 'starts_on', e.starts_on,
             'vest', p.name, 'vest_note', case when p.id is not null then e.vest_note end, 'photo', e.group_photo) w
    from public.events e
    join public.tag_pools tp on tp.id = e.tag_pool_id and tp.slug = p_pool_slug
    left join public.players p on p.id = e.vest_player_id and p.event_id = e.id
    where e.kind = 'league' and (p.id is not null or e.group_photo is not null)
    order by e.starts_on desc
    limit 200
  ) s;
$$;
revoke execute on function public.league_weeks(text) from public;
grant execute on function public.league_weeks(text) to anon, authenticated;

-- ---------- photos: public read by URL, the event's TDs write (<event_id>/<file>) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('league-photos', 'league-photos', true, 8388608, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "td reads league photos" on storage.objects;
create policy "td reads league photos" on storage.objects for select to authenticated
  using (bucket_id = 'league-photos' and public.can_td(public._uuid_or_null((storage.foldername(name))[1])));
drop policy if exists "td writes league photos" on storage.objects;
create policy "td writes league photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'league-photos' and public.can_td(public._uuid_or_null((storage.foldername(name))[1])));
drop policy if exists "td deletes league photos" on storage.objects;
create policy "td deletes league photos" on storage.objects for delete to authenticated
  using (bucket_id = 'league-photos' and public.can_td(public._uuid_or_null((storage.foldername(name))[1])));
