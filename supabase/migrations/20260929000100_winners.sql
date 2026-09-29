-- Winners Circle (locked 2026-09-29)
-- Source of truth:
--   event_prize       : per event: added cash total (raffle etc.), credit rounding ($1/$5), credit label ("Boner Bucks")
--   division_payouts  : per division: cash/credit, entry fee, payback %, fixed added $ (optional),
--                       paid places + % table (null = app default for the field size)
--   players.finish_status : 'dnf' | 'dq' | 'ns' (no-show); null = normal
--   playoffs (exists) : winner of a tie for 1st
--   winners_posts     : the frozen snapshot the public Winners page shows (TD taps POST RESULTS)
-- Rules:
--   * event_prize + division_payouts are TD-only (pools/fees are not public). winners_posts is public-read.
--   * All payout math is client-side and pure (src/lib/prizes/payout.ts); the server stores inputs + the posted result.
--   * Duplicating an event carries payout setup (fees, tables, rounding, label), never the added total, posts or statuses.
-- =====================================================================

alter table public.players add column finish_status text check (finish_status in ('dnf', 'dq', 'ns'));

create table public.event_prize (
  event_id     uuid primary key references public.events(id) on delete cascade,
  added_total  numeric(10,2) not null default 0 check (added_total >= 0),
  credit_round smallint not null default 1 check (credit_round in (1, 5)),
  credit_label text not null default 'prize credit' check (length(btrim(credit_label)) between 1 and 24),
  updated_at   timestamptz not null default now()
);

create table public.division_payouts (
  event_id       uuid not null,
  div_code       text not null,
  currency       text not null check (currency in ('cash', 'credit')),
  entry_fee      numeric(8,2) not null default 0 check (entry_fee >= 0),
  payback_pct    numeric(5,2) not null default 100 check (payback_pct between 0 and 100),
  added_override numeric(10,2) check (added_override is null or added_override >= 0),
  paid_places    smallint check (paid_places is null or paid_places between 0 and 200),
  pcts           numeric(5,2)[] check (pcts is null or cardinality(pcts) <= 200),
  updated_at     timestamptz not null default now(),
  primary key (event_id, div_code),
  foreign key (event_id, div_code) references public.divisions(event_id, code) on delete cascade
);

create table public.winners_posts (
  event_id  uuid primary key references public.events(id) on delete cascade,
  payload   jsonb not null,
  posted_at timestamptz not null default now()
);

-- Jewel XI prizes are Boner Bucks.
insert into public.event_prize (event_id, credit_label)
select id, 'Boner Bucks' from public.events where slug = 'jewel-xi-2026'
on conflict (event_id) do update set credit_label = excluded.credit_label;

alter table public.event_prize      enable row level security;
alter table public.division_payouts enable row level security;
alter table public.winners_posts    enable row level security;
revoke all on public.event_prize, public.division_payouts, public.winners_posts from anon, authenticated;
grant select, insert, update, delete on public.event_prize, public.division_payouts, public.winners_posts to authenticated;
grant select on public.winners_posts to anon;

create policy "td only" on public.event_prize for all to authenticated
  using (public.can_td(event_id)) with check (public.can_td(event_id));
create policy "td only" on public.division_payouts for all to authenticated
  using (public.can_td(event_id)) with check (public.can_td(event_id));
create policy "public read" on public.winners_posts for select to anon, authenticated using (true);
create policy "td write" on public.winners_posts for insert to authenticated with check (public.can_td(event_id));
create policy "td update" on public.winners_posts for update to authenticated using (public.can_td(event_id)) with check (public.can_td(event_id));
create policy "td delete" on public.winners_posts for delete to authenticated using (public.can_td(event_id));

-- ---------- duplicate: also carry payout setup ----------
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
