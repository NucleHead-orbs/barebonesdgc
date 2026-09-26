-- =====================================================================
-- Jewel XI Scoring — core schema
-- Truth layer for players, cards, scores, sign-offs, and paper totals.
--
-- Access model (locked 2026-09-26):
--   * Public (anon) can READ everything except card tokens.
--   * Players NEVER write tables directly. All player writes go through
--     SECURITY DEFINER RPCs that require the card's QR token.
--   * The TD writes via RLS policies gated on JWT app_metadata.role = 'td'.
-- =====================================================================

-- ---------- helpers --------------------------------------------------
create or replace function public.is_td() returns boolean
language sql stable set search_path = public, pg_temp as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'td'
$$;

create or replace function public._new_token() returns text
language sql volatile set search_path = public, pg_temp as $$
  -- 16 hex chars (64 bits) from a v4 UUID; URL-safe, no extension needed.
  select substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)
$$;

-- ---------- reference data -------------------------------------------
create table public.events (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  starts_on  date not null,
  ends_on    date not null,
  created_at timestamptz not null default now()
);

create table public.holes (
  event_id uuid not null references public.events(id) on delete cascade,
  n        smallint not null check (n between 1 and 40),
  par      smallint not null check (par between 2 and 6),
  dist_ft  integer,
  ob       text,
  quote    text,
  rules    text[] not null default '{}',
  primary key (event_id, n)
);

create table public.divisions (
  event_id     uuid not null references public.events(id) on delete cascade,
  code         text not null,
  sort         smallint not null,
  wave_default text not null check (wave_default in ('AM','PM')),
  primary key (event_id, code)
);

create table public.sponsors (
  id       uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name     text not null,
  tier     text,
  hole     smallint,
  logo_url text,
  sort     integer not null default 0
);

-- ---------- players ---------------------------------------------------
create table public.players (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  div_code   text not null,
  rating     integer,
  pdga       text,
  dgs_id     text,
  reg_order  integer,
  checked_in boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (event_id, div_code) references public.divisions(event_id, code)
);
create unique index players_dgs_uq  on public.players(event_id, dgs_id) where dgs_id is not null;
create unique index players_pdga_uq on public.players(event_id, pdga)   where pdga   is not null;

-- ---------- cards -----------------------------------------------------
create table public.cards (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  round      smallint not null check (round in (1,2)),
  wave       text not null check (wave in ('AM','PM')),
  start_hole smallint not null,
  group_no   smallint not null check (group_no >= 1),
  label      text not null,          -- '7' or '7A' (server-computed, see td_publish_round)
  locked     boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, round),
  unique (event_id, round, wave, start_hole, group_no),
  unique (event_id, round, wave, label),
  foreign key (event_id, start_hole) references public.holes(event_id, n)
);

-- Tokens are keyed by SLOT (event, round, wave, label), not by card row,
-- so a printed QR survives regenerating the round. Never publicly readable.
create table public.card_tokens (
  event_id uuid not null references public.events(id) on delete cascade,
  round    smallint not null,
  wave     text not null,
  label    text not null,
  token    text not null unique default public._new_token(),
  primary key (event_id, round, wave, label)
);

create table public.card_players (
  card_id   uuid not null,
  round     smallint not null,
  player_id uuid not null references public.players(id) on delete cascade,
  seat      smallint not null,
  primary key (card_id, player_id),
  unique (player_id, round),                        -- one card per player per round
  foreign key (card_id, round) references public.cards(id, round) on delete cascade
);

-- ---------- scoring ---------------------------------------------------
create table public.scores (
  player_id   uuid not null references public.players(id) on delete cascade,
  round       smallint not null check (round in (1,2)),
  hole        smallint not null,
  strokes     smallint not null check (strokes between 1 and 12),
  client_ts   timestamptz not null,               -- when the thumb hit the screen (LWW key)
  received_at timestamptz not null default now(), -- when the server got it
  device_id   text,
  primary key (player_id, round, hole)
);

create table public.signoffs (
  card_id   uuid not null,
  player_id uuid not null,
  initials  text not null check (length(initials) between 1 and 4),
  signed_at timestamptz not null default now(),
  primary key (card_id, player_id),
  foreign key (card_id, player_id) references public.card_players(card_id, player_id) on delete cascade
);

create table public.submissions (
  card_id      uuid primary key references public.cards(id) on delete cascade,
  submitted_at timestamptz not null default now()
);

create table public.paper_totals (
  player_id  uuid not null references public.players(id) on delete cascade,
  round      smallint not null check (round in (1,2)),
  strokes    integer not null check (strokes between 20 and 240),
  entered_by uuid default auth.uid(),
  entered_at timestamptz not null default now(),
  primary key (player_id, round)
);

