-- Extra tee pads (locked 2026-10-03, Mike): some holes have more than one tee pad (Rec / Ladies pad, AM pad).
-- Each extra pad gets its own physical tee sign that can be sponsored like a full hole.
-- Source of truth:
--   hole_tees      : an event's extra pads: hole n, label, feet, par (null = the hole's par). The main tee is the
--                    holes row itself, so the scorecard is untouched (everyone still scores by hole).
--   sponsors.tee_id: which sign a sponsor is on: null = the hole's main tee sign, else that pad's sign.
-- Rules:
--   * A pad belongs to an existing hole (FK to holes; dropping the hole drops its pads).
--   * A sponsor's tee must be a pad of the same event and hole; changing the sponsor's hole puts them back on
--     the main tee (tee_id cleared), so a sponsor can never point at another hole's pad.
--   * Public reads pads (signs, course); the event's TDs write them.
--   * Duplicating an event copies its pads (td_create_event). Seeds Jewel XI from YT & Beard's course guide.
--   * Safe to re-run.
-- =====================================================================

create table if not exists public.hole_tees (
  id       uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  n        smallint not null,
  label    text not null check (length(btrim(label)) between 1 and 30),
  dist_ft  integer check (dist_ft is null or dist_ft between 1 and 2000),
  par      smallint check (par is null or par between 2 and 6),
  sort     smallint not null default 1,
  constraint hole_tees_hole_fk foreign key (event_id, n) references public.holes (event_id, n) on delete cascade,
  constraint hole_tees_label_uq unique (event_id, n, label)
);
create index if not exists hole_tees_event on public.hole_tees (event_id, n, sort);

alter table public.hole_tees enable row level security;
revoke all on public.hole_tees from anon, authenticated;
grant select on public.hole_tees to anon, authenticated;
grant insert, update, delete on public.hole_tees to authenticated;
drop policy if exists "public read" on public.hole_tees;
create policy "public read" on public.hole_tees for select to anon, authenticated using (true);
drop policy if exists "td insert" on public.hole_tees;
create policy "td insert" on public.hole_tees for insert to authenticated with check (public.can_td(event_id));
drop policy if exists "td update" on public.hole_tees;
create policy "td update" on public.hole_tees for update to authenticated using (public.can_td(event_id)) with check (public.can_td(event_id));
drop policy if exists "td delete" on public.hole_tees;
create policy "td delete" on public.hole_tees for delete to authenticated using (public.can_td(event_id));

alter table public.sponsors add column if not exists tee_id uuid references public.hole_tees (id) on delete set null;

create or replace function public._sponsor_tee_fit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.tee_id is not null and not exists (
    select 1 from public.hole_tees t where t.id = new.tee_id and t.event_id = new.event_id and t.n = new.hole
  ) then
    if tg_op = 'UPDATE' and new.hole is distinct from old.hole and new.tee_id = old.tee_id then
      new.tee_id := null;  -- moved to another hole: back on that hole's main tee
    else
      raise exception 'tee_mismatch';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists sponsors_tee_fit on public.sponsors;
create trigger sponsors_tee_fit before insert or update of tee_id, hole, event_id on public.sponsors
  for each row execute function public._sponsor_tee_fit();

insert into public.hole_tees (event_id, n, label, sort)
select e.id, v.n, v.label, v.sort
from public.events e
cross join (values (9, 'Rec / Ladies pad', 1), (10, 'Rec / Ladies pad', 1), (13, 'Rec / Ladies pad', 1), (13, 'AM pad', 2),
                   (18, 'Rec / Ladies pad', 1), (20, 'Rec / Ladies pad', 1), (20, 'AM pad', 2)) v(n, label, sort)
where e.slug = 'jewel-xi-2026' and exists (select 1 from public.holes h where h.event_id = e.id and h.n = v.n)
on conflict (event_id, n, label) do nothing;

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
    insert into public.hole_tees (event_id, n, label, dist_ft, par, sort)
      select v_id, n, label, dist_ft, par, sort from public.hole_tees where event_id = p_copy_from;
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

