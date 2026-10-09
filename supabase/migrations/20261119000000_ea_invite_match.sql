-- =====================================================================
-- Early Access invites: find the person before making a new one (2026-10-09, Mike: "it's not recognizing him as the
-- same Hayden from our other tags" -> "add the suggested member list").
-- Source of truth: tag_members (one person, one My Tag link, every set's tags).
-- Rules:
--   * td_ea_invite_matches(event, typed name): up to 6 existing members who look like the typed name: same full name,
--     any typed word (2+ letters) that starts a word of their name or nickname. Best match first. Each comes with the
--     tags they hold and whether they're already in this event's Early Access.
--   * td_ea_invite_member(event, member): invite THAT member (their existing link, tags and history) instead of
--     creating a new person. Same claim + tag rules as td_ea_invite (shared in _ea_invite).
--   * td_ea_invite(event, name, nickname) is unchanged in behavior (exact-name reuse, else a new member).
-- =====================================================================

create or replace function public._ea_invite(p_event uuid, p_member uuid, p_nick text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare ea public.early_access; num int;
begin
  ea := public._ea_need_td(p_event);
  if not exists (select 1 from public.tag_members where id = p_member) then raise exception 'not_found'; end if;
  if exists (select 1 from public.ea_claims where event_id = p_event and member_id = p_member and status = 'approved') then raise exception 'member_already_joined'; end if;
  insert into public.ea_claims (event_id, player_id, member_id, nickname, via, status, decided_at, decided_by)
  values (p_event, null, p_member, p_nick, 'invite', 'approved', now(), public.my_email());
  select number into num from public.tags where pool_id = ea.pool_id and holder_id = p_member;
  if num is null then
    perform 1 from public.tags where pool_id = ea.pool_id for update;
    num := (select coalesce(max(number), 0) + 1 from public.tags where pool_id = ea.pool_id);
    insert into public.tags (pool_id, number, holder_id, status) values (ea.pool_id, num, p_member, 'held');
    insert into public.tag_history (pool_id, number, kind, member_id) values (ea.pool_id, num, 'issued', p_member);
  end if;
  return jsonb_build_object('member_id', p_member, 'name', (select name from public.tag_members where id = p_member), 'number', num,
    'token', (select token from public.tag_members where id = p_member));
end $$;

create or replace function public.td_ea_invite(p_event uuid, p_name text, p_nickname text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_name text := btrim(coalesce(p_name, '')); v_nick text := nullif(btrim(coalesce(p_nickname, '')), ''); mid uuid;
begin
  perform public._ea_need_td(p_event);
  if length(v_name) not between 1 and 60 then raise exception 'name_required'; end if;
  if v_nick is not null and length(v_nick) > 40 then raise exception 'invalid_nickname'; end if;
  select id into mid from public.tag_members where lower(btrim(name)) = lower(v_name);
  if mid is null then
    insert into public.tag_members (name, nickname) values (v_name, v_nick) returning id into mid;
  else
    update public.tag_members set nickname = v_nick where id = mid and nickname is null and v_nick is not null;
  end if;
  return public._ea_invite(p_event, mid, v_nick);
end $$;

/** Invite someone who's already a member (keeps their link, tags and history). */
create or replace function public.td_ea_invite_member(p_event uuid, p_member uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return public._ea_invite(p_event, p_member, null);
end $$;

/** Members who look like the typed name, best first. */
create or replace function public.td_ea_invite_matches(p_event uuid, p_name text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v text := lower(btrim(coalesce(p_name, ''))); words text[];
begin
  perform public._ea_need_td(p_event);
  words := array(select w from regexp_split_to_table(v, '[^[:alnum:]'']+') w where length(w) >= 2);
  if cardinality(words) = 0 then return '[]'; end if;
  return coalesce((select jsonb_agg(x.j order by x.score desc, x.name) from (
    select m.name, jsonb_build_object('id', m.id, 'name', m.name, 'nickname', m.nickname,
             'tags', coalesce((select jsonb_agg(po.name || ' #' || t.number order by po.sort, po.name)
                                 from public.tags t join public.tag_pools po on po.id = t.pool_id where t.holder_id = m.id and t.status = 'held'), '[]'),
             'joined', exists (select 1 from public.ea_claims c where c.event_id = p_event and c.member_id = m.id and c.status = 'approved')) j,
           (case when lower(btrim(m.name)) = v then 100 else 0 end)
           + (select count(*) from unnest(words) w
               where lower(m.name) ~ ('(^|[^[:alnum:]])' || public._re_escape(w))
                  or lower(coalesce(m.nickname, '')) ~ ('(^|[^[:alnum:]])' || public._re_escape(w)))::int * 10
           + (case when lower(split_part(btrim(m.name), ' ', 1)) = words[1] then 5 else 0 end) score
      from public.tag_members m
     where lower(btrim(m.name)) = v
        or exists (select 1 from unnest(words) w
                    where lower(m.name) ~ ('(^|[^[:alnum:]])' || public._re_escape(w))
                       or lower(coalesce(m.nickname, '')) ~ ('(^|[^[:alnum:]])' || public._re_escape(w)))
     order by score desc, m.name limit 6) x), '[]');
end $$;

revoke all on function public._ea_invite(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.td_ea_invite_member(uuid, uuid), public.td_ea_invite_matches(uuid, text) from public, anon;
grant execute on function public.td_ea_invite_member(uuid, uuid), public.td_ea_invite_matches(uuid, text) to authenticated;
