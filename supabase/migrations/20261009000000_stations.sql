-- Volunteer stations (locked 2026-10-01)
-- Source of truth:
--   stations      : per event: name, default headcount (need), notes, sort.
--   station_needs : headcount override for one shift.
--   station_slots : who works a station in a shift. Shift = (day, half): day 0 = first event day, half AM|PM.
--                   claimed = true when crew took an open spot themselves (false = TD assigned).
-- Rules:
--   * TD-only tables (can_td). Crew read the grid through crew_home and act only via crew_claim_slot / crew_drop_slot.
--   * A shift must fall on an event day (0 .. ends_on - starts_on). A slot's crew member and station belong to the event.
--   * One person can't be in the same station + shift twice. Two stations in one shift is allowed (the UI flags it).
--   * Crew claim only while the cell is short (filled < need) and drop only their own claims; TD assignments are the TD's.
--   * Duplicating an event carries stations + per-shift needs, never slots.
-- =====================================================================

create table public.stations (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 40),
  need       smallint not null default 1 check (need between 0 and 50),
  notes      text check (notes is null or length(notes) <= 500),
  sort       integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index stations_name_key on public.stations (event_id, lower(btrim(name)));

create table public.station_needs (
  station_id uuid not null references public.stations(id) on delete cascade,
  day        smallint not null check (day between 0 and 13),
  half       text not null check (half in ('AM', 'PM')),
  need       smallint not null check (need between 0 and 50),
  primary key (station_id, day, half)
);

create table public.station_slots (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  day        smallint not null check (day between 0 and 13),
  half       text not null check (half in ('AM', 'PM')),
  crew_id    uuid not null references public.crew(id) on delete cascade,
  claimed    boolean not null default false,
  created_at timestamptz not null default now(),
  unique (station_id, day, half, crew_id)
);
create index station_slots_event on public.station_slots(event_id, day, half);

create or replace function public._slot_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare ev public.events;
begin
  select * into ev from public.events where id = new.event_id;
  if new.day > ev.ends_on - ev.starts_on then raise exception 'not_an_event_day'; end if;
  if not exists (select 1 from public.stations where id = new.station_id and event_id = new.event_id)
     or not exists (select 1 from public.crew where id = new.crew_id and event_id = new.event_id) then
    raise exception 'wrong_event';
  end if;
  return new;
end $$;
create trigger station_slots_check before insert or update on public.station_slots
  for each row execute function public._slot_check();

alter table public.stations      enable row level security;
alter table public.station_needs enable row level security;
alter table public.station_slots enable row level security;
revoke all on public.stations, public.station_needs, public.station_slots from anon, authenticated;
grant select, insert, update, delete on public.stations, public.station_needs, public.station_slots to authenticated;
create policy "td only" on public.stations for all to authenticated using (public.can_td(event_id)) with check (public.can_td(event_id));
create policy "td only" on public.station_slots for all to authenticated using (public.can_td(event_id)) with check (public.can_td(event_id));
create policy "td only" on public.station_needs for all to authenticated
  using (public.can_td((select s.event_id from public.stations s where s.id = station_id)))
  with check (public.can_td((select s.event_id from public.stations s where s.id = station_id)));

create or replace function public._station_need(p_station uuid, p_day int, p_half text) returns int
language sql stable set search_path = public, pg_temp as $$
  select coalesce((select need from public.station_needs where station_id = p_station and day = p_day and half = p_half),
                  (select need from public.stations where id = p_station))
$$;

