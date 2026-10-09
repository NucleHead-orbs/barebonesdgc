-- Skins (locked 2026-10-08, Mike: "add a skin selection and add a couple more options ... future use for themed events or
-- holiday seasons"). Answers: phone picks, admin sets a default; Night Card replaces today's dark; ship G-Mode, Night Card,
-- Spooky Season, Ugly Sweater, Jewel Electric. Applies to My Tag, the Scorecard and the TD Builder.
-- Source of truth:
--   skin_default : one row. The club-wide default skin and the last day it runs (null = until changed).
-- Rules:
--   * A phone's own pick (localStorage bb-skin) beats the default. No pick = the default while it runs, else Night Card.
--   * The default ends after `until` (Arizona date) on its own: the server stops returning it.
--   * Anyone reads the active default (skin_default_get). Only a super admin (is_td) sets it (td_skin_default_set).
-- Safe to re-run.
create table if not exists public.skin_default (
  id     boolean primary key default true check (id),
  skin   text not null default 'night' check (skin in ('night', 'gmode', 'spooky', 'sweater', 'electric')),
  until  date,
  set_by text,
  set_at timestamptz not null default now()
);
alter table public.skin_default enable row level security;
revoke all on public.skin_default from anon, authenticated;
insert into public.skin_default (id) values (true) on conflict do nothing;

/** The default skin right now: { skin, until } while it runs, else { skin: 'night', until: null }. */
create or replace function public.skin_default_get() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select jsonb_build_object('skin', d.skin, 'until', d.until) from public.skin_default d
                    where d.until is null or d.until >= (now() at time zone 'America/Phoenix')::date),
                  jsonb_build_object('skin', 'night', 'until', null))
$$;

/** Super admin: set the default (and optionally the last day it runs). */
create or replace function public.td_skin_default_set(p_skin text, p_until date) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_td() then raise exception 'not_allowed'; end if;
  if p_skin is null or p_skin not in ('night', 'gmode', 'spooky', 'sweater', 'electric') then raise exception 'invalid_skin'; end if;
  if p_until is not null and p_until < (now() at time zone 'America/Phoenix')::date then raise exception 'invalid_until'; end if;
  insert into public.skin_default (id, skin, until, set_by, set_at) values (true, p_skin, p_until, public.my_email(), now())
    on conflict (id) do update set skin = excluded.skin, until = excluded.until, set_by = excluded.set_by, set_at = excluded.set_at;
  return public.skin_default_get();
end $$;

revoke execute on function public.skin_default_get(), public.td_skin_default_set(text, date) from public, anon, authenticated;
grant execute on function public.skin_default_get() to anon, authenticated;
grant execute on function public.td_skin_default_set(text, date) to authenticated;
