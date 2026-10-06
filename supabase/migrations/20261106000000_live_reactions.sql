-- Live reactions (locked 2026-10-05, Mike: "ways for the viewers to interact, maybe like sending animations to the card when they
-- open it? Either in razz or congrats fashion." Reactions first; stroke tokens parked).
-- Source of truth:
--   club_live_reactions : one row per reaction sent to a live round: who (a club member, by their My Tag link), what, at whom
--                         (a name on the card, or everyone).
--   club_live.muted     : the scorer turned reactions off for this round.
-- Rules:
--   * Kinds. Razz: skull, choke, trash, cry. Congrats: clap, fire, goat, cheers.
--   * Only members (My Tag link) can send, so every razz has a name on it. The round must be live (not ended, a push in the
--     last 30 minutes) and not muted. Target = one of the card's player names exactly, or null (everyone).
--   * One reaction per member per round every 15 seconds; 40 per round per 10 minutes overall.
--   * Anyone can read a live round's reactions (the scorer's phone and every viewer play them). Last 50 after an id.
--   * round_live_mute(id, secret, muted): the scorer's phone only (same secret as the pushes).
-- =====================================================================

alter table public.club_live add column if not exists muted boolean not null default false;

create table if not exists public.club_live_reactions (
  id        bigint generated always as identity primary key,
  live_id   uuid not null references public.club_live(id) on delete cascade,
  member_id uuid references public.tag_members(id) on delete set null,
  kind      text not null check (kind in ('skull', 'choke', 'trash', 'cry', 'clap', 'fire', 'goat', 'cheers')),
  target    text check (target is null or length(target) between 1 and 60),
  at        timestamptz not null default now()
);
create index if not exists club_live_reactions_live on public.club_live_reactions (live_id, id);
alter table public.club_live_reactions enable row level security;
revoke all on public.club_live_reactions from anon, authenticated;

create or replace function public.live_react(p_live uuid, p_token text, p_kind text, p_target text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members; l public.club_live; t text := nullif(btrim(coalesce(p_target, '')), ''); v_id bigint;
begin
  me := public._tag_member(p_token);
  if p_kind not in ('skull', 'choke', 'trash', 'cry', 'clap', 'fire', 'goat', 'cheers') then raise exception 'invalid_reaction'; end if;
  select * into l from public.club_live where id = p_live;
  if l.id is null or l.ended_at is not null or l.updated_at < now() - interval '30 minutes' then raise exception 'not_live'; end if;
  if l.muted then raise exception 'muted'; end if;
  if t is not null and not exists (select 1 from jsonb_array_elements(l.card -> 'players') p where p ->> 'name' = t) then raise exception 'unknown_player'; end if;
  if exists (select 1 from public.club_live_reactions where live_id = p_live and member_id = me.id and at > now() - interval '15 seconds') then raise exception 'slow_down'; end if;
  if (select count(*) from public.club_live_reactions where live_id = p_live and at > now() - interval '10 minutes') >= 40 then raise exception 'slow_down'; end if;
  insert into public.club_live_reactions (live_id, member_id, kind, target) values (p_live, me.id, p_kind, t) returning club_live_reactions.id into v_id;
  return v_id;
end $$;

create or replace function public.live_reactions(p_live uuid, p_after bigint) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'muted', (select muted from public.club_live where id = p_live),
    'last', (select max(id) from public.club_live_reactions where live_id = p_live),
    'list', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'target', r.target, 'at', r.at,
               'who', coalesce(nullif(btrim(m.nickname), ''), m.name, 'Someone')) order by r.id)
             from (select * from public.club_live_reactions where live_id = p_live and id > coalesce(p_after, 0) order by id desc limit 50) r
             left join public.tag_members m on m.id = r.member_id), '[]'))
$$;

create or replace function public.round_live_mute(p_id uuid, p_secret text, p_muted boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.club_live set muted = coalesce(p_muted, false) where id = p_id and secret_hash = md5(coalesce(p_secret, ''));
  if not found then raise exception 'invalid_live'; end if;
end $$;

-- the live views say whether reactions are muted
create or replace function public._live_json(l public.club_live) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', l.id, 'course', l.course, 'card', l.card, 'started_at', l.started_at, 'updated_at', l.updated_at,
    'ended', l.ended_at is not null, 'muted', l.muted)
$$;
revoke execute on function public._live_json(public.club_live) from public, anon, authenticated;

grant execute on function public.live_react(uuid, text, text, text), public.live_reactions(uuid, bigint), public.round_live_mute(uuid, text, boolean) to anon, authenticated;
