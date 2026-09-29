-- Digital bag tags (locked 2026-09-29, Mike)
-- Decisions: a separate numbered set per league (pool); casual rounds are self-serve with every player confirming
-- from their private My Tag link; ties keep their tag order; only a pool admin issues tags (next number at the bottom).
-- Source of truth:
--   tag_pools        : one numbered set per league (Lazy Boners, RBFL). slug is the public id.
--   tag_pool_admins  : emails who run a pool (league TD). Super admin (is_td) runs every pool.
--   tag_members      : club-level people who hold tags. name is unique (case-insensitive). token = private My Tag link.
--   tags             : (pool, number) -> holder. status held | available | retired. #1 is the best tag.
--   tag_matches      : a round where tags were on the line: source casual | event; status pending | applied | disputed | void.
--   tag_match_players: who played, score (lower wins), confirmation, and the tag they had before/after (set when applied).
--   tag_history      : append-only ledger of every tag change (issued, moved, released, retired, undo). Public.
-- Rules:
--   * Apply = the players on the round who hold a tag in that pool trade tags: best score takes the lowest of their
--     numbers, and so on. Ties keep their order from before (the better tag stays better). Players without a tag in
--     the pool don't count. Tags are read at apply time, so a round logged earlier still swaps whatever they hold now.
--   * Casual: a holder logs 2-6 holders + scores; the logger is confirmed; it applies when everyone confirms. Any
--     dispute -> 'disputed' for the pool admin. Unconfirmed rounds expire after 7 days. Max 3 open rounds per logger.
--   * Event: a pool admin who is also a TD of the event records it once (not again unless voided), applied at once.
--   * Undo: only the pool's latest applied round, and only if none of its tags changed since.
--   * Tokens are never publicly readable (column grants). Pending rounds are only visible to their players and admins.
--   * Safe to re-run.
-- =====================================================================

create or replace function public._new_tag_token() returns text
language sql volatile set search_path = public, pg_temp as $$
  select replace(gen_random_uuid()::text, '-', '')
$$;

create table if not exists public.tag_pools (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name       text not null check (length(btrim(name)) between 1 and 60),
  sort       integer not null default 0,
  created_at timestamptz not null default now()
);
insert into public.tag_pools (slug, name, sort) values ('lazy-boners', 'Lazy Boners', 1), ('rbfl', 'RBFL', 2)
on conflict (slug) do nothing;

create table if not exists public.tag_pool_admins (
  pool_id  uuid not null references public.tag_pools(id) on delete cascade,
  email    text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  added_at timestamptz not null default now(),
  primary key (pool_id, email)
);

create table if not exists public.tag_members (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(btrim(name)) between 1 and 60),
  nickname     text check (nickname is null or length(btrim(nickname)) between 1 and 40),
  token        text not null unique default public._new_tag_token(),
  last_seen_at timestamptz,
  created_at   timestamptz not null default now()
);
create unique index if not exists tag_members_name_uq on public.tag_members (lower(btrim(name)));

create table if not exists public.tags (
  pool_id   uuid not null references public.tag_pools(id) on delete cascade,
  number    integer not null check (number between 1 and 9999),
  holder_id uuid references public.tag_members(id) on delete restrict,
  status    text not null default 'held' check (status in ('held', 'available', 'retired')),
  issued_at timestamptz not null default now(),
  moved_at  timestamptz,
  moves     integer not null default 0,
  primary key (pool_id, number),
  constraint tags_holder_status check ((status = 'held') = (holder_id is not null)),
  -- deferred so a swap can pass through a moment where one member briefly has two rows
  constraint tags_one_per_member unique (pool_id, holder_id) deferrable initially deferred
);

