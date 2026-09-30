-- Random draw doubles (locked 2026-09-30, Mike).
-- Decisions: a round is singles or doubles (per round); partners are a pure random draw (seeded, re-drawable);
-- an odd player is a Cali (a one-person team, throws twice); doubles results are their own team board + team payouts
-- (prize split between partners); tags record from a singles round only. Card requests still pull people onto one card
-- (in doubles their whole teams move together).
-- Source of truth:
--   events.r1_format / r2_format : 'singles' | 'doubles'.  events.dubs_style : the play style printed on cards.
--   teams       : (event, round, team_no) -> player_a (the captain) + player_b (null = Cali). A player is on one team per round.
--   Team scores live on the CAPTAIN's scores rows. Anything a partner enters is routed to the captain (score_upsert,
--   sign_card), so offline sync / last-write-wins / sign / submit keep their existing logic.
--   player_rounds mirrors the captain's result onto the partner, so each player's round is the team's round.
--   team_rounds : one row per team per round (the doubles board).
--   round_payouts : payout config for a doubles round (one pool of teams; each prize is split between partners).
-- Rules:
--   * Teams can only change while the round has no scores; changing them clears that round's cards (regenerate).
--   * Publishing a doubles round refuses a card that splits a team, or a player who isn't on a team.
--   * A round's format can't change once it has cards.
-- Safe to re-run.

