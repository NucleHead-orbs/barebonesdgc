-- Tag room unlock time (locked 2026-10-03, Mike: "set the tags to unlock at 6pm"). Golden Boners: 6:00 pm Arizona, Oct 3.
--   tag_rooms.opens_at : no taps before this moment (null = no wait). The page counts down to it from the server clock.
-- Safe to re-run (only sets Golden Boners' time while it is still unset).
alter table public.tag_rooms add column if not exists opens_at timestamptz;

create or replace function public.room_get(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r public.tag_rooms;
begin
  r := public._room(p_token);
  return jsonb_build_object(
    'pool', (select jsonb_build_object('id', p.id, 'slug', p.slug, 'name', p.name) from public.tag_pools p where p.id = r.pool_id),
    'open', r.open, 'opens_at', r.opens_at, 'now', now(),
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
  if r.opens_at is not null and now() < r.opens_at then raise exception 'room_not_yet'; end if;
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

/** Set (or clear, null) when the room unlocks. */
create or replace function public.td_room_set_unlock(p_pool uuid, p_at timestamptz) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._need_tag(p_pool);
  update public.tag_rooms set opens_at = p_at where pool_id = p_pool;
  if not found then raise exception 'no_room'; end if;
end $$;

create or replace function public.td_room_get(p_pool uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.tag_rooms;
begin
  perform public._need_tag(p_pool);
  select * into r from public.tag_rooms where pool_id = p_pool;
  if not found then return jsonb_build_object('on', false); end if;
  return jsonb_build_object('on', true, 'token', r.token, 'open', r.open, 'opens_at', r.opens_at,
    'invites', coalesce((select jsonb_agg(jsonb_build_object('member_id', m.id, 'name', m.name, 'nickname', m.nickname,
                  'activated_at', i.activated_at,
                  'number', (select t.number from public.tags t where t.pool_id = p_pool and t.holder_id = m.id))
                  order by i.activated_at nulls last, lower(m.name))
                from public.tag_invites i join public.tag_members m on m.id = i.member_id
               where i.pool_id = p_pool and i.removed_at is null), '[]'));
end $$;

revoke execute on function public.td_room_set_unlock(uuid, timestamptz) from public, anon;
grant execute on function public.td_room_set_unlock(uuid, timestamptz) to authenticated;

update public.tag_rooms set opens_at = '2026-10-03 18:00:00-07'
 where pool_id = (select id from public.tag_pools where slug = 'golden-boners') and opens_at is null
   and not exists (select 1 from public.tag_invites i where i.pool_id = tag_rooms.pool_id and i.activated_at is not null);
