-- Boner Rounds: casual rounds kept on the site scorecard, saved by a member, usable for a tag exchange
-- (locked 2026-10-03, Mike): members save with their My Tag link (no sign-in); players are members or guests;
-- a round shows publicly right away, marked unconfirmed until the other members confirm; a tag exchange made from
-- a round follows the casual tag rule (everyone on it confirms, the last confirmation swaps).
-- Source of truth:
--   club_rounds        : one saved round (course, date, pars per hole, who saved it). status saved | void.
--   club_round_players : one row per player: a member (tag_members) or a guest name; hole scores; strokes; to_par;
--                        confirmed_at / disputed_at for members (the saver is confirmed on save; guests never confirm).
--   tag_matches.round_id : the tag exchange made from a round (one per tag set per round, unless voided).
-- Rules:
--   * Anyone can keep score on /scorecard; saving needs a member's My Tag link and the saver must be on the round.
--   * 1-8 players, 1-36 holes, pars 2-6, every hole scored 1-20 for everyone. Played in the last 14 days (or tomorrow).
--   * Strokes and to_par are computed here, never trusted from the phone.
--   * Tag exchange: any member on the round who holds a tag in that set starts it; it includes every member on the
--     round holding a tag in that set (2-8); score = strokes; the starter is confirmed. Same swap as every tag round.
--   * Confirming the round (Boner Rounds page or My Tag) also confirms a waiting exchange made from it, and
--     confirming the exchange on My Tag also confirms the round. Disputes mirror the same way.
--   * The saver can void their round unless an exchange from it already moved tags; a tag admin can void any.
--     Voiding a round withdraws exchanges from it that are still waiting.
--   * Writes only through the round_* functions. Public reads see saved rounds (never tokens).
--   * Safe to re-run.
-- =====================================================================

create table if not exists public.club_rounds (
  id          uuid primary key default gen_random_uuid(),
  course      text not null check (length(btrim(course)) between 1 and 80),
  course_id   uuid references public.courses(id) on delete set null,
  layout_id   uuid,  -- the library layout the pars came from (checked on save; no FK so courses->course_layouts embeds stay unambiguous)
  played_on   date not null,
  pars        smallint[] not null check (cardinality(pars) between 1 and 36 and 2 <= all (pars) and 6 >= all (pars)),
  totals_only boolean not null default false,
  note        text check (note is null or length(note) <= 300),
  created_by  uuid not null references public.tag_members(id) on delete restrict,
  status      text not null default 'saved' check (status in ('saved', 'void')),
  voided_by   text,
  created_at  timestamptz not null default now()
);
create index if not exists club_rounds_recent on public.club_rounds (played_on desc, created_at desc) where status = 'saved';
create index if not exists club_rounds_by on public.club_rounds (created_by, created_at desc);

create table if not exists public.club_round_players (
  round_id     uuid not null references public.club_rounds(id) on delete cascade,
  seq          smallint not null check (seq between 1 and 8),
  member_id    uuid references public.tag_members(id) on delete restrict,
  guest_name   text check (guest_name is null or length(btrim(guest_name)) between 1 and 40),
  scores       smallint[] check (scores is null or (cardinality(scores) between 1 and 36 and 1 <= all (scores) and 20 >= all (scores))),
  strokes      integer not null check (strokes between 1 and 720),
  to_par       integer not null check (to_par between -216 and 600),
  confirmed_at timestamptz,
  disputed_at  timestamptz,
  primary key (round_id, seq),
  check (num_nonnulls(member_id, guest_name) = 1),
  check (member_id is not null or (confirmed_at is null and disputed_at is null)),
  unique (round_id, member_id)
);
create index if not exists club_round_players_member on public.club_round_players (member_id);

alter table public.tag_matches add column if not exists round_id uuid references public.club_rounds(id) on delete set null;
create unique index if not exists tag_matches_round_once on public.tag_matches (pool_id, round_id) where round_id is not null and status <> 'void';

