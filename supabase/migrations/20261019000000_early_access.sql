-- Early access tag league + raffle (locked 2026-10-03, Mike): an event's registered players get an early tag set
-- to field-test the scorecard and tags before the event. Announced: a raffle earned from verified rounds. Secret:
-- awards revealed on the day (most verified rounds, most different partners, biggest tag climb, best bug find).
-- Source of truth:
--   early_access : one row per event that runs it: its own tag set (tag_pools, invite only), the window
--                  (opens_on..closes_on, closes before the event starts), min Jewel players per round, weekly cap.
--   ea_claims    : "That's me" requests. A registrant (players row) claims from the public page (a device secret
--                  waits for the answer) or from My Tag (member known). A TD approves or declines. An APPROVED claim
--                  is the link registrant <-> club member (tag_members); one per player and one per member per event.
--   ea_bonus     : tickets a TD grants by hand (bug bounty), with a reason. Voided, never deleted.
--   ea_draws     : raffle winners, in draw order. Voided, never deleted.
--   Tickets are never stored: they are computed from saved club rounds every time (_ea_standings).
-- Rules:
--   * A round counts (is "verified") when it is saved, played inside the window, has at least min_players linked
--     players on it, and every linked player on it has confirmed (none disputed). Guests and other members don't count
--     and aren't needed. Voiding a round removes its tickets.
--   * Tickets = verified rounds per week (Mon-Sun), capped at weekly_cap each week
--             + 1 per different linked player you've shared a verified round with
--             + TD bonus tickets.
--   * Approving links the claim (creating the club member if the name is new, or reusing the member with that name)
--     and issues the next tag at the bottom of the set (join order). Other waiting claims for that player are declined.
--   * A page claim returns the member's My Tag link only to the device holding that claim's secret, once approved.
--   * Public sees the roster (who joined) and each joined player's ticket total. Breakdown: only to that player
--     (My Tag) and the event's TDs. The secret awards and the draw: TDs only (winners are public once drawn).
--   * The draw opens after the window closes; it picks by ticket weight among players not already drawn.
--   * Every write is a function; the tables have no client grants. Safe to re-run.
-- =====================================================================

create table if not exists public.early_access (
  event_id    uuid primary key references public.events(id) on delete cascade,
  pool_id     uuid not null unique references public.tag_pools(id) on delete restrict,
  opens_on    date not null,
  closes_on   date not null,
  min_players smallint not null default 3 check (min_players between 2 and 8),
  weekly_cap  smallint not null default 2 check (weekly_cap between 1 and 7),
  created_at  timestamptz not null default now(),
  check (closes_on >= opens_on)
);

create table if not exists public.ea_claims (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.early_access(event_id) on delete cascade,
  player_id  uuid not null references public.players(id) on delete cascade,
  member_id  uuid references public.tag_members(id) on delete cascade,
  nickname   text check (nickname is null or length(btrim(nickname)) between 1 and 40),
  via        text not null check (via in ('page', 'mytag')),
  secret     text unique,
  status     text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'removed')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  check (status <> 'approved' or member_id is not null),
  check ((via = 'page') = (secret is not null))
);
create unique index if not exists ea_claims_player_once on public.ea_claims (event_id, player_id) where status = 'approved';
create unique index if not exists ea_claims_member_once on public.ea_claims (event_id, member_id) where status = 'approved';
create index if not exists ea_claims_event on public.ea_claims (event_id, status, created_at);

create table if not exists public.ea_bonus (
  id         bigint generated always as identity primary key,
  event_id   uuid not null references public.early_access(event_id) on delete cascade,
  member_id  uuid not null references public.tag_members(id) on delete cascade,
  tickets    smallint not null check (tickets between 1 and 5),
  reason     text not null check (length(btrim(reason)) between 1 and 120),
  by_email   text,
  at         timestamptz not null default now(),
  void       boolean not null default false
);

create table if not exists public.ea_draws (
  id         bigint generated always as identity primary key,
  event_id   uuid not null references public.early_access(event_id) on delete cascade,
  member_id  uuid not null references public.tag_members(id) on delete cascade,
  tickets    integer not null,
  by_email   text,
  at         timestamptz not null default now(),
  void       boolean not null default false
);

