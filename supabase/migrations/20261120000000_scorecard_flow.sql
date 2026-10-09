-- =====================================================================
-- Scorecard flow from the course (2026-10-09, Mike after a 2-round day):
--   1. Start the card from a scheduled round (casual invite or challenge): the card remembers where it came from
--      (club_rounds.source = 'casual:<id>' | 'challenge:<id>'), and only ONE card per scheduled round can be saved
--      ('already_saved'), since everyone on it can now open it.
--   2. PULL OUT mid-round -> DNF: club_round_players.dnf_after = holes finished. The holes after that are saved as
--      par +3 each (the server writes them, whatever the phone sent), and on any tags on the line a DNF finishes
--      last, behind everyone who finished, whatever the totals say (tag_match_players.dnf, sorted first in _tag_apply).
--   (Tee order / box owner is display-only on the phone: lib/rounds/rounds.ts teeOrder.)
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

alter table public.club_rounds add column if not exists source text check (source is null or source ~ '^(casual|challenge):[0-9a-f-]{36}$');
create unique index if not exists club_rounds_source_once on public.club_rounds (source) where source is not null and status = 'saved';
alter table public.club_round_players add column if not exists dnf_after smallint check (dnf_after is null or dnf_after >= 0);
alter table public.tag_match_players add column if not exists dnf boolean not null default false;

select pg_temp.patch('public.round_save(text,jsonb)', array[
  -- declare the source + DNF
  'v_cid uuid; v_lid uuid;',
  'v_cid uuid; v_lid uuid; v_src text := nullif(btrim(coalesce(p_round ->> ''source'', '''')), ''''); v_dnf int; v_old uuid;',
  -- one saved card per scheduled round
  '  insert into public.club_rounds (course, course_id, layout_id, played_on, pars, hole_labels, note, created_by)
  values (v_course, v_cid, v_lid, v_day, pars, labels, nullif(btrim(coalesce(p_round ->> ''note'', '''')), ''''), me.id) returning id into rid;',
  '  if v_src is not null then
    if v_src !~ ''^(casual|challenge):[0-9a-f-]{36}$'' then v_src := null;
    else
      select id into v_old from public.club_rounds where source = v_src and status = ''saved'';
      if v_old is not null then raise exception ''already_saved:%'', v_old; end if;
    end if;
  end if;
  insert into public.club_rounds (course, course_id, layout_id, played_on, pars, hole_labels, note, created_by, source)
  values (v_course, v_cid, v_lid, v_day, pars, labels, nullif(btrim(coalesce(p_round ->> ''note'', '''')), ''''), me.id, v_src) returning id into rid;',
  -- DNF: holes after dnf_after are par +3, whatever was sent
  '    if exists (select 1 from unnest(sc) s where s is null or s < 1 or s > 20) then raise exception ''invalid_score''; end if;',
  '    v_dnf := case when coalesce(r ->> ''dnf_after'', '''') ~ ''^[0-9]{1,2}$'' and (r ->> ''dnf_after'')::int < n then (r ->> ''dnf_after'')::int end;
    if v_dnf is not null then
      sc := array(select case when g <= v_dnf then sc[g] else pars[g] + 3 end from generate_series(1, n) g);
    end if;
    if exists (select 1 from unnest(sc) s where s is null or s < 1 or s > 20) then raise exception ''invalid_score''; end if;',
  '      insert into public.club_round_players (round_id, seq, member_id, scores, strokes, to_par, confirmed_at)
      values (rid, i, (r ->> ''member_id'')::uuid, sc, (select sum(s) from unnest(sc) s), (select sum(s) from unnest(sc) s) - v_par,
              case when (r ->> ''member_id'')::uuid = me.id then now() end);',
  '      insert into public.club_round_players (round_id, seq, member_id, scores, strokes, to_par, confirmed_at, dnf_after)
      values (rid, i, (r ->> ''member_id'')::uuid, sc, (select sum(s) from unnest(sc) s), (select sum(s) from unnest(sc) s) - v_par,
              case when (r ->> ''member_id'')::uuid = me.id then now() end, v_dnf);',
  '      insert into public.club_round_players (round_id, seq, guest_name, scores, strokes, to_par)
      values (rid, i, left(btrim(r ->> ''guest_name''), 40), sc, (select sum(s) from unnest(sc) s), (select sum(s) from unnest(sc) s) - v_par);',
  '      insert into public.club_round_players (round_id, seq, guest_name, scores, strokes, to_par, dnf_after)
      values (rid, i, left(btrim(r ->> ''guest_name''), 40), sc, (select sum(s) from unnest(sc) s), (select sum(s) from unnest(sc) s) - v_par, v_dnf);'
]);

-- a DNF on a Scorecard round finishes last on any tags put on it (every path that turns a card into a tag round)
create or replace function public._tag_match_player_dnf() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select coalesce(p.dnf_after is not null, false) into new.dnf
    from public.tag_matches m join public.club_round_players p on p.round_id = m.round_id and p.member_id = new.member_id
   where m.id = new.match_id;
  new.dnf := coalesce(new.dnf, false);
  return new;
end $$;
drop trigger if exists tag_match_player_dnf on public.tag_match_players;
create trigger tag_match_player_dnf before insert on public.tag_match_players for each row execute function public._tag_match_player_dnf();

select pg_temp.patch('public._tag_apply(uuid)', array[
  'row_number() over (order by score, tag_before) as rn', 'row_number() over (order by dnf, score, tag_before) as rn']);

-- My Rounds shows DNFs
select pg_temp.patch('public.tag_my_rounds(text,integer)', array[
  '''confirmed'', p.confirmed_at is not null, ''disputed'', p.disputed_at is not null) order by p.strokes, p.seq)',
  '''confirmed'', p.confirmed_at is not null, ''disputed'', p.disputed_at is not null, ''dnf_after'', p.dnf_after) order by p.dnf_after is not null, p.strokes, p.seq)']);

revoke all on function public._tag_match_player_dnf() from public, anon, authenticated;