create table public.playoffs (
  event_id         uuid not null references public.events(id) on delete cascade,
  div_code         text not null,
  winner_player_id uuid not null references public.players(id) on delete cascade,
  notes            text,
  recorded_at      timestamptz not null default now(),
  primary key (event_id, div_code)
);

create table public.builder_settings (
  event_id   uuid not null references public.events(id) on delete cascade,
  round      smallint not null check (round in (1,2)),
  settings   jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (event_id, round)
);

create index scores_round_idx     on public.scores(round);
create index card_players_player  on public.card_players(player_id);
create index cards_event_round    on public.cards(event_id, round);

-- ---------- invariants (triggers) -------------------------------------
-- Card for a player in a round (null if unassigned).
create or replace function public._card_of(p_player uuid, p_round smallint) returns uuid
language sql stable set search_path = public, pg_temp as $$
  select card_id from public.card_players where player_id = p_player and round = p_round
$$;

-- Rule: a submitted card's scores are frozen. Applies to everyone, TD included
-- (TD unlocks first). Raises SQLSTATE P0001 with message 'card_submitted'.
create or replace function public._scores_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_card uuid;
begin
  v_card := public._card_of(coalesce(new.player_id, old.player_id), coalesce(new.round, old.round));
  if v_card is not null and exists (select 1 from public.submissions where card_id = v_card) then
    raise exception 'card_submitted';
  end if;
  return coalesce(new, old);
end $$;

create trigger scores_guard before insert or update or delete on public.scores
for each row execute function public._scores_guard();

-- Rule: any CHANGE to a score clears every signature on that card+round.
-- Re-saving the same value does not.
create or replace function public._scores_clear_signoffs() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_card uuid;
begin
  if tg_op = 'UPDATE' and new.strokes is not distinct from old.strokes then
    return null;
  end if;
  v_card := public._card_of(coalesce(new.player_id, old.player_id), coalesce(new.round, old.round));
  if v_card is not null then
    delete from public.signoffs where card_id = v_card;
  end if;
  return null;
end $$;

create trigger scores_clear_signoffs after insert or update or delete on public.scores
for each row execute function public._scores_clear_signoffs();

create or replace function public._signoffs_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.submissions where card_id = new.card_id) then
    raise exception 'card_submitted';
  end if;
  return new;
end $$;

create trigger signoffs_guard before insert or update on public.signoffs
for each row execute function public._signoffs_guard();

-- ---------- token resolution ------------------------------------------
create or replace function public._card_for_token(p_token text) returns public.cards
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v public.cards;
begin
  select c.* into v
  from public.card_tokens t
  join public.cards c
    on c.event_id = t.event_id and c.round = t.round and c.wave = t.wave and c.label = t.label
  where t.token = p_token;
  if not found then raise exception 'invalid_token'; end if;
  return v;
end $$;

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
       where cp.card_id = p_card and s.player_id is null)
$$;

-- ---------- player RPCs (token-gated) ---------------------------------
-- Everything a phone needs to open a card: card, players, current sign/submit state.
create or replace function public.get_card(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c public.cards;
begin
  c := public._card_for_token(p_token);
  return jsonb_build_object(
    'card', jsonb_build_object('id', c.id, 'event_id', c.event_id, 'round', c.round,
                               'wave', c.wave, 'label', c.label, 'start_hole', c.start_hole),
    'players', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name,
                          'div_code', p.div_code, 'seat', cp.seat) order by cp.seat)
                         from public.card_players cp join public.players p on p.id = cp.player_id
                         where cp.card_id = c.id), '[]'),
    'signoffs', coalesce((select jsonb_object_agg(player_id, initials)
                          from public.signoffs where card_id = c.id), '{}'),
    'submitted', exists (select 1 from public.submissions where card_id = c.id),
    'complete', public._card_complete(c.id)
  );
end $$;