alter table public.early_access enable row level security;
alter table public.ea_claims enable row level security;
alter table public.ea_bonus enable row level security;
alter table public.ea_draws enable row level security;
revoke all on public.early_access, public.ea_claims, public.ea_bonus, public.ea_draws from anon, authenticated;

-- ---------- the math (one place) ----------
/** Verified rounds in the window: one row per linked player on each counting round. */
create or replace function public._ea_rounds(p_event uuid)
returns table (round_id uuid, played_on date, member_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  with ea as (select * from public.early_access where event_id = p_event),
  linked as (select c.member_id from public.ea_claims c where c.event_id = p_event and c.status = 'approved'),
  rp as (select r.id, r.played_on, p.member_id, p.confirmed_at, p.disputed_at
           from ea, public.club_rounds r join public.club_round_players p on p.round_id = r.id
          where r.status = 'saved' and r.played_on between ea.opens_on and ea.closes_on
            and p.member_id in (select l.member_id from linked l)),
  ok as (select rp.id from rp group by rp.id
          having count(*) >= (select ea.min_players from ea)
             and bool_and(rp.confirmed_at is not null and rp.disputed_at is null))
  select rp.id, rp.played_on, rp.member_id from rp where rp.id in (select ok.id from ok)
$$;

/** Every linked player with tickets and the stats behind them, best first. */
create or replace function public._ea_standings(p_event uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with ea as (select * from public.early_access where event_id = p_event),
  linked as (select c.member_id, c.player_id from public.ea_claims c where c.event_id = p_event and c.status = 'approved'),
  q as (select * from public._ea_rounds(p_event)),
  wk as (select q.member_id, date_trunc('week', q.played_on) w, count(*) n from q group by 1, 2),
  rt as (select wk.member_id, sum(least(wk.n, (select ea.weekly_cap from ea)))::int t, sum(wk.n)::int rounds from wk group by 1),
  pr as (select a.member_id, count(distinct b.member_id)::int n
           from q a join q b on b.round_id = a.round_id and b.member_id <> a.member_id group by 1),
  bo as (select b.member_id, sum(b.tickets)::int n from public.ea_bonus b where b.event_id = p_event and not b.void group by 1),
  st as (select l.member_id, l.player_id, coalesce(rt.rounds, 0) rounds, coalesce(rt.t, 0) round_tickets,
                coalesce(pr.n, 0) partners, coalesce(bo.n, 0) bonus
           from linked l left join rt using (member_id) left join pr using (member_id) left join bo using (member_id))
  select coalesce(jsonb_agg(jsonb_build_object(
           'member_id', st.member_id, 'player_id', st.player_id, 'name', m.name, 'nickname', m.nickname, 'tag', t.number,
           'start_tag', (select h.number from public.tag_history h where h.pool_id = (select ea.pool_id from ea)
                          and h.member_id = st.member_id and h.kind = 'issued' order by h.id limit 1),
           'rounds', st.rounds, 'round_tickets', st.round_tickets, 'partners', st.partners, 'bonus', st.bonus,
           'tickets', st.round_tickets + st.partners + st.bonus)
         order by st.round_tickets + st.partners + st.bonus desc, lower(m.name)), '[]')
    from st join public.tag_members m on m.id = st.member_id
    left join public.tags t on t.pool_id = (select ea.pool_id from ea) and t.holder_id = st.member_id
$$;

create or replace function public._ea_by_slug(p_slug text) returns public.early_access
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare x public.early_access;
begin
  select ea.* into x from public.early_access ea join public.events e on e.id = ea.event_id where e.slug = p_slug;
  if not found then raise exception 'no_early_access'; end if;
  return x;
end $$;

create or replace function public._ea_need_td(p_event uuid) returns public.early_access
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare x public.early_access;
begin
  if p_event is null or not public.can_td(p_event) then raise exception 'forbidden'; end if;
  select * into x from public.early_access where event_id = p_event;
  if not found then raise exception 'no_early_access'; end if;
  return x;
end $$;

-- ---------- public ----------
/** The public page: window, roster (who joined), ticket totals, winners once drawn. */
create or replace function public.ea_public(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare ea public.early_access; e public.events; st jsonb;
begin
  ea := public._ea_by_slug(p_slug);
  select * into e from public.events where id = ea.event_id;
  st := public._ea_standings(ea.event_id);
  return jsonb_build_object(
    'event', jsonb_build_object('id', e.id, 'slug', e.slug, 'name', e.name, 'starts_on', e.starts_on),
    'pool', (select slug from public.tag_pools where id = ea.pool_id),
    'opens_on', ea.opens_on, 'closes_on', ea.closes_on, 'min_players', ea.min_players, 'weekly_cap', ea.weekly_cap,
    'today', current_date,
    'roster', coalesce((select jsonb_agg(jsonb_build_object('player_id', p.id, 'name', p.name,
                  'joined', exists (select 1 from public.ea_claims c where c.event_id = ea.event_id and c.player_id = p.id and c.status = 'approved'))
                  order by lower(p.name)) from public.players p where p.event_id = ea.event_id), '[]'),
    'standings', coalesce((select jsonb_agg(jsonb_build_object('name', x ->> 'name', 'nickname', x ->> 'nickname',
                  'tag', (x ->> 'tag')::int, 'tickets', (x ->> 'tickets')::int)) from jsonb_array_elements(st) x), '[]'),
    'winners', coalesce((select jsonb_agg(jsonb_build_object('name', m.name, 'nickname', m.nickname, 'at', d.at) order by d.id)
                  from public.ea_draws d join public.tag_members m on m.id = d.member_id
                 where d.event_id = ea.event_id and not d.void), '[]'));
end $$;

create or replace function public._ea_check_claim(ea public.early_access, p_player uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if current_date > ea.closes_on then raise exception 'window_closed'; end if;
  if not exists (select 1 from public.players where id = p_player and event_id = ea.event_id) then raise exception 'unknown_player'; end if;
  if exists (select 1 from public.ea_claims where event_id = ea.event_id and player_id = p_player and status = 'approved') then
    raise exception 'already_joined';
  end if;
  if (select count(*) from public.ea_claims where event_id = ea.event_id and player_id = p_player and status = 'pending') >= 3 then
    raise exception 'too_many_claims';
  end if;
  if (select count(*) from public.ea_claims where event_id = ea.event_id and status = 'pending') >= 400 then raise exception 'too_many_claims'; end if;
end $$;

/** "That's me" from the public page. Returns the device secret to check back with. */
create or replace function public.ea_claim(p_slug text, p_player uuid, p_nickname text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare ea public.early_access; s text := public._new_tag_token() || public._new_tag_token();
begin
  ea := public._ea_by_slug(p_slug);
  perform public._ea_check_claim(ea, p_player);
  if length(btrim(coalesce(p_nickname, ''))) > 40 then raise exception 'invalid_nickname'; end if;
  insert into public.ea_claims (event_id, player_id, nickname, via, secret)
  values (ea.event_id, p_player, nullif(btrim(coalesce(p_nickname, '')), ''), 'page', s);
  return s;
end $$;

/** "That's me" from My Tag: the member is known. */
create or replace function public.ea_claim_mine(p_token text, p_slug text, p_player uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members; ea public.early_access;
begin
  me := public._tag_member(p_token);
  ea := public._ea_by_slug(p_slug);
  perform public._ea_check_claim(ea, p_player);
  if exists (select 1 from public.ea_claims where event_id = ea.event_id and member_id = me.id and status in ('pending', 'approved')) then
    raise exception 'already_claimed';
  end if;
  insert into public.ea_claims (event_id, player_id, member_id, via) values (ea.event_id, p_player, me.id, 'mytag');
end $$;

/** A page claim's answer. The My Tag link only once approved, and only to the secret's holder. */
create or replace function public.ea_claim_status(p_secret text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c public.ea_claims;
begin
  if p_secret is null or length(p_secret) < 40 then raise exception 'invalid_claim'; end if;
  select * into c from public.ea_claims where secret = p_secret;
  if not found then raise exception 'invalid_claim'; end if;
  return jsonb_build_object('status', c.status, 'name', (select name from public.players where id = c.player_id),
    'token', case when c.status = 'approved' then (select token from public.tag_members where id = c.member_id) end);
end $$;

/** My Tag: every early access this member is in, waiting on, or could still join. */
create or replace function public.ea_me(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me public.tag_members;
begin
  me := public._tag_member(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'slug', e.slug, 'name', e.name, 'starts_on', e.starts_on, 'opens_on', ea.opens_on, 'closes_on', ea.closes_on,
      'min_players', ea.min_players, 'weekly_cap', ea.weekly_cap,
      'status', coalesce((select c.status from public.ea_claims c where c.event_id = ea.event_id and c.member_id = me.id
                           and c.status in ('approved', 'pending') order by c.status limit 1), 'open'),
      'me', (select x from jsonb_array_elements(public._ea_standings(ea.event_id)) x where x ->> 'member_id' = me.id::text))
      order by e.starts_on)
    from public.early_access ea join public.events e on e.id = ea.event_id
   where current_date <= ea.closes_on
      or exists (select 1 from public.ea_claims c where c.event_id = ea.event_id and c.member_id = me.id and c.status = 'approved')), '[]');
end $$;

-- ---------- TD ----------
/** Turn early access on for an event: its own invite-only tag set; the event's TDs run that set. */
create or replace function public.td_ea_start(p_event uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.events; pid uuid; v_slug text;
begin
  if p_event is null or not public.can_td(p_event) then raise exception 'forbidden'; end if;
  if exists (select 1 from public.early_access where event_id = p_event) then raise exception 'already_on'; end if;
  select * into e from public.events where id = p_event;
  if e.starts_on <= current_date then raise exception 'event_started'; end if;
  v_slug := left(regexp_replace(e.slug, '-?[0-9]{4}$', ''), 36) || '-ea';
  if exists (select 1 from public.tag_pools where slug = v_slug) then v_slug := left(e.slug, 36) || '-ea'; end if;
  insert into public.tag_pools (slug, name, sort, invite_only)
  values (v_slug, left(e.name, 47) || ' Early Access', 10, true) returning id into pid;
  insert into public.early_access (event_id, pool_id, opens_on, closes_on) values (p_event, pid, current_date, e.starts_on - 1);
  insert into public.tag_pool_admins (pool_id, email) select pid, t.email from public.event_tds t where t.event_id = p_event
  on conflict do nothing;
end $$;

create or replace function public.td_ea_settings(p_event uuid, p_opens date, p_closes date, p_min int, p_cap int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare ea public.early_access; e public.events;
begin
  ea := public._ea_need_td(p_event);
  select * into e from public.events where id = p_event;
  if p_opens is null or p_closes is null or p_closes < p_opens or p_closes >= e.starts_on then raise exception 'invalid_dates'; end if;
  if p_min is null or p_min not between 2 and 8 or p_cap is null or p_cap not between 1 and 7 then raise exception 'invalid_rules'; end if;
  update public.early_access set opens_on = p_opens, closes_on = p_closes, min_players = p_min, weekly_cap = p_cap where event_id = p_event;
end $$;

/** Everything the TD panel needs: settings, claims, links, bonuses, standings, the secret awards, the draw. */
create or replace function public.td_ea_get(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare ea public.early_access; st jsonb;
begin
  if p_event is null or not public.can_td(p_event) then raise exception 'forbidden'; end if;
  select * into ea from public.early_access where event_id = p_event;
  if not found then return jsonb_build_object('on', false); end if;
  st := public._ea_standings(p_event);
  return jsonb_build_object('on', true,
    'pool', (select slug from public.tag_pools where id = ea.pool_id),
    'opens_on', ea.opens_on, 'closes_on', ea.closes_on, 'min_players', ea.min_players, 'weekly_cap', ea.weekly_cap, 'today', current_date,
    'players', (select count(*) from public.players where event_id = p_event),
    'claims', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'player_id', c.player_id, 'player', p.name, 'nickname', c.nickname,
                  'via', c.via, 'created_at', c.created_at,
                  'member', (select jsonb_build_object('id', m.id, 'name', m.name) from public.tag_members m
                              where m.id = c.member_id or (c.member_id is null and lower(btrim(m.name)) = lower(btrim(p.name))) limit 1),
                  'others', (select count(*) from public.ea_claims o where o.event_id = c.event_id and o.player_id = c.player_id
                              and o.status = 'pending' and o.id <> c.id)) order by c.created_at)
                from public.ea_claims c join public.players p on p.id = c.player_id
               where c.event_id = p_event and c.status = 'pending'), '[]'),
    'linked', coalesce((select jsonb_agg(jsonb_build_object('claim_id', c.id, 'player', p.name, 'member_id', m.id, 'member', m.name,
                  'nickname', m.nickname, 'via', c.via, 'at', c.decided_at,
                  'tag', (select t.number from public.tags t where t.pool_id = ea.pool_id and t.holder_id = m.id)) order by c.decided_at)
                from public.ea_claims c join public.players p on p.id = c.player_id join public.tag_members m on m.id = c.member_id
               where c.event_id = p_event and c.status = 'approved'), '[]'),
    'bonus', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'member_id', b.member_id, 'name', m.name, 'tickets', b.tickets,
                  'reason', b.reason, 'by', b.by_email, 'at', b.at) order by b.id desc)
                from public.ea_bonus b join public.tag_members m on m.id = b.member_id where b.event_id = p_event and not b.void), '[]'),
    'standings', st,
    'awards', jsonb_build_object(
       'iron', coalesce((select jsonb_agg(x order by (x ->> 'rounds')::int desc, x ->> 'name') from (
                  select x from jsonb_array_elements(st) x where (x ->> 'rounds')::int > 0
                   order by (x ->> 'rounds')::int desc, x ->> 'name' limit 5) z), '[]'),
       'collector', coalesce((select jsonb_agg(x order by (x ->> 'partners')::int desc, x ->> 'name') from (
                  select x from jsonb_array_elements(st) x where (x ->> 'partners')::int > 0
                   order by (x ->> 'partners')::int desc, x ->> 'name' limit 5) z), '[]'),
       'climb', coalesce((select jsonb_agg(x order by (x ->> 'start_tag')::int - (x ->> 'tag')::int desc, x ->> 'name') from (
                  select x from jsonb_array_elements(st) x where (x ->> 'tag') is not null and (x ->> 'start_tag') is not null
                     and (x ->> 'start_tag')::int > (x ->> 'tag')::int
                   order by (x ->> 'start_tag')::int - (x ->> 'tag')::int desc, x ->> 'name' limit 5) z), '[]')),
    'draws', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'member_id', d.member_id, 'name', m.name, 'nickname', m.nickname,
                  'tickets', d.tickets, 'at', d.at) order by d.id)
                from public.ea_draws d join public.tag_members m on m.id = d.member_id where d.event_id = p_event and not d.void), '[]'));
