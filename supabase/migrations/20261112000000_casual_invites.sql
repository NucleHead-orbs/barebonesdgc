-- =====================================================================
-- Casual round invites + 6-player challenge cards (locked 2026-10-07, Mike: "players who are more than 5 spots away can
-- still invite players for a round, they just aren't beholden to a tag match, it's optional. Jump-ins should be increased
-- to 6 total spots on a card." Choices: host picks players + open seats; tags decided at tee-off on the Scorecard;
-- anyone with a tag in the set can send one).
--
-- Source of truth:
--   tag_casual          : one casual round (set, host, tee time, course, note). cancelled_at = called off by the host.
--   tag_casual_players  : who's on it. status 'in' | 'invited' (asked, no answer) | 'out' (asked, said no).
--                         invited = the host asked them (false = they jumped in). The host is a row too ('in').
-- Rules:
--   * Host: holds a tag in the set. Tee time 15 min to 30 days out, a library course, up to 5 invited players who hold a
--     tag in the set (any distance on the board), a note up to 200 chars. Max 3 upcoming invites per host per set.
--   * A card holds 6. Seats aren't reserved: invited or not, the first to say IN gets the seat until 6 are in.
--   * Anyone with a tag in the set can jump in; invited players answer IN / OUT. Everyone but the host can drop out.
--     All of it closes at tee time. The host can call it off before tee time.
--   * Nothing here touches tags: the round is saved on the Scorecard, where the scorer ticks the tag sets to put on the
--     line at tee-off (all the usual rules, Early Access included).
--   * Board posts (only sets with the Board on): the invite (with @mentions, so invited players get the @ ping),
--     jump-ins / drop-outs, called off.
-- Challenge rounds: jump-ins go from 2 to 4, so a challenge card can be 6 too.
-- =====================================================================

alter table public.tag_chat drop constraint if exists tag_chat_kind_check;
alter table public.tag_chat add constraint tag_chat_kind_check check (
  (kind = 'chat' and event is null) or
  (kind = 'system' and member_id is null and event in ('challenge', 'accepted', 'declined', 'expired', 'played', 'lapsed', 'bomb', 'penalty', 'matchmaker',
                                                       'scheduled', 'jumpin', 'dropout', 'vouched', 'result', 'invite', 'invite_off')));

