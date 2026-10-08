-- =====================================================================
-- My Tag -> MY ROUNDS (locked 2026-10-07, Mike: "the player's round history, with their full card details" ->
-- "Scorecard + tag rounds").
-- Source of truth (no new tables):
--   * kind 'card': saved Scorecard rounds (club_rounds status 'saved') this member is on: course, date, pars, hole
--     labels, everyone's hole-by-hole scores, confirm state, and this member's tag moves from any tag set put on it.
--   * kind 'tag': applied tag rounds with no Scorecard card (manual submissions and TD-recorded league nights,
--     tag_matches.round_id is null): totals and everyone's tag moves.
-- Rules: newest first (played_on, then saved time), 25 a page (p_offset), 'more' says another page exists.
-- =====================================================================

create or replace function public.tag_my_rounds(p_token text, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me public.tag_members; lim constant int := 25; rows jsonb;
begin
  me := public._tag_member(p_token);
  with all_rounds as (
    select r.played_on, r.created_at, jsonb_build_object(
        'kind', 'card', 'id', r.id, 'course', r.course, 'played_on', r.played_on, 'pars', to_jsonb(r.pars), 'hole_labels', to_jsonb(r.hole_labels),
        'totals_only', r.totals_only, 'note', r.note,
        'players', (select jsonb_agg(jsonb_build_object('member_id', p.member_id, 'name', coalesce(m.name, p.guest_name, '?'), 'nickname', m.nickname,
                       'guest', p.member_id is null, 'scores', to_jsonb(p.scores), 'strokes', p.strokes, 'to_par', p.to_par,
                       'confirmed', p.confirmed_at is not null, 'disputed', p.disputed_at is not null) order by p.strokes, p.seq)
                      from public.club_round_players p left join public.tag_members m on m.id = p.member_id where p.round_id = r.id),
        'tags', coalesce((select jsonb_agg(jsonb_build_object('pool_name', po.name, 'status', t.status, 'before', tp.tag_before, 'after', tp.tag_after) order by po.sort, po.name)
                      from public.tag_matches t join public.tag_pools po on po.id = t.pool_id
                      join public.tag_match_players tp on tp.match_id = t.id and tp.member_id = me.id
                     where t.round_id = r.id and t.status <> 'void'), '[]')) j
      from public.club_rounds r
     where r.status = 'saved' and exists (select 1 from public.club_round_players x where x.round_id = r.id and x.member_id = me.id)
    union all
    select t.played_on, t.created_at, jsonb_build_object(
        'kind', 'tag', 'id', t.id, 'course', t.course, 'played_on', t.played_on, 'pool_name', po.name, 'source', t.source,
        'players', (select jsonb_agg(jsonb_build_object('member_id', tp.member_id, 'name', m.name, 'nickname', m.nickname,
                       'score', tp.score, 'before', tp.tag_before, 'after', tp.tag_after) order by tp.score, tp.tag_before nulls last)
                      from public.tag_match_players tp join public.tag_members m on m.id = tp.member_id where tp.match_id = t.id)) j
      from public.tag_matches t join public.tag_pools po on po.id = t.pool_id
     where t.status = 'applied' and t.round_id is null
       and exists (select 1 from public.tag_match_players x where x.match_id = t.id and x.member_id = me.id)
  ), page as (
    select j, played_on, created_at from all_rounds order by played_on desc, created_at desc offset greatest(coalesce(p_offset, 0), 0) limit lim + 1
  )
  select coalesce(jsonb_agg(j order by played_on desc, created_at desc), '[]') into rows from page;
  return jsonb_build_object('rounds', coalesce((select jsonb_agg(e order by n) from jsonb_array_elements(rows) with ordinality x(e, n) where n <= lim), '[]'),
                            'more', jsonb_array_length(rows) > lim);
end $$;

revoke all on function public.tag_my_rounds(text, int) from public;
grant execute on function public.tag_my_rounds(text, int) to anon, authenticated;