create table if not exists public.tag_matches (
  id            uuid primary key default gen_random_uuid(),
  pool_id       uuid not null references public.tag_pools(id) on delete cascade,
  source        text not null check (source in ('casual', 'event')),
  event_id      uuid references public.events(id) on delete set null,
  status        text not null default 'pending' check (status in ('pending', 'applied', 'disputed', 'void')),
  course        text check (course is null or length(course) <= 80),
  played_on     date not null default current_date,
  note          text check (note is null or length(note) <= 300),
  created_by    uuid references public.tag_members(id) on delete set null,
  created_by_td text,
  resolved_by   text,
  created_at    timestamptz not null default now(),
  applied_at    timestamptz
);
create unique index if not exists tag_matches_event_once on public.tag_matches (pool_id, event_id) where event_id is not null and status <> 'void';
create index if not exists tag_matches_pool on public.tag_matches (pool_id, applied_at desc);

create table if not exists public.tag_match_players (
  match_id     uuid not null references public.tag_matches(id) on delete cascade,
  member_id    uuid not null references public.tag_members(id) on delete cascade,
  score        integer not null check (score between -99 and 999),
  tag_before   integer,
  tag_after    integer,
  confirmed_at timestamptz,
  disputed_at  timestamptz,
  primary key (match_id, member_id)
);
create index if not exists tag_match_players_member on public.tag_match_players (member_id);

create table if not exists public.tag_history (
  id        bigint generated always as identity primary key,
  pool_id   uuid not null references public.tag_pools(id) on delete cascade,
  number    integer not null,
  kind      text not null check (kind in ('issued', 'moved', 'released', 'retired', 'undo')),
  member_id uuid references public.tag_members(id) on delete set null,  -- who holds it after this line (null = nobody)
  prev_id   uuid references public.tag_members(id) on delete set null,  -- who held it before
  match_id  uuid references public.tag_matches(id) on delete set null,
  at        timestamptz not null default now()
);
create index if not exists tag_history_tag on public.tag_history (pool_id, number, id desc);
create index if not exists tag_history_member on public.tag_history (member_id);

