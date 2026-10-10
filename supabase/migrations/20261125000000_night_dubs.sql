-- =====================================================================
-- Dubs nights + host-posted results (locked 2026-10-09, Mike: Blake's glow league switched to dubs and scored on
-- UDisc: "add the format and let Blake update the round results at the end ... no tag swap, but we can celebrate their
-- event the same". Answers: teams + score to par; Board story + FINAL on Rounds + MY ROUNDS; a Singles/Dubs toggle the
-- host can flip until results are posted).
--
-- Source of truth:
--   tag_nights.format       : 'singles' (Scorecard cards, field-wide tag swap) | 'dubs' (scored elsewhere, no tags).
--   tag_nights.results_at   : when the host posted the results (dubs). null = not yet.
--   tag_night_teams         : one row per team: score to par, place (1 = won; ties share a place).
--   tag_night_team_players  : who's on each team: a member or a guest name (1 or 2 per team: a Cali is a team of 1).
-- Rules:
--   * tag_night_format(night, format): host only, until it closes. Not to dubs once a Scorecard card is saved on it.
--   * Dubs nights take no Scorecard cards ('night_dubs') and never swap tags: closing (by hand, by the 12 h clock, or by
--     posting results) just closes.
--   * tag_night_results(night, teams, note): host only, dubs only. 2 to 60 teams, each 1–2 players (a member id or a
--     guest name, nobody twice), score to par -99..99. Places come from the scores (ties share). Members on a team are
--     checked in. Posting closes the night; the host can post again to fix a typo (replaces the teams; the Board story
--     only goes out the first time).
--   * The Board story (sets the host holds a tag in, Board on): the top of the standings, the margin, a roast for last.
--   * tag_nights / live_upcoming / tag_my_rounds carry the results.
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

alter table public.tag_nights add column if not exists format text not null default 'singles' check (format in ('singles', 'dubs'));
alter table public.tag_nights add column if not exists results_at timestamptz;
alter table public.tag_nights add column if not exists results_note text check (results_note is null or length(results_note) <= 200);

create table if not exists public.tag_night_teams (
  night_id uuid not null references public.tag_nights (id) on delete cascade,
  team     smallint not null check (team between 1 and 60),
  to_par   smallint not null check (to_par between -99 and 99),
  place    smallint not null check (place between 1 and 60),
  primary key (night_id, team)
);
create table if not exists public.tag_night_team_players (
  night_id   uuid not null,
  team       smallint not null,
  seq        smallint not null check (seq between 1 and 2),
  member_id  uuid references public.tag_members (id) on delete cascade,
  guest_name text check (guest_name is null or length(btrim(guest_name)) between 1 and 40),
  primary key (night_id, team, seq),
  foreign key (night_id, team) references public.tag_night_teams (night_id, team) on delete cascade,
  check (num_nonnulls(member_id, guest_name) = 1)
);
alter table public.tag_night_teams enable row level security;
alter table public.tag_night_team_players enable row level security;
revoke all on public.tag_night_teams, public.tag_night_team_players from anon, authenticated;

/** "Bullockey & Danny Walden" */
create or replace function public._tag_night_team_name(p_night uuid, p_team int) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select string_agg(coalesce(public._tag_short(p.member_id), p.guest_name), ' & ' order by p.seq)
    from public.tag_night_team_players p where p.night_id = p_night and p.team = p_team
$$;

/** Standings: [{place, to_par, team, players: [names]}], best first. */
create or replace function public._tag_night_standings(p_night uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('team', t.team, 'place', t.place, 'to_par', t.to_par,
           'players', (select jsonb_agg(jsonb_build_object('id', p.member_id, 'name', coalesce(public._tag_short(p.member_id), p.guest_name)) order by p.seq)
                         from public.tag_night_team_players p where p.night_id = t.night_id and p.team = t.team))
           order by t.place, t.team), '[]')
    from public.tag_night_teams t where t.night_id = p_night
$$;

