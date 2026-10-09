-- =====================================================================
-- Round talk fixes (2026-10-09, Mike):
--   * A DNF in the round story: "<name> pulled out way before climax, safe from child support, but not from last
--     place." DNFs sort last in the story too (same as the tag swap), and the usual last-place roast stays off them.
--   * "took the higher tag" read backwards (lower number = better): a settled challenge now says
--     "<winner> took #5 from <loser>, who drops to #7."
--   * The confirm alert for a Scorecard round opens MY ROUNDS on My Tag (confirm it right there), not Boner Rounds.
-- Patched in place from the live definitions (exact text swap, refused if the text isn't there).
-- =====================================================================

create or replace function pg_temp.patch(p_fn regprocedure, p_pairs text[]) returns void language plpgsql as $$
declare d text := pg_get_functiondef(p_fn); i int;
begin
  for i in 1 .. cardinality(p_pairs) / 2 loop
    if position(p_pairs[2 * i - 1] in d) = 0 then raise exception 'patch_failed: % (%)', p_fn, p_pairs[2 * i - 1]; end if;
    d := replace(d, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute d;
end $$;

select pg_temp.patch('public._tag_round_story(uuid)', array[
  'order by p.score, p.tag_after nulls last, p.member_id', 'order by p.dnf, p.score, p.tag_after nulls last, p.member_id',
  'ace record; eagle record;', 'dq text; ace record; eagle record;',
  '  if n >= 3 and extras < 3 and sc[n] > sc[n - 1] then',
  '  for dq in select coalesce(nullif(btrim(x.nickname), ''''), x.name) from public.tag_match_players p join public.tag_members x on x.id = p.member_id
              where p.match_id = p_match and p.dnf order by 1 loop
    out := out || (dq || '' pulled out way before climax, safe from child support, but not from last place.'');
  end loop;
  if n >= 3 and extras < 3 and sc[n] > sc[n - 1] and not exists (select 1 from public.tag_match_players where match_id = p_match and dnf) then']);

select pg_temp.patch('public._tag_challenge_news()', array[
  '''Challenge settled: '' || a || '' took the higher tag from '' || b || ''.''',
  '''Challenge settled: '' || public._tag_short(new.challenger_id) || '' took #'' || an || '' from '' || public._tag_short(new.challenged_id) || '', who drops to #'' || bn || ''.''']);

select pg_temp.patch('public._tag_push_confirm_card()', array[
  '''/rounds/'' || r.id)', '''?tab=rounds&round='' || r.id)']);

-- My Tag's round list knows which tag rounds came off a Scorecard card (those confirm on the card, in MY ROUNDS)
select pg_temp.patch('public._tag_match_json(uuid,uuid)', array[
  '''created_by'', m.created_by, ''mine'', m.created_by = p_me,', '''created_by'', m.created_by, ''mine'', m.created_by = p_me, ''round_id'', m.round_id,']);
