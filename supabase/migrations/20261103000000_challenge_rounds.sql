-- Challenge rounds: a time + course, and jump-ins (locked 2026-10-05, Mike: "let's add the ability for players to 'jump in' on a
-- scheduled challenge round. The jump-in player cannot select the time or course but can jump in before it's finalized.")
-- Answers: the challenged player picks; the challenger OKs or proposes another slot; locked when both agree; jump-ins close
-- 2 hours before tee time; anyone holding a tag in the set, max 2 (a card of 4), their tags on the line too; no kicking
-- (a jump-in can drop out before it closes).
-- Source of truth:
--   tag_challenges.tee_at / course_id : the proposed slot. slot_by = who proposed it. locked_at = when the other one OK'd it
--                                      (null = not agreed yet). Only on an accepted challenge.
--   tag_challenge_joins               : jump-ins (challenge, member). Max 2 per challenge.
-- Rules:
--   * The first slot comes from the challenged player. After that either one may propose a new slot (it unlocks until the
--     other OKs). The slot must be in the future and no later than the challenge's play-by date (due_at).
--   * Proposing/OKing a slot is closed once jump-ins close (tee_at - 2 h).
--   * Jump in: the slot is locked, now < tee_at - 2 h, you hold a tag in the set, you're not one of the two, a spot is
--     left. Drop out: same window. No one else can remove you.
--   * The round is played and saved as usual (Scorecard, tags on the line). The challenge is settled by the two of them
--     being on the applied tag round (unchanged); jump-ins' tags move like any tag round.
--   * Board news: slot locked, jump-in, drop-out. Every write is a function; the new table has no client grants.
-- =====================================================================

alter table public.tag_challenges add column if not exists tee_at timestamptz;
alter table public.tag_challenges add column if not exists course_id uuid references public.courses(id) on delete set null;
alter table public.tag_challenges add column if not exists slot_by uuid references public.tag_members(id) on delete set null;
alter table public.tag_challenges add column if not exists locked_at timestamptz;

create table if not exists public.tag_challenge_joins (
  challenge_id uuid not null references public.tag_challenges(id) on delete cascade,
  member_id    uuid not null references public.tag_members(id) on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (challenge_id, member_id)
);
alter table public.tag_challenge_joins enable row level security;
revoke all on public.tag_challenge_joins from anon, authenticated;

alter table public.tag_chat drop constraint if exists tag_chat_kind_check;
alter table public.tag_chat add constraint tag_chat_kind_check check (
  (kind = 'chat' and event is null) or
  (kind = 'system' and member_id is null and event in ('challenge', 'accepted', 'declined', 'expired', 'played', 'lapsed', 'bomb', 'penalty', 'matchmaker',
                                                      'scheduled', 'jumpin', 'dropout')));

create or replace function public._tag_slot_text(p_tee timestamptz, p_course uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select to_char(p_tee at time zone 'America/Phoenix', 'Dy Mon FMDD, FMHH12:MIam') || coalesce(' at ' || (select name from public.courses where id = p_course), '')
$$;

/** Propose the slot (time + course). The challenged player goes first; then either can counter until the other OKs. */
create or replace function public.tag_challenge_slot(p_token text, p_challenge uuid, p_tee timestamptz, p_course uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members; c public.tag_challenges;
begin
  me := public._tag_member(p_token);
  select * into c from public.tag_challenges where id = p_challenge for update;
  if c.id is null or me.id not in (c.challenger_id, c.challenged_id) then raise exception 'not_your_challenge'; end if;
  if c.status <> 'accepted' then raise exception 'challenge_%', c.status; end if;
  if c.tee_at is null and me.id <> c.challenged_id then raise exception 'defender_picks'; end if;
  if c.tee_at is not null and now() >= c.tee_at - interval '2 hours' then raise exception 'slot_closed'; end if;
  if p_tee is null or p_tee <= now() + interval '2 hours' then raise exception 'slot_too_soon'; end if;
  if p_tee > c.due_at then raise exception 'slot_after_due'; end if;
  if p_course is null or not exists (select 1 from public.courses where id = p_course) then raise exception 'unknown_course'; end if;
  update public.tag_challenges set tee_at = p_tee, course_id = p_course, slot_by = me.id, locked_at = null where id = c.id;
end $$;

/** OK the other player's slot: it's locked and jump-ins open. */
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
    || ' is on: ' || public._tag_slot_text(c.tee_at, c.course_id) || '. 2 spots to jump in on My Tag > MATCHUPS.');
end $$;

/** Jump in on a locked challenge round. */
create or replace function public.tag_challenge_join(p_token text, p_challenge uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members; c public.tag_challenges;
begin
  me := public._tag_member(p_token);
  select * into c from public.tag_challenges where id = p_challenge for update;
  if c.id is null or c.status <> 'accepted' or c.locked_at is null then raise exception 'not_open'; end if;
  if now() >= c.tee_at - interval '2 hours' then raise exception 'slot_closed'; end if;
  if me.id in (c.challenger_id, c.challenged_id) then raise exception 'already_in'; end if;
  if not exists (select 1 from public.tags where pool_id = c.pool_id and holder_id = me.id) then raise exception 'no_tag_in_pool'; end if;
  if exists (select 1 from public.tag_challenge_joins where challenge_id = c.id and member_id = me.id) then raise exception 'already_in'; end if;
  if (select count(*) from public.tag_challenge_joins where challenge_id = c.id) >= 2 then raise exception 'round_full'; end if;
  insert into public.tag_challenge_joins (challenge_id, member_id) values (c.id, me.id);
  perform public._tag_news(c.pool_id, 'jumpin', public._tag_who(c.pool_id, me.id) || ' jumped into ' || public._tag_who(c.pool_id, c.challenger_id)
    || ' vs ' || public._tag_who(c.pool_id, c.challenged_id) || ' (' || public._tag_slot_text(c.tee_at, c.course_id) || ').'
    || case when (select count(*) from public.tag_challenge_joins where challenge_id = c.id) >= 2 then ' Card''s full.' else ' 1 spot left.' end);
end $$;

/** Drop out of a round you jumped into (before it closes). */
create or replace function public.tag_challenge_leave(p_token text, p_challenge uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members; c public.tag_challenges;
begin
  me := public._tag_member(p_token);
  select * into c from public.tag_challenges where id = p_challenge for update;
  if c.id is null or not exists (select 1 from public.tag_challenge_joins where challenge_id = c.id and member_id = me.id) then raise exception 'not_in'; end if;
  if c.tee_at is not null and now() >= c.tee_at - interval '2 hours' then raise exception 'slot_closed'; end if;
  delete from public.tag_challenge_joins where challenge_id = c.id and member_id = me.id;
  perform public._tag_news(c.pool_id, 'dropout', public._tag_who(c.pool_id, me.id) || ' dropped out of ' || public._tag_who(c.pool_id, c.challenger_id)
    || ' vs ' || public._tag_who(c.pool_id, c.challenged_id) || '. A spot just opened.');
end $$;

/**
 * Challenge rounds this player can see: accepted challenges in sets they hold a tag in, that they're part of (any slot
 * state), or that are locked and not yet past tee time (+ 6 h, so the card stays up while they play).
 */
create or replace function public.tag_rounds(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me public.tag_members;
begin
  me := public._tag_member(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'pool_id', c.pool_id, 'pool', po.slug, 'pool_name', po.name,
      'challenger', (select jsonb_build_object('id', m.id, 'name', m.name, 'nickname', m.nickname, 'number', (select number from public.tags where pool_id = c.pool_id and holder_id = m.id)) from public.tag_members m where m.id = c.challenger_id),
      'challenged', (select jsonb_build_object('id', m.id, 'name', m.name, 'nickname', m.nickname, 'number', (select number from public.tags where pool_id = c.pool_id and holder_id = m.id)) from public.tag_members m where m.id = c.challenged_id),
      'role', case when me.id = c.challenger_id then 'challenger' when me.id = c.challenged_id then 'challenged'
                   when exists (select 1 from public.tag_challenge_joins j where j.challenge_id = c.id and j.member_id = me.id) then 'joined' end,
      'tee_at', c.tee_at, 'course_id', c.course_id, 'course', (select name from public.courses where id = c.course_id),
      'slot_mine', c.slot_by = me.id, 'locked', c.locked_at is not null, 'closes_at', c.tee_at - interval '2 hours', 'due_at', c.due_at,
      'joins', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'nickname', m.nickname,
                  'number', (select number from public.tags where pool_id = c.pool_id and holder_id = m.id)) order by j.joined_at)
                from public.tag_challenge_joins j join public.tag_members m on m.id = j.member_id where j.challenge_id = c.id), '[]')
    ) order by c.tee_at nulls last, c.created_at)
    from public.tag_challenges c join public.tag_pools po on po.id = c.pool_id
   where c.status = 'accepted'
     and exists (select 1 from public.tags t where t.pool_id = c.pool_id and t.holder_id = me.id)
     and (me.id in (c.challenger_id, c.challenged_id)
          or exists (select 1 from public.tag_challenge_joins j where j.challenge_id = c.id and j.member_id = me.id)
          or (c.locked_at is not null and c.tee_at > now() - interval '6 hours'))), '[]');
end $$;

revoke execute on function public._tag_slot_text(timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.tag_challenge_slot(text, uuid, timestamptz, uuid), public.tag_challenge_slot_ok(text, uuid),
  public.tag_challenge_join(text, uuid), public.tag_challenge_leave(text, uuid), public.tag_rounds(text) to anon, authenticated;
