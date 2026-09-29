-- Event prep: task list, shirt orders, design board (locked 2026-09-29)
-- Source of truth:
--   prep_tasks        : checklist; due = events.starts_on + due_offset_days (negative = before). Done = done_at not null.
--   players.shirt_size: from the DGS "T-shirt size" column (import never wipes it) or typed by a TD.
--   shirt_order       : per event: extras per size, vendor, notes, ordered_at.
--   design_assets     : one design (category, title, status draft|approved|sent, notes)
--   design_files      : every uploaded version of a design (storage path in the private event-assets bucket)
-- Rules:
--   * Everything here is TD-only (can_td). Files live under event-assets/<event_id>/..., TD-only by folder.
--   * shirt_size is public like the rest of players (it's on the roster, not sensitive).
--   * Duplicating an event copies prep_tasks with nothing done (offsets keep dates relative), never files, orders or sizes.
-- =====================================================================

alter table public.players add column shirt_size text check (shirt_size is null or length(shirt_size) between 1 and 12);

create table public.prep_tasks (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  title           text not null check (length(btrim(title)) between 1 and 140),
  category        text not null default 'general',
  due_offset_days integer check (due_offset_days is null or due_offset_days between -730 and 365),
  assignee        text check (assignee is null or assignee = lower(btrim(assignee))),
  notes           text check (notes is null or length(notes) <= 1000),
  done_at         timestamptz,
  done_by         text,
  sort            integer not null default 0,
  created_at      timestamptz not null default now()
);
create index prep_tasks_event on public.prep_tasks(event_id, sort);

create table public.shirt_order (
  event_id   uuid primary key references public.events(id) on delete cascade,
  extras     jsonb not null default '{}' check (jsonb_typeof(extras) = 'object'),
  vendor     text check (vendor is null or length(vendor) <= 120),
  notes      text check (notes is null or length(notes) <= 1000),
  ordered_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.design_assets (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  category   text not null check (category in ('shirts', 'tee_signs', 'flyer', 'logos', 'prize_bucks', 'signage', 'merch', 'other')),
  title      text not null check (length(btrim(title)) between 1 and 120),
  status     text not null default 'draft' check (status in ('draft', 'approved', 'sent')),
  notes      text check (notes is null or length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index design_assets_event on public.design_assets(event_id, category);

create table public.design_files (
  id          uuid primary key default gen_random_uuid(),
  asset_id    uuid not null references public.design_assets(id) on delete cascade,
  version     integer not null check (version >= 1),
  path        text not null unique,
  file_name   text not null,
  mime        text,
  bytes       bigint,
  uploaded_by text,
  uploaded_at timestamptz not null default now(),
  unique (asset_id, version)
);

-- ---------- RLS: TD-only ----------
alter table public.prep_tasks    enable row level security;
alter table public.shirt_order   enable row level security;
alter table public.design_assets enable row level security;
alter table public.design_files  enable row level security;
revoke all on public.prep_tasks, public.shirt_order, public.design_assets, public.design_files from anon, authenticated;
grant select, insert, update, delete on public.prep_tasks, public.shirt_order, public.design_assets, public.design_files to authenticated;
create policy "td only" on public.prep_tasks for all to authenticated using (public.can_td(event_id)) with check (public.can_td(event_id));
create policy "td only" on public.shirt_order for all to authenticated using (public.can_td(event_id)) with check (public.can_td(event_id));
create policy "td only" on public.design_assets for all to authenticated using (public.can_td(event_id)) with check (public.can_td(event_id));
create policy "td only" on public.design_files for all to authenticated
  using (public.can_td((select a.event_id from public.design_assets a where a.id = asset_id)))
  with check (public.can_td((select a.event_id from public.design_assets a where a.id = asset_id)));

-- ---------- private file bucket: event-assets/<event_id>/... ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('event-assets', 'event-assets', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create policy "td reads event assets" on storage.objects for select to authenticated
  using (bucket_id = 'event-assets' and public.can_td(public._uuid_or_null((storage.foldername(name))[1])));
create policy "td writes event assets" on storage.objects for insert to authenticated
  with check (bucket_id = 'event-assets' and public.can_td(public._uuid_or_null((storage.foldername(name))[1])));
create policy "td updates event assets" on storage.objects for update to authenticated
  using (bucket_id = 'event-assets' and public.can_td(public._uuid_or_null((storage.foldername(name))[1])))
  with check (bucket_id = 'event-assets' and public.can_td(public._uuid_or_null((storage.foldername(name))[1])));
create policy "td deletes event assets" on storage.objects for delete to authenticated
  using (bucket_id = 'event-assets' and public.can_td(public._uuid_or_null((storage.foldername(name))[1])));

-- ---------- import: also takes the shirt size (never wipes one) ----------
create or replace function public.td_import_players(p_event_id uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  it jsonb; v_id uuid; ins int := 0; upd int := 0; skipped jsonb := '[]';
  v_name text; v_div text; v_dgs text; v_pdga text; v_shirt text;
begin
  perform public._require_event_td(p_event_id);
  for it in select value from jsonb_array_elements(p_rows) loop
    v_name  := btrim(regexp_replace(coalesce(it->>'name', ''), '\s+', ' ', 'g'));
    v_div   := upper(btrim(coalesce(it->>'div_code', '')));
    v_dgs   := nullif(btrim(coalesce(it->>'dgs_id', '')), '');
    v_pdga  := nullif(btrim(coalesce(it->>'pdga', '')), '');
    v_shirt := left(nullif(upper(btrim(coalesce(it->>'shirt_size', ''))), ''), 12);
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
      insert into public.players (event_id, name, div_code, rating, pdga, dgs_id, reg_order, checked_in, shirt_size)
      values (p_event_id, v_name, v_div, nullif(it->>'rating','')::int, v_pdga, v_dgs, nullif(it->>'reg_order','')::int,
              coalesce((it->>'checked_in')::boolean, false), v_shirt);
      ins := ins + 1;
    else
      update public.players set name = v_name, div_code = v_div,
        rating     = coalesce(nullif(it->>'rating','')::int, rating),
        pdga       = coalesce(v_pdga, pdga), dgs_id = coalesce(v_dgs, dgs_id),
        reg_order  = coalesce(nullif(it->>'reg_order','')::int, reg_order),
        checked_in = checked_in or coalesce((it->>'checked_in')::boolean, false),
        shirt_size = coalesce(v_shirt, shirt_size)
      where id = v_id;
      upd := upd + 1;
    end if;
  end loop;
  return jsonb_build_object('inserted', ins, 'updated', upd, 'skipped', skipped);
end $$;

-- ---------- duplicate: also carry the checklist (nothing done) ----------
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
    insert into public.event_prize (event_id, credit_round, credit_label)
      select v_id, credit_round, credit_label from public.event_prize where event_id = p_copy_from;
    insert into public.division_payouts (event_id, div_code, currency, entry_fee, payback_pct, added_override, paid_places, pcts)
      select v_id, div_code, currency, entry_fee, payback_pct, added_override, paid_places, pcts
        from public.division_payouts where event_id = p_copy_from;
    insert into public.prep_tasks (event_id, title, category, due_offset_days, assignee, notes, sort)
      select v_id, title, category, due_offset_days, assignee, notes, sort from public.prep_tasks where event_id = p_copy_from;
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

revoke execute on function public.td_create_event(text, text, date, date, uuid, int, jsonb, boolean) from public, anon;
grant execute on function public.td_create_event(text, text, date, date, uuid, int, jsonb, boolean) to authenticated;