-- ---------- access: public reads saved rounds; every write is a function ----------
alter table public.club_rounds enable row level security;
alter table public.club_round_players enable row level security;
revoke all on public.club_rounds, public.club_round_players from anon, authenticated;
grant select on public.club_rounds, public.club_round_players to anon, authenticated;
drop policy if exists "public read saved" on public.club_rounds;
create policy "public read saved" on public.club_rounds for select to anon, authenticated using (status = 'saved' or public.is_tag_admin());
drop policy if exists "public read saved" on public.club_round_players;
create policy "public read saved" on public.club_round_players for select to anon, authenticated
  using (exists (select 1 from public.club_rounds r where r.id = round_id and (r.status = 'saved' or public.is_tag_admin())));

-- ---------- save ----------
/**
 * p_round: {course, course_id?, layout_id?, played_on, pars: [3,3,...], note?,
 *           players: [{member_id} | {guest_name}, scores: [..one per hole..]]}. Returns the round id.
 */
create or replace function public.round_save(p_token text, p_round jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members; rid uuid; pars smallint[]; n int; np int; i int; r jsonb; sc smallint[]; v_par int;
        v_course text := btrim(coalesce(p_round ->> 'course', '')); v_day date; v_cid uuid; v_lid uuid;
begin
  me := public._tag_member(p_token);
  if jsonb_typeof(p_round) <> 'object' or jsonb_typeof(p_round -> 'pars') <> 'array' or jsonb_typeof(p_round -> 'players') <> 'array' then
    raise exception 'invalid_round';
  end if;
  if v_course = '' or length(v_course) > 80 then raise exception 'course_required'; end if;
  begin
    v_day := (p_round ->> 'played_on')::date;
    pars := array(select (x #>> '{}')::smallint from jsonb_array_elements(p_round -> 'pars') x);
  exception when others then raise exception 'invalid_round';
  end;
  if v_day is null or v_day > current_date + 1 or v_day < current_date - 14 then raise exception 'invalid_date'; end if;
  n := cardinality(pars);
  if n < 1 or n > 36 or exists (select 1 from unnest(pars) p where p is null or p < 2 or p > 6) then raise exception 'invalid_pars'; end if;
  v_par := (select sum(p) from unnest(pars) p);
  np := jsonb_array_length(p_round -> 'players');
  if np < 1 or np > 8 then raise exception 'players_1_to_8'; end if;
  if not exists (select 1 from jsonb_array_elements(p_round -> 'players') x where x ->> 'member_id' = me.id::text) then raise exception 'must_include_you'; end if;
  if (select count(distinct x ->> 'member_id') from jsonb_array_elements(p_round -> 'players') x where x ? 'member_id' and x ->> 'member_id' is not null)
     <> (select count(*) from jsonb_array_elements(p_round -> 'players') x where x ? 'member_id' and x ->> 'member_id' is not null) then
    raise exception 'duplicate_player';
  end if;
  if (select count(*) from public.club_rounds where created_by = me.id and created_at > now() - interval '1 day') >= 20 then raise exception 'too_many_rounds'; end if;
  if nullif(p_round ->> 'course_id', '') is not null then
    begin v_cid := (p_round ->> 'course_id')::uuid; exception when others then raise exception 'invalid_round'; end;
    if not exists (select 1 from public.courses where id = v_cid) then v_cid := null; end if;
  end if;
  if nullif(p_round ->> 'layout_id', '') is not null then
    begin v_lid := (p_round ->> 'layout_id')::uuid; exception when others then raise exception 'invalid_round'; end;
    if not exists (select 1 from public.course_layouts where id = v_lid and (v_cid is null or course_id = v_cid)) then v_lid := null; end if;
  end if;

  insert into public.club_rounds (course, course_id, layout_id, played_on, pars, note, created_by)
  values (v_course, v_cid, v_lid, v_day, pars, nullif(btrim(coalesce(p_round ->> 'note', '')), ''), me.id) returning id into rid;

  i := 0;
  for r in select * from jsonb_array_elements(p_round -> 'players') loop
    i := i + 1;
    if jsonb_typeof(r -> 'scores') <> 'array' or jsonb_array_length(r -> 'scores') <> n then raise exception 'every_hole_scored'; end if;
    begin
      sc := array(select (x #>> '{}')::smallint from jsonb_array_elements(r -> 'scores') x);
    exception when others then raise exception 'invalid_score';
    end;
    if exists (select 1 from unnest(sc) s where s is null or s < 1 or s > 20) then raise exception 'invalid_score'; end if;
    if nullif(r ->> 'member_id', '') is not null then
      if not exists (select 1 from public.tag_members where id = (r ->> 'member_id')::uuid) then raise exception 'unknown_member'; end if;
      insert into public.club_round_players (round_id, seq, member_id, scores, strokes, to_par, confirmed_at)
      values (rid, i, (r ->> 'member_id')::uuid, sc, (select sum(s) from unnest(sc) s), (select sum(s) from unnest(sc) s) - v_par,
              case when (r ->> 'member_id')::uuid = me.id then now() end);
    else
      if btrim(coalesce(r ->> 'guest_name', '')) = '' then raise exception 'name_required'; end if;
      insert into public.club_round_players (round_id, seq, guest_name, scores, strokes, to_par)
      values (rid, i, left(btrim(r ->> 'guest_name'), 40), sc, (select sum(s) from unnest(sc) s), (select sum(s) from unnest(sc) s) - v_par);
    end if;
  end loop;
  return rid;
end $$;

-- ---------- confirm / dispute ----------
/** Confirm (p_ok) or dispute a round you're on. Also confirms/disputes a waiting tag exchange made from it. */
create or replace function public.round_confirm(p_token text, p_round uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members; m record;
begin
  me := public._tag_member(p_token);
  if not exists (select 1 from public.club_rounds r join public.club_round_players p on p.round_id = r.id
                  where r.id = p_round and r.status = 'saved' and p.member_id = me.id) then
    raise exception 'not_your_round';
  end if;
  update public.club_round_players
     set confirmed_at = case when p_ok then coalesce(confirmed_at, now()) end,
         disputed_at  = case when p_ok then null else now() end
   where round_id = p_round and member_id = me.id;
  for m in select tm.id from public.tag_matches tm join public.tag_match_players tp on tp.match_id = tm.id
            where tm.round_id = p_round and tm.status = 'pending' and tp.member_id = me.id
              and tp.confirmed_at is null and tm.created_at >= now() - interval '7 days' loop
    perform public.tag_confirm(p_token, m.id, p_ok);
  end loop;
end $$;

/** Mirror a confirmation/dispute on a tag exchange back onto the round it came from. */
create or replace function public._round_sync_from_tag() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_round uuid;
begin
  select round_id into v_round from public.tag_matches where id = new.match_id;
  if v_round is null then return new; end if;
  if new.confirmed_at is not null and old.confirmed_at is null then
    update public.club_round_players set confirmed_at = coalesce(confirmed_at, new.confirmed_at), disputed_at = null
     where round_id = v_round and member_id = new.member_id;
  elsif new.disputed_at is not null and old.disputed_at is null then
    update public.club_round_players set disputed_at = new.disputed_at, confirmed_at = null
     where round_id = v_round and member_id = new.member_id;
  end if;
  return new;
end $$;
drop trigger if exists tag_match_players_round_sync on public.tag_match_players;
create trigger tag_match_players_round_sync after update of confirmed_at, disputed_at on public.tag_match_players
  for each row execute function public._round_sync_from_tag();

-- ---------- tag exchange from a round ----------
create or replace function public.round_tag_exchange(p_token text, p_round uuid, p_pool uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members; rd public.club_rounds; mid uuid; n int;
begin
  me := public._tag_member(p_token);
  select * into rd from public.club_rounds where id = p_round and status = 'saved';
  if not found or not exists (select 1 from public.club_round_players where round_id = p_round and member_id = me.id) then raise exception 'not_your_round'; end if;
  if exists (select 1 from public.club_round_players where round_id = p_round and disputed_at is not null) then raise exception 'round_disputed'; end if;
  if not exists (select 1 from public.tags where pool_id = p_pool and holder_id = me.id) then raise exception 'no_tag_in_pool'; end if;
  if rd.played_on < current_date - 14 then raise exception 'invalid_date'; end if;
  if exists (select 1 from public.tag_matches where pool_id = p_pool and round_id = p_round and status <> 'void') then raise exception 'already_exchanged'; end if;
  n := (select count(*) from public.club_round_players p join public.tags t on t.pool_id = p_pool and t.holder_id = p.member_id where p.round_id = p_round);
  if n < 2 then raise exception 'need_two_holders'; end if;
  if (select count(*) from public.tag_matches where created_by = me.id and status = 'pending' and created_at > now() - interval '7 days') >= 3 then
    raise exception 'too_many_open';
  end if;
  insert into public.tag_matches (pool_id, source, status, course, played_on, created_by, round_id)
  values (p_pool, 'casual', 'pending', left(rd.course, 80), rd.played_on, me.id, p_round) returning id into mid;
  insert into public.tag_match_players (match_id, member_id, score, confirmed_at)
  select mid, p.member_id, p.strokes, case when p.member_id = me.id then now() end
    from public.club_round_players p join public.tags t on t.pool_id = p_pool and t.holder_id = p.member_id
   where p.round_id = p_round;
  return mid;
end $$;

-- ---------- void ----------
create or replace function public._round_void(p_round uuid, p_by text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.tag_matches where round_id = p_round and status = 'applied') then raise exception 'tags_already_moved'; end if;
  update public.tag_matches set status = 'void', resolved_by = p_by || ' (round voided)' where round_id = p_round and status in ('pending', 'disputed');
  update public.club_rounds set status = 'void', voided_by = p_by where id = p_round and status = 'saved';
  if not found then raise exception 'not_found'; end if;
end $$;

create or replace function public.round_void(p_token text, p_round uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members;
begin
  me := public._tag_member(p_token);
  if not exists (select 1 from public.club_rounds where id = p_round and created_by = me.id) then raise exception 'not_your_round'; end if;
  perform public._round_void(p_round, me.name);
end $$;

create or replace function public.td_round_void(p_round uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_tag_admin() then raise exception 'forbidden'; end if;
  perform public._round_void(p_round, coalesce(public.my_email(), 'admin'));
end $$;

-- ---------- reads ----------
/** Who this link is, and the saved rounds waiting on their confirmation. */
create or replace function public.round_me(p_token text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members;
begin
  me := public._tag_member(p_token);
  update public.tag_members set last_seen_at = now() where id = me.id;
  return jsonb_build_object(
    'me', jsonb_build_object('id', me.id, 'name', me.name, 'nickname', me.nickname),
    'pools', coalesce((select jsonb_agg(jsonb_build_object('pool_id', t.pool_id, 'number', t.number)) from public.tags t where t.holder_id = me.id), '[]'),
    'to_confirm', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'course', r.course, 'played_on', r.played_on) order by r.played_on desc, r.created_at desc)
        from public.club_rounds r join public.club_round_players p on p.round_id = r.id
       where r.status = 'saved' and p.member_id = me.id and p.confirmed_at is null and p.disputed_at is null), '[]'));
end $$;

/** Tag exchanges made from these rounds: set, status, and (once applied) who moved. Pending ones show status only. */
create or replace function public.round_exchanges(p_rounds uuid[]) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'round_id', m.round_id, 'pool', po.slug, 'pool_name', po.name, 'status', m.status,
      'waiting_on', case when m.status = 'pending' then (select count(*) from public.tag_match_players p where p.match_id = m.id and p.confirmed_at is null) end,
      'moves', case when m.status = 'applied' then (select jsonb_agg(jsonb_build_object('member_id', p.member_id, 'tag_before', p.tag_before, 'tag_after', p.tag_after) order by p.tag_after)
                  from public.tag_match_players p where p.match_id = m.id) end)
    order by m.created_at), '[]')
  from public.tag_matches m join public.tag_pools po on po.id = m.pool_id
  where m.round_id = any (p_rounds) and m.status <> 'void' and cardinality(p_rounds) <= 100
$$;

-- ---------- execute grants ----------
revoke execute on function public._round_void(uuid, text), public._round_sync_from_tag() from public, anon, authenticated;
revoke execute on function public.round_save(text, jsonb), public.round_confirm(text, uuid, boolean), public.round_tag_exchange(text, uuid, uuid),
  public.round_void(text, uuid), public.td_round_void(uuid), public.round_me(text), public.round_exchanges(uuid[]) from public;
grant execute on function public.round_save(text, jsonb), public.round_confirm(text, uuid, boolean), public.round_tag_exchange(text, uuid, uuid),
  public.round_void(text, uuid), public.round_me(text), public.round_exchanges(uuid[]) to anon, authenticated;
grant execute on function public.td_round_void(uuid) to authenticated;
revoke execute on function public.td_round_void(uuid) from anon;