alter table public.events add column if not exists r1_format text not null default 'singles';
alter table public.events add column if not exists r2_format text not null default 'singles';
alter table public.events add column if not exists dubs_style text not null default 'Best shot';
do $$ begin
  alter table public.events add constraint events_r1_format_check check (r1_format in ('singles', 'doubles'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.events add constraint events_r2_format_check check (r2_format in ('singles', 'doubles'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.events add constraint events_dubs_style_check check (dubs_style in ('Best shot', 'Best disc', 'Alternate shot'));
exception when duplicate_object then null; end $$;

create or replace function public._round_format(p_event uuid, p_round smallint) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case when p_round = 2 then r2_format else r1_format end from public.events where id = p_event
$$;

create table if not exists public.teams (
  id        uuid primary key default gen_random_uuid(),
  event_id  uuid not null references public.events(id) on delete cascade,
  round     smallint not null check (round in (1, 2)),
  team_no   smallint not null check (team_no >= 1),
  player_a  uuid not null references public.players(id) on delete cascade,
  player_b  uuid references public.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (player_b is null or player_b <> player_a),
  unique (event_id, round, team_no)
);
create unique index if not exists teams_a on public.teams(round, player_a);
create unique index if not exists teams_b on public.teams(round, player_b) where player_b is not null;
create index if not exists teams_event on public.teams(event_id, round);
alter table public.teams enable row level security;
drop policy if exists "public read" on public.teams;
create policy "public read" on public.teams for select to anon, authenticated using (true);
revoke all on public.teams from anon, authenticated;
grant select on public.teams to anon, authenticated;

-- a player is either a captain or a partner in a round, never both (the unique indexes cover each column separately)
create or replace function public._teams_one_role() returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.teams t where t.round = new.round and t.id <> new.id
             and (t.player_b = new.player_a or (new.player_b is not null and t.player_a = new.player_b))) then
    raise exception 'player_on_two_teams';
  end if;
  return new;
end $$;
drop trigger if exists teams_one_role on public.teams;
create trigger teams_one_role before insert or update on public.teams for each row execute function public._teams_one_role();

create or replace function public._team_captain(p_player uuid, p_round smallint) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select player_a from public.teams where player_b = p_player and round = p_round), p_player)
$$;

-- ---------- TD: set the draw ----------
-- p_teams: [[captain, partner|null], ...] in team order. Replaces the round's teams. Clears unscored cards.
create or replace function public.td_set_teams(p_event_id uuid, p_round smallint, p_teams jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare it jsonb; n int := 0; a uuid; b uuid; seen uuid[] := '{}';
begin
  perform public._require_event_td(p_event_id);
  if p_round not in (1, 2) or p_round > (select rounds from public.events where id = p_event_id) then raise exception 'invalid_round'; end if;
  if public._round_format(p_event_id, p_round) <> 'doubles' then raise exception 'not_doubles'; end if;
  if jsonb_typeof(p_teams) <> 'array' then raise exception 'invalid_teams'; end if;
  if exists (select 1 from public.scores s join public.players p on p.id = s.player_id
             where p.event_id = p_event_id and s.round = p_round) then
    raise exception 'round_has_scores';
  end if;
  delete from public.cards where event_id = p_event_id and round = p_round;
  delete from public.teams where event_id = p_event_id and round = p_round;
  for it in select value from jsonb_array_elements(p_teams) loop
    if jsonb_typeof(it) <> 'array' or jsonb_array_length(it) not between 1 and 2 then raise exception 'invalid_teams'; end if;
    a := (it->>0)::uuid; b := nullif(it->>1, '')::uuid;
    if a is null or a = any(seen) or (b is not null and (b = any(seen) or b = a)) then raise exception 'duplicate_player'; end if;
    if not exists (select 1 from public.players where id = a and event_id = p_event_id)
       or (b is not null and not exists (select 1 from public.players where id = b and event_id = p_event_id)) then
      raise exception 'unknown_player';
    end if;
    n := n + 1; seen := seen || a || coalesce(b, a);
    insert into public.teams (event_id, round, team_no, player_a, player_b) values (p_event_id, p_round, n, a, b);
  end loop;
  return n;
end $$;
revoke all on function public.td_set_teams(uuid, smallint, jsonb) from public, anon;
grant execute on function public.td_set_teams(uuid, smallint, jsonb) to authenticated;

-- ---------- format lives on the event ----------
create or replace function public.td_update_event(p_event_id uuid, p jsonb) returns public.events
language plpgsql security definer set search_path = public, pg_temp as $$
declare ev public.events; v_rounds smallint; v_waves smallint; v_f1 text; v_f2 text;
begin
  perform public._require_event_td(p_event_id);
  select * into ev from public.events where id = p_event_id for update;
  v_rounds := coalesce((p->>'rounds')::smallint, ev.rounds);
  v_waves  := coalesce((p->>'waves')::smallint, ev.waves);
  v_f1 := coalesce(p->>'r1_format', ev.r1_format);
  v_f2 := coalesce(p->>'r2_format', ev.r2_format);
  if v_rounds < ev.rounds and exists (select 1 from public.cards where event_id = p_event_id and round > v_rounds) then
    raise exception 'round2_has_cards';
  end if;
  if v_waves < ev.waves and exists (select 1 from public.cards where event_id = p_event_id and wave = 'PM') then
    raise exception 'pm_cards_exist';
  end if;
  if (v_f1 <> ev.r1_format and exists (select 1 from public.cards where event_id = p_event_id and round = 1))
     or (v_f2 <> ev.r2_format and exists (select 1 from public.cards where event_id = p_event_id and round = 2)) then
    raise exception 'round_has_cards';
  end if;
  if btrim(coalesce(p->>'name', ev.name)) = '' then raise exception 'invalid_name'; end if;

  update public.events set
    name         = btrim(coalesce(p->>'name', name)),
    club_name    = case when p ? 'club_name' then nullif(btrim(coalesce(p->>'club_name', '')), '') else club_name end,
    starts_on    = coalesce((p->>'starts_on')::date, starts_on),
    ends_on      = coalesce((p->>'ends_on')::date, ends_on),
    palette      = coalesce(p->>'palette', palette),
    rounds       = v_rounds,
    waves        = v_waves,
    use_checkin  = coalesce((p->>'use_checkin')::boolean, use_checkin),
    use_sponsors = coalesce((p->>'use_sponsors')::boolean, use_sponsors),
    archived     = coalesce((p->>'archived')::boolean, archived),
    r1_format    = v_f1,
    r2_format    = v_f2,
    dubs_style   = coalesce(p->>'dubs_style', dubs_style)
  where id = p_event_id
  returning * into ev;
  if ev.ends_on < ev.starts_on then raise exception 'invalid_dates'; end if;
  if v_waves = 1 then update public.divisions set wave_default = 'AM' where event_id = p_event_id; end if;
  -- a round that is no longer doubles has no teams
  delete from public.teams where event_id = p_event_id and ((round = 1 and v_f1 <> 'doubles') or (round = 2 and v_f2 <> 'doubles') or round > v_rounds);
  return ev;
end $$;

-- ---------- publishing a doubles round keeps teams together ----------
create or replace function public._check_doubles_cards(p_event_id uuid, p_round smallint, p_cards jsonb) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare it jsonb; ids uuid[];
begin
  if public._round_format(p_event_id, p_round) <> 'doubles' then return; end if;
  for it in select value from jsonb_array_elements(p_cards) loop
    select array_agg(x::uuid) into ids from jsonb_array_elements_text(it->'player_ids') x;
    if exists (select 1 from unnest(ids) i where not exists (
                 select 1 from public.teams t where t.event_id = p_event_id and t.round = p_round and (t.player_a = i or t.player_b = i))) then
      raise exception 'player_without_team';
    end if;
    if exists (select 1 from public.teams t where t.event_id = p_event_id and t.round = p_round and t.player_b is not null
                 and ((t.player_a = any(ids)) <> (t.player_b = any(ids)))) then
      raise exception 'team_split';
    end if;
  end loop;
end $$;

create or replace function public.td_publish_round(
  p_event_id uuid, p_round smallint, p_cards jsonb, p_force boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare it jsonb; v_card uuid; v_label text; v_n int; pid text; seat int; ev public.events;
begin
  perform public._require_event_td(p_event_id);
  select * into ev from public.events where id = p_event_id;
  if p_round not in (1,2) or p_round > ev.rounds then raise exception 'invalid_round'; end if;
  if ev.waves = 1 and exists (select 1 from jsonb_array_elements(p_cards) o where o->>'wave' <> 'AM') then
    raise exception 'invalid_wave';
  end if;
  perform public._check_doubles_cards(p_event_id, p_round, p_cards);

  if not p_force and exists (
      select 1 from public.scores s join public.players p on p.id = s.player_id
      where p.event_id = p_event_id and s.round = p_round) then
    raise exception 'round_has_scores';
  end if;

  delete from public.cards where event_id = p_event_id and round = p_round;

  for it in select value from jsonb_array_elements(p_cards) loop
    if jsonb_array_length(coalesce(it->'player_ids', '[]')) = 0 then
      raise exception 'empty_card';
    end if;
    select count(*) into v_n from jsonb_array_elements(p_cards) o
      where o->>'wave' = it->>'wave' and (o->>'start_hole')::int = (it->>'start_hole')::int;
    v_label := (it->>'start_hole') ||
               case when v_n > 1 then chr(64 + (it->>'group_no')::int) else '' end;

    insert into public.cards (event_id, round, wave, start_hole, group_no, label, locked)
    values (p_event_id, p_round, it->>'wave', (it->>'start_hole')::smallint,
            (it->>'group_no')::smallint, v_label, coalesce((it->>'locked')::boolean, false))
    returning id into v_card;

    seat := 0;
    for pid in select jsonb_array_elements_text(it->'player_ids') loop
      seat := seat + 1;
      if not exists (select 1 from public.players where id = pid::uuid and event_id = p_event_id) then
        raise exception 'unknown_player %', pid;
      end if;
      insert into public.card_players (card_id, round, player_id, seat)
      values (v_card, p_round, pid::uuid, seat);
    end loop;

    insert into public.card_tokens (event_id, round, wave, label)
    values (p_event_id, p_round, it->>'wave', v_label)
    on conflict do nothing;
  end loop;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'card_id', c.id, 'wave', c.wave, 'label', c.label, 'start_hole', c.start_hole, 'token', t.token,
      'players', (select jsonb_agg(cp.player_id order by cp.seat) from public.card_players cp where cp.card_id = c.id))
      order by c.wave, c.start_hole, c.group_no)
    from public.cards c
    join public.card_tokens t on t.event_id = c.event_id and t.round = c.round and t.wave = c.wave and t.label = c.label
    where c.event_id = p_event_id and c.round = p_round), '[]');
