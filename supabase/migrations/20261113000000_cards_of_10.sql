-- =====================================================================
-- Cards of 10 (locked 2026-10-07, Mike: "We do a lot of casual supergroups. Let's up it to 10.")
-- One card size for everything casual:
--   * Scorecard rounds (round_save + the live mirror): 1-10 players (was 8). club_round_players.seq 1-10.
--   * Manual tag round submission (tag_log): 2-10 tag holders (was 6).
--   * Casual invites: up to 9 invited, 10 on the card (was 5 / 6).
--   * Challenge rounds: up to 8 jump-ins, a card of 10 (was 4 / 6).
-- Event cards (TD card builder) are unchanged: tournament cards stay 3-5.
-- Each function is patched in place from its live definition (exact text swap, refused if the text isn't there),
-- so nothing else in them can drift.
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

alter table public.club_round_players drop constraint if exists club_round_players_seq_check;
alter table public.club_round_players add constraint club_round_players_seq_check check (seq between 1 and 10);

select pg_temp.patch('public.round_save(text,jsonb)', array[
  'if np < 1 or np > 8 then raise exception ''players_1_to_8''', 'if np < 1 or np > 10 then raise exception ''players_1_to_10''']);

select pg_temp.patch('public._live_check(jsonb)', array[
  'jsonb_array_length(p -> ''players'') not between 1 and 8', 'jsonb_array_length(p -> ''players'') not between 1 and 10']);

select pg_temp.patch('public.tag_log(text,uuid,jsonb,text,date)', array[
  'if n < 2 or n > 6 then raise exception ''players_2_to_6''', 'if n < 2 or n > 10 then raise exception ''players_2_to_10''']);

select pg_temp.patch('public.tag_casual_create(text,uuid,timestamp with time zone,uuid,uuid[],text)', array[
  'if cardinality(ids) > 5 then', 'if cardinality(ids) > 9 then',
  'Casual round, up to 6:', 'Casual round, up to 10:']);

select pg_temp.patch('public.tag_casual_answer(text,uuid,boolean)', array[
  'status = ''in'') >= 6 then raise exception ''round_full''', 'status = ''in'') >= 10 then raise exception ''round_full''',
  'n := 6 - (select count(*)', 'n := 10 - (select count(*)']);

select pg_temp.patch('public.tag_challenge_join(text,uuid)', array[
  'where challenge_id = c.id) >= 4 then raise exception ''round_full''', 'where challenge_id = c.id) >= 8 then raise exception ''round_full''',
  'n := 4 - (select count(*)', 'n := 8 - (select count(*)']);

select pg_temp.patch('public.tag_challenge_slot_ok(text,uuid)', array[
  '. 4 spots to jump in on My Tag > MATCHUPS.', '. 8 spots to jump in on My Tag > MATCHUPS.']);
