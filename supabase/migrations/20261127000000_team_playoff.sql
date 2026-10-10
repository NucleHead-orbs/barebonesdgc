-- =====================================================================
-- Doubles playoffs (2026-10-10, Mike: "It doesn't seem to let me settle the winner." A tie for 1st in a doubles round
-- had no playoff picker, only "settle it on the course first").
--
-- Source of truth (no new table): playoffs (event_id, div_code, winner_player_id), the same table divisions use.
--   A doubles round's pool is div_code 'TEAMS-R<round>'; winner_player_id = the winning team's captain (teams.player_a).
-- Rules:
--   * WINNERS: a tie for 1st in a doubles round asks who won the playoff; the pick takes 1st outright and the rest of
--     that tie share 2nd (same rule as a division).
--   * league_mvp: a recorded playoff winner takes the week's win; the other teams in that tie count as 2nd.
-- =====================================================================

create or replace function public.league_mvp(p_slug text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with wk as (
    select e.id from public.events e join public.leagues l on l.id = e.league_id
     where l.slug = p_slug and e.r1_format = 'doubles' and not coalesce(e.archived, false)
  ), base as (
    select t.event_id, t.player_a, t.a_name, t.b_name, t.to_par, rank() over (partition by t.event_id order by t.to_par) place
      from public.team_rounds t join wk on wk.id = t.event_id
     where t.round = 1 and t.hole_count > 0 and t.holes_played = t.hole_count
  ), tr as (
    -- a playoff settles a tie for 1st: the winner keeps 1st, the rest of the tie drop to 2nd
    select b.event_id, b.a_name, b.b_name, b.to_par,
           case when b.place = 1 and po.winner_player_id is not null and po.winner_player_id <> b.player_a
                     and exists (select 1 from base w where w.event_id = b.event_id and w.place = 1 and w.player_a = po.winner_player_id)
                then 2 else b.place end place
      from base b left join public.playoffs po on po.event_id = b.event_id and po.div_code = 'TEAMS-R1'
  ), pl as (
    select event_id, btrim(a_name) nm, to_par, place from tr
    union all
    select event_id, btrim(b_name), to_par, place from tr where b_name is not null
  ), agg as (
    select lower(nm) k, (array_agg(nm order by event_id desc))[1] name, count(distinct event_id)::int weeks,
           count(*) filter (where place = 1)::int wins, count(*) filter (where place <= 3)::int podiums, min(to_par)::int best
      from pl where nm <> '' group by lower(nm)
  )
  select jsonb_build_object('weeks', (select count(distinct event_id) from tr),
    'players', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'weeks', weeks, 'wins', wins, 'podiums', podiums, 'best', best)
                           order by wins desc, podiums desc, weeks, name) from agg), '[]'))
$$;
grant execute on function public.league_mvp(text) to anon, authenticated;