end $$;

-- ---------- scorecard: partners route to their captain ----------
create or replace function public._card_complete(p_card uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.card_players where card_id = p_card)
     and not exists (
       select 1
       from public.card_players cp
       join public.cards c on c.id = cp.card_id
       join public.holes h on h.event_id = c.event_id
       left join public.scores s
         on s.player_id = cp.player_id and s.round = cp.round and s.hole = h.n
       where cp.card_id = p_card and s.player_id is null
         and not exists (select 1 from public.teams t where t.player_b = cp.player_id and t.round = cp.round))
$$;

create or replace function public.score_upsert(
  p_token text, p_player_id uuid, p_hole smallint, p_strokes smallint,
  p_client_ts timestamptz default null, p_device_id text default null
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.cards;
  v_ts timestamptz := least(coalesce(p_client_ts, now()), now() + interval '2 minutes');
  v_rows int; v_pid uuid;
begin
  c := public._card_for_token(p_token);
  if not exists (select 1 from public.card_players where card_id = c.id and player_id = p_player_id) then
    return 'rejected_not_on_card';
  end if;
  if exists (select 1 from public.submissions where card_id = c.id) then
    return 'rejected_submitted';
  end if;
  if p_strokes is null or p_strokes not between 1 and 12
     or not exists (select 1 from public.holes where event_id = c.event_id and n = p_hole) then
    return 'rejected_invalid';
  end if;
  v_pid := public._team_captain(p_player_id, c.round);

  insert into public.scores as s (player_id, round, hole, strokes, client_ts, device_id)
  values (v_pid, c.round, p_hole, p_strokes, v_ts, p_device_id)
  on conflict (player_id, round, hole) do update
    set strokes = excluded.strokes, client_ts = excluded.client_ts,
        device_id = excluded.device_id, received_at = now()
    where s.client_ts <= excluded.client_ts;
  get diagnostics v_rows = row_count;
  return case when v_rows = 1 then 'applied' else 'stale' end;
exception when raise_exception then
  if sqlerrm = 'card_submitted' then return 'rejected_submitted'; end if;
  raise;
end $$;

create or replace function public.sign_card(p_token text, p_player_id uuid, p_initials text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.cards; v_ini text := upper(trim(coalesce(p_initials, ''))); v_pid uuid;
begin
  c := public._card_for_token(p_token);
  if not exists (select 1 from public.card_players where card_id = c.id and player_id = p_player_id) then
    return 'rejected_not_on_card';
  end if;
  if exists (select 1 from public.submissions where card_id = c.id) then return 'rejected_submitted'; end if;
  if length(v_ini) not between 1 and 4 then return 'rejected_invalid'; end if;
  if not public._card_complete(c.id) then return 'incomplete'; end if;
  v_pid := public._team_captain(p_player_id, c.round);   -- a team signs once
  insert into public.signoffs (card_id, player_id, initials) values (c.id, v_pid, v_ini)
  on conflict (card_id, player_id) do update set initials = excluded.initials, signed_at = now();
  return 'signed';
end $$;

create or replace function public.submit_card(p_token text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.cards;
begin
  c := public._card_for_token(p_token);
  perform 1 from public.cards where id = c.id for update;   -- serialize double-taps
  if exists (select 1 from public.submissions where card_id = c.id) then return 'already_submitted'; end if;
  if not public._card_complete(c.id) then return 'incomplete'; end if;
  if exists (select 1 from public.card_players cp
             left join public.signoffs s on s.card_id = cp.card_id and s.player_id = cp.player_id
             where cp.card_id = c.id and s.player_id is null
               and not exists (select 1 from public.teams t where t.player_b = cp.player_id and t.round = cp.round)) then
    return 'missing_signatures';
  end if;
  insert into public.submissions (card_id) values (c.id);
  return 'submitted';
end $$;

create or replace function public.get_card(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c public.cards; e public.events;
begin
  c := public._card_for_token(p_token);
  select * into e from public.events where id = c.event_id;
  return jsonb_build_object(
    'card', jsonb_build_object('id', c.id, 'event_id', c.event_id, 'round', c.round,
                               'wave', c.wave, 'label', c.label, 'start_hole', c.start_hole,
                               'format', public._round_format(c.event_id, c.round), 'dubs_style', e.dubs_style),
    'event', jsonb_build_object('name', e.name, 'slug', e.slug, 'club_name', e.club_name, 'skin', e.skin,
                                'palette', e.palette, 'rounds', e.rounds, 'waves', e.waves),
    'players', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name,
                          'div_code', p.div_code, 'seat', cp.seat) order by cp.seat)
                         from public.card_players cp join public.players p on p.id = cp.player_id
                         where cp.card_id = c.id), '[]'),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('team_no', t.team_no, 'a', t.player_a, 'b', t.player_b) order by t.team_no)
                       from public.teams t
                       where t.round = c.round and t.player_a in (select player_id from public.card_players where card_id = c.id)), '[]'),
    'signoffs', coalesce((select jsonb_object_agg(player_id, initials)
                          from public.signoffs where card_id = c.id), '{}'),
    'submitted', exists (select 1 from public.submissions where card_id = c.id),
    'complete', public._card_complete(c.id)
  );
