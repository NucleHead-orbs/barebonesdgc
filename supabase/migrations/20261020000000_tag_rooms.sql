-- Tag rooms (locked 2026-10-03, Mike): one shared link per tag set. Everyone invited sees tiles with their names;
-- tapping your tile activates your tag (first come, first numbered) and that phone becomes your My Tag.
-- Golden Boners goes first: its 13 issued tags are reset into the room (no tags had moved yet).
-- Source of truth:
--   tag_rooms   : one per pool: the shared link token, open/closed.
--   tag_invites : who gets a tile (pool, member). activated_at = tapped; removed_at = taken off the list.
--   tags        : unchanged. Activating issues a tag exactly like td_tag_issue would.
-- Rules:
--   * Activate = the lowest number that isn't held or retired (#1 first), recorded in tag_history as 'issued'.
--     One tile per member, once. The member's My Tag link goes back to that phone.
--   * Trust the link: anyone holding it can tap any untapped tile. Wrong tile? A pool admin RESETS it: the tag goes
--     back in the pot ('released') and that member gets a new My Tag link, so the wrong phone loses access.
--   * Room closed (or link replaced) = nobody can activate; the page says so.
--   * Public reads nothing directly; room_get / room_activate check the room token; td_room_* check can_tag(pool).
--   * Safe to re-run (the Golden Boners reset runs only when its room is first created).
-- =====================================================================

