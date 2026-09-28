-- Multi-event TD tool (locked 2026-09-28)
-- Jewel XI becomes one saved configuration of a generic event.
--
-- Access model:
--   * app_metadata.role = 'td'  -> SUPER ADMIN (every event; only one who creates events from scratch / deletes).
--   * event_tds(event_id, email) -> EVENT TD for that event only. Invite = add the email; the person signs up
--     with it. Only CONFIRMED emails count (auth.users.email_confirmed_at).
--   * Every TD write (RLS + RPC) is checked per event with can_td(event_id).
--   * Players still never write tables; token RPCs are unchanged.
-- =====================================================================

-- ---------- 1. event format (the "build menu") ------------------------
alter table public.events
  add column club_name    text,
  add column skin         text     not null default 'event'  check (skin in ('event', 'jewel-xi')),
  add column palette      text     not null default 'cosmic' check (palette in ('cosmic', 'sunset', 'toxic', 'blood', 'bone')),
  add column rounds       smallint not null default 1        check (rounds in (1, 2)),
  add column waves        smallint not null default 1        check (waves in (1, 2)),  -- 1 = single wave (stored as AM), 2 = AM/PM
  add column use_checkin  boolean  not null default true,
  add column use_sponsors boolean  not null default false,
  add column archived     boolean  not null default false;

-- Jewel XI = today's configuration, selected.
update public.events
   set club_name = 'Bare Bones Disc Golf', skin = 'jewel-xi', palette = 'cosmic',
       rounds = 2, waves = 2, use_checkin = false, use_sponsors = true
 where slug = 'jewel-xi-2026';

-- ---------- 2. event TDs ------------------------------------------------
create table public.event_tds (
  event_id uuid not null references public.events(id) on delete cascade,
  email    text not null check (email = lower(btrim(email)) and email like '_%@_%'),
  added_at timestamptz not null default now(),
  primary key (event_id, email)
);
create index event_tds_email on public.event_tds(email);

-- Caller's email, only once confirmed. Null for anon / unconfirmed.
create or replace function public.my_email() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select lower(email) from auth.users where id = auth.uid() and email_confirmed_at is not null
$$;