-- ---------- challenge rounds: 4 jump-ins (a card of 6) ----------
create or replace function public.tag_challenge_slot_ok(p_token text, p_challenge uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members; c public.tag_challenges;
begin
  me := public._tag_member(p_token);
  select * into c from public.tag_challenges where id = p_challenge for update;
  if c.id is null or me.id not in (c.challenger_id, c.challenged_id) then raise exception 'not_your_challenge'; end if;
  if c.status <> 'accepted' then raise exception 'challenge_%', c.status; end if;
  if c.tee_at is null then raise exception 'no_slot'; end if;
  if c.slot_by = me.id then raise exception 'other_player_oks'; end if;
  if c.locked_at is not null then return; end if;
  if now() >= c.tee_at - interval '2 hours' then raise exception 'slot_closed'; end if;
  update public.tag_challenges set locked_at = now() where id = c.id;
  perform public._tag_news(c.pool_id, 'scheduled', public._tag_who(c.pool_id, c.challenger_id) || ' vs ' || public._tag_who(c.pool_id, c.challenged_id)
    || ' is on: ' || public._tag_slot_text(c.tee_at, c.course_id) || '. 4 spots to jump in on My Tag > MATCHUPS.');
end $$;

create or replace function public.tag_challenge_join(p_token text, p_challenge uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members; c public.tag_challenges; n int;
begin
  me := public._tag_member(p_token);
  select * into c from public.tag_challenges where id = p_challenge for update;
  if c.id is null or c.status <> 'accepted' or c.locked_at is null then raise exception 'not_open'; end if;
  if now() >= c.tee_at - interval '2 hours' then raise exception 'slot_closed'; end if;
  if me.id in (c.challenger_id, c.challenged_id) then raise exception 'already_in'; end if;
  if not exists (select 1 from public.tags where pool_id = c.pool_id and holder_id = me.id) then raise exception 'no_tag_in_pool'; end if;
  if exists (select 1 from public.tag_challenge_joins where challenge_id = c.id and member_id = me.id) then raise exception 'already_in'; end if;
  if (select count(*) from public.tag_challenge_joins where challenge_id = c.id) >= 4 then raise exception 'round_full'; end if;
  insert into public.tag_challenge_joins (challenge_id, member_id) values (c.id, me.id);
  n := 4 - (select count(*) from public.tag_challenge_joins where challenge_id = c.id);
  perform public._tag_news(c.pool_id, 'jumpin', public._tag_who(c.pool_id, me.id) || ' jumped into ' || public._tag_who(c.pool_id, c.challenger_id)
    || ' vs ' || public._tag_who(c.pool_id, c.challenged_id) || ' (' || public._tag_slot_text(c.tee_at, c.course_id) || ').'
    || case when n <= 0 then ' Card''s full.' when n = 1 then ' 1 spot left.' else ' ' || n || ' spots left.' end);
end $$;

-- ---------- casual invites ----------
create table if not exists public.tag_casual (
  id           uuid primary key default gen_random_uuid(),
  pool_id      uuid not null references public.tag_pools(id) on delete cascade,
  host_id      uuid not null references public.tag_members(id) on delete cascade,
  tee_at       timestamptz not null,
  course_id    uuid references public.courses(id) on delete set null,
  note         text check (note is null or length(note) <= 200),
  created_at   timestamptz not null default now(),
  cancelled_at timestamptz
);
create index if not exists tag_casual_pool_tee on public.tag_casual (pool_id, tee_at);
create table if not exists public.tag_casual_players (
  invite_id uuid not null references public.tag_casual(id) on delete cascade,
  member_id uuid not null references public.tag_members(id) on delete cascade,
  status    text not null check (status in ('in', 'invited', 'out')),
  invited   boolean not null default false,
  at        timestamptz not null default now(),
  primary key (invite_id, member_id)
);
alter table public.tag_casual enable row level security;
alter table public.tag_casual_players enable row level security;
revoke all on public.tag_casual, public.tag_casual_players from anon, authenticated;

create or replace function public._tag_short(p_member uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif(btrim(nickname), ''), name) from public.tag_members where id = p_member
$$;

/** Send a casual round invite. Returns its id. */
create or replace function public.tag_casual_create(p_token text, p_pool uuid, p_tee timestamptz, p_course uuid, p_members uuid[], p_note text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members; v_id uuid; ids uuid[] := array(select distinct x from unnest(coalesce(p_members, '{}')) x where x is not null);
        v_note text := nullif(btrim(coalesce(p_note, '')), ''); chat bigint; names text;
begin
  me := public._tag_member(p_token);
  if not exists (select 1 from public.tags where pool_id = p_pool and holder_id = me.id) then raise exception 'no_tag_in_pool'; end if;
  if p_tee is null or p_tee < now() + interval '15 minutes' then raise exception 'slot_too_soon'; end if;
  if p_tee > now() + interval '30 days' then raise exception 'slot_too_far'; end if;
  if p_course is null or not exists (select 1 from public.courses where id = p_course) then raise exception 'unknown_course'; end if;
  if cardinality(ids) > 5 then raise exception 'too_many_players'; end if;
  if me.id = any(ids) then raise exception 'invite_yourself'; end if;
  if exists (select 1 from unnest(ids) x where not exists (select 1 from public.tags t where t.pool_id = p_pool and t.holder_id = x)) then
    raise exception 'not_in_set';
  end if;
  if length(coalesce(v_note, '')) > 200 then raise exception 'note_too_long'; end if;
  if (select count(*) from public.tag_casual where pool_id = p_pool and host_id = me.id and cancelled_at is null and tee_at > now()) >= 3 then
    raise exception 'too_many_invites';
  end if;

  insert into public.tag_casual (pool_id, host_id, tee_at, course_id, note) values (p_pool, me.id, p_tee, p_course, v_note) returning id into v_id;
  insert into public.tag_casual_players (invite_id, member_id, status, invited) values (v_id, me.id, 'in', false);
  insert into public.tag_casual_players (invite_id, member_id, status, invited) select v_id, x, 'invited', true from unnest(ids) x;

  select string_agg('@' || public._tag_short(x), ', ' order by public._tag_short(x)) into names from unnest(ids) x;
  chat := public._tag_news(p_pool, 'invite', public._tag_who(p_pool, me.id) || ' is playing ' || public._tag_slot_text(p_tee, p_course) || '. '
    || coalesce('Invited: ' || names || '. ', '') || 'Casual round, up to 6: jump in on My Tag > MATCHUPS.'
    || coalesce(' "' || v_note || '"', ''));
  if chat is not null then
    insert into public.tag_chat_mentions (chat_id, member_id, label) select chat, x, public._tag_short(x) from unnest(ids) x on conflict do nothing;
  end if;
  return v_id;
end $$;

/** IN (invited or jumping in) / OUT (drop out or decline). */
create or replace function public.tag_casual_answer(p_token text, p_invite uuid, p_in boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members; i public.tag_casual; r public.tag_casual_players; n int;
begin
  me := public._tag_member(p_token);
  select * into i from public.tag_casual where id = p_invite for update;
  if i.id is null or i.cancelled_at is not null then raise exception 'not_open'; end if;
  if now() >= i.tee_at then raise exception 'slot_closed'; end if;
  if not exists (select 1 from public.tags where pool_id = i.pool_id and holder_id = me.id) then raise exception 'no_tag_in_pool'; end if;
  select * into r from public.tag_casual_players where invite_id = i.id and member_id = me.id;
  if p_in then
    if r.status = 'in' then return; end if;
    if (select count(*) from public.tag_casual_players where invite_id = i.id and status = 'in') >= 6 then raise exception 'round_full'; end if;
    insert into public.tag_casual_players (invite_id, member_id, status, invited) values (i.id, me.id, 'in', false)
    on conflict (invite_id, member_id) do update set status = 'in', at = now();
    n := 6 - (select count(*) from public.tag_casual_players where invite_id = i.id and status = 'in');
    perform public._tag_news(i.pool_id, 'jumpin', public._tag_who(i.pool_id, me.id) || ' is in for ' || public._tag_short(i.host_id) || '''s round ('
      || public._tag_slot_text(i.tee_at, i.course_id) || ').' || case when n <= 0 then ' Card''s full.' when n = 1 then ' 1 seat left.' else ' ' || n || ' seats left.' end);
  else
    if me.id = i.host_id then raise exception 'host_cancels'; end if;
    if r.member_id is null or r.status = 'out' then return; end if;
    if r.invited then update public.tag_casual_players set status = 'out', at = now() where invite_id = i.id and member_id = me.id;
    else delete from public.tag_casual_players where invite_id = i.id and member_id = me.id; end if;
    if r.status = 'in' then
      perform public._tag_news(i.pool_id, 'dropout', public._tag_who(i.pool_id, me.id) || ' dropped out of ' || public._tag_short(i.host_id)
        || '''s round (' || public._tag_slot_text(i.tee_at, i.course_id) || '). A seat just opened.');
    end if;
  end if;
end $$;

/** The host calls it off (before tee time). */
create or replace function public.tag_casual_cancel(p_token text, p_invite uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members; i public.tag_casual;
begin
  me := public._tag_member(p_token);
  select * into i from public.tag_casual where id = p_invite for update;
  if i.id is null or i.host_id <> me.id then raise exception 'not_your_invite'; end if;
  if i.cancelled_at is not null then return; end if;
  if now() >= i.tee_at then raise exception 'slot_closed'; end if;
  update public.tag_casual set cancelled_at = now() where id = i.id;
  perform public._tag_news(i.pool_id, 'invite_off', public._tag_who(i.pool_id, me.id) || ' called off the round ' || public._tag_slot_text(i.tee_at, i.course_id) || '.');
end $$;

/** Casual invites in my sets: upcoming (and up to 6 h after tee, while it's being played), not called off. */
create or replace function public.tag_casuals(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me public.tag_members;
begin
  me := public._tag_member(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'pool_id', i.pool_id, 'pool', po.slug, 'pool_name', po.name,
      'host', (select jsonb_build_object('id', m.id, 'name', m.name, 'nickname', m.nickname, 'number', (select number from public.tags where pool_id = i.pool_id and holder_id = m.id)) from public.tag_members m where m.id = i.host_id),
      'tee_at', i.tee_at, 'course_id', i.course_id, 'course', (select name from public.courses where id = i.course_id), 'note', i.note,
      'mine', (select status from public.tag_casual_players where invite_id = i.id and member_id = me.id),
      'host_me', i.host_id = me.id,
      'open', now() < i.tee_at,
      'players', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'nickname', m.nickname,
                  'number', (select number from public.tags where pool_id = i.pool_id and holder_id = m.id), 'status', ip.status, 'invited', ip.invited)
                  order by ip.status = 'in' desc, ip.at)
                from public.tag_casual_players ip join public.tag_members m on m.id = ip.member_id where ip.invite_id = i.id), '[]')
    ) order by i.tee_at)
    from public.tag_casual i join public.tag_pools po on po.id = i.pool_id
   where i.cancelled_at is null and i.tee_at > now() - interval '6 hours'
     and exists (select 1 from public.tags t where t.pool_id = i.pool_id and t.holder_id = me.id)), '[]');
end $$;

revoke all on function public._tag_short(uuid) from public, anon, authenticated;
revoke all on function public.tag_casual_create(text, uuid, timestamptz, uuid, uuid[], text), public.tag_casual_answer(text, uuid, boolean),
  public.tag_casual_cancel(text, uuid), public.tag_casuals(text) from public;
grant execute on function public.tag_casual_create(text, uuid, timestamptz, uuid, uuid[], text), public.tag_casual_answer(text, uuid, boolean),
  public.tag_casual_cancel(text, uuid), public.tag_casuals(text) to anon, authenticated;