end $$;

-- ---------- results: a partner's round is the team's round ----------
create or replace view public.player_rounds with (security_invoker = true) as
with rounds as (select 1::smallint as round union all select 2::smallint),
course as (select event_id, sum(par)::int as par_total, count(*)::int as hole_count
           from public.holes group by event_id),
app as (select s.player_id, s.round, count(*)::int as holes_played,
               sum(s.strokes)::int as strokes, sum(s.strokes - h.par)::int as to_par
        from public.scores s
        join public.players p on p.id = s.player_id
        join public.holes h on h.event_id = p.event_id and h.n = s.hole
        group by s.player_id, s.round),
src as (select p.id as player_id, r.round,
               coalesce((select t.player_a from public.teams t where t.player_b = p.id and t.round = r.round), p.id) as score_id
        from public.players p cross join rounds r)
select p.id as player_id, p.event_id, p.name, p.div_code, r.round,
       cp.card_id, c.wave, c.label as card_label,
       case when pt.strokes is not null then co.hole_count else coalesce(a.holes_played, 0) end as holes_played,
       co.hole_count,
       coalesce(pt.strokes, a.strokes) as strokes,
       case when pt.strokes is not null then pt.strokes - co.par_total else a.to_par end as to_par,
       (pt.strokes is not null) as paper,
       (pt.strokes is not null or sb.card_id is not null) as official
