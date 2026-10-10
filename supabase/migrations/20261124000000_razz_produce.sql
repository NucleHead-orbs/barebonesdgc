-- =====================================================================
-- Two more live razzes (2026-10-09, Mike): eggplant and pickle. Same rules as the rest (migration 20261106):
-- members only, one every 15 seconds, the scorer can mute. Site copy (names, glyphs) lives in src/lib/rounds/live.ts.
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

alter table public.club_live_reactions drop constraint if exists club_live_reactions_kind_check;
alter table public.club_live_reactions add constraint club_live_reactions_kind_check
  check (kind in ('skull', 'choke', 'trash', 'cry', 'eggplant', 'pickle', 'clap', 'fire', 'goat', 'cheers'));

select pg_temp.patch('public.live_react(uuid,text,text,text)', array[
  'if p_kind not in (''skull'', ''choke'', ''trash'', ''cry'', ''clap'', ''fire'', ''goat'', ''cheers'')',
  'if p_kind not in (''skull'', ''choke'', ''trash'', ''cry'', ''eggplant'', ''pickle'', ''clap'', ''fire'', ''goat'', ''cheers'')']);
