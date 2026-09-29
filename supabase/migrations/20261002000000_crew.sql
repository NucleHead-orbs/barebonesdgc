-- Crew view (locked 2026-09-29)
-- Source of truth:
--   crew               : one row per volunteer: name, roles, private link token, last seen, revoked.
--   announcements      : TD directives; roles = who it's for ({} = everyone); pinned.
--   announcement_reads : "Got it" receipts.
--   prep_tasks.crew_id : task assigned to a crew member. prep_task_notes: update notes (TD or crew).
--   raffle_sales       : sales logged at the table (voided, never deleted).
--   contacts           : vendors + sponsor prospects: status lead|to_ask|asked|yes|no|paid, owner.
--   card_requests.source 'crew': submitted by crew, lands 'new' for the TD.
-- Rules:
--   * Crew never sign in. Every crew action is a SECURITY DEFINER function taking the link token
--     (crew_*). A token only reaches its own event, and is dead once revoked or the event is archived.
--   * Roles gate actions: checkin (check in, walk-ups), raffle (log/void own sales),
--     requests (card requests), contacts (add leads, update contacts they own). Everyone: read
--     announcements for them, ack, tick tasks assigned to them, note any task.
--   * TD tables are TD-only (can_td). Crew tokens are never readable except by the event's TD.
--   * The raffle total never changes payouts by itself; the TD confirms it into event_prize.added_total.
--   * Duplicating an event carries the crew roster (new links) but no announcements, sales or notes.
-- =====================================================================

create or replace function public._new_crew_token() returns text
language sql volatile set search_path = public, pg_temp as $$
  select replace(gen_random_uuid()::text, '-', '')   -- 122 random bits, URL-safe
$$;

create table public.crew (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 60),
  roles        text[] not null default '{}' check (roles <@ array['checkin','raffle','requests','contacts']::text[]),
  token        text not null unique default public._new_crew_token(),
  last_seen_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index crew_event on public.crew(event_id);