-- ---------- format ----------
create or replace function public.tag_night_format(p_token text, p_night uuid, p_format text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare n public.tag_nights;
begin
  n := public._tag_night_host(p_token, p_night);
  if p_format not in ('singles', 'dubs') then raise exception 'invalid_format'; end if;
  if n.closed_at is not null then raise exception 'night_closed'; end if;
  if p_format = 'dubs' and exists (select 1 from public.club_rounds where night_id = p_night and status = 'saved') then raise exception 'cards_saved'; end if;
  update public.tag_nights set format = p_format where id = p_night;
end $$;

-- dubs: no Scorecard cards, no swap
select pg_temp.patch('public._tag_night_card(uuid,uuid)', array[
  '  if n.closed_at is not null then raise exception ''night_closed''; end if;',
  '  if n.closed_at is not null then raise exception ''night_closed''; end if;
  if n.format = ''dubs'' then raise exception ''night_dubs''; end if;']);
select pg_temp.patch('public._tag_night_close(uuid)', array[
  '  update public.tag_nights set closed_at = now() where id = p_night;',
  '  update public.tag_nights set closed_at = now() where id = p_night;
  if n.format = ''dubs'' then return 0; end if;']);
-- a dubs night closes with its results (or the clock), not CLOSE THE NIGHT
select pg_temp.patch('public.tag_night_close(text,uuid)', array[
  '  if n.closed_at is not null then raise exception ''night_closed''; end if;',
  '  if n.closed_at is not null then raise exception ''night_closed''; end if;
  if n.format = ''dubs'' then raise exception ''night_dubs''; end if;']);
create or replace function public.tag_night_create(p_token text, p_title text, p_start timestamptz, p_course uuid, p_note text, p_format text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if coalesce(p_format, 'singles') not in ('singles', 'dubs') then raise exception 'invalid_format'; end if;
  v_id := public.tag_night_create(p_token, p_title, p_start, p_course, p_note);
  update public.tag_nights set format = coalesce(p_format, 'singles') where id = v_id;
  return v_id;
end $$;

-- ---------- results ----------
create or replace function public.tag_night_results(p_token text, p_night uuid, p_teams jsonb, p_note text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n public.tag_nights; t jsonb; p jsonb; k int := 0; s int; first_time boolean; v_note text := nullif(btrim(coalesce(p_note, '')), '');
        line text; story text[] := '{}'; nt int; seed text; w text; r text; l text; mg int; po record; mid uuid; g text;
begin
  n := public._tag_night_host(p_token, p_night);
  if n.format <> 'dubs' then raise exception 'not_dubs'; end if;
  if jsonb_typeof(p_teams) <> 'array' or jsonb_array_length(p_teams) not between 2 and 60 then raise exception 'teams_2_to_60'; end if;
  if length(coalesce(v_note, '')) > 200 then raise exception 'note_too_long'; end if;
  first_time := n.results_at is null;
  delete from public.tag_night_teams where night_id = p_night;
  for t in select * from jsonb_array_elements(p_teams) loop
    k := k + 1;
    if jsonb_typeof(t -> 'players') <> 'array' or jsonb_array_length(t -> 'players') not between 1 and 2 then raise exception 'team_1_or_2'; end if;
    if coalesce(t ->> 'to_par', '') !~ '^-?[0-9]{1,2}$' then raise exception 'invalid_score'; end if;
    insert into public.tag_night_teams (night_id, team, to_par, place) values (p_night, k, (t ->> 'to_par')::int, 1);
    s := 0;
    for p in select * from jsonb_array_elements(t -> 'players') loop
      s := s + 1;
      mid := null; g := null;
      if nullif(p ->> 'member_id', '') is not null then
        begin mid := (p ->> 'member_id')::uuid; exception when others then raise exception 'unknown_member'; end;
        if not exists (select 1 from public.tag_members where id = mid) then raise exception 'unknown_member'; end if;
        if exists (select 1 from public.tag_night_team_players x where x.night_id = p_night and x.member_id = mid) then raise exception 'player_twice'; end if;
        insert into public.tag_night_players (night_id, member_id, added_by) values (p_night, mid, n.host_id) on conflict do nothing;
      else
        g := btrim(coalesce(p ->> 'guest_name', ''));
        if length(g) not between 1 and 40 then raise exception 'name_required'; end if;
        if exists (select 1 from public.tag_night_team_players x where x.night_id = p_night and lower(btrim(x.guest_name)) = lower(g)) then raise exception 'player_twice'; end if;
      end if;
      insert into public.tag_night_team_players (night_id, team, seq, member_id, guest_name) values (p_night, k, s, mid, g);
    end loop;
  end loop;
  update public.tag_night_teams t set place = x.rk from (select team, rank() over (order by to_par) rk from public.tag_night_teams where night_id = p_night) x
   where t.night_id = p_night and t.team = x.team;
  update public.tag_nights set results_at = now(), results_note = v_note, closed_at = coalesce(closed_at, now()) where id = p_night;

  if first_time then
    nt := k; seed := p_night::text;
    select string_agg(case when x.ties > 1 then 'T' else '' end || x.place || '. ' || public._tag_night_team_name(p_night, x.team) || ' ' ||
             case when x.to_par = 0 then 'E' when x.to_par > 0 then '+' || x.to_par else x.to_par::text end, ', ' order by x.place, x.team)
      into line
      from (select t.*, count(*) over (partition by t.place) ties
              from public.tag_night_teams t where t.night_id = p_night order by t.place, t.team limit 5) x;
    select public._tag_night_team_name(p_night, team) into w from public.tag_night_teams where night_id = p_night order by place, team limit 1;
    select public._tag_night_team_name(p_night, team) into r from public.tag_night_teams where night_id = p_night order by place, team offset 1 limit 1;
    select public._tag_night_team_name(p_night, team) into l from public.tag_night_teams where night_id = p_night order by place desc, team desc limit 1;
    mg := (select to_par from public.tag_night_teams where night_id = p_night order by place, team offset 1 limit 1)
        - (select to_par from public.tag_night_teams where night_id = p_night order by place, team limit 1);
    story := story || (btrim(n.title) || ' (dubs' || coalesce(' at ' || (select name from public.courses where id = n.course_id), '') || '): ' || line
                       || case when nt > 5 then ' … ' || nt || ' teams.' else '.' end);
    story := story || public._bb_fill(case
      when mg = 0 then public._bb_pick(seed || 'tie', array['Dead heat at the top. Somebody buy a playoff disc.', 'Tied for first. Two teams, one trophy, zero chill.'])
      when mg <= 2 then public._bb_pick(seed || 'close', array['{w} by {m}. {r} was right there and still couldn''t finish.', '{w} edged {r} by {m}. Close only counts in horseshoes and glow sticks.'])
      else public._bb_pick(seed || 'blowout', array['{w} by {m}. That wasn''t dubs, that was a spanking with a partner.', '{w} won by {m}. {r} needs to have a talk with their teammate.'])
    end, array['w', 'r', 'm'], array[w, r, mg::text || case when mg = 1 then ' stroke' else ' strokes' end]);
    if nt >= 3 then
      story := story || public._bb_fill(case
        when (select count(*) from public.tag_night_team_players x join public.tag_night_teams t using (night_id, team)
               where x.night_id = p_night and t.team = (select team from public.tag_night_teams where night_id = p_night order by place desc, team desc limit 1)) = 1
          then public._bb_pick(seed || 'last1', array['{l} brought up the rear. Solo. Nobody to blame but the glow stick.', '{l} went Cali and finished last. Bold. Wrong, but bold.'])
        else public._bb_pick(seed || 'last', array['{l} brought up the rear. Together. Romantic.', '{l} finished last and blamed each other the whole drive home.']) end,
        array['l'], array[l]);
    end if;
    if v_note is not null then story := story || ('"' || v_note || '"'); end if;
    for po in select distinct t.pool_id from public.tags t where t.holder_id = n.host_id loop
      perform public._tag_news(po.pool_id, 'result', array_to_string(story, ' '));
    end loop;
  end if;
  return public._tag_night_standings(p_night);
end $$;

-- ---------- reads ----------
select pg_temp.patch('public.tag_nights(text)', array[
  '''host_me'', n.host_id = me.id,',
  '''host_me'', n.host_id = me.id, ''format'', n.format, ''results_at'', n.results_at, ''results_note'', n.results_note, ''results'', public._tag_night_standings(n.id),']);

select pg_temp.patch('public.live_upcoming()', array[
  '''live'', public._live_for(''night:'' || n.id)) j',
  '''live'', public._live_for(''night:'' || n.id), ''format'', n.format, ''results'', case when n.results_at is not null then public._tag_night_standings(n.id) end) j',
  '     where n.cancelled_at is null and n.closed_at is null
       and n.starts_at < now() + interval ''7 days''
       and (n.starts_at > now() - interval ''3 hours'' or jsonb_array_length(public._live_for(''night:'' || n.id)) > 0)',
  '     where n.cancelled_at is null and n.starts_at < now() + interval ''7 days''
       and ((n.closed_at is null and (n.starts_at > now() - interval ''3 hours'' or n.format = ''dubs'' and n.starts_at > now() - interval ''12 hours''
                                      or jsonb_array_length(public._live_for(''night:'' || n.id)) > 0))
            or n.results_at > now() - interval ''24 hours'')']);

select pg_temp.patch('public.tag_my_rounds(text,integer)', array[
  '  ), page as (',
  '    union all
    select (n.starts_at at time zone ''America/Phoenix'')::date, n.results_at, jsonb_build_object(
        ''kind'', ''night'', ''id'', n.id, ''title'', n.title, ''course'', (select name from public.courses where id = n.course_id),
        ''played_on'', (n.starts_at at time zone ''America/Phoenix'')::date, ''format'', n.format, ''note'', n.results_note,
        ''teams'', public._tag_night_standings(n.id)) j
      from public.tag_nights n
     where n.results_at is not null and n.cancelled_at is null
       and exists (select 1 from public.tag_night_team_players x where x.night_id = n.id and x.member_id = me.id)
  ), page as (']);

revoke all on function public._tag_night_team_name(uuid, int), public._tag_night_standings(uuid) from public, anon, authenticated;
grant execute on function public.tag_night_format(text, uuid, text), public.tag_night_results(text, uuid, jsonb, text),
  public.tag_night_create(text, text, timestamptz, uuid, text, text) to anon, authenticated;
