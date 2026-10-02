-- Music page: who's listening now + play counts. Anonymous by design: a "listener" is a random id the
-- browser makes up and keeps; no names, emails or IPs are stored. Tables have RLS on and no policies:
-- writes only go through the two RPCs below, and the public only ever reads totals (music_stats).
-- One listeners row per browser that ever pressed play (upserted), so it stays tiny without cleanup.

create table if not exists public.music_listeners (
  listener uuid primary key,
  slug     text,                                -- what they're playing right now; null = paused
  seen_at  timestamptz not null default now(),
  constraint music_listeners_slug check (slug is null or slug ~ '^[a-z0-9-]{1,60}$')
);
create index if not exists music_listeners_seen on public.music_listeners (seen_at);

create table if not exists public.music_plays (
  play_id   uuid primary key,                   -- one id per time a track starts playing: counted once
  listener  uuid not null,
  slug      text not null check (slug ~ '^[a-z0-9-]{1,60}$'),
  played_at timestamptz not null default now()
);
create index if not exists music_plays_slug on public.music_plays (slug);
create index if not exists music_plays_listener on public.music_plays (listener, played_at desc);

alter table public.music_listeners enable row level security;
alter table public.music_plays enable row level security;
revoke all on public.music_listeners, public.music_plays from anon, authenticated;

/** "I'm playing <slug>" every ~30 s while playing; slug null on pause. Live = seen in the last 75 s. */
create or replace function public.music_heartbeat(p_listener uuid, p_slug text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_listener is null then raise exception 'bad_listener'; end if;
  if p_slug is not null and p_slug !~ '^[a-z0-9-]{1,60}$' then raise exception 'bad_slug'; end if;
  insert into music_listeners (listener, slug, seen_at) values (p_listener, p_slug, now())
  on conflict (listener) do update set slug = excluded.slug, seen_at = now();
end $$;

/**
 * Count a play (the client calls this once a track has had 30 s of listening). Same play id twice
 * counts once; one listener can't log two plays inside 25 s (impossible at 30 s per play).
 */
create or replace function public.music_log_play(p_play uuid, p_listener uuid, p_slug text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_play is null or p_listener is null then raise exception 'bad_listener'; end if;
  if p_slug is null or p_slug !~ '^[a-z0-9-]{1,60}$' then raise exception 'bad_slug'; end if;
  if exists (select 1 from music_plays where listener = p_listener and played_at > now() - interval '25 seconds') then
    return false;
  end if;
  insert into music_plays (play_id, listener, slug) values (p_play, p_listener, p_slug) on conflict do nothing;
  return found;
end $$;

/** Public totals: { live: listeners playing now, plays: { slug: count } }. */
create or replace function public.music_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'live', (select count(*) from music_listeners where slug is not null and seen_at > now() - interval '75 seconds'),
    'plays', coalesce((select jsonb_object_agg(slug, n) from (select slug, count(*) as n from music_plays group by slug) x), '{}'::jsonb));
$$;

revoke all on function public.music_heartbeat(uuid, text), public.music_log_play(uuid, uuid, text), public.music_stats() from public;
grant execute on function public.music_heartbeat(uuid, text), public.music_log_play(uuid, uuid, text), public.music_stats() to anon, authenticated;
