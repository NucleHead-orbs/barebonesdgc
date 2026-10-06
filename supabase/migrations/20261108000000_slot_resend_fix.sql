-- Challenge round slot fix (2026-10-06, Mike: "The Jump In is not available for me anymore for Danny and Nick's challenge").
-- Cause: re-sending the exact slot both players had already agreed on (MOVE IT -> SEND IT, nothing changed) unlocked the round,
-- which hides it from jump-ins until the other player OKs again.
-- Rules (changed): re-sending the same time + course on a locked round is a no-op. Actually moving a locked round still
-- unlocks it, and now says so on the Board ("wants to move ... jump-ins on hold").
-- Data: Danny vs Nick (Jewel EA) was unlocked that way with the same slot they had locked (Wed Oct 7, 4:30pm, Emerald Park): re-locked.
-- =====================================================================

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
  -- re-sending the slot they already agreed on changes nothing (it used to unlock the round and hide it from jump-ins)
  if c.locked_at is not null and c.tee_at = p_tee and c.course_id = p_course then return; end if;
  update public.tag_challenges set tee_at = p_tee, course_id = p_course, slot_by = me.id, locked_at = null where id = c.id;
  if c.locked_at is not null then
    perform public._tag_news(c.pool_id, 'scheduled', public._tag_who(c.pool_id, me.id) || ' wants to move ' || public._tag_who(c.pool_id, c.challenger_id)
      || ' vs ' || public._tag_who(c.pool_id, c.challenged_id) || ' to ' || public._tag_slot_text(p_tee, p_course)
      || '. Jump-ins are on hold until the other player OKs it.');
  end if;
end $$;

update public.tag_challenges c set locked_at = now()
 where c.id = 'b0d5e49a-f028-48fd-83a0-82a4bfbb6011' and c.status = 'accepted' and c.locked_at is null
   and c.tee_at = timestamptz '2026-10-07 16:30:00 America/Phoenix'
   and c.course_id = (select id from public.courses where name = 'Emerald Park');
