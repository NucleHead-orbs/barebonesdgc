-- Early Access invites (locked 2026-10-05, Mike: "a way for me to send out unique invites in addition to the early access
-- tournament players ... Greg Wood & Jack Selleh ... if we can get them to be able to use this - we've made it grandpa proof!").
-- Answers: full Early Access (tag, raffle tickets, count as Jewel players); outside the 50 spots; delivered by text + a
-- printable QR card; plus a welcome tour on My Tag (frontend).
-- Source of truth: an invite is an ea_claims row with via = 'invite' and no registrant (player_id null), approved at once.
-- Everything that reads approved claims (tickets, standings, the 3-player rule, remove) treats it like any joined player.
-- Rules:
--   * td_ea_invite(event, name, nickname): any TD of the event. Reuses the club member with that name (case-insensitive)
--     or creates one; issues the next tag at the bottom of the set; returns the member's My Tag link token.
--   * Invites skip the registrant cap (max_players) and never appear on the public registrant roster; they do appear in
--     the standings like everyone else.
--   * One join per member per event (unchanged). REMOVE works the same (tag back to available).
-- =====================================================================

alter table public.ea_claims alter column player_id drop not null;
alter table public.ea_claims drop constraint if exists ea_claims_via_check;
alter table public.ea_claims add constraint ea_claims_via_check check (via in ('page', 'mytag', 'invite'));
alter table public.ea_claims drop constraint if exists ea_claims_invite_check;
alter table public.ea_claims add constraint ea_claims_invite_check check ((via = 'invite') = (player_id is null) and (via <> 'invite' or status <> 'pending'));

create or replace function public._ea_claims_cap() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare ea public.early_access;
begin
  if new.via = 'invite' then return new; end if;  -- invites are on top of the registrant spots
  if new.status not in ('pending', 'approved') then return new; end if;
  if tg_op = 'UPDATE' and new.status = old.status then return new; end if;
  select * into ea from public.early_access where event_id = new.event_id;
  if ea.event_id is not null and not public._ea_in_cap(ea, new.player_id) then raise exception 'early_access_full'; end if;
  return new;
end $$;

/** Invite someone who isn't a registrant. Returns {member_id, name, number, token}. */
create or replace function public.td_ea_invite(p_event uuid, p_name text, p_nickname text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare ea public.early_access; v_name text := btrim(coalesce(p_name, '')); v_nick text := nullif(btrim(coalesce(p_nickname, '')), ''); mid uuid; num int;
begin
  ea := public._ea_need_td(p_event);
  if length(v_name) not between 1 and 60 then raise exception 'name_required'; end if;
  if v_nick is not null and length(v_nick) > 40 then raise exception 'invalid_nickname'; end if;
  select id into mid from public.tag_members where lower(btrim(name)) = lower(v_name);
  if mid is null then
    insert into public.tag_members (name, nickname) values (v_name, v_nick) returning id into mid;
  else
    update public.tag_members set nickname = v_nick where id = mid and nickname is null and v_nick is not null;
  end if;
  if exists (select 1 from public.ea_claims where event_id = p_event and member_id = mid and status = 'approved') then raise exception 'member_already_joined'; end if;
  insert into public.ea_claims (event_id, player_id, member_id, nickname, via, status, decided_at, decided_by)
  values (p_event, null, mid, v_nick, 'invite', 'approved', now(), public.my_email());
  select number into num from public.tags where pool_id = ea.pool_id and holder_id = mid;
  if num is null then
    perform 1 from public.tags where pool_id = ea.pool_id for update;
    num := (select coalesce(max(number), 0) + 1 from public.tags where pool_id = ea.pool_id);
    insert into public.tags (pool_id, number, holder_id, status) values (ea.pool_id, num, mid, 'held');
    insert into public.tag_history (pool_id, number, kind, member_id) values (ea.pool_id, num, 'issued', mid);
  end if;
  return jsonb_build_object('member_id', mid, 'name', (select name from public.tag_members where id = mid), 'number', num,
    'token', (select token from public.tag_members where id = mid));
end $$;
revoke execute on function public.td_ea_invite(uuid, text, text) from public, anon;
grant execute on function public.td_ea_invite(uuid, text, text) to authenticated;

-- ---------- redefined from ea_cap: joined list includes invites (name from the member, link for re-sending) ----------
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
    'linked', coalesce((select jsonb_agg(jsonb_build_object('claim_id', c.id, 'player', coalesce(p.name, m.name), 'member_id', m.id, 'member', m.name,
                  'nickname', m.nickname, 'via', c.via, 'at', c.decided_at,
                  'tag', (select t.number from public.tags t where t.pool_id = ea.pool_id and t.holder_id = m.id),
                  'token', case when c.via = 'invite' then m.token end) order by c.decided_at)
                from public.ea_claims c left join public.players p on p.id = c.player_id join public.tag_members m on m.id = c.member_id
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