-- One score write. Returns: 'applied' | 'stale' | 'rejected_submitted'
--                          | 'rejected_not_on_card' | 'rejected_invalid'.
-- Last-write-wins on client_ts. Future-dated phone clocks are clamped to
-- now()+2min so one bad clock can't lock a hole for the rest of the day.
create or replace function public.score_upsert(
  p_token text, p_player_id uuid, p_hole smallint, p_strokes smallint,
  p_client_ts timestamptz default null, p_device_id text default null
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.cards;
  v_ts timestamptz := least(coalesce(p_client_ts, now()), now() + interval '2 minutes');
  v_rows int;
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

  insert into public.scores as s (player_id, round, hole, strokes, client_ts, device_id)
  values (p_player_id, c.round, p_hole, p_strokes, v_ts, p_device_id)
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

-- Offline queue flush. p_items: [{player_id, hole, strokes, client_ts, device_id}]
-- Each item stands alone; one bad item never blocks the rest.
-- Returns [{player_id, hole, client_ts, result}] in input order.
create or replace function public.score_sync(p_token text, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare it jsonb; out jsonb := '[]'; r text;
begin
  perform public._card_for_token(p_token);  -- fail fast on a bad token
  for it in select value from jsonb_array_elements(p_items) with ordinality order by ordinality loop
    begin
      r := public.score_upsert(p_token, (it->>'player_id')::uuid, (it->>'hole')::smallint,
                               (it->>'strokes')::smallint, (it->>'client_ts')::timestamptz,
                               it->>'device_id');
    exception when others then
      r := 'rejected_invalid';
    end;
    out := out || jsonb_build_object('player_id', it->'player_id', 'hole', it->'hole',
                                     'client_ts', it->'client_ts', 'result', r);
  end loop;
  return out;
end $$;

-- Returns: 'signed' | 'incomplete' | 'rejected_submitted' | 'rejected_not_on_card' | 'rejected_invalid'
create or replace function public.sign_card(p_token text, p_player_id uuid, p_initials text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.cards; v_ini text := upper(trim(coalesce(p_initials, '')));
begin
  c := public._card_for_token(p_token);
  if not exists (select 1 from public.card_players where card_id = c.id and player_id = p_player_id) then
    return 'rejected_not_on_card';
  end if;
  if exists (select 1 from public.submissions where card_id = c.id) then return 'rejected_submitted'; end if;
  if length(v_ini) not between 1 and 4 then return 'rejected_invalid'; end if;
  if not public._card_complete(c.id) then return 'incomplete'; end if;
  insert into public.signoffs (card_id, player_id, initials) values (c.id, p_player_id, v_ini)
  on conflict (card_id, player_id) do update set initials = excluded.initials, signed_at = now();
  return 'signed';
end $$;

-- Returns: 'submitted' | 'already_submitted' | 'incomplete' | 'missing_signatures'
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
             where cp.card_id = c.id and s.player_id is null) then
    return 'missing_signatures';
  end if;
  insert into public.submissions (card_id) values (c.id);
  return 'submitted';
end $$;

-- ---------- TD RPCs ----------------------------------------------------
create or replace function public._require_td() returns void
language plpgsql stable set search_path = public, pg_temp as $$
begin
  if not public.is_td() then raise exception 'forbidden'; end if;
end $$;

create or replace function public.td_unlock_card(p_card_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._require_td();
  delete from public.submissions where card_id = p_card_id;
  delete from public.signoffs    where card_id = p_card_id;
end $$;

-- Upsert players from a DGS export. Match order: dgs_id, then pdga. Never deletes.
-- p_rows: [{name, div_code, rating, pdga, dgs_id, reg_order}]
-- Returns {inserted, updated, skipped:[{row, reason}]}
create or replace function public.td_import_players(p_event_id uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  it jsonb; v_id uuid; ins int := 0; upd int := 0; skipped jsonb := '[]';
  v_name text; v_div text; v_dgs text; v_pdga text;
begin
  perform public._require_td();
  for it in select value from jsonb_array_elements(p_rows) loop
    v_name := trim(coalesce(it->>'name', ''));
    v_div  := upper(trim(coalesce(it->>'div_code', '')));
    v_dgs  := nullif(trim(coalesce(it->>'dgs_id', '')), '');
    v_pdga := nullif(trim(coalesce(it->>'pdga', '')), '');
    if v_name = '' then skipped := skipped || jsonb_build_object('row', it, 'reason', 'no_name'); continue; end if;
    if v_div = 'SPON' then skipped := skipped || jsonb_build_object('row', it, 'reason', 'sponsor_only'); continue; end if;
    if not exists (select 1 from public.divisions where event_id = p_event_id and code = v_div) then
      skipped := skipped || jsonb_build_object('row', it, 'reason', 'unknown_division'); continue;
    end if;

    v_id := null;
    if v_dgs  is not null then select id into v_id from public.players where event_id = p_event_id and dgs_id = v_dgs; end if;
    if v_id is null and v_pdga is not null then select id into v_id from public.players where event_id = p_event_id and pdga = v_pdga; end if;

    if v_id is null then
      insert into public.players (event_id, name, div_code, rating, pdga, dgs_id, reg_order)
      values (p_event_id, v_name, v_div, nullif(it->>'rating','')::int, v_pdga, v_dgs, nullif(it->>'reg_order','')::int);
      ins := ins + 1;
    else
      update public.players set name = v_name, div_code = v_div,
        rating = nullif(it->>'rating','')::int,
        pdga = coalesce(v_pdga, pdga), dgs_id = coalesce(v_dgs, dgs_id),
        reg_order = coalesce(nullif(it->>'reg_order','')::int, reg_order)
      where id = v_id;
      upd := upd + 1;
    end if;
  end loop;
  return jsonb_build_object('inserted', ins, 'updated', upd, 'skipped', skipped);
end $$;

-- Publish a round: the builder's FULL output (locked cards included) replaces
-- the round atomically. Labels are computed here — one rule, one place:
--   group letter appears only when a wave has >1 card on that hole ('7A','7B').
-- Refuses if the round already has scores, unless p_force.
-- p_cards: [{wave, start_hole, group_no, locked, player_ids:[uuid,...]}]
-- Returns [{card_id, wave, label, start_hole, token, players}]
create or replace function public.td_publish_round(
  p_event_id uuid, p_round smallint, p_cards jsonb, p_force boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare it jsonb; v_card uuid; v_label text; v_n int; pid text; seat int;
begin
  perform public._require_td();
  if p_round not in (1,2) then raise exception 'invalid_round'; end if;

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

-- ---------- read models ------------------------------------------------
-- One row per player per round. Paper total overrides app scores.
-- Official = paper total exists OR that round's card is submitted.
create view public.player_rounds with (security_invoker = true) as
with rounds as (select 1::smallint as round union all select 2::smallint),
course as (select event_id, sum(par)::int as par_total, count(*)::int as hole_count
           from public.holes group by event_id),
app as (select s.player_id, s.round, count(*)::int as holes_played,
               sum(s.strokes)::int as strokes, sum(s.strokes - h.par)::int as to_par
        from public.scores s
        join public.players p on p.id = s.player_id
        join public.holes h on h.event_id = p.event_id and h.n = s.hole
        group by s.player_id, s.round)
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
join course co on co.event_id = p.event_id
left join app a            on a.player_id = p.id and a.round = r.round
left join public.paper_totals pt on pt.player_id = p.id and pt.round = r.round
left join public.card_players cp on cp.player_id = p.id and cp.round = r.round
left join public.cards c         on c.id = cp.card_id
left join public.submissions sb  on sb.card_id = cp.card_id;

-- Leaderboard source: one row per player. Client ranks within division.
create view public.leaderboard with (security_invoker = true) as
select p.id as player_id, p.event_id, p.name, p.div_code, d.sort as div_sort,
       r1.holes_played as r1_holes, r1.to_par as r1_to_par, r1.official as r1_official,
       r2.holes_played as r2_holes, r2.to_par as r2_to_par, r2.official as r2_official,
       r1.hole_count
from public.players p
join public.divisions d on d.event_id = p.event_id and d.code = p.div_code
join public.player_rounds r1 on r1.player_id = p.id and r1.round = 1
join public.player_rounds r2 on r2.player_id = p.id and r2.round = 2;

-- R2 seeding: official, COMPLETE R1 totals only. Everyone else seeds last.
create view public.r2_seed with (security_invoker = true) as
select player_id, event_id, div_code, strokes as r1_strokes
from public.player_rounds
where round = 1 and official and holes_played = hole_count;

-- ---------- RLS ----------------------------------------------------------
-- Supabase auto-grants ALL on new public tables/views to anon + authenticated.
-- Wipe that so the explicit grants below are the complete access truth.
revoke all on all tables in schema public from anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['events','holes','divisions','sponsors','players','cards','card_players',
                           'scores','signoffs','submissions','paper_totals','playoffs','builder_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    execute format('create policy "td write" on public.%I for all to authenticated using (public.is_td()) with check (public.is_td())', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

alter table public.card_tokens enable row level security;
create policy "td only" on public.card_tokens for all to authenticated
  using (public.is_td()) with check (public.is_td());
grant select, insert, update, delete on public.card_tokens to authenticated;

grant select on public.player_rounds, public.leaderboard, public.r2_seed to anon, authenticated;

-- Function execute rights: lock down internals, expose the API surface only.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_td() to anon, authenticated;
grant execute on function public.get_card(text), public.score_upsert(text, uuid, smallint, smallint, timestamptz, text),
                          public.score_sync(text, jsonb), public.sign_card(text, uuid, text),
                          public.submit_card(text)
  to anon, authenticated;
grant execute on function public.td_unlock_card(uuid), public.td_import_players(uuid, jsonb),
                          public.td_publish_round(uuid, smallint, jsonb, boolean)
  to authenticated;
-- Triggers and views call these as the invoker, so readers need them:
grant execute on function public._card_of(uuid, smallint), public._new_token() to anon, authenticated;

-- Realtime: leaderboard subscribes to these.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.scores, public.signoffs,
      public.submissions, public.paper_totals, public.card_players, public.cards;
  end if;
end $$;