end $$;

/**
 * Approve a claim. p_member (page claims only) = link this existing club member instead of the name match / a new one.
 * Issues the next tag at the bottom of the set (join order). Returns {member_id, number}.
 */
create or replace function public.td_ea_approve(p_claim uuid, p_member uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.ea_claims; ea public.early_access; pl public.players; mid uuid; num int;
begin
  select * into c from public.ea_claims where id = p_claim for update;
  if not found then raise exception 'not_found'; end if;
  ea := public._ea_need_td(c.event_id);
  if c.status <> 'pending' then raise exception 'already_%', c.status; end if;
  select * into pl from public.players where id = c.player_id;
  if exists (select 1 from public.ea_claims where event_id = c.event_id and player_id = c.player_id and status = 'approved') then
    raise exception 'already_joined';
  end if;
  if c.member_id is not null then
    if p_member is not null and p_member <> c.member_id then raise exception 'member_mismatch'; end if;
    mid := c.member_id;
  elsif p_member is not null then
    select id into mid from public.tag_members where id = p_member;
    if not found then raise exception 'unknown_member'; end if;
  else
    select id into mid from public.tag_members where lower(btrim(name)) = lower(btrim(pl.name));
    if not found then
      insert into public.tag_members (name, nickname) values (left(btrim(pl.name), 60), c.nickname) returning id into mid;
    end if;
  end if;
  if exists (select 1 from public.ea_claims where event_id = c.event_id and member_id = mid and status = 'approved') then
    raise exception 'member_already_joined';
  end if;

  update public.ea_claims set status = 'approved', member_id = mid, decided_at = now(), decided_by = public.my_email() where id = c.id;
  update public.ea_claims set status = 'declined', decided_at = now(), decided_by = public.my_email()
   where event_id = c.event_id and player_id = c.player_id and status = 'pending';
  update public.tag_members set nickname = c.nickname where id = mid and nickname is null and c.nickname is not null;

  select number into num from public.tags where pool_id = ea.pool_id and holder_id = mid;
  if num is null then
    perform 1 from public.tags where pool_id = ea.pool_id for update;
    num := (select coalesce(max(number), 0) + 1 from public.tags where pool_id = ea.pool_id);
    insert into public.tags (pool_id, number, holder_id, status) values (ea.pool_id, num, mid, 'held');
    insert into public.tag_history (pool_id, number, kind, member_id) values (ea.pool_id, num, 'issued', mid);
  end if;
  return jsonb_build_object('member_id', mid, 'number', num);
end $$;

create or replace function public.td_ea_decline(p_claim uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.ea_claims;
begin
  select * into c from public.ea_claims where id = p_claim for update;
  if not found then raise exception 'not_found'; end if;
  perform public._ea_need_td(c.event_id);
  if c.status <> 'pending' then raise exception 'already_%', c.status; end if;
  update public.ea_claims set status = 'declined', decided_at = now(), decided_by = public.my_email() where id = c.id;
end $$;

/** Undo a link (wrong person): the claim is marked removed and their early-access tag goes back as available. */
create or replace function public.td_ea_remove(p_claim uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.ea_claims; ea public.early_access; num int;
begin
  select * into c from public.ea_claims where id = p_claim for update;
  if not found then raise exception 'not_found'; end if;
  ea := public._ea_need_td(c.event_id);
  if c.status <> 'approved' then raise exception 'not_joined'; end if;
  update public.ea_claims set status = 'removed', decided_at = now(), decided_by = public.my_email() where id = c.id;
  select number into num from public.tags where pool_id = ea.pool_id and holder_id = c.member_id for update;
  if num is not null then
    update public.tags set holder_id = null, status = 'available' where pool_id = ea.pool_id and number = num;
    insert into public.tag_history (pool_id, number, kind, prev_id) values (ea.pool_id, num, 'released', c.member_id);
  end if;
end $$;

create or replace function public.td_ea_bonus(p_event uuid, p_member uuid, p_tickets int, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._ea_need_td(p_event);
  if not exists (select 1 from public.ea_claims where event_id = p_event and member_id = p_member and status = 'approved') then
    raise exception 'not_joined';
  end if;
  if p_tickets is null or p_tickets not between 1 and 5 then raise exception 'invalid_tickets'; end if;
  if length(btrim(coalesce(p_reason, ''))) not between 1 and 120 then raise exception 'reason_required'; end if;
  insert into public.ea_bonus (event_id, member_id, tickets, reason, by_email) values (p_event, p_member, p_tickets, btrim(p_reason), public.my_email());
end $$;

create or replace function public.td_ea_bonus_void(p_id bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.ea_bonus;
begin
  select * into b from public.ea_bonus where id = p_id;
  if not found then raise exception 'not_found'; end if;
  perform public._ea_need_td(b.event_id);
  update public.ea_bonus set void = true where id = p_id;
end $$;

/** Draw one winner, weighted by tickets, among players not already drawn. Only after the window closes. */
create or replace function public.td_ea_draw(p_event uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare ea public.early_access; total int; pick int; w uuid; wt int;
begin
  ea := public._ea_need_td(p_event);
  if current_date <= ea.closes_on then raise exception 'window_open'; end if;
  perform 1 from public.early_access where event_id = p_event for update;
  with pool as (
    select (x ->> 'member_id')::uuid member_id, (x ->> 'tickets')::int tickets from jsonb_array_elements(public._ea_standings(p_event)) x
     where (x ->> 'tickets')::int > 0
       and not exists (select 1 from public.ea_draws d where d.event_id = p_event and not d.void and d.member_id = (x ->> 'member_id')::uuid))
  select coalesce(sum(tickets), 0) into total from pool;
  if total = 0 then raise exception 'nobody_left'; end if;
  pick := 1 + floor(random() * total)::int;
  with pool as (
    select (x ->> 'member_id')::uuid member_id, (x ->> 'tickets')::int tickets from jsonb_array_elements(public._ea_standings(p_event)) x
     where (x ->> 'tickets')::int > 0
       and not exists (select 1 from public.ea_draws d where d.event_id = p_event and not d.void and d.member_id = (x ->> 'member_id')::uuid)),
  cum as (select member_id, tickets, sum(tickets) over (order by member_id) c from pool)
  select member_id, tickets into w, wt from cum where c >= pick order by c limit 1;
  insert into public.ea_draws (event_id, member_id, tickets, by_email) values (p_event, w, wt, public.my_email());
  return jsonb_build_object('member_id', w, 'name', (select name from public.tag_members where id = w), 'tickets', wt, 'total', total);
end $$;

create or replace function public.td_ea_draw_void(p_id bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.ea_draws;
begin
  select * into d from public.ea_draws where id = p_id;
  if not found then raise exception 'not_found'; end if;
  perform public._ea_need_td(d.event_id);
  update public.ea_draws set void = true where id = p_id;
end $$;

-- ---------- who can call what ----------
revoke execute on function public._ea_rounds(uuid), public._ea_standings(uuid), public._ea_by_slug(text), public._ea_need_td(uuid),
  public._ea_check_claim(public.early_access, uuid) from public, anon, authenticated;
grant execute on function public.ea_public(text), public.ea_claim(text, uuid, text), public.ea_claim_mine(text, text, uuid),
  public.ea_claim_status(text), public.ea_me(text) to anon, authenticated;
revoke execute on function public.td_ea_start(uuid), public.td_ea_settings(uuid, date, date, int, int), public.td_ea_get(uuid),
  public.td_ea_approve(uuid, uuid), public.td_ea_decline(uuid), public.td_ea_remove(uuid), public.td_ea_bonus(uuid, uuid, int, text),
  public.td_ea_bonus_void(bigint), public.td_ea_draw(uuid), public.td_ea_draw_void(bigint) from public, anon;
grant execute on function public.td_ea_start(uuid), public.td_ea_settings(uuid, date, date, int, int), public.td_ea_get(uuid),
  public.td_ea_approve(uuid, uuid), public.td_ea_decline(uuid), public.td_ea_remove(uuid), public.td_ea_bonus(uuid, uuid, int, text),
  public.td_ea_bonus_void(bigint), public.td_ea_draw(uuid), public.td_ea_draw_void(bigint) to authenticated;

-- ---------- Jewel XI: on from today, closes the day before ----------
insert into public.tag_pools (slug, name, sort, invite_only) values ('jewel-xi-ea', 'Jewel XI Early Access', 10, true)
on conflict (slug) do nothing;
insert into public.early_access (event_id, pool_id, opens_on, closes_on)
select e.id, (select id from public.tag_pools where slug = 'jewel-xi-ea'), current_date, e.starts_on - 1
  from public.events e where e.slug = 'jewel-xi-2026' and e.starts_on > current_date
on conflict (event_id) do nothing;
insert into public.tag_pool_admins (pool_id, email)
select ea.pool_id, t.email from public.early_access ea join public.event_tds t on t.event_id = ea.event_id
 where ea.pool_id = (select id from public.tag_pools where slug = 'jewel-xi-ea')
on conflict do nothing;