create table if not exists public.tag_rooms (
  pool_id    uuid primary key references public.tag_pools(id) on delete cascade,
  token      text not null unique default (public._new_tag_token() || public._new_tag_token()),
  open       boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.tag_invites (
  pool_id      uuid not null references public.tag_pools(id) on delete cascade,
  member_id    uuid not null references public.tag_members(id) on delete cascade,
  added_at     timestamptz not null default now(),
  activated_at timestamptz,
  removed_at   timestamptz,
  primary key (pool_id, member_id)
);

alter table public.tag_rooms enable row level security;
alter table public.tag_invites enable row level security;
revoke all on public.tag_rooms, public.tag_invites from anon, authenticated;

create or replace function public._room(p_token text) returns public.tag_rooms
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare x public.tag_rooms;
begin
  if p_token is null or length(p_token) < 40 then raise exception 'invalid_room'; end if;
  select * into x from public.tag_rooms where token = p_token;
  if not found then raise exception 'invalid_room'; end if;
  return x;
end $$;

/** The room page: the set, open or not, and every tile (tapped tiles show their number). */
create or replace function public.room_get(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r public.tag_rooms;
begin
  r := public._room(p_token);
  return jsonb_build_object(
    'pool', (select jsonb_build_object('id', p.id, 'slug', p.slug, 'name', p.name) from public.tag_pools p where p.id = r.pool_id),
    'open', r.open,
    'tiles', coalesce((select jsonb_agg(jsonb_build_object('member_id', m.id, 'name', m.name, 'nickname', m.nickname,
                  'active', i.activated_at is not null,
                  'number', (select t.number from public.tags t where t.pool_id = r.pool_id and t.holder_id = m.id))
                  order by lower(coalesce(m.nickname, m.name)))
                from public.tag_invites i join public.tag_members m on m.id = i.member_id
               where i.pool_id = r.pool_id and i.removed_at is null), '[]'));
end $$;

/** Tap your tile: issue the lowest free number, return it with your My Tag link. */
create or replace function public.room_activate(p_token text, p_member uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.tag_rooms; i public.tag_invites; num int;
begin
  r := public._room(p_token);
  if not r.open then raise exception 'room_closed'; end if;
  select * into i from public.tag_invites where pool_id = r.pool_id and member_id = p_member and removed_at is null for update;
  if not found then raise exception 'not_invited'; end if;
  if i.activated_at is not null or exists (select 1 from public.tags where pool_id = r.pool_id and holder_id = p_member) then
    raise exception 'already_active';
  end if;
  perform 1 from public.tags where pool_id = r.pool_id for update;   -- one number at a time
  num := (select min(g) from generate_series(1, (select coalesce(max(number), 0) + 1 from public.tags where pool_id = r.pool_id)) g
           where not exists (select 1 from public.tags t where t.pool_id = r.pool_id and t.number = g and t.status in ('held', 'retired')));
  if exists (select 1 from public.tags where pool_id = r.pool_id and number = num) then
    update public.tags set holder_id = p_member, status = 'held', issued_at = now() where pool_id = r.pool_id and number = num;
  else
    insert into public.tags (pool_id, number, holder_id, status) values (r.pool_id, num, p_member, 'held');
  end if;
  insert into public.tag_history (pool_id, number, kind, member_id) values (r.pool_id, num, 'issued', p_member);
  update public.tag_invites set activated_at = now() where pool_id = r.pool_id and member_id = p_member;
  return jsonb_build_object('number', num, 'token', (select token from public.tag_members where id = p_member),
                            'name', (select name from public.tag_members where id = p_member));
end $$;

-- ---------- admin ----------
/** The room for a pool (created on first call), with the full invite list. */
create or replace function public.td_room_get(p_pool uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.tag_rooms;
begin
  perform public._need_tag(p_pool);
  select * into r from public.tag_rooms where pool_id = p_pool;
  if not found then return jsonb_build_object('on', false); end if;
  return jsonb_build_object('on', true, 'token', r.token, 'open', r.open,
    'invites', coalesce((select jsonb_agg(jsonb_build_object('member_id', m.id, 'name', m.name, 'nickname', m.nickname,
                  'activated_at', i.activated_at,
                  'number', (select t.number from public.tags t where t.pool_id = p_pool and t.holder_id = m.id))
                  order by i.activated_at nulls last, lower(m.name))
                from public.tag_invites i join public.tag_members m on m.id = i.member_id
               where i.pool_id = p_pool and i.removed_at is null), '[]'));
end $$;

create or replace function public.td_room_start(p_pool uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._need_tag(p_pool);
  insert into public.tag_rooms (pool_id) values (p_pool) on conflict (pool_id) do nothing;
end $$;

create or replace function public.td_room_set_open(p_pool uuid, p_open boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._need_tag(p_pool);
  update public.tag_rooms set open = coalesce(p_open, false) where pool_id = p_pool;
  if not found then raise exception 'no_room'; end if;
end $$;

/** Replace the shared link (the old one stops working at once). */
create or replace function public.td_room_new_link(p_pool uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare t text := public._new_tag_token() || public._new_tag_token();
begin
  perform public._need_tag(p_pool);
  update public.tag_rooms set token = t where pool_id = p_pool;
  if not found then raise exception 'no_room'; end if;
  return t;
end $$;

/** Give someone a tile: an existing member (p_member) or a new one by name (reuses the same name). */
create or replace function public.td_room_invite(p_pool uuid, p_member uuid, p_name text, p_nickname text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare mid uuid;
begin
  perform public._need_tag(p_pool);
  if not exists (select 1 from public.tag_rooms where pool_id = p_pool) then raise exception 'no_room'; end if;
  if p_member is not null then
    select id into mid from public.tag_members where id = p_member;
    if not found then raise exception 'unknown_member'; end if;
  else
    if btrim(coalesce(p_name, '')) = '' then raise exception 'name_required'; end if;
    select id into mid from public.tag_members where lower(btrim(name)) = lower(btrim(p_name));
    if not found then
      insert into public.tag_members (name, nickname) values (left(btrim(p_name), 60), nullif(left(btrim(coalesce(p_nickname, '')), 40), '')) returning id into mid;
    end if;
  end if;
  if exists (select 1 from public.tags where pool_id = p_pool and holder_id = mid) then raise exception 'already_has_tag'; end if;
  insert into public.tag_invites (pool_id, member_id) values (p_pool, mid)
  on conflict (pool_id, member_id) do update set removed_at = null, activated_at = null, added_at = now();
  return mid;
end $$;

/** Take an untapped tile off the list. */
create or replace function public.td_room_uninvite(p_pool uuid, p_member uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._need_tag(p_pool);
  if exists (select 1 from public.tag_invites where pool_id = p_pool and member_id = p_member and activated_at is not null) then
    raise exception 'reset_first';
  end if;
  update public.tag_invites set removed_at = now() where pool_id = p_pool and member_id = p_member and removed_at is null;
  if not found then raise exception 'not_invited'; end if;
end $$;

/** Wrong tile tapped (or start over): tag back in the pot, tile untapped, and that member gets a new My Tag link. */
create or replace function public.td_room_reset(p_pool uuid, p_member uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare num int;
begin
  perform public._need_tag(p_pool);
  if not exists (select 1 from public.tag_invites where pool_id = p_pool and member_id = p_member and removed_at is null and activated_at is not null) then
    raise exception 'not_active';
  end if;
  select number into num from public.tags where pool_id = p_pool and holder_id = p_member for update;
  if num is not null then
    update public.tags set holder_id = null, status = 'available' where pool_id = p_pool and number = num;
    insert into public.tag_history (pool_id, number, kind, prev_id) values (p_pool, num, 'released', p_member);
  end if;
  update public.tag_invites set activated_at = null where pool_id = p_pool and member_id = p_member;
  update public.tag_members set token = public._new_tag_token() where id = p_member;
end $$;

revoke execute on function public._room(text) from public, anon, authenticated;
grant execute on function public.room_get(text), public.room_activate(text, uuid) to anon, authenticated;
revoke execute on function public.td_room_get(uuid), public.td_room_start(uuid), public.td_room_set_open(uuid, boolean), public.td_room_new_link(uuid),
  public.td_room_invite(uuid, uuid, text, text), public.td_room_uninvite(uuid, uuid), public.td_room_reset(uuid, uuid) from public, anon;
grant execute on function public.td_room_get(uuid), public.td_room_start(uuid), public.td_room_set_open(uuid, boolean), public.td_room_new_link(uuid),
  public.td_room_invite(uuid, uuid, text, text), public.td_room_uninvite(uuid, uuid), public.td_room_reset(uuid, uuid) to authenticated;

-- ---------- Golden Boners: open a room and reset its tags into it (first run only) ----------
do $$
declare gp uuid := (select id from public.tag_pools where slug = 'golden-boners');
begin
  if gp is null or exists (select 1 from public.tag_rooms where pool_id = gp) then return; end if;
  if exists (select 1 from public.tag_matches where pool_id = gp and status in ('pending', 'disputed')) then
    raise exception 'golden boners has open rounds: settle them before the reset';
  end if;
  insert into public.tag_rooms (pool_id) values (gp);
  insert into public.tag_invites (pool_id, member_id) select gp, holder_id from public.tags where pool_id = gp and status = 'held'
  on conflict do nothing;
  insert into public.tag_history (pool_id, number, kind, prev_id) select gp, number, 'released', holder_id from public.tags where pool_id = gp and status = 'held';
  update public.tags set holder_id = null, status = 'available' where pool_id = gp and status = 'held';
end $$;