create or replace function public.crew_claim_slot(p_token text, p_station uuid, p_day int, p_half text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.crew; v_id uuid;
begin
  c := public._crew(p_token);
  if not exists (select 1 from public.stations where id = p_station and event_id = c.event_id) then raise exception 'not_found'; end if;
  perform 1 from public.stations where id = p_station for update;   -- serialize claims on one station
  if (select count(*) from public.station_slots where station_id = p_station and day = p_day and half = p_half)
     >= public._station_need(p_station, p_day, p_half) then
    raise exception 'station_full';
  end if;
  insert into public.station_slots (event_id, station_id, day, half, crew_id, claimed)
  values (c.event_id, p_station, p_day, p_half, c.id, true)
  on conflict (station_id, day, half, crew_id) do nothing
  returning id into v_id;
  if v_id is null then raise exception 'already_there'; end if;
  return v_id;
end $$;

create or replace function public.crew_drop_slot(p_token text, p_slot uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.crew;
begin
  c := public._crew(p_token);
  delete from public.station_slots where id = p_slot and crew_id = c.id and claimed;
  if not found then raise exception 'not_your_claim'; end if;
end $$;

revoke execute on function public._station_need(uuid, int, text) from public, anon, authenticated;
revoke execute on function public.crew_claim_slot(text, uuid, int, text), public.crew_drop_slot(text, uuid) from public;
grant execute on function public.crew_claim_slot(text, uuid, int, text), public.crew_drop_slot(text, uuid) to anon, authenticated;

-- ---------- crew_home: add stations + slots (redefined from crew) ----------
create or replace function public.crew_home(p_token text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.crew; ev public.events; out jsonb;
begin
  c := public._crew(p_token);
  update public.crew set last_seen_at = now() where id = c.id;
  select * into ev from public.events where id = c.event_id;
  out := jsonb_build_object(
    'me', jsonb_build_object('id', c.id, 'name', c.name, 'roles', to_jsonb(c.roles)),
    'event', jsonb_build_object('id', ev.id, 'name', ev.name, 'slug', ev.slug, 'club_name', ev.club_name,
      'starts_on', ev.starts_on, 'ends_on', ev.ends_on, 'skin', ev.skin, 'palette', ev.palette, 'use_checkin', ev.use_checkin),
    'crew', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'roles', to_jsonb(x.roles)) order by x.name)
                        from public.crew x where x.event_id = c.event_id and x.revoked_at is null), '[]'),
    'announcements', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'body', a.body, 'roles', to_jsonb(a.roles),
                        'pinned', a.pinned, 'created_at', a.created_at, 'updated_at', a.updated_at,
                        'read', exists (select 1 from public.announcement_reads r where r.announcement_id = a.id and r.crew_id = c.id))
                        order by a.pinned desc, a.created_at desc)
                        from public.announcements a where a.event_id = c.event_id and (a.roles = '{}' or a.roles && c.roles)), '[]'),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'category', t.category,
                        'due_offset_days', t.due_offset_days, 'done_at', t.done_at, 'done_by', t.done_by, 'notes', t.notes,
                        'crew_id', t.crew_id, 'assignee', t.assignee, 'sort', t.sort,
                        'updates', coalesce((select jsonb_agg(jsonb_build_object('author', n.author, 'body', n.body, 'created_at', n.created_at) order by n.created_at)
                                              from public.prep_task_notes n where n.task_id = t.id), '[]'))
                        order by t.sort)
                        from public.prep_tasks t where t.event_id = c.event_id), '[]')
  );
  if 'checkin' = any (c.roles) or 'requests' = any (c.roles) then
    out := out || jsonb_build_object(
      'players', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'div_code', p.div_code, 'checked_in', p.checked_in) order by p.name)
                             from public.players p where p.event_id = c.event_id), '[]'),
      'divisions', coalesce((select jsonb_agg(d.code order by d.sort) from public.divisions d where d.event_id = c.event_id), '[]'));
  end if;
  if 'requests' = any (c.roles) then
    out := out || jsonb_build_object('my_requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'note', r.note, 'created_at', r.created_at,
        'players', (select jsonb_agg(m.player_id) from public.card_request_players m where m.request_id = r.id)) order by r.created_at desc)
      from public.card_requests r where r.event_id = c.event_id and r.crew_id = c.id), '[]'));
  end if;
  if 'raffle' = any (c.roles) then
    out := out || jsonb_build_object(
      'raffle', jsonb_build_object(
        'total', coalesce((select sum(amount) from public.raffle_sales where event_id = c.event_id and voided_at is null), 0),
        'tickets', coalesce((select sum(tickets) from public.raffle_sales where event_id = c.event_id and voided_at is null), 0),
        'mine', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'buyer', s.buyer, 'tickets', s.tickets, 'amount', s.amount, 'method', s.method,
                   'created_at', s.created_at, 'voided_at', s.voided_at) order by s.created_at desc)
                   from public.raffle_sales s where s.event_id = c.event_id and s.crew_id = c.id), '[]')));
  end if;
  if 'contacts' = any (c.roles) then
    out := out || jsonb_build_object('contacts', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'kind', k.kind, 'name', k.name, 'org', k.org,
        'phone', k.phone, 'email', k.email, 'status', k.status, 'amount', k.amount, 'notes', k.notes, 'mine', k.crew_id = c.id,
        'owner', (select x.name from public.crew x where x.id = k.crew_id), 'updated_at', k.updated_at) order by k.kind, k.name)
      from public.contacts k where k.event_id = c.event_id), '[]'));
  end if;
  out := out || jsonb_build_object(
    'stations', coalesce((select jsonb_agg(jsonb_build_object('id', st.id, 'name', st.name, 'need', st.need, 'notes', st.notes, 'sort', st.sort,
        'needs', coalesce((select jsonb_agg(jsonb_build_object('day', n.day, 'half', n.half, 'need', n.need)) from public.station_needs n where n.station_id = st.id), '[]'))
        order by st.sort, st.name) from public.stations st where st.event_id = c.event_id), '[]'),
    'slots', coalesce((select jsonb_agg(jsonb_build_object('id', sl.id, 'station_id', sl.station_id, 'day', sl.day, 'half', sl.half,
        'crew_id', sl.crew_id, 'name', x.name, 'claimed', sl.claimed))
        from public.station_slots sl join public.crew x on x.id = sl.crew_id where sl.event_id = c.event_id), '[]'));
  return out;
end $$;

-- ---------- duplicate carries stations + needs (td_create_event replaced in place, from doubles) ----------
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
    insert into public.stations (event_id, name, need, notes, sort)
      select v_id, name, need, notes, sort from public.stations where event_id = p_copy_from;
    insert into public.station_needs (station_id, day, half, need)
      select ns.id, n.day, n.half, n.need
        from public.station_needs n
        join public.stations os on os.id = n.station_id and os.event_id = p_copy_from
        join public.stations ns on ns.event_id = v_id and ns.name = os.name;
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
