-- =====================================================================
-- Coming up live (locked 2026-10-09, Mike: "show what rounds are scheduled as if we're advertising upcoming live
-- watchable events". Answers: nights + challenges + casual invites; the tile flips to LIVE and links its cards).
--
-- Source of truth (no new tables):
--   tag_nights (not called off, not closed), tag_challenges (accepted, tee time locked), tag_casual (not called off).
--   club_live.source : the scheduled round a live card was started from ('casual:<id>' | 'challenge:<id>' | 'night:<id>'),
--                      sent by the Scorecard inside the live card. Junk is ignored (null).
-- Rules:
--   * live_upcoming(): public. Every scheduled round with a start in the next 7 days, or started in the last 3 hours,
--     or with a live card on it right now. Gone once its card is saved (casual / challenge) or the night closes.
--     Each comes with its live cards (on the course in the last 30 min, not ended), soonest first.
--   * Names are short names (nickname, else name), same as the Live now strip shows. No links, no tokens.
-- =====================================================================

alter table public.club_live add column if not exists source text check (source is null or source ~ '^(casual|challenge|night):[0-9a-f-]{36}$');
create index if not exists club_live_source on public.club_live (source) where source is not null and ended_at is null;

create or replace function pg_temp.patch(p_fn regprocedure, p_pairs text[]) returns void language plpgsql as $$
declare d text := pg_get_functiondef(p_fn); i int;
begin
  for i in 1 .. cardinality(p_pairs) / 2 loop
    if position(p_pairs[2 * i - 1] in d) = 0 then raise exception 'patch_failed: % (%)', p_fn, p_pairs[2 * i - 1]; end if;
    d := replace(d, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute d;
end $$;

select pg_temp.patch('public.round_live_push(uuid,text,text,jsonb)', array[
  'declare v public.club_live; mid uuid;',
  'declare v public.club_live; mid uuid; v_src text := case when coalesce(p_card ->> ''source'', '''') ~ ''^(casual|challenge|night):[0-9a-f-]{36}$'' then p_card ->> ''source'' end;',
  'insert into public.club_live (id, secret_hash, member_id, course, card) values (p_id, md5(p_secret), mid, left(coalesce(p_card ->> ''course'', ''''), 80), p_card);',
  'insert into public.club_live (id, secret_hash, member_id, course, card, source) values (p_id, md5(p_secret), mid, left(coalesce(p_card ->> ''course'', ''''), 80), p_card, v_src);',
  'member_id = coalesce(mid, member_id), updated_at = now() where id = p_id;',
  'member_id = coalesce(mid, member_id), source = v_src, updated_at = now() where id = p_id;']);

/** The live cards started from one scheduled round. */
create or replace function public._live_for(p_source text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(public._live_json(l) order by l.started_at), '[]') from public.club_live l
   where l.source = p_source and l.ended_at is null and l.updated_at > now() - interval '30 minutes'
$$;

create or replace function public.live_upcoming() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x.j order by x.at), '[]') from (
    -- check-in nights
    select n.starts_at at, jsonb_build_object('kind', 'night', 'id', n.id, 'at', n.starts_at, 'title', n.title,
             'course', (select name from public.courses where id = n.course_id), 'host', public._tag_short(n.host_id), 'set', null,
             'players', coalesce((select jsonb_agg(coalesce(public._tag_short(p.member_id), p.guest_name) order by p.seq) from public.tag_night_players p where p.night_id = n.id), '[]'),
             'live', public._live_for('night:' || n.id)) j
      from public.tag_nights n
     where n.cancelled_at is null and n.closed_at is null
       and n.starts_at < now() + interval '7 days'
       and (n.starts_at > now() - interval '3 hours' or jsonb_array_length(public._live_for('night:' || n.id)) > 0)
    union all
    -- challenge rounds with a locked tee time
    select c.tee_at, jsonb_build_object('kind', 'challenge', 'id', c.id, 'at', c.tee_at,
             'title', public._tag_short(c.challenger_id) || coalesce(' (#' || (select number from public.tags where pool_id = c.pool_id and holder_id = c.challenger_id) || ')', '')
                      || ' vs ' || public._tag_short(c.challenged_id) || coalesce(' (#' || (select number from public.tags where pool_id = c.pool_id and holder_id = c.challenged_id) || ')', ''),
             'course', (select name from public.courses where id = c.course_id), 'host', null, 'set', (select name from public.tag_pools where id = c.pool_id),
             'players', jsonb_build_array(public._tag_short(c.challenger_id), public._tag_short(c.challenged_id))
                        || coalesce((select jsonb_agg(public._tag_short(j.member_id) order by j.joined_at) from public.tag_challenge_joins j where j.challenge_id = c.id), '[]'),
             'live', public._live_for('challenge:' || c.id))
      from public.tag_challenges c
     where c.status = 'accepted' and c.locked_at is not null and c.tee_at is not null
       and c.tee_at < now() + interval '7 days'
       and (c.tee_at > now() - interval '3 hours' or jsonb_array_length(public._live_for('challenge:' || c.id)) > 0)
       and not exists (select 1 from public.club_rounds r where r.source = 'challenge:' || c.id and r.status = 'saved')
    union all
    -- casual invites
    select i.tee_at, jsonb_build_object('kind', 'casual', 'id', i.id, 'at', i.tee_at, 'title', public._tag_short(i.host_id) || '''s round',
             'course', (select name from public.courses where id = i.course_id), 'host', public._tag_short(i.host_id), 'set', (select name from public.tag_pools where id = i.pool_id),
             'players', coalesce((select jsonb_agg(public._tag_short(p.member_id) order by p.at) from public.tag_casual_players p where p.invite_id = i.id and p.status = 'in'), '[]'),
             'live', public._live_for('casual:' || i.id))
      from public.tag_casual i
     where i.cancelled_at is null
       and i.tee_at < now() + interval '7 days'
       and (i.tee_at > now() - interval '3 hours' or jsonb_array_length(public._live_for('casual:' || i.id)) > 0)
       and not exists (select 1 from public.club_rounds r where r.source = 'casual:' || i.id and r.status = 'saved')
  ) x
$$;

revoke all on function public._live_for(text) from public, anon, authenticated;
grant execute on function public.live_upcoming() to anon, authenticated;
