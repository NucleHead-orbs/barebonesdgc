-- Early access: the first N registrants only (locked 2026-10-04, Mike: "limit it to the first 50"; answer: first 50 to
-- register, by registration order, so the race is to register for the Jewel).
-- Source of truth:
--   early_access.max_players : how many registrants get early access (null = everyone). Jewel XI = 50.
--   Who's in: a registrant's place in registration order (players.reg_order from Disc Golf Scene, then when they were
--   added). Place <= max_players = eligible. If someone ahead drops out (removed from players), the next one moves in.
-- Rules:
--   * A claim (page or My Tag) and an approval are refused for a registrant outside the first max_players ('early_access_full').
--     Enforced by a trigger on ea_claims, so every path is covered.
--   * td_ea_set_max: any TD of the event; 1..500 or null.
--   * ea_public adds max_players, registered (count) and each roster row's 'eligible'; td_ea_get adds max_players.
-- =====================================================================

alter table public.early_access add column if not exists max_players smallint;
alter table public.early_access drop constraint if exists early_access_max_players_check;
alter table public.early_access add constraint early_access_max_players_check check (max_players is null or max_players between 1 and 500);

/** Is this registrant inside the first max_players by registration order? */
create or replace function public._ea_in_cap(ea public.early_access, p_player uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select ea.max_players is null or coalesce((
    select 1 + count(*) from public.players o, public.players me
     where me.id = p_player and o.event_id = ea.event_id and o.id <> me.id
       and (coalesce(o.reg_order, 2147483647), o.created_at, o.id) < (coalesce(me.reg_order, 2147483647), me.created_at, me.id)
  ), 2147483647) <= ea.max_players
$$;

create or replace function public._ea_claims_cap() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare ea public.early_access;
begin
  if new.status not in ('pending', 'approved') then return new; end if;
  if tg_op = 'UPDATE' and new.status = old.status then return new; end if;
  select * into ea from public.early_access where event_id = new.event_id;
  if ea.event_id is not null and not public._ea_in_cap(ea, new.player_id) then raise exception 'early_access_full'; end if;
  return new;
end $$;
drop trigger if exists ea_claims_cap on public.ea_claims;
create trigger ea_claims_cap before insert or update of status on public.ea_claims for each row execute function public._ea_claims_cap();

create or replace function public.td_ea_set_max(p_event uuid, p_max int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._ea_need_td(p_event);
  if p_max is not null and p_max not between 1 and 500 then raise exception 'invalid_rules'; end if;
  update public.early_access set max_players = p_max where event_id = p_event;
end $$;
revoke execute on function public.td_ea_set_max(uuid, int) from public, anon;
grant execute on function public.td_ea_set_max(uuid, int) to authenticated;
revoke execute on function public._ea_in_cap(public.early_access, uuid) from public, anon, authenticated;

-- ---------- redefined from early_access (one more key each) ----------
create or replace function public.ea_public(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare ea public.early_access; e public.events; st jsonb;
begin
  ea := public._ea_by_slug(p_slug);
  select * into e from public.events where id = ea.event_id;
  st := public._ea_standings(ea.event_id);
  return jsonb_build_object(
    'event', jsonb_build_object('id', e.id, 'slug', e.slug, 'name', e.name, 'starts_on', e.starts_on),
    'pool', (select slug from public.tag_pools where id = ea.pool_id),
    'opens_on', ea.opens_on, 'closes_on', ea.closes_on, 'min_players', ea.min_players, 'weekly_cap', ea.weekly_cap,
    'max_players', ea.max_players, 'registered', (select count(*) from public.players where event_id = ea.event_id),
    'today', current_date,
    'roster', coalesce((select jsonb_agg(jsonb_build_object('player_id', p.id, 'name', p.name,
                  'joined', exists (select 1 from public.ea_claims c where c.event_id = ea.event_id and c.player_id = p.id and c.status = 'approved'),
                  'eligible', public._ea_in_cap(ea, p.id))
                  order by lower(p.name)) from public.players p where p.event_id = ea.event_id), '[]'),
    'standings', coalesce((select jsonb_agg(jsonb_build_object('name', x ->> 'name', 'nickname', x ->> 'nickname',
                  'tag', (x ->> 'tag')::int, 'tickets', (x ->> 'tickets')::int)) from jsonb_array_elements(st) x), '[]'),
    'winners', coalesce((select jsonb_agg(jsonb_build_object('name', m.name, 'nickname', m.nickname, 'at', d.at) order by d.id)
                  from public.ea_draws d join public.tag_members m on m.id = d.member_id
                 where d.event_id = ea.event_id and not d.void), '[]'));
end $$;

create or replace function public.td_ea_get(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare ea public.early_access; st jsonb;
begin
  if p_event is null or not public.can_td(p_event) then raise exception 'forbidden'; end if;
  select * into ea from public.early_access where event_id = p_event;
  if not found then return jsonb_build_object('on', false); end if;
  st := public._ea_standings(p_event);
  return jsonb_build_object('on', true,
    'pool', (select slug from public.tag_pools where id = ea.pool_id),
    'opens_on', ea.opens_on, 'closes_on', ea.closes_on, 'min_players', ea.min_players, 'weekly_cap', ea.weekly_cap, 'today', current_date,
    'max_players', ea.max_players,
    'players', (select count(*) from public.players where event_id = p_event),
    'claims', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'player_id', c.player_id, 'player', p.name, 'nickname', c.nickname,
                  'via', c.via, 'created_at', c.created_at,
                  'member', (select jsonb_build_object('id', m.id, 'name', m.name) from public.tag_members m
                              where m.id = c.member_id or (c.member_id is null and lower(btrim(m.name)) = lower(btrim(p.name))) limit 1),
                  'others', (select count(*) from public.ea_claims o where o.event_id = c.event_id and o.player_id = c.player_id
                              and o.status = 'pending' and o.id <> c.id)) order by c.created_at)
                from public.ea_claims c join public.players p on p.id = c.player_id
               where c.event_id = p_event and c.status = 'pending'), '[]'),
    'linked', coalesce((select jsonb_agg(jsonb_build_object('claim_id', c.id, 'player', p.name, 'member_id', m.id, 'member', m.name,
                  'nickname', m.nickname, 'via', c.via, 'at', c.decided_at,
                  'tag', (select t.number from public.tags t where t.pool_id = ea.pool_id and t.holder_id = m.id)) order by c.decided_at)
                from public.ea_claims c join public.players p on p.id = c.player_id join public.tag_members m on m.id = c.member_id
               where c.event_id = p_event and c.status = 'approved'), '[]'),
    'bonus', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'member_id', b.member_id, 'name', m.name, 'tickets', b.tickets,
                  'reason', b.reason, 'by', b.by_email, 'at', b.at) order by b.id desc)
                from public.ea_bonus b join public.tag_members m on m.id = b.member_id where b.event_id = p_event and not b.void), '[]'),
    'standings', st,
    'awards', jsonb_build_object(
       'iron', coalesce((select jsonb_agg(x order by (x ->> 'rounds')::int desc, x ->> 'name') from (
                  select x from jsonb_array_elements(st) x where (x ->> 'rounds')::int > 0
                   order by (x ->> 'rounds')::int desc, x ->> 'name' limit 5) z), '[]'),
       'collector', coalesce((select jsonb_agg(x order by (x ->> 'partners')::int desc, x ->> 'name') from (
                  select x from jsonb_array_elements(st) x where (x ->> 'partners')::int > 0
                   order by (x ->> 'partners')::int desc, x ->> 'name' limit 5) z), '[]'),
       'climb', coalesce((select jsonb_agg(x order by (x ->> 'start_tag')::int - (x ->> 'tag')::int desc, x ->> 'name') from (
                  select x from jsonb_array_elements(st) x where (x ->> 'tag') is not null and (x ->> 'start_tag') is not null
                     and (x ->> 'start_tag')::int > (x ->> 'tag')::int
                   order by (x ->> 'start_tag')::int - (x ->> 'tag')::int desc, x ->> 'name' limit 5) z), '[]')),
    'draws', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'member_id', d.member_id, 'name', m.name, 'nickname', m.nickname,
                  'tickets', d.tickets, 'at', d.at) order by d.id)
                from public.ea_draws d join public.tag_members m on m.id = d.member_id where d.event_id = p_event and not d.void), '[]'));
end $$;

-- ---------- data: Jewel XI early access is the first 50 registrants ----------
update public.early_access set max_players = 50 where event_id = (select id from public.events where slug = 'jewel-xi-2026');
