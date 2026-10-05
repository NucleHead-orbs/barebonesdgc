-- Early Access: 3 players, or an accepted challenge (locked 2026-10-05, Mike: "it will be tricky for 3 to get together weekly,
-- but I don't want trickery so let's keep the 3 player lock on casual rounds but let 2 player rounds count only if it is a
-- challenge that has been accepted through the system." Answers: tickets AND tags; the Early Access set only).
-- Rules (an early_access tag set only; every other set unchanged):
--   * A tag round with fewer than min_players (3) tag holders on it moves tags only when it is exactly 2 holders who
--     have an ACCEPTED challenge between them in that set. Otherwise it is refused ('needs_challenge') wherever it is
--     made: club scorecard with tags on the line, My Tag log, TD record/propose (one check on the players insert covers
--     every path).
--   * Raffle tickets: a saved club round counts with at least min_players linked players (unchanged), OR with exactly
--     2 linked players when that round's tag round in the Early Access set settled their challenge (challenge played).
--     Everyone confirmed, none disputed, inside the window (unchanged).
-- =====================================================================

/** The rule, in one place: can these tag holders put this set on the line? Non-Early-Access sets: always. */
create or replace function public._ea_line_ok(p_pool uuid, p_members uuid[]) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when not exists (select 1 from public.early_access where pool_id = p_pool) then true
    when (select count(distinct x) from unnest(p_members) x) >= (select min_players from public.early_access where pool_id = p_pool) then true
    when (select count(distinct x) from unnest(p_members) x) = 2 then exists (
      select 1 from public.tag_challenges c
       where c.pool_id = p_pool and c.status = 'accepted'
         and c.challenger_id = any(p_members) and c.challenged_id = any(p_members))
    else false end
$$;

/** For the scorecard's "Tags on the line?" list: is this set allowed for these holders right now? */
create or replace function public.tag_line_ok(p_pool uuid, p_members uuid[]) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public._ea_line_ok(p_pool, coalesce(p_members, '{}'))
$$;

/** Refuse a tag round that breaks the rule. Runs once per insert statement (every path inserts a round's players in one
    statement), so it sees the whole round. */
create or replace function public._ea_round_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare m record;
begin
  for m in select tm.id, tm.pool_id from public.tag_matches tm join public.early_access ea on ea.pool_id = tm.pool_id
            where tm.id in (select distinct match_id from new_rows) and tm.status <> 'void' loop
    if not public._ea_line_ok(m.pool_id, array(select member_id from public.tag_match_players where match_id = m.id)) then
      raise exception 'needs_challenge';
    end if;
  end loop;
  return null;
end $$;
drop trigger if exists tag_match_players_ea_check on public.tag_match_players;
create trigger tag_match_players_ea_check after insert on public.tag_match_players
  referencing new table as new_rows for each statement execute function public._ea_round_check();
revoke execute on function public._ea_round_check(), public._ea_line_ok(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.tag_line_ok(uuid, uuid[]) to anon, authenticated;

/** Verified rounds in the window: one row per linked player on each counting round. (+ 2-player challenge rounds) */
create or replace function public._ea_rounds(p_event uuid)
returns table (round_id uuid, played_on date, member_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  with ea as (select * from public.early_access where event_id = p_event),
  linked as (select c.member_id from public.ea_claims c where c.event_id = p_event and c.status = 'approved'),
  rp as (select r.id, r.played_on, p.member_id, p.confirmed_at, p.disputed_at
           from ea, public.club_rounds r join public.club_round_players p on p.round_id = r.id
          where r.status = 'saved' and r.played_on between ea.opens_on and ea.closes_on
            and p.member_id in (select l.member_id from linked l)),
  ok as (select rp.id from rp group by rp.id
          having bool_and(rp.confirmed_at is not null and rp.disputed_at is null)
             and (count(*) >= (select ea.min_players from ea)
                  or (count(*) = 2 and exists (
                        select 1 from public.tag_matches tm join public.tag_challenges c on c.match_id = tm.id and c.status = 'played'
                         where tm.round_id = rp.id and tm.pool_id = (select ea.pool_id from ea) and tm.status = 'applied'
                           and c.challenger_id in (select x.member_id from rp x where x.id = rp.id)
                           and c.challenged_id in (select x.member_id from rp x where x.id = rp.id)))))
  select rp.id, rp.played_on, rp.member_id from rp where rp.id in (select ok.id from ok)
$$;