from public.players p
cross join rounds r
join src on src.player_id = p.id and src.round = r.round
join course co on co.event_id = p.event_id
left join app a            on a.player_id = src.score_id and a.round = r.round
left join public.paper_totals pt on pt.player_id = src.score_id and pt.round = r.round
left join public.card_players cp on cp.player_id = p.id and cp.round = r.round
left join public.cards c         on c.id = cp.card_id
left join public.submissions sb  on sb.card_id = cp.card_id;

create or replace view public.team_rounds with (security_invoker = true) as
select t.id as team_id, t.event_id, t.round, t.team_no, t.player_a, t.player_b,
       pa.name as a_name, pb.name as b_name, pr.card_label, pr.wave,
       pr.holes_played, pr.hole_count, pr.strokes, pr.to_par, pr.paper, pr.official
from public.teams t
join public.players pa on pa.id = t.player_a
left join public.players pb on pb.id = t.player_b
join public.player_rounds pr on pr.player_id = t.player_a and pr.round = t.round;
grant select on public.player_rounds, public.team_rounds to anon, authenticated;

-- ---------- team payouts (one pool per doubles round) ----------
create table if not exists public.round_payouts (
  event_id       uuid not null references public.events(id) on delete cascade,
  round          smallint not null check (round in (1, 2)),
  currency       text not null check (currency in ('cash', 'credit')),
  entry_fee      numeric(8,2) not null default 0 check (entry_fee >= 0),   -- per PLAYER; a team's pot share = 2 x fee (1 x for a Cali)
  payback_pct    numeric(5,2) not null default 100 check (payback_pct between 0 and 100),
  added_override numeric(10,2) check (added_override is null or added_override >= 0),
  paid_places    smallint check (paid_places is null or paid_places between 0 and 200),
  pcts           numeric(5,2)[] check (pcts is null or cardinality(pcts) <= 200),
  updated_at     timestamptz not null default now(),
  primary key (event_id, round)
);
alter table public.round_payouts enable row level security;
revoke all on public.round_payouts from anon, authenticated;
grant select, insert, update, delete on public.round_payouts to authenticated;
drop policy if exists "td only" on public.round_payouts;
create policy "td only" on public.round_payouts for all to authenticated
  using (public.can_td(event_id)) with check (public.can_td(event_id));