create or replace function public.can_td(p_event uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_td()
      or exists (select 1 from public.event_tds t where t.event_id = p_event and t.email = public.my_email())
$$;

create or replace function public._uuid_or_null(p text) returns uuid
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

create or replace function public._require_event_td(p_event uuid) returns void
language plpgsql stable set search_path = public, pg_temp as $$
begin
  if p_event is null or not public.can_td(p_event) then raise exception 'forbidden'; end if;
end $$;

-- ---------- 3. RLS: global "td write" -> per-event ----------------------
drop policy "td write" on public.events;
create policy "admin insert" on public.events for insert to authenticated with check (public.is_td());
-- no UPDATE policy: events change only through td_update_event (it enforces the format rules)
create policy "admin delete" on public.events for delete to authenticated using (public.is_td());

do $$
declare t text;
begin
  -- tables that carry event_id
  foreach t in array array['holes', 'divisions', 'sponsors', 'players', 'cards', 'playoffs', 'builder_settings'] loop
    execute format('drop policy "td write" on public.%I', t);
    execute format('create policy "td write" on public.%I for all to authenticated '
                   'using (public.can_td(event_id)) with check (public.can_td(event_id))', t);
  end loop;
  -- card-scoped tables
  foreach t in array array['card_players', 'signoffs', 'submissions'] loop
    execute format('drop policy "td write" on public.%I', t);
    execute format('create policy "td write" on public.%I for all to authenticated '
                   'using (public.can_td((select c.event_id from public.cards c where c.id = card_id))) '
                   'with check (public.can_td((select c.event_id from public.cards c where c.id = card_id)))', t);
  end loop;
  -- player-scoped tables
  foreach t in array array['scores', 'paper_totals'] loop
    execute format('drop policy "td write" on public.%I', t);
    execute format('create policy "td write" on public.%I for all to authenticated '
                   'using (public.can_td((select p.event_id from public.players p where p.id = player_id))) '
                   'with check (public.can_td((select p.event_id from public.players p where p.id = player_id)))', t);
  end loop;
end $$;

drop policy "td only" on public.card_tokens;
create policy "td only" on public.card_tokens for all to authenticated
  using (public.can_td(event_id)) with check (public.can_td(event_id));

drop policy "public read" on public.sponsors;
create policy "public read" on public.sponsors for select to anon, authenticated
  using (not hidden or public.can_td(event_id));

-- event_tds: you see your own rows and your events' rows; only the super admin edits the list.
alter table public.event_tds enable row level security;
revoke all on public.event_tds from anon, authenticated;
grant select, insert, delete on public.event_tds to authenticated;
create policy "td read"     on public.event_tds for select to authenticated using (email = public.my_email() or public.can_td(event_id));
create policy "admin write" on public.event_tds for insert to authenticated with check (public.is_td());
create policy "admin del"   on public.event_tds for delete to authenticated using (public.is_td());

-- Sponsor logos live under <event_id>/...
drop policy "td writes sponsor logos"  on storage.objects;
drop policy "td updates sponsor logos" on storage.objects;
drop policy "td deletes sponsor logos" on storage.objects;
create policy "td writes sponsor logos" on storage.objects for insert to authenticated
  with check (bucket_id = 'sponsor-logos' and public.can_td(public._uuid_or_null((storage.foldername(name))[1])));
create policy "td updates sponsor logos" on storage.objects for update to authenticated
  using (bucket_id = 'sponsor-logos' and public.can_td(public._uuid_or_null((storage.foldername(name))[1])))
  with check (bucket_id = 'sponsor-logos' and public.can_td(public._uuid_or_null((storage.foldername(name))[1])));
create policy "td deletes sponsor logos" on storage.objects for delete to authenticated
  using (bucket_id = 'sponsor-logos' and public.can_td(public._uuid_or_null((storage.foldername(name))[1])));

-- ---------- 4. TD RPCs: same logic, per-event check ----------------------
create or replace function public.td_unlock_card(p_card_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._require_event_td((select event_id from public.cards where id = p_card_id));
  delete from public.submissions where card_id = p_card_id;
  delete from public.signoffs    where card_id = p_card_id;
end $$;

create or replace function public.td_import_players(p_event_id uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  it jsonb; v_id uuid; ins int := 0; upd int := 0; skipped jsonb := '[]';
  v_name text; v_div text; v_dgs text; v_pdga text;
begin
  perform public._require_event_td(p_event_id);
  for it in select value from jsonb_array_elements(p_rows) loop
    v_name := btrim(regexp_replace(coalesce(it->>'name', ''), '\s+', ' ', 'g'));
    v_div  := upper(btrim(coalesce(it->>'div_code', '')));
    v_dgs  := nullif(btrim(coalesce(it->>'dgs_id', '')), '');
    v_pdga := nullif(btrim(coalesce(it->>'pdga', '')), '');
    if v_name = '' then skipped := skipped || jsonb_build_object('row', it, 'reason', 'no_name'); continue; end if;
    if v_div = 'SPON' then skipped := skipped || jsonb_build_object('row', it, 'reason', 'sponsor_only'); continue; end if;
    if not exists (select 1 from public.divisions where event_id = p_event_id and code = v_div) then
      skipped := skipped || jsonb_build_object('row', it, 'reason', 'unknown_division'); continue;
    end if;

    v_id := null;
    if v_dgs  is not null then select id into v_id from public.players where event_id = p_event_id and dgs_id = v_dgs; end if;
    if v_id is null and v_pdga is not null then select id into v_id from public.players where event_id = p_event_id and pdga = v_pdga; end if;
    if v_id is null then select id into v_id from public.players where event_id = p_event_id and lower(btrim(name)) = lower(v_name); end if;

    if v_id is null then
      insert into public.players (event_id, name, div_code, rating, pdga, dgs_id, reg_order, checked_in)
      values (p_event_id, v_name, v_div, nullif(it->>'rating','')::int, v_pdga, v_dgs, nullif(it->>'reg_order','')::int,
              coalesce((it->>'checked_in')::boolean, false));
      ins := ins + 1;
    else
      update public.players set name = v_name, div_code = v_div,
        rating     = coalesce(nullif(it->>'rating','')::int, rating),   -- never wipe a hand-entered rating
        pdga       = coalesce(v_pdga, pdga), dgs_id = coalesce(v_dgs, dgs_id),
        reg_order  = coalesce(nullif(it->>'reg_order','')::int, reg_order),
        checked_in = checked_in or coalesce((it->>'checked_in')::boolean, false)  -- import never un-checks anyone
      where id = v_id;
      upd := upd + 1;
    end if;
  end loop;
  return jsonb_build_object('inserted', ins, 'updated', upd, 'skipped', skipped);
end $$;

create or replace function public.td_import_sponsors(p_event_id uuid, p_names jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_name text; ins int := 0; ex int := 0; v_sort int;
begin
  perform public._require_event_td(p_event_id);
  select coalesce(max(sort), 0) into v_sort from public.sponsors where event_id = p_event_id;
  for v_name in select btrim(regexp_replace(value, '\s+', ' ', 'g')) from jsonb_array_elements_text(p_names) loop
    continue when v_name = '';
    if exists (select 1 from public.sponsors
               where event_id = p_event_id and lower(btrim(source_name)) = lower(v_name)) then
      ex := ex + 1;
    else
      v_sort := v_sort + 1;
      insert into public.sponsors (event_id, name, source_name, hidden, sort)
      values (p_event_id, v_name, v_name, true, v_sort);
      ins := ins + 1;
    end if;
  end loop;
  return jsonb_build_object('inserted', ins, 'existing', ex);
end $$;

-- Publish: unchanged rules (see jewel_core), plus the event's format is enforced:
-- round must be within events.rounds, and a single-wave event only takes AM cards.
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

-- ---------- 5. build-menu RPCs ---------------------------------------------
-- Events this caller can run (super admin: all).
create or replace function public.td_my_events() returns setof public.events
language sql stable security definer set search_path = public, pg_temp as $$
  select * from public.events where public.can_td(id) order by archived, starts_on desc, name
$$;

create or replace function public._event_slug(p_name text, p_starts date) returns text
language plpgsql stable set search_path = public, pg_temp as $$
declare base text; s text; i int := 1;
begin
  base := trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'));
  base := left(coalesce(nullif(base, ''), 'event'), 48) || '-' || to_char(p_starts, 'YYYY-MM-DD');
  s := base;
  while exists (select 1 from public.events where slug = s) loop
    i := i + 1; s := base || '-' || i;
  end loop;
  return s;
end $$;

-- New event (super admin) or duplicate of an event you run (league week 2).
-- Fresh: p_hole_count par-3 holes + p_divisions [{code, wave}]. Duplicate: copies format, course,
-- divisions, card rules and the TD list; never players, cards or scores.
create or replace function public.td_create_event(
  p_name text, p_club text, p_starts date, p_ends date,
  p_copy_from uuid default null, p_hole_count int default 18, p_divisions jsonb default '[]'
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
  else
    if p_hole_count is null or p_hole_count not between 1 and 40 then raise exception 'invalid_holes'; end if;
    insert into public.holes (event_id, n, par) select v_id, g, 3 from generate_series(1, p_hole_count) g;
    perform public._write_divisions(v_id, p_divisions);
  end if;
  return jsonb_build_object('id', v_id, 'slug', v_slug);
end $$;

-- Divisions = the list, in order. p_divs: [{code, wave}]. Removing a division that has players is refused.
-- A single-wave event stores every division as AM.
create or replace function public._write_divisions(p_event uuid, p_divs jsonb) returns void
language plpgsql set search_path = public, pg_temp as $$
declare v_waves smallint; v_codes text[]; v_bad text;
begin
  select waves into v_waves from public.events where id = p_event;
  select array_agg(upper(btrim(d->>'code')) order by o) into v_codes
    from jsonb_array_elements(coalesce(p_divs, '[]')) with ordinality as x(d, o);
  if v_codes is null or cardinality(v_codes) = 0 then raise exception 'no_divisions'; end if;
  if exists (select 1 from unnest(v_codes) c where c !~ '^[A-Z0-9]{1,8}$') then raise exception 'invalid_division'; end if;
  if cardinality(v_codes) <> (select count(distinct c) from unnest(v_codes) c) then raise exception 'duplicate_division'; end if;
  if exists (select 1 from jsonb_array_elements(p_divs) d where coalesce(d->>'wave', 'AM') not in ('AM', 'PM')) then
    raise exception 'invalid_wave';
  end if;

  select d.code into v_bad from public.divisions d
   where d.event_id = p_event and d.code <> all (v_codes)
     and exists (select 1 from public.players p where p.event_id = p_event and p.div_code = d.code)
   limit 1;
  if v_bad is not null then raise exception 'division_in_use %', v_bad; end if;

  delete from public.divisions where event_id = p_event and code <> all (v_codes);
  insert into public.divisions (event_id, code, sort, wave_default)
    select p_event, upper(btrim(d->>'code')), o::smallint,
           case when v_waves = 1 then 'AM' else coalesce(d->>'wave', 'AM') end
      from jsonb_array_elements(p_divs) with ordinality as x(d, o)
  on conflict (event_id, code) do update set sort = excluded.sort, wave_default = excluded.wave_default;
end $$;

create or replace function public.td_set_divisions(p_event_id uuid, p_divs jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._require_event_td(p_event_id);
  perform public._write_divisions(p_event_id, p_divs);
end $$;

-- Course = holes 1..N. p_holes: [{n, par, dist_ft, ob}]. Hole quotes/rules are kept (Jewel narrator lines).
-- Removing a hole that a card starts on, or that has scores, is refused.
create or replace function public.td_set_holes(p_event_id uuid, p_holes jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  perform public._require_event_td(p_event_id);
  v_n := jsonb_array_length(coalesce(p_holes, '[]'));
  if v_n not between 1 and 40
     or (select count(distinct (h->>'n')::int) from jsonb_array_elements(p_holes) h
          where (h->>'n')::int between 1 and v_n) <> v_n
     or exists (select 1 from jsonb_array_elements(p_holes) h
                 where (h->>'par')::int not between 2 and 6
                    or coalesce(nullif(h->>'dist_ft', '')::int, 1) not between 1 and 5000) then
    raise exception 'invalid_holes';
  end if;
  if exists (select 1 from public.cards where event_id = p_event_id and start_hole > v_n) then
    raise exception 'holes_have_cards';
  end if;
  if exists (select 1 from public.scores s join public.players p on p.id = s.player_id
              where p.event_id = p_event_id and s.hole > v_n) then
    raise exception 'holes_have_scores';
  end if;

  delete from public.holes where event_id = p_event_id and n > v_n;
  insert into public.holes (event_id, n, par, dist_ft, ob)
    select p_event_id, (h->>'n')::smallint, (h->>'par')::smallint, nullif(h->>'dist_ft', '')::int,
           nullif(btrim(coalesce(h->>'ob', '')), '')
      from jsonb_array_elements(p_holes) h
  on conflict (event_id, n) do update set par = excluded.par, dist_ft = excluded.dist_ft, ob = excluded.ob;
end $$;

-- Basics + format + features. The only way to change an event row (no direct UPDATE policy),
-- so these rules can't be skipped:
--   * rounds 2 -> 1 refused while round 2 has cards
--   * waves 2 -> 1 refused while PM cards exist; on success every division becomes AM
create or replace function public.td_update_event(p_event_id uuid, p jsonb) returns public.events
language plpgsql security definer set search_path = public, pg_temp as $$
declare ev public.events; v_rounds smallint; v_waves smallint;
begin
  perform public._require_event_td(p_event_id);
  select * into ev from public.events where id = p_event_id for update;
  v_rounds := coalesce((p->>'rounds')::smallint, ev.rounds);
  v_waves  := coalesce((p->>'waves')::smallint, ev.waves);
  if v_rounds < ev.rounds and exists (select 1 from public.cards where event_id = p_event_id and round > v_rounds) then
    raise exception 'round2_has_cards';
  end if;
  if v_waves < ev.waves and exists (select 1 from public.cards where event_id = p_event_id and wave = 'PM') then
    raise exception 'pm_cards_exist';
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
    archived     = coalesce((p->>'archived')::boolean, archived)
  where id = p_event_id
  returning * into ev;
  if ev.ends_on < ev.starts_on then raise exception 'invalid_dates'; end if;
  if v_waves = 1 then update public.divisions set wave_default = 'AM' where event_id = p_event_id; end if;
  return ev;
end $$;

-- Super admin only. Submissions go first: frozen-score guards would otherwise block the cascade.
create or replace function public.td_delete_event(p_event_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_td() then raise exception 'forbidden'; end if;
  if (select slug from public.events where id = p_event_id) = 'jewel-xi-2026' then raise exception 'protected_event'; end if;
  delete from public.submissions where card_id in (select id from public.cards where event_id = p_event_id);
  delete from public.events where id = p_event_id;
end $$;

-- Scorecard needs the event's name + look, not just its id.
create or replace function public.get_card(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c public.cards; e public.events;
begin
  c := public._card_for_token(p_token);
  select * into e from public.events where id = c.event_id;
  return jsonb_build_object(
    'card', jsonb_build_object('id', c.id, 'event_id', c.event_id, 'round', c.round,
                               'wave', c.wave, 'label', c.label, 'start_hole', c.start_hole),
    'event', jsonb_build_object('name', e.name, 'slug', e.slug, 'club_name', e.club_name, 'skin', e.skin,
                                'palette', e.palette, 'rounds', e.rounds, 'waves', e.waves),
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

-- ---------- 6. grants ------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on function public.is_td(), public.my_email(), public.can_td(uuid), public._uuid_or_null(text),
                          public._card_of(uuid, smallint), public._new_token() to anon, authenticated;
grant execute on function public.get_card(text), public.score_upsert(text, uuid, smallint, smallint, timestamptz, text),
                          public.score_sync(text, jsonb), public.sign_card(text, uuid, text), public.submit_card(text)
  to anon, authenticated;
revoke execute on function public._write_divisions(uuid, jsonb), public._event_slug(text, date),
                           public._require_event_td(uuid) from authenticated;
grant execute on function public.td_my_events(), public.td_create_event(text, text, date, date, uuid, int, jsonb),
                          public.td_set_divisions(uuid, jsonb), public.td_set_holes(uuid, jsonb),
                          public.td_update_event(uuid, jsonb), public.td_delete_event(uuid),
                          public.td_unlock_card(uuid), public.td_import_players(uuid, jsonb),
                          public.td_publish_round(uuid, smallint, jsonb, boolean), public.td_import_sponsors(uuid, jsonb)
  to authenticated;
