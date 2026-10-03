-- Hole labels (locked 2026-10-03, Mike's UDisc layouts): some layouts play holes out of order or with letters
-- (Buffalo Ridge Outside Ring: 1 2 3 4 5 A B C D E F G H 7 14 15 16 17 18). The scorecard and Boner Rounds show
-- the course's own hole names.
-- Source of truth:
--   course_holes.label     : what the hole is called on the course (null = its play-order number n).
--   club_rounds.hole_labels : the labels a saved round was played with (null = 1..n). Same length as pars.
-- Rules:
--   * n stays the play order (1..holes) everywhere; a label is display only, 1-4 letters/digits.
--   * td_save_layout keeps a label when the payload has one (saving from an event has none, so labels come off;
--     re-import the layout to put them back).
--   * round_save takes optional "labels"; plain 1..n is stored as null.
--   * Safe to re-run.
-- =====================================================================

alter table public.course_holes add column if not exists label text;
alter table public.course_holes drop constraint if exists course_holes_label_check;
alter table public.course_holes add constraint course_holes_label_check check (label is null or label ~ '^[A-Za-z0-9]{1,4}$');

alter table public.club_rounds add column if not exists hole_labels text[];
alter table public.club_rounds drop constraint if exists club_rounds_hole_labels_check;
alter table public.club_rounds add constraint club_rounds_hole_labels_check
  check (hole_labels is null or (cardinality(hole_labels) = cardinality(pars) and array_position(hole_labels, null) is null));

create or replace function public.td_save_layout(p_course_id uuid, p_layout_id uuid, p_name text, p_holes jsonb, p_source text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_admin boolean := public.is_td(); v_me text := public.my_email();
begin
  if not public.is_any_td() then raise exception 'forbidden'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'invalid_name'; end if;
  perform public._check_holes(p_holes);
  if exists (select 1 from jsonb_array_elements(p_holes) h where nullif(h->>'label', '') is not null and h->>'label' !~ '^[A-Za-z0-9]{1,4}$') then
    raise exception 'invalid_holes';
  end if;
  if p_layout_id is null then
    insert into public.course_layouts (course_id, name, source, updated_by)
    values (p_course_id, btrim(p_name), nullif(btrim(coalesce(p_source, '')), ''), v_me)
    returning id into v_id;
  else
    update public.course_layouts
       set name = btrim(p_name), source = coalesce(nullif(btrim(coalesce(p_source, '')), ''), source),
           updated_at = now(), updated_by = v_me,
           verified_at = case when v_admin then verified_at end,
           verified_by = case when v_admin then verified_by end
     where id = p_layout_id and course_id = p_course_id
    returning id into v_id;
    if v_id is null then raise exception 'unknown_layout'; end if;
    delete from public.course_holes where layout_id = v_id;
  end if;
  insert into public.course_holes (layout_id, n, label, par, dist_ft, ob, rules)
    select v_id, (h->>'n')::smallint, nullif(btrim(coalesce(h->>'label', '')), ''), (h->>'par')::smallint, nullif(h->>'dist_ft', '')::int,
           nullif(btrim(coalesce(h->>'ob', '')), ''),
           coalesce(array(select btrim(r) from jsonb_array_elements_text(case when jsonb_typeof(h->'rules') = 'array' then h->'rules' else '[]' end) r
                          where btrim(r) <> ''), '{}')
      from jsonb_array_elements(p_holes) h;
  return v_id;
end $$;

create or replace function public.round_save(p_token text, p_round jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members; rid uuid; pars smallint[]; labels text[]; n int; np int; i int; r jsonb; sc smallint[]; v_par int;
        v_course text := btrim(coalesce(p_round ->> 'course', '')); v_day date; v_cid uuid; v_lid uuid;
begin
  me := public._tag_member(p_token);
  if jsonb_typeof(p_round) <> 'object' or jsonb_typeof(p_round -> 'pars') <> 'array' or jsonb_typeof(p_round -> 'players') <> 'array' then
    raise exception 'invalid_round';
  end if;
  if v_course = '' or length(v_course) > 80 then raise exception 'course_required'; end if;
  begin
    v_day := (p_round ->> 'played_on')::date;
    pars := array(select (x #>> '{}')::smallint from jsonb_array_elements(p_round -> 'pars') x);
  exception when others then raise exception 'invalid_round';
  end;
  if v_day is null or v_day > current_date + 1 or v_day < current_date - 14 then raise exception 'invalid_date'; end if;
  n := cardinality(pars);
  if jsonb_typeof(p_round -> 'labels') = 'array' then
    labels := array(select x #>> '{}' from jsonb_array_elements(p_round -> 'labels') x);
    if cardinality(labels) <> n or exists (select 1 from unnest(labels) l where l is null or l !~ '^[A-Za-z0-9]{1,4}$') then raise exception 'invalid_labels'; end if;
    if labels = array(select g::text from generate_series(1, n) g) then labels := null; end if;   -- plain 1..n: nothing to keep
  end if;
  if n < 1 or n > 36 or exists (select 1 from unnest(pars) p where p is null or p < 2 or p > 6) then raise exception 'invalid_pars'; end if;
  v_par := (select sum(p) from unnest(pars) p);
  np := jsonb_array_length(p_round -> 'players');
  if np < 1 or np > 8 then raise exception 'players_1_to_8'; end if;
  if not exists (select 1 from jsonb_array_elements(p_round -> 'players') x where x ->> 'member_id' = me.id::text) then raise exception 'must_include_you'; end if;
  if (select count(distinct x ->> 'member_id') from jsonb_array_elements(p_round -> 'players') x where x ? 'member_id' and x ->> 'member_id' is not null)
     <> (select count(*) from jsonb_array_elements(p_round -> 'players') x where x ? 'member_id' and x ->> 'member_id' is not null) then
    raise exception 'duplicate_player';
  end if;
  if (select count(*) from public.club_rounds where created_by = me.id and created_at > now() - interval '1 day') >= 20 then raise exception 'too_many_rounds'; end if;
  if nullif(p_round ->> 'course_id', '') is not null then
    begin v_cid := (p_round ->> 'course_id')::uuid; exception when others then raise exception 'invalid_round'; end;
    if not exists (select 1 from public.courses where id = v_cid) then v_cid := null; end if;
  end if;
  if nullif(p_round ->> 'layout_id', '') is not null then
    begin v_lid := (p_round ->> 'layout_id')::uuid; exception when others then raise exception 'invalid_round'; end;
    if not exists (select 1 from public.course_layouts where id = v_lid and (v_cid is null or course_id = v_cid)) then v_lid := null; end if;
  end if;

  insert into public.club_rounds (course, course_id, layout_id, played_on, pars, hole_labels, note, created_by)
  values (v_course, v_cid, v_lid, v_day, pars, labels, nullif(btrim(coalesce(p_round ->> 'note', '')), ''), me.id) returning id into rid;

  i := 0;
  for r in select * from jsonb_array_elements(p_round -> 'players') loop
    i := i + 1;
    if jsonb_typeof(r -> 'scores') <> 'array' or jsonb_array_length(r -> 'scores') <> n then raise exception 'every_hole_scored'; end if;
    begin
      sc := array(select (x #>> '{}')::smallint from jsonb_array_elements(r -> 'scores') x);
    exception when others then raise exception 'invalid_score';
    end;
    if exists (select 1 from unnest(sc) s where s is null or s < 1 or s > 20) then raise exception 'invalid_score'; end if;
    if nullif(r ->> 'member_id', '') is not null then
      if not exists (select 1 from public.tag_members where id = (r ->> 'member_id')::uuid) then raise exception 'unknown_member'; end if;
      insert into public.club_round_players (round_id, seq, member_id, scores, strokes, to_par, confirmed_at)
      values (rid, i, (r ->> 'member_id')::uuid, sc, (select sum(s) from unnest(sc) s), (select sum(s) from unnest(sc) s) - v_par,
              case when (r ->> 'member_id')::uuid = me.id then now() end);
    else
      if btrim(coalesce(r ->> 'guest_name', '')) = '' then raise exception 'name_required'; end if;
      insert into public.club_round_players (round_id, seq, guest_name, scores, strokes, to_par)
      values (rid, i, left(btrim(r ->> 'guest_name'), 40), sc, (select sum(s) from unnest(sc) s), (select sum(s) from unnest(sc) s) - v_par);
    end if;
  end loop;
  return rid;
end $$;
