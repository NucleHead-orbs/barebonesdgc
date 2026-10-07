-- =====================================================================
-- TD ROUNDS (locked 2026-10-07, Mike: "Is there a way I can see these rounds easier?" -> "TD panel with controls").
-- Source of truth: tag_challenges + tag_challenge_joins (challenge rounds), tag_casual + tag_casual_players (casual
-- rounds). No new tables.
-- Rules:
--   * Pool admins only (_need_tag(pool), same gate as Heat and chat moderation).
--   * td_tag_rounds(pool): every accepted challenge round (scheduled or not) and every casual round that isn't called
--     off, from 6 h before now (still being played) onward, with who's on each card.
--   * td_round_add / td_round_remove(kind 'challenge'|'casual', id, member): the TD's hand. No time windows (that's the
--     point: late jump-ins, after-tee dropouts), but the same card rules: tag in the set, card of 10, the two
--     challenge players and the casual host stay on (call it off / void it instead). Rounds more than 6 h past tee
--     are over ('td_round_over').
--   * Every change posts to the set's Board ("... by the TD") and @-pings the player it was about.
-- =====================================================================

create or replace function public._td_round_post(p_pool uuid, p_event text, p_body text, p_member uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare chat bigint;
begin
  chat := public._tag_news(p_pool, p_event, p_body);
  if chat is not null then
    insert into public.tag_chat_mentions (chat_id, member_id, label) values (chat, p_member, public._tag_short(p_member)) on conflict do nothing;
  end if;
end $$;

/** Upcoming tag rounds in a set, for the TD. */
create or replace function public.td_tag_rounds(p_pool uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._need_tag(p_pool);
  return coalesce((select jsonb_agg(x order by (x ->> 'tee_at') is null, (x ->> 'tee_at')::timestamptz, x ->> 'created_at') from (
    select jsonb_build_object(
      'kind', 'challenge', 'id', c.id, 'tee_at', c.tee_at, 'course', (select name from public.courses where id = c.course_id),
      'locked', c.locked_at is not null, 'due_at', c.due_at, 'created_at', c.created_at, 'note', null,
      'title', public._tag_short(c.challenger_id) || ' vs ' || public._tag_short(c.challenged_id),
      'players', (select jsonb_agg(p order by p ->> 'ord', p ->> 'at') from (
          select jsonb_build_object('id', m.id, 'name', m.name, 'nickname', m.nickname, 'role', r.role, 'ord', r.ord, 'at', r.at,
                   'number', (select number from public.tags where pool_id = c.pool_id and holder_id = m.id)) p
            from (values (c.challenger_id, 'challenger', '0', c.created_at), (c.challenged_id, 'challenged', '1', c.created_at)) r(id, role, ord, at)
            join public.tag_members m on m.id = r.id
          union all
          select jsonb_build_object('id', m.id, 'name', m.name, 'nickname', m.nickname, 'role', 'jumpin', 'ord', '2', 'at', j.joined_at,
                   'number', (select number from public.tags where pool_id = c.pool_id and holder_id = m.id))
            from public.tag_challenge_joins j join public.tag_members m on m.id = j.member_id where j.challenge_id = c.id) q)
    ) x
      from public.tag_challenges c
     where c.pool_id = p_pool and c.status = 'accepted' and (c.tee_at is null or c.tee_at > now() - interval '6 hours')
    union all
    select jsonb_build_object(
      'kind', 'casual', 'id', i.id, 'tee_at', i.tee_at, 'course', (select name from public.courses where id = i.course_id),
      'locked', true, 'due_at', null, 'created_at', i.created_at, 'note', i.note,
      'title', public._tag_short(i.host_id) || '''s casual round',
      'players', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'nickname', m.nickname,
                   'role', case when m.id = i.host_id then 'host' else ip.status end,
                   'number', (select number from public.tags where pool_id = i.pool_id and holder_id = m.id))
                   order by m.id <> i.host_id, ip.status = 'in' desc, ip.at)
                 from public.tag_casual_players ip join public.tag_members m on m.id = ip.member_id where ip.invite_id = i.id), '[]')
    )
      from public.tag_casual i
     where i.pool_id = p_pool and i.cancelled_at is null and i.tee_at > now() - interval '6 hours'
  ) s(x)), '[]');
end $$;

/** TD puts a tag holder on a round. */
create or replace function public.td_round_add(p_kind text, p_id uuid, p_member uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.tag_challenges; i public.tag_casual; v_pool uuid; v_tee timestamptz; n int;
begin
  if p_kind = 'challenge' then
    select * into c from public.tag_challenges where id = p_id for update;
    if c.id is null or c.status <> 'accepted' then raise exception 'not_found'; end if;
    v_pool := c.pool_id; v_tee := c.tee_at;
  elsif p_kind = 'casual' then
    select * into i from public.tag_casual where id = p_id for update;
    if i.id is null or i.cancelled_at is not null then raise exception 'not_found'; end if;
    v_pool := i.pool_id; v_tee := i.tee_at;
  else raise exception 'td_bad_kind'; end if;
  perform public._need_tag(v_pool);
  if v_tee is not null and v_tee < now() - interval '6 hours' then raise exception 'td_round_over'; end if;
  if not exists (select 1 from public.tags where pool_id = v_pool and holder_id = p_member) then raise exception 'td_not_in_set'; end if;

  if p_kind = 'challenge' then
    if p_member in (c.challenger_id, c.challenged_id)
       or exists (select 1 from public.tag_challenge_joins where challenge_id = c.id and member_id = p_member) then raise exception 'td_already_on'; end if;
    if (select count(*) from public.tag_challenge_joins where challenge_id = c.id) >= 8 then raise exception 'td_round_full'; end if;
    insert into public.tag_challenge_joins (challenge_id, member_id) values (c.id, p_member);
    n := 8 - (select count(*) from public.tag_challenge_joins where challenge_id = c.id);
    perform public._td_round_post(v_pool, 'jumpin', public._tag_who(v_pool, p_member) || ' was added to ' || public._tag_who(v_pool, c.challenger_id)
      || ' vs ' || public._tag_who(v_pool, c.challenged_id) || coalesce(' (' || public._tag_slot_text(c.tee_at, c.course_id) || ')', '') || ' by the TD.'
      || case when n <= 0 then ' Card''s full.' else '' end, p_member);
  else
    if exists (select 1 from public.tag_casual_players where invite_id = i.id and member_id = p_member and status = 'in') then raise exception 'td_already_on'; end if;
    if (select count(*) from public.tag_casual_players where invite_id = i.id and status = 'in') >= 10 then raise exception 'td_round_full'; end if;
    insert into public.tag_casual_players (invite_id, member_id, status, invited) values (i.id, p_member, 'in', false)
    on conflict (invite_id, member_id) do update set status = 'in', at = now();
    n := 10 - (select count(*) from public.tag_casual_players where invite_id = i.id and status = 'in');
    perform public._td_round_post(v_pool, 'jumpin', public._tag_who(v_pool, p_member) || ' was added to ' || public._tag_short(i.host_id) || '''s round ('
      || public._tag_slot_text(i.tee_at, i.course_id) || ') by the TD.' || case when n <= 0 then ' Card''s full.' else '' end, p_member);
  end if;
end $$;

/** TD takes a player off a round (not the two challenge players, not the casual host). */
create or replace function public.td_round_remove(p_kind text, p_id uuid, p_member uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.tag_challenges; i public.tag_casual; r public.tag_casual_players; v_pool uuid; v_tee timestamptz;
begin
  if p_kind = 'challenge' then
    select * into c from public.tag_challenges where id = p_id for update;
    if c.id is null or c.status <> 'accepted' then raise exception 'not_found'; end if;
    v_pool := c.pool_id; v_tee := c.tee_at;
  elsif p_kind = 'casual' then
    select * into i from public.tag_casual where id = p_id for update;
    if i.id is null or i.cancelled_at is not null then raise exception 'not_found'; end if;
    v_pool := i.pool_id; v_tee := i.tee_at;
  else raise exception 'td_bad_kind'; end if;
  perform public._need_tag(v_pool);
  if v_tee is not null and v_tee < now() - interval '6 hours' then raise exception 'td_round_over'; end if;

  if p_kind = 'challenge' then
    if p_member in (c.challenger_id, c.challenged_id) then raise exception 'td_main_player'; end if;
    delete from public.tag_challenge_joins where challenge_id = c.id and member_id = p_member;
    if not found then raise exception 'td_not_on'; end if;
    perform public._td_round_post(v_pool, 'dropout', public._tag_who(v_pool, p_member) || ' was taken off ' || public._tag_who(v_pool, c.challenger_id)
      || ' vs ' || public._tag_who(v_pool, c.challenged_id) || coalesce(' (' || public._tag_slot_text(c.tee_at, c.course_id) || ')', '') || ' by the TD.', p_member);
  else
    if p_member = i.host_id then raise exception 'td_host'; end if;
    select * into r from public.tag_casual_players where invite_id = i.id and member_id = p_member;
    if r.member_id is null or r.status = 'out' then raise exception 'td_not_on'; end if;
    if r.invited then update public.tag_casual_players set status = 'out', at = now() where invite_id = i.id and member_id = p_member;
    else delete from public.tag_casual_players where invite_id = i.id and member_id = p_member; end if;
    if r.status = 'in' then
      perform public._td_round_post(v_pool, 'dropout', public._tag_who(v_pool, p_member) || ' was taken off ' || public._tag_short(i.host_id) || '''s round ('
        || public._tag_slot_text(i.tee_at, i.course_id) || ') by the TD.', p_member);
    end if;
  end if;
end $$;

revoke all on function public._td_round_post(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.td_tag_rounds(uuid), public.td_round_add(text, uuid, uuid), public.td_round_remove(text, uuid, uuid) from public, anon;
grant execute on function public.td_tag_rounds(uuid), public.td_round_add(text, uuid, uuid), public.td_round_remove(text, uuid, uuid) to authenticated;