create table public.announcements (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  title      text not null check (length(btrim(title)) between 1 and 120),
  body       text not null default '' check (length(body) <= 4000),
  roles      text[] not null default '{}' check (roles <@ array['checkin','raffle','requests','contacts']::text[]),
  pinned     boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index announcements_event on public.announcements(event_id, created_at desc);

create table public.announcement_reads (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  crew_id         uuid not null references public.crew(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (announcement_id, crew_id)
);

alter table public.prep_tasks add column crew_id uuid references public.crew(id) on delete set null;

create table public.prep_task_notes (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.prep_tasks(id) on delete cascade,
  event_id   uuid not null references public.events(id) on delete cascade,
  author     text not null check (length(btrim(author)) between 1 and 120),
  crew_id    uuid references public.crew(id) on delete set null,
  body       text not null check (length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index prep_task_notes_task on public.prep_task_notes(task_id, created_at);

create table public.raffle_sales (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  crew_id    uuid references public.crew(id) on delete set null,
  logged_by  text not null,
  buyer      text check (buyer is null or length(buyer) <= 80),
  tickets    integer not null check (tickets between 1 and 1000),
  amount     numeric(8,2) not null check (amount >= 0 and amount <= 10000),
  method     text not null default 'cash' check (method in ('cash', 'card', 'other')),
  created_at timestamptz not null default now(),
  voided_at  timestamptz
);
create index raffle_sales_event on public.raffle_sales(event_id, created_at desc);

create table public.contacts (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  kind       text not null check (kind in ('vendor', 'sponsor', 'other')),
  name       text not null check (length(btrim(name)) between 1 and 80),
  org        text check (org is null or length(org) <= 80),
  phone      text check (phone is null or length(phone) <= 40),
  email      text check (email is null or length(email) <= 120),
  status     text not null default 'to_ask' check (status in ('lead', 'to_ask', 'asked', 'yes', 'no', 'paid')),
  amount     numeric(10,2) check (amount is null or amount >= 0),
  crew_id    uuid references public.crew(id) on delete set null,    -- owner (crew)
  notes      text check (notes is null or length(notes) <= 2000),
  created_by text,
  sponsor_id uuid references public.sponsors(id) on delete set null, -- set when promoted
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contacts_event on public.contacts(event_id, status);

alter table public.card_requests drop constraint card_requests_source_check;
alter table public.card_requests add constraint card_requests_source_check check (source in ('player', 'td', 'crew'));
alter table public.card_requests add column crew_id uuid references public.crew(id) on delete set null;

-- ---------- RLS: TD-only ----------
alter table public.crew               enable row level security;
alter table public.announcements      enable row level security;
alter table public.announcement_reads enable row level security;
alter table public.prep_task_notes    enable row level security;
alter table public.raffle_sales       enable row level security;
alter table public.contacts           enable row level security;
revoke all on public.crew, public.announcements, public.announcement_reads, public.prep_task_notes,
              public.raffle_sales, public.contacts from anon, authenticated;
grant select, insert, update, delete on public.crew, public.announcements, public.prep_task_notes,
              public.raffle_sales, public.contacts to authenticated;
grant select on public.announcement_reads to authenticated;
create policy "td only" on public.crew            for all to authenticated using (public.can_td(event_id)) with check (public.can_td(event_id));
create policy "td only" on public.announcements   for all to authenticated using (public.can_td(event_id)) with check (public.can_td(event_id));
create policy "td only" on public.prep_task_notes for all to authenticated using (public.can_td(event_id)) with check (public.can_td(event_id));
create policy "td only" on public.raffle_sales    for all to authenticated using (public.can_td(event_id)) with check (public.can_td(event_id));
create policy "td only" on public.contacts        for all to authenticated using (public.can_td(event_id)) with check (public.can_td(event_id));
create policy "td read" on public.announcement_reads for select to authenticated
  using (public.can_td((select a.event_id from public.announcements a where a.id = announcement_id)));

-- A task's crew assignee must belong to the task's event.
create or replace function public._crew_same_event() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.crew_id is not null and not exists (select 1 from public.crew c where c.id = new.crew_id and c.event_id = new.event_id) then
    raise exception 'wrong_event';
  end if;
  return new;
end $$;
create trigger prep_tasks_crew_event before insert or update of crew_id on public.prep_tasks
  for each row execute function public._crew_same_event();
create trigger contacts_crew_event before insert or update of crew_id on public.contacts
  for each row execute function public._crew_same_event();

-- ---------- token -> crew ----------
create or replace function public._crew(p_token text) returns public.crew
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c public.crew;
begin
  select * into c from public.crew where token = p_token and revoked_at is null;
  if not found or p_token is null or length(p_token) < 20 then raise exception 'invalid_link'; end if;
  if (select archived from public.events where id = c.event_id) then raise exception 'event_closed'; end if;
  return c;
end $$;

create or replace function public._crew_role(c public.crew, p_role text) returns void
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if not (p_role = any (c.roles)) then raise exception 'not_your_role'; end if;
end $$;

-- ---------- crew: everything the link page shows ----------
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
  return out;
end $$;

create or replace function public.crew_ack(p_token text, p_announcement uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.crew;
begin
  c := public._crew(p_token);
  if not exists (select 1 from public.announcements a where a.id = p_announcement and a.event_id = c.event_id
                  and (a.roles = '{}' or a.roles && c.roles)) then raise exception 'not_found'; end if;
  insert into public.announcement_reads (announcement_id, crew_id) values (p_announcement, c.id) on conflict do nothing;
end $$;

create or replace function public.crew_task_done(p_token text, p_task uuid, p_done boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.crew;
begin
  c := public._crew(p_token);
  update public.prep_tasks set done_at = case when p_done then coalesce(done_at, now()) end,
                               done_by = case when p_done then coalesce(done_by, c.name) end
   where id = p_task and event_id = c.event_id and crew_id = c.id;
  if not found then raise exception 'not_your_task'; end if;
end $$;

create or replace function public.crew_task_note(p_token text, p_task uuid, p_body text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.crew;
begin
  c := public._crew(p_token);
  if btrim(coalesce(p_body, '')) = '' or length(p_body) > 1000 then raise exception 'invalid_note'; end if;
  if not exists (select 1 from public.prep_tasks where id = p_task and event_id = c.event_id) then raise exception 'not_found'; end if;
  insert into public.prep_task_notes (task_id, event_id, author, crew_id, body) values (p_task, c.event_id, c.name, c.id, btrim(p_body));
end $$;

create or replace function public.crew_checkin(p_token text, p_player uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.crew;
begin
  c := public._crew(p_token); perform public._crew_role(c, 'checkin');
  update public.players set checked_in = p_on where id = p_player and event_id = c.event_id;
  if not found then raise exception 'unknown_player'; end if;
end $$;

/** Walk-up: same matching as td_import_players (a repeat name updates, never duplicates). */
create or replace function public.crew_walkup(p_token text, p_name text, p_div text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.crew; v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')); v_div text := upper(btrim(coalesce(p_div, ''))); v_id uuid;
begin
  c := public._crew(p_token); perform public._crew_role(c, 'checkin');
  if v_name = '' or length(v_name) > 80 then raise exception 'invalid_name'; end if;
  if not exists (select 1 from public.divisions where event_id = c.event_id and code = v_div) then raise exception 'invalid_division'; end if;
  select id into v_id from public.players where event_id = c.event_id and lower(btrim(name)) = lower(v_name);
  if v_id is null then
    insert into public.players (event_id, name, div_code, reg_order, checked_in)
    values (c.event_id, v_name, v_div, coalesce((select max(reg_order) from public.players where event_id = c.event_id), 0) + 1, true)
    returning id into v_id;
  else
    update public.players set checked_in = true, div_code = v_div where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.crew_raffle_sale(p_token text, p_buyer text, p_tickets int, p_amount numeric, p_method text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.crew; v_id uuid;
begin
  c := public._crew(p_token); perform public._crew_role(c, 'raffle');
  insert into public.raffle_sales (event_id, crew_id, logged_by, buyer, tickets, amount, method)
  values (c.event_id, c.id, c.name, nullif(btrim(coalesce(p_buyer, '')), ''), p_tickets, round(p_amount, 2), coalesce(p_method, 'cash'))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.crew_raffle_void(p_token text, p_sale uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.crew;
begin
  c := public._crew(p_token); perform public._crew_role(c, 'raffle');
  update public.raffle_sales set voided_at = now() where id = p_sale and crew_id = c.id and voided_at is null;
  if not found then raise exception 'not_your_sale'; end if;
end $$;

create or replace function public.crew_card_request(p_token text, p_players uuid[], p_note text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.crew; v_players uuid[]; v_id uuid; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  c := public._crew(p_token); perform public._crew_role(c, 'requests');
  select array_agg(distinct x) into v_players from unnest(coalesce(p_players, '{}')) x where x is not null;
  if v_players is null or cardinality(v_players) not between 2 and 5 or (v_note is not null and length(v_note) > 140) then
    raise exception 'invalid_request';
  end if;
  if (select count(*) from public.players where event_id = c.event_id and id = any (v_players)) <> cardinality(v_players) then
    raise exception 'unknown_player';
  end if;
  insert into public.card_requests (event_id, status, source, note, crew_id) values (c.event_id, 'new', 'crew', v_note, c.id) returning id into v_id;
  insert into public.card_request_players (request_id, player_id, is_requester)
    select v_id, x, x = p_players[1] from unnest(v_players) x;
  return v_id;
end $$;

/** A crew-added contact lands as a 'lead' owned by them; the TD moves it on (or to 'no'). */
create or replace function public.crew_add_contact(p_token text, p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.crew; v_id uuid;
begin
  c := public._crew(p_token); perform public._crew_role(c, 'contacts');
  insert into public.contacts (event_id, kind, name, org, phone, email, notes, amount, status, crew_id, created_by)
  values (c.event_id, coalesce(p->>'kind', 'sponsor'), btrim(coalesce(p->>'name', '')), nullif(btrim(coalesce(p->>'org', '')), ''),
          nullif(btrim(coalesce(p->>'phone', '')), ''), nullif(btrim(coalesce(p->>'email', '')), ''), nullif(btrim(coalesce(p->>'notes', '')), ''),
          nullif(p->>'amount', '')::numeric, 'lead', c.id, c.name)
  returning id into v_id;
  return v_id;
end $$;

/** Owners move their contact along (never back to 'lead', never approve their own lead). */
create or replace function public.crew_update_contact(p_token text, p_contact uuid, p_status text, p_notes text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.crew; k public.contacts;
begin
  c := public._crew(p_token); perform public._crew_role(c, 'contacts');
  select * into k from public.contacts where id = p_contact and event_id = c.event_id and crew_id = c.id;
  if not found then raise exception 'not_your_contact'; end if;
  if p_status is not null and (p_status = 'lead' or k.status = 'lead') and p_status <> k.status then raise exception 'lead_needs_td'; end if;
  update public.contacts set status = coalesce(p_status, status), notes = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), notes), updated_at = now()
   where id = k.id;
end $$;

-- ---------- duplicate carries the crew roster (new links; td_create_event redefined from courses) ----------
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
  insert into public.events (slug, name, starts_on, ends_on, club_name, skin, palette, rounds, waves, use_checkin, use_sponsors, course_layout_id)
  values (v_slug, btrim(p_name), p_starts, p_ends, nullif(btrim(coalesce(p_club, src.club_name, '')), ''),
          coalesce(src.skin, 'event'), coalesce(src.palette, 'cosmic'), coalesce(src.rounds, 1), coalesce(src.waves, 1),
          coalesce(src.use_checkin, true), coalesce(src.use_sponsors, false), src.course_layout_id)
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

revoke execute on function public.td_create_event(text, text, date, date, uuid, int, jsonb, boolean) from public, anon;
grant execute on function public.td_create_event(text, text, date, date, uuid, int, jsonb, boolean) to authenticated;

-- ---------- TD helpers ----------
create or replace function public.td_new_crew_link(p_crew uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v text;
begin
  update public.crew set token = public._new_crew_token(), revoked_at = null
   where id = p_crew and public.can_td(event_id) returning token into v;
  if v is null then raise exception 'forbidden'; end if;
  return v;
end $$;

/** A yes/paid sponsor contact -> a hidden Sponsors row (TD approves it there, like DGS imports). */
create or replace function public.td_promote_contact(p_contact uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare k public.contacts; v_id uuid;
begin
  select * into k from public.contacts where id = p_contact;
  if not found or not public.can_td(k.event_id) then raise exception 'forbidden'; end if;
  if k.kind <> 'sponsor' or k.status not in ('yes', 'paid') then raise exception 'not_a_yes'; end if;
  if k.sponsor_id is not null then return k.sponsor_id; end if;
  insert into public.sponsors (event_id, name, hidden, sort)
  values (k.event_id, coalesce(k.org, k.name), true, coalesce((select max(sort) from public.sponsors where event_id = k.event_id), 0) + 1)
  returning id into v_id;
  update public.contacts set sponsor_id = v_id, updated_at = now() where id = k.id;
  return v_id;
end $$;

revoke execute on function public._crew(text), public._crew_role(public.crew, text), public._new_crew_token() from public, anon, authenticated;
revoke execute on function public.crew_home(text), public.crew_ack(text, uuid), public.crew_task_done(text, uuid, boolean),
  public.crew_task_note(text, uuid, text), public.crew_checkin(text, uuid, boolean), public.crew_walkup(text, text, text),
  public.crew_raffle_sale(text, text, int, numeric, text), public.crew_raffle_void(text, uuid),
  public.crew_card_request(text, uuid[], text), public.crew_add_contact(text, jsonb), public.crew_update_contact(text, uuid, text, text),
  public.td_new_crew_link(uuid), public.td_promote_contact(uuid) from public;
grant execute on function public.crew_home(text), public.crew_ack(text, uuid), public.crew_task_done(text, uuid, boolean),
  public.crew_task_note(text, uuid, text), public.crew_checkin(text, uuid, boolean), public.crew_walkup(text, text, text),
  public.crew_raffle_sale(text, text, int, numeric, text), public.crew_raffle_void(text, uuid),
  public.crew_card_request(text, uuid[], text), public.crew_add_contact(text, jsonb), public.crew_update_contact(text, uuid, text, text)
  to anon, authenticated;
grant execute on function public.td_new_crew_link(uuid), public.td_promote_contact(uuid) to authenticated;
-- default table grant for new tables' token default
grant execute on function public._new_crew_token() to authenticated;
