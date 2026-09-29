-- Card requests, private player tags, keep-apart pairs (locked 2026-09-29)
--
-- Source of truth:
--   card_requests + card_request_players : "put me on a card with ..." (player- or TD-entered)
--   player_private                        : TD-only tag per player: 'star' (needs a good card) / 'easy' (plays with anyone)
--   keep_apart                            : TD-only pairs that must never share a card
-- Rules:
--   * None of these are publicly readable. TDs of the event read/write them (can_td).
--   * Players submit requests only through submit_card_request (no login): every name must be
--     registered in that event, 1-4 partners, max 3 pending ('new') requests per requester,
--     an identical pending request is not duplicated. Archived events refuse requests.
--   * Only 'approved' requests affect card generation (client generator, Round 1).
--   * Duplicating an event carries tags + keep-apart over (matched by player name); requests never.
-- =====================================================================

create table public.card_requests (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  status     text not null default 'new' check (status in ('new', 'approved', 'declined')),
  source     text not null default 'player' check (source in ('player', 'td')),
  note       text check (note is null or length(note) <= 140),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index card_requests_event on public.card_requests(event_id, status);

create table public.card_request_players (
  request_id   uuid not null references public.card_requests(id) on delete cascade,
  player_id    uuid not null references public.players(id) on delete cascade,
  is_requester boolean not null default false,
  primary key (request_id, player_id)
);
create index card_request_players_player on public.card_request_players(player_id);

create table public.player_private (
  player_id  uuid primary key references public.players(id) on delete cascade,
  event_id   uuid not null references public.events(id) on delete cascade,
  vibe       text check (vibe in ('star', 'easy')),
  updated_at timestamptz not null default now()
);
create index player_private_event on public.player_private(event_id);

create table public.keep_apart (
  event_id uuid not null references public.events(id) on delete cascade,
  player_a uuid not null references public.players(id) on delete cascade,
  player_b uuid not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (player_a, player_b),
  check (player_a < player_b)
);
create index keep_apart_event on public.keep_apart(event_id);

-- Same-event integrity: a tag / pair / request member must belong to the row's event.
create or replace function public._same_event_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_event uuid;
begin
  if tg_table_name = 'player_private' then
    if not exists (select 1 from public.players where id = new.player_id and event_id = new.event_id) then raise exception 'wrong_event'; end if;
  elsif tg_table_name = 'keep_apart' then
    if (select count(*) from public.players where id in (new.player_a, new.player_b) and event_id = new.event_id) <> 2 then raise exception 'wrong_event'; end if;
  elsif tg_table_name = 'card_request_players' then
    select event_id into v_event from public.card_requests where id = new.request_id;
    if not exists (select 1 from public.players where id = new.player_id and event_id = v_event) then raise exception 'wrong_event'; end if;
  end if;
  return new;
end $$;
create trigger player_private_guard before insert or update on public.player_private for each row execute function public._same_event_guard();
create trigger keep_apart_guard before insert or update on public.keep_apart for each row execute function public._same_event_guard();
create trigger card_request_players_guard before insert or update on public.card_request_players for each row execute function public._same_event_guard();

-- ---------- RLS: TD-only, per event ----------
alter table public.card_requests        enable row level security;
alter table public.card_request_players enable row level security;
alter table public.player_private       enable row level security;
alter table public.keep_apart           enable row level security;
revoke all on public.card_requests, public.card_request_players, public.player_private, public.keep_apart from anon, authenticated;
grant select, insert, update, delete on public.card_requests, public.card_request_players, public.player_private, public.keep_apart to authenticated;

create policy "td only" on public.card_requests for all to authenticated
  using (public.can_td(event_id)) with check (public.can_td(event_id));
create policy "td only" on public.card_request_players for all to authenticated
  using (public.can_td((select r.event_id from public.card_requests r where r.id = request_id)))
  with check (public.can_td((select r.event_id from public.card_requests r where r.id = request_id)));
create policy "td only" on public.player_private for all to authenticated
  using (public.can_td(event_id)) with check (public.can_td(event_id));
create policy "td only" on public.keep_apart for all to authenticated
  using (public.can_td(event_id)) with check (public.can_td(event_id));

-- ---------- player-facing: submit a request (no login) ----------
-- Returns 'submitted' | 'duplicate'. Raises: invalid_event, event_closed, invalid_request, unknown_player, too_many.
create or replace function public.submit_card_request(p_event_id uuid, p_requester uuid, p_partners uuid[], p_note text default null)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_partners uuid[]; v_id uuid; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not exists (select 1 from public.events where id = p_event_id) then raise exception 'invalid_event'; end if;
  if (select archived from public.events where id = p_event_id) then raise exception 'event_closed'; end if;
  select array_agg(distinct x order by x) into v_partners from unnest(coalesce(p_partners, '{}')) x where x is not null and x <> p_requester;
  if p_requester is null or v_partners is null or cardinality(v_partners) not between 1 and 4
     or (v_note is not null and length(v_note) > 140) then
    raise exception 'invalid_request';
  end if;
  if (select count(*) from public.players where event_id = p_event_id and id = any (v_partners || p_requester)) <> cardinality(v_partners) + 1 then
    raise exception 'unknown_player';
  end if;
  -- the same pending request again: keep the first
  if exists (
    select 1 from public.card_requests r
     where r.event_id = p_event_id and r.status = 'new'
       and exists (select 1 from public.card_request_players m where m.request_id = r.id and m.player_id = p_requester and m.is_requester)
       and (select array_agg(m.player_id order by m.player_id) from public.card_request_players m where m.request_id = r.id and not m.is_requester) = v_partners) then
    return 'duplicate';
  end if;
  if (select count(*) from public.card_requests r
       where r.event_id = p_event_id and r.status = 'new'
         and exists (select 1 from public.card_request_players m where m.request_id = r.id and m.player_id = p_requester and m.is_requester)) >= 3 then
    raise exception 'too_many';
  end if;

  insert into public.card_requests (event_id, source, note) values (p_event_id, 'player', v_note) returning id into v_id;
  insert into public.card_request_players (request_id, player_id, is_requester) values (v_id, p_requester, true);
  insert into public.card_request_players (request_id, player_id, is_requester) select v_id, x, false from unnest(v_partners) x;
  return 'submitted';
end $$;

-- ---------- TD: add a request by hand (lands approved) ----------
create or replace function public.td_add_card_request(p_event_id uuid, p_players uuid[], p_note text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_players uuid[]; v_id uuid;
begin
  perform public._require_event_td(p_event_id);
  select array_agg(distinct x) into v_players from unnest(coalesce(p_players, '{}')) x where x is not null;
  if v_players is null or cardinality(v_players) not between 2 and 5 then raise exception 'invalid_request'; end if;
  if (select count(*) from public.players where event_id = p_event_id and id = any (v_players)) <> cardinality(v_players) then
    raise exception 'unknown_player';
  end if;
  insert into public.card_requests (event_id, status, source, note, decided_at)
  values (p_event_id, 'approved', 'td', nullif(btrim(coalesce(p_note, '')), ''), now()) returning id into v_id;
  insert into public.card_request_players (request_id, player_id, is_requester)
    select v_id, x, x = p_players[1] from unnest(v_players) x;
  return v_id;
end $$;

-- ---------- duplicate: carry tags + keep-apart over ----------
-- Same body as 20260928000200 plus the two copies at the end (players matched by name).
drop function public.td_create_event(text, text, date, date, uuid, int, jsonb, boolean);
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
  insert into public.events (slug, name, starts_on, ends_on, club_name, skin, palette, rounds, waves, use_checkin, use_sponsors)
  values (v_slug, btrim(p_name), p_starts, p_ends, nullif(btrim(coalesce(p_club, src.club_name, '')), ''),
          coalesce(src.skin, 'event'), coalesce(src.palette, 'cosmic'), coalesce(src.rounds, 1), coalesce(src.waves, 1),
          coalesce(src.use_checkin, true), coalesce(src.use_sponsors, false))
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

-- ---------- grants ----------
revoke execute on function public._same_event_guard() from public, anon, authenticated;
revoke execute on function public.submit_card_request(uuid, uuid, uuid[], text), public.td_add_card_request(uuid, uuid[], text),
                           public.td_create_event(text, text, date, date, uuid, int, jsonb, boolean) from public, anon;
grant execute on function public.submit_card_request(uuid, uuid, uuid[], text) to anon, authenticated;
grant execute on function public.td_add_card_request(uuid, uuid[], text),
                          public.td_create_event(text, text, date, date, uuid, int, jsonb, boolean) to authenticated;