-- ---------- duplicate carries the formats + team payout config ----------
create or replace function public.td_create_event(
  p_name text, p_club text, p_starts date, p_ends date,
  p_copy_from uuid default null, p_hole_count int default 18, p_divisions jsonb default '[]',
  p_copy_players boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare src public.events; v_id uuid; v_slug text;
begin
  if p_copy_from is null then
    if not public.is_td() then raise exception 'forbidden'; end if;
  else
    perform public._require_event_td(p_copy_from);
    select * into src from public.events where id = p_copy_from;
  end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'invalid_name'; end if;
  if p_starts is null or p_ends is null or p_ends < p_starts then raise exception 'invalid_dates'; end if;

  v_slug := public._event_slug(p_name, p_starts);
  insert into public.events (slug, name, starts_on, ends_on, club_name, skin, palette, rounds, waves, use_checkin, use_sponsors, course_layout_id,
                             r1_format, r2_format, dubs_style)
  values (v_slug, btrim(p_name), p_starts, p_ends, nullif(btrim(coalesce(p_club, src.club_name, '')), ''),
          coalesce(src.skin, 'event'), coalesce(src.palette, 'cosmic'), coalesce(src.rounds, 1), coalesce(src.waves, 1),
          coalesce(src.use_checkin, true), coalesce(src.use_sponsors, false), src.course_layout_id,
          coalesce(src.r1_format, 'singles'), coalesce(src.r2_format, 'singles'), coalesce(src.dubs_style, 'Best shot'))
  returning id into v_id;

  if p_copy_from is not null then
    insert into public.holes (event_id, n, par, dist_ft, ob, quote, rules)
      select v_id, n, par, dist_ft, ob, quote, rules from public.holes where event_id = p_copy_from;
    insert into public.divisions (event_id, code, sort, wave_default)
      select v_id, code, sort, wave_default from public.divisions where event_id = p_copy_from;
    insert into public.builder_settings (event_id, round, settings)
      select v_id, round, settings from public.builder_settings where event_id = p_copy_from;
    insert into public.event_tds (event_id, email)
      select v_id, email from public.event_tds where event_id = p_copy_from;
    insert into public.event_prize (event_id, credit_round, credit_label)
      select v_id, credit_round, credit_label from public.event_prize where event_id = p_copy_from;
    insert into public.round_payouts (event_id, round, currency, entry_fee, payback_pct, added_override, paid_places, pcts)
      select v_id, round, currency, entry_fee, payback_pct, added_override, paid_places, pcts
        from public.round_payouts where event_id = p_copy_from;
    insert into public.division_payouts (event_id, div_code, currency, entry_fee, payback_pct, added_override, paid_places, pcts)
      select v_id, div_code, currency, entry_fee, payback_pct, added_override, paid_places, pcts
        from public.division_payouts where event_id = p_copy_from;
    insert into public.prep_tasks (event_id, title, category, due_offset_days, assignee, notes, sort)
      select v_id, title, category, due_offset_days, assignee, notes, sort from public.prep_tasks where event_id = p_copy_from;
    insert into public.crew (event_id, name, roles)
      select v_id, name, roles from public.crew where event_id = p_copy_from and revoked_at is null;
    if p_copy_players then
      insert into public.players (event_id, name, div_code, rating, pdga, dgs_id, reg_order, checked_in)
        select v_id, name, div_code, rating, pdga, dgs_id, reg_order, false from public.players where event_id = p_copy_from;
      insert into public.player_private (player_id, event_id, vibe)
        select np.id, v_id, pp.vibe
          from public.player_private pp
          join public.players op on op.id = pp.player_id
          join public.players np on np.event_id = v_id and lower(btrim(np.name)) = lower(btrim(op.name))
         where pp.event_id = p_copy_from and pp.vibe is not null;
      insert into public.keep_apart (event_id, player_a, player_b)
        select distinct v_id, least(na.id, nb.id), greatest(na.id, nb.id)
          from public.keep_apart k
          join public.players oa on oa.id = k.player_a
          join public.players ob on ob.id = k.player_b
          join public.players na on na.event_id = v_id and lower(btrim(na.name)) = lower(btrim(oa.name))
          join public.players nb on nb.event_id = v_id and lower(btrim(nb.name)) = lower(btrim(ob.name))
         where k.event_id = p_copy_from and na.id <> nb.id
        on conflict do nothing;
    end if;
  else
    if p_hole_count is null or p_hole_count not between 1 and 40 then raise exception 'invalid_holes'; end if;
    insert into public.holes (event_id, n, par) select v_id, g, 3 from generate_series(1, p_hole_count) g;
    perform public._write_divisions(v_id, p_divisions);
  end if;
  return jsonb_build_object('id', v_id, 'slug', v_slug);
end $$;