-- ---------- who runs a pool ----------
create or replace function public.can_tag(p_pool uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_td() or exists (select 1 from public.tag_pool_admins a where a.pool_id = p_pool and a.email = public.my_email())
$$;
create or replace function public.is_tag_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_td() or exists (select 1 from public.tag_pool_admins a where a.email = public.my_email())
$$;

-- ---------- access ----------
alter table public.tag_pools enable row level security;
alter table public.tag_pool_admins enable row level security;
alter table public.tag_members enable row level security;
alter table public.tags enable row level security;
alter table public.tag_matches enable row level security;
alter table public.tag_match_players enable row level security;
alter table public.tag_history enable row level security;

revoke all on public.tag_pools, public.tag_pool_admins, public.tag_members, public.tags, public.tag_matches,
  public.tag_match_players, public.tag_history from anon, authenticated;
grant select on public.tag_pools, public.tags, public.tag_matches, public.tag_match_players, public.tag_history to anon, authenticated;
grant select (id, name, nickname) on public.tag_members to anon, authenticated;   -- never the token
grant select, insert, delete on public.tag_pool_admins to authenticated;
-- every other write goes through the functions below

drop policy if exists "public read" on public.tag_pools;
create policy "public read" on public.tag_pools for select to anon, authenticated using (true);
drop policy if exists "public read" on public.tags;
create policy "public read" on public.tags for select to anon, authenticated using (true);
drop policy if exists "public read" on public.tag_members;
create policy "public read" on public.tag_members for select to anon, authenticated using (true);
drop policy if exists "public read" on public.tag_history;
create policy "public read" on public.tag_history for select to anon, authenticated using (true);
drop policy if exists "applied or admin" on public.tag_matches;
create policy "applied or admin" on public.tag_matches for select to anon, authenticated using (status = 'applied' or public.can_tag(pool_id));
drop policy if exists "applied or admin" on public.tag_match_players;
create policy "applied or admin" on public.tag_match_players for select to anon, authenticated
  using (exists (select 1 from public.tag_matches m where m.id = match_id and (m.status = 'applied' or public.can_tag(m.pool_id))));
drop policy if exists "admins read" on public.tag_pool_admins;
create policy "admins read" on public.tag_pool_admins for select to authenticated using (public.can_tag(pool_id));
drop policy if exists "super admin adds" on public.tag_pool_admins;
create policy "super admin adds" on public.tag_pool_admins for insert to authenticated with check (public.is_td());
drop policy if exists "super admin removes" on public.tag_pool_admins;
create policy "super admin removes" on public.tag_pool_admins for delete to authenticated using (public.is_td());

-- ---------- the swap (the one place tags change hands in a round) ----------
create or replace function public._tag_apply(p_match uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.tag_matches; r record;
begin
  select * into m from public.tag_matches where id = p_match for update;
  if not found then raise exception 'not_found'; end if;
  if m.status not in ('pending', 'disputed') then raise exception 'already_%', m.status; end if;
  perform 1 from public.tags where pool_id = m.pool_id for update;   -- one swap at a time per pool

  update public.tag_match_players p set tag_before = t.number, tag_after = null
    from public.tags t where p.match_id = m.id and t.pool_id = m.pool_id and t.holder_id = p.member_id;
  update public.tag_match_players p set tag_before = null, tag_after = null
   where p.match_id = m.id and not exists (select 1 from public.tags t where t.pool_id = m.pool_id and t.holder_id = p.member_id);

  -- best score takes the lowest number; ties keep their order from before
  with ranked as (
    select member_id, row_number() over (order by score, tag_before) as rn from public.tag_match_players
     where match_id = m.id and tag_before is not null
  ), nums as (
    select tag_before as number, row_number() over (order by tag_before) as rn from public.tag_match_players
     where match_id = m.id and tag_before is not null
  )
  update public.tag_match_players p set tag_after = n.number
    from ranked rk join nums n using (rn) where p.match_id = m.id and p.member_id = rk.member_id;

  for r in select member_id, tag_before, tag_after from public.tag_match_players
            where match_id = m.id and tag_before is not null and tag_after <> tag_before loop
    insert into public.tag_history (pool_id, number, kind, member_id, prev_id, match_id)
    values (m.pool_id, r.tag_after, 'moved', r.member_id,
            (select member_id from public.tag_match_players where match_id = m.id and tag_before = r.tag_after), m.id);
  end loop;
  update public.tags t set holder_id = p.member_id, moved_at = now(), moves = t.moves + 1
    from public.tag_match_players p
   where p.match_id = m.id and t.pool_id = m.pool_id and t.number = p.tag_after and p.tag_after <> p.tag_before;

  update public.tag_matches set status = 'applied', applied_at = now() where id = m.id;
end $$;

-- ---------- My Tag (private link, no sign-in) ----------
create or replace function public._tag_member(p_token text) returns public.tag_members
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare x public.tag_members;
begin
  if p_token is null or length(p_token) < 20 then raise exception 'invalid_link'; end if;
  select * into x from public.tag_members where token = p_token;
  if not found then raise exception 'invalid_link'; end if;
  return x;
end $$;

create or replace function public._tag_match_json(p_match uuid, p_me uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', m.id, 'pool', po.slug, 'pool_name', po.name, 'source', m.source, 'status', m.status,
    'course', m.course, 'played_on', m.played_on, 'created_at', m.created_at, 'applied_at', m.applied_at,
    'expired', m.status = 'pending' and m.created_at < now() - interval '7 days',
    'created_by', m.created_by, 'mine', m.created_by = p_me,
    'players', (select jsonb_agg(jsonb_build_object('member_id', p.member_id, 'name', x.name, 'nickname', x.nickname, 'score', p.score,
                  'tag_before', p.tag_before, 'tag_after', p.tag_after,
                  'tag_now', (select t.number from public.tags t where t.pool_id = m.pool_id and t.holder_id = p.member_id),
                  'confirmed', p.confirmed_at is not null, 'disputed', p.disputed_at is not null) order by p.score, x.name)
                from public.tag_match_players p join public.tag_members x on x.id = p.member_id where p.match_id = m.id))
  from public.tag_matches m join public.tag_pools po on po.id = m.pool_id where m.id = p_match
$$;

create or replace function public.tag_me(p_token text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members;
begin
  me := public._tag_member(p_token);
  update public.tag_members set last_seen_at = now() where id = me.id;
  return jsonb_build_object(
    'me', jsonb_build_object('id', me.id, 'name', me.name, 'nickname', me.nickname),
    'holdings', coalesce((select jsonb_agg(jsonb_build_object('pool_id', po.id, 'pool', po.slug, 'pool_name', po.name, 'number', t.number,
                    'moved_at', t.moved_at, 'moves', t.moves, 'held', (select count(*) from public.tags h where h.pool_id = po.id and h.status = 'held'))
                    order by po.sort)
                  from public.tags t join public.tag_pools po on po.id = t.pool_id where t.holder_id = me.id), '[]'),
    'rosters', coalesce((select jsonb_object_agg(po.slug, (select jsonb_agg(jsonb_build_object('member_id', x.id, 'name', x.name, 'nickname', x.nickname, 'number', t2.number) order by t2.number)
                    from public.tags t2 join public.tag_members x on x.id = t2.holder_id where t2.pool_id = po.id))
                  from public.tag_pools po where exists (select 1 from public.tags t where t.pool_id = po.id and t.holder_id = me.id)), '{}'),
    'open', coalesce((select jsonb_agg(public._tag_match_json(m.id, me.id) order by m.created_at desc)
                  from public.tag_matches m where m.status in ('pending', 'disputed')
                   and exists (select 1 from public.tag_match_players p where p.match_id = m.id and p.member_id = me.id)), '[]'),
    'recent', coalesce((select jsonb_agg(j order by at desc) from (
                  select public._tag_match_json(m.id, me.id) j, m.applied_at at from public.tag_matches m
                   where m.status = 'applied' and exists (select 1 from public.tag_match_players p where p.match_id = m.id and p.member_id = me.id)
                   order by m.applied_at desc limit 15) z), '[]')
  );
end $$;

/** p_players: [{member_id, score}], must include me. Everyone must hold a tag in the pool now. */
create or replace function public.tag_log(p_token text, p_pool uuid, p_players jsonb, p_course text, p_played_on date) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members; mid uuid; n int; r jsonb;
begin
  me := public._tag_member(p_token);
  if jsonb_typeof(p_players) <> 'array' then raise exception 'invalid_players'; end if;
  n := jsonb_array_length(p_players);
  if n < 2 or n > 6 then raise exception 'players_2_to_6'; end if;
  if (select count(distinct x ->> 'member_id') from jsonb_array_elements(p_players) x) <> n then raise exception 'duplicate_player'; end if;
  if not exists (select 1 from jsonb_array_elements(p_players) x where (x ->> 'member_id')::uuid = me.id) then raise exception 'must_include_you'; end if;
  for r in select * from jsonb_array_elements(p_players) loop
    if not exists (select 1 from public.tags t where t.pool_id = p_pool and t.holder_id = (r ->> 'member_id')::uuid) then raise exception 'no_tag_in_pool'; end if;
    if (r ->> 'score') is null or (r ->> 'score') !~ '^-?[0-9]{1,3}$' then raise exception 'invalid_score'; end if;
  end loop;
  if p_played_on is not null and (p_played_on > current_date + 1 or p_played_on < current_date - 14) then raise exception 'invalid_date'; end if;
  if (select count(*) from public.tag_matches where created_by = me.id and status = 'pending' and created_at > now() - interval '7 days') >= 3 then
    raise exception 'too_many_open';
  end if;
  insert into public.tag_matches (pool_id, source, status, course, played_on, created_by)
  values (p_pool, 'casual', 'pending', nullif(btrim(coalesce(p_course, '')), ''), coalesce(p_played_on, current_date), me.id) returning id into mid;
  insert into public.tag_match_players (match_id, member_id, score, confirmed_at)
  select mid, (x ->> 'member_id')::uuid, (x ->> 'score')::int, case when (x ->> 'member_id')::uuid = me.id then now() end
    from jsonb_array_elements(p_players) x;
  return mid;
end $$;

/** Confirm (p_ok) or dispute a round you're on. The last confirmation applies it. Returns the new status. */
create or replace function public.tag_confirm(p_token text, p_match uuid, p_ok boolean) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members; m public.tag_matches;
begin
  me := public._tag_member(p_token);
  select * into m from public.tag_matches where id = p_match for update;
  if not found or not exists (select 1 from public.tag_match_players where match_id = p_match and member_id = me.id) then raise exception 'not_your_round'; end if;
  if m.status <> 'pending' then raise exception 'round_%', m.status; end if;
  if m.created_at < now() - interval '7 days' then raise exception 'round_expired'; end if;
  if p_ok then
    update public.tag_match_players set confirmed_at = coalesce(confirmed_at, now()), disputed_at = null where match_id = p_match and member_id = me.id;
    if not exists (select 1 from public.tag_match_players where match_id = p_match and confirmed_at is null) then
      perform public._tag_apply(p_match);
      return 'applied';
    end if;
    return 'pending';
  end if;
  update public.tag_match_players set disputed_at = now(), confirmed_at = null where match_id = p_match and member_id = me.id;
  update public.tag_matches set status = 'disputed' where id = p_match;
  return 'disputed';
end $$;

/** The logger can take back a round nobody else has confirmed yet. */
create or replace function public.tag_withdraw(p_token text, p_match uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members;
begin
  me := public._tag_member(p_token);
  update public.tag_matches set status = 'void', resolved_by = me.name
   where id = p_match and created_by = me.id and status = 'pending'
     and not exists (select 1 from public.tag_match_players p where p.match_id = p_match and p.member_id <> me.id and p.confirmed_at is not null);
  if not found then raise exception 'cannot_withdraw'; end if;
end $$;

-- ---------- pool admin ----------
create or replace function public._need_tag(p_pool uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin if not public.can_tag(p_pool) then raise exception 'forbidden'; end if; end $$;

/** Everyone with a tag or a link, with their private link token. Pool admins only. */
create or replace function public.td_tag_members() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_tag_admin() then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'nickname', x.nickname, 'token', x.token,
      'last_seen_at', x.last_seen_at, 'created_at', x.created_at) order by lower(x.name)) from public.tag_members x), '[]');
end $$;

/**
 * Issue a tag. p_member = existing person, else p_name creates (or reuses, same name) one.
 * p_number null = next number at the bottom (highest ever + 1). A given number must be free (new, available or retired).
 */
create or replace function public.td_tag_issue(p_pool uuid, p_member uuid, p_name text, p_nickname text, p_number int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare mid uuid; num int; t public.tags;
begin
  perform public._need_tag(p_pool);
  if p_member is not null then
    select id into mid from public.tag_members where id = p_member;
    if not found then raise exception 'unknown_member'; end if;
  else
    if btrim(coalesce(p_name, '')) = '' then raise exception 'name_required'; end if;
    select id into mid from public.tag_members where lower(btrim(name)) = lower(btrim(p_name));
    if not found then
      insert into public.tag_members (name, nickname) values (btrim(p_name), nullif(btrim(coalesce(p_nickname, '')), '')) returning id into mid;
    end if;
  end if;
  if exists (select 1 from public.tags where pool_id = p_pool and holder_id = mid) then raise exception 'already_has_tag'; end if;
  perform 1 from public.tags where pool_id = p_pool for update;
  num := coalesce(p_number, (select coalesce(max(number), 0) + 1 from public.tags where pool_id = p_pool));
  if num < 1 or num > 9999 then raise exception 'invalid_number'; end if;
  select * into t from public.tags where pool_id = p_pool and number = num;
  if found then
    if t.status = 'held' then raise exception 'tag_taken'; end if;
    update public.tags set holder_id = mid, status = 'held', issued_at = now() where pool_id = p_pool and number = num;
  else
    insert into public.tags (pool_id, number, holder_id, status) values (p_pool, num, mid, 'held');
  end if;
  insert into public.tag_history (pool_id, number, kind, member_id) values (p_pool, num, 'issued', mid);
  return jsonb_build_object('member_id', mid, 'number', num);
end $$;

/** Take a tag back (player quit, moved away): available for reissue, or retired for good. */
create or replace function public.td_tag_release(p_pool uuid, p_number int, p_retire boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.tags;
begin
  perform public._need_tag(p_pool);
  select * into t from public.tags where pool_id = p_pool and number = p_number for update;
  if not found then raise exception 'not_found'; end if;
  update public.tags set holder_id = null, status = case when p_retire then 'retired' else 'available' end where pool_id = p_pool and number = p_number;
  insert into public.tag_history (pool_id, number, kind, member_id, prev_id) values (p_pool, p_number, case when p_retire then 'retired' else 'released' end, null, t.holder_id);
end $$;

create or replace function public.td_tag_member_update(p_member uuid, p_name text, p_nickname text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_tag_admin() then raise exception 'forbidden'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'name_required'; end if;
  update public.tag_members set name = btrim(p_name), nickname = nullif(btrim(coalesce(p_nickname, '')), '') where id = p_member;
  if not found then raise exception 'unknown_member'; end if;
end $$;

/** New private link (the old one stops working at once). */
create or replace function public.td_tag_new_link(p_member uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare tok text;
begin
  if not public.is_tag_admin() then raise exception 'forbidden'; end if;
  update public.tag_members set token = public._new_tag_token() where id = p_member returning token into tok;
  if tok is null then raise exception 'unknown_member'; end if;
  return tok;
end $$;

/**
 * Record a round an admin saw (league night from the scorecard, or one texted in) and apply it now.
 * p_event: the event it came from (then the admin must also be a TD of that event; once per pool+event).
 * p_rows: [{member_id, score}], 2+ people.
 */
create or replace function public.td_tag_record(p_pool uuid, p_event uuid, p_rows jsonb, p_course text, p_played_on date) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare mid uuid; n int;
begin
  perform public._need_tag(p_pool);
  if p_event is not null and not public.can_td(p_event) then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'invalid_players'; end if;
  n := jsonb_array_length(p_rows);
  if n < 2 or n > 200 then raise exception 'players_2_or_more'; end if;
  if (select count(distinct x ->> 'member_id') from jsonb_array_elements(p_rows) x) <> n then raise exception 'duplicate_player'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) x where (x ->> 'score') is null or (x ->> 'score') !~ '^-?[0-9]{1,3}$') then raise exception 'invalid_score'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) x where not exists (select 1 from public.tag_members m where m.id = (x ->> 'member_id')::uuid)) then
    raise exception 'unknown_member';
  end if;
  if p_event is not null and exists (select 1 from public.tag_matches where pool_id = p_pool and event_id = p_event and status <> 'void') then
    raise exception 'event_already_recorded';
  end if;
  insert into public.tag_matches (pool_id, source, event_id, status, course, played_on, created_by_td)
  values (p_pool, case when p_event is null then 'casual' else 'event' end, p_event, 'pending', nullif(btrim(coalesce(p_course, '')), ''),
          coalesce(p_played_on, current_date), coalesce(public.my_email(), 'admin'))
  returning id into mid;
  insert into public.tag_match_players (match_id, member_id, score, confirmed_at)
  select mid, (x ->> 'member_id')::uuid, (x ->> 'score')::int, now() from jsonb_array_elements(p_rows) x;
  perform public._tag_apply(mid);
  return mid;
end $$;

/** Settle a pending or disputed round: apply it as logged, or void it. */
create or replace function public.td_tag_resolve(p_match uuid, p_apply boolean) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.tag_matches;
begin
  select * into m from public.tag_matches where id = p_match;
  if not found then raise exception 'not_found'; end if;
  perform public._need_tag(m.pool_id);
  if m.status not in ('pending', 'disputed') then raise exception 'round_%', m.status; end if;
  if p_apply then
    perform public._tag_apply(p_match);
    update public.tag_matches set resolved_by = coalesce(public.my_email(), 'admin') where id = p_match;
    return 'applied';
  end if;
  update public.tag_matches set status = 'void', resolved_by = coalesce(public.my_email(), 'admin') where id = p_match;
  return 'void';
end $$;

/** Undo the pool's latest applied round, only if none of its tags have changed since. */
create or replace function public.td_tag_undo(p_pool uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.tag_matches; r record;
begin
  perform public._need_tag(p_pool);
  perform 1 from public.tags where pool_id = p_pool for update;
  select * into m from public.tag_matches where pool_id = p_pool and status = 'applied' order by applied_at desc limit 1;
  if not found then raise exception 'nothing_to_undo'; end if;
  if exists (select 1 from public.tag_history h where h.pool_id = p_pool and h.at > m.applied_at
              and h.number in (select tag_after from public.tag_match_players where match_id = m.id and tag_after is not null)
              and h.match_id is distinct from m.id
              and not exists (select 1 from public.tag_matches v where v.id = h.match_id and v.status = 'void')) then  -- undone rounds don't count
    raise exception 'tags_changed_since';
  end if;
  for r in select member_id, tag_before, tag_after from public.tag_match_players where match_id = m.id and tag_before is not null and tag_before <> tag_after loop
    insert into public.tag_history (pool_id, number, kind, member_id, prev_id, match_id) values (p_pool, r.tag_before, 'undo', r.member_id,
      (select member_id from public.tag_match_players where match_id = m.id and tag_after = r.tag_before), m.id);
  end loop;
  update public.tags t set holder_id = p.member_id, moves = greatest(t.moves - 1, 0), moved_at = now()
    from public.tag_match_players p
   where p.match_id = m.id and t.pool_id = p_pool and t.number = p.tag_before and p.tag_before <> p.tag_after;
  update public.tag_matches set status = 'void', resolved_by = coalesce(public.my_email(), 'admin') || ' (undo)' where id = m.id;
  return m.id;
end $$;

-- ---------- execute grants ----------
revoke execute on function public._new_tag_token(), public._tag_apply(uuid), public._tag_member(text), public._tag_match_json(uuid, uuid),
  public._need_tag(uuid) from public, anon, authenticated;
revoke execute on function public.tag_me(text), public.tag_log(text, uuid, jsonb, text, date), public.tag_confirm(text, uuid, boolean),
  public.tag_withdraw(text, uuid), public.can_tag(uuid), public.is_tag_admin(), public.td_tag_members(),
  public.td_tag_issue(uuid, uuid, text, text, int), public.td_tag_release(uuid, int, boolean), public.td_tag_member_update(uuid, text, text),
  public.td_tag_new_link(uuid), public.td_tag_record(uuid, uuid, jsonb, text, date), public.td_tag_resolve(uuid, boolean),
  public.td_tag_undo(uuid) from public;
grant execute on function public.tag_me(text), public.tag_log(text, uuid, jsonb, text, date), public.tag_confirm(text, uuid, boolean),
  public.tag_withdraw(text, uuid), public.can_tag(uuid), public.is_tag_admin() to anon, authenticated;
grant execute on function public.td_tag_members(), public.td_tag_issue(uuid, uuid, text, text, int), public.td_tag_release(uuid, int, boolean),
  public.td_tag_member_update(uuid, text, text), public.td_tag_new_link(uuid), public.td_tag_record(uuid, uuid, jsonb, text, date),
  public.td_tag_resolve(uuid, boolean), public.td_tag_undo(uuid) to authenticated;
-- Supabase grants new functions to anon by default; admin functions are signed-in only.
revoke execute on function public.td_tag_members(), public.td_tag_issue(uuid, uuid, text, text, int), public.td_tag_release(uuid, int, boolean),
  public.td_tag_member_update(uuid, text, text), public.td_tag_new_link(uuid), public.td_tag_record(uuid, uuid, jsonb, text, date),
  public.td_tag_resolve(uuid, boolean), public.td_tag_undo(uuid) from anon;
