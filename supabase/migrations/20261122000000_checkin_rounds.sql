-- =====================================================================
-- Check-in rounds (locked 2026-10-09, Mike: Blake's Friday glow league at Freestone wants tags on the line "over
-- multiple cards". Answers: whole-field swap; it goes up when the last card is in, or the host closes it; every tag set,
-- automatically; any tag holder can host).
--
-- Source of truth:
--   tag_nights         : one check-in round (host, title, course, start, note). closed_at = the field swap went up (or
--                        nothing to swap). cancelled_at = called off.
--   tag_night_players  : who's checked in: a member (member_id) or a guest the host added (guest_name). One row each.
--   club_rounds.night_id : a Scorecard card played on that night. Many cards per night; a member is on one card only.
--   tag_matches.night_id : the night's field swap, one per tag set (pool_id, night_id), round_id null.
-- Rules:
--   * Host: anyone holding a tag in any set. Start from 2 h ago to 30 days out, a library course, a title (glow league),
--     a note. Max 2 open nights per host. The host is checked in. The host adds/removes guests and members and can call
--     it off (no cards saved yet) or CLOSE THE NIGHT.
--   * Check-in opens 3 h before the start, for any member. Checking out: not once you're on a saved card. The host
--     can't check out.
--   * Cards: the Scorecard sends night = <id> with the round. Saving it checks every member on the card in (they played)
--     and refuses 'already_on_card' if one of them is on another saved card that night, 'night_closed' / 'night_off' /
--     'night_not_open'. No per-card tags on a night card ('night_tags_field'): the whole field swaps instead.
--   * Close: on its own once every checked-in member is on a saved card (checked at each card save), when the host
--     closes it, or 12 h after the start (tag_night_tick, pg_cron every 15 min). Closing builds one pending swap per tag
--     set with 2+ holders among the members on saved cards: score = strokes on their card, a DNF is last, ties keep their
--     order. Early Access only goes up when the field meets its rules (3+ Jewel players), otherwise that set sits out.
--     Each player's tag row starts confirmed if they've confirmed their card; confirming the card (MY ROUNDS) confirms
--     the night's swaps too; the last OK swaps (same 7-day window). A disputed card disputes the set's swap for its admin.
--   * Board: the night is announced in every set the host holds a tag in (with the Board on); closing posts per set.
--   * No TD override from a My Tag link (TDs have no token role); the 12 h auto-close is the backstop.
-- =====================================================================

create or replace function pg_temp.patch(p_fn regprocedure, p_pairs text[]) returns void language plpgsql as $$
declare d text := pg_get_functiondef(p_fn); i int;
begin
  for i in 1 .. cardinality(p_pairs) / 2 loop
    if position(p_pairs[2 * i - 1] in d) = 0 then raise exception 'patch_failed: % (%)', p_fn, p_pairs[2 * i - 1]; end if;
    d := replace(d, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute d;
end $$;

create table if not exists public.tag_nights (
  id           uuid primary key default gen_random_uuid(),
  host_id      uuid not null references public.tag_members (id) on delete cascade,
  title        text not null check (length(btrim(title)) between 1 and 60),
  course_id    uuid references public.courses (id) on delete set null,
  starts_at    timestamptz not null,
  note         text check (note is null or length(note) <= 200),
  created_at   timestamptz not null default now(),
  closed_at    timestamptz,
  cancelled_at timestamptz
);
create index if not exists tag_nights_start on public.tag_nights (starts_at);
alter table public.tag_nights enable row level security;
revoke all on public.tag_nights from anon, authenticated;

create table if not exists public.tag_night_players (
  night_id      uuid not null references public.tag_nights (id) on delete cascade,
  seq           bigint generated always as identity,
  member_id     uuid references public.tag_members (id) on delete cascade,
  guest_name    text check (guest_name is null or length(btrim(guest_name)) between 1 and 40),
  added_by      uuid references public.tag_members (id) on delete set null,
  checked_in_at timestamptz not null default now(),
  primary key (night_id, seq),
  check (num_nonnulls(member_id, guest_name) = 1)
);
create unique index if not exists tag_night_players_member on public.tag_night_players (night_id, member_id) where member_id is not null;
create unique index if not exists tag_night_players_guest on public.tag_night_players (night_id, lower(btrim(guest_name))) where guest_name is not null;
alter table public.tag_night_players enable row level security;
revoke all on public.tag_night_players from anon, authenticated;

alter table public.club_rounds add column if not exists night_id uuid references public.tag_nights (id) on delete set null;
create index if not exists club_rounds_night on public.club_rounds (night_id) where night_id is not null;
alter table public.tag_matches add column if not exists night_id uuid references public.tag_nights (id) on delete set null;
create unique index if not exists tag_matches_night_once on public.tag_matches (pool_id, night_id) where night_id is not null and status <> 'void';

-- ---------- helpers ----------
/** Members on a saved card of the night, with their card. */
create or replace function public._tag_night_carded(p_night uuid)
returns table (member_id uuid, round_id uuid, strokes int, dnf boolean, confirmed_at timestamptz, disputed_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.member_id, r.id, p.strokes, p.dnf_after is not null, p.confirmed_at, p.disputed_at
    from public.club_rounds r join public.club_round_players p on p.round_id = r.id
   where r.night_id = p_night and r.status = 'saved' and p.member_id is not null
$$;

create or replace function public._tag_night_host(p_token text, p_night uuid) returns public.tag_nights
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members; n public.tag_nights;
begin
  me := public._tag_member(p_token);
  select * into n from public.tag_nights where id = p_night for update;
  if not found then raise exception 'not_found'; end if;
  if n.host_id <> me.id then raise exception 'not_your_night'; end if;
  if n.cancelled_at is not null then raise exception 'night_off'; end if;
  return n;
end $$;

/** Close the night: one pending field swap per tag set. Safe to call twice (no-op once closed). */
create or replace function public._tag_night_close(p_night uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n public.tag_nights; po record; mid uuid; made int := 0; ids uuid[]; v_day date; v_course text; cards int; players int;
begin
  select * into n from public.tag_nights where id = p_night for update;
  if not found or n.closed_at is not null or n.cancelled_at is not null then return 0; end if;
  update public.tag_nights set closed_at = now() where id = p_night;
  select count(distinct round_id), count(*) into cards, players from public._tag_night_carded(p_night);
  if players < 2 then return 0; end if;
  select min(r.played_on) into v_day from public.club_rounds r where r.night_id = p_night and r.status = 'saved';
  v_course := coalesce((select name from public.courses where id = n.course_id),
                       (select r.course from public.club_rounds r where r.night_id = p_night and r.status = 'saved' limit 1));
  for po in select t.pool_id, array_agg(c.member_id) ids from public._tag_night_carded(p_night) c
              join public.tags t on t.holder_id = c.member_id
             group by t.pool_id having count(*) >= 2 loop
    if not public._ea_line_ok(po.pool_id, po.ids) then continue; end if;
    insert into public.tag_matches (pool_id, source, status, course, played_on, created_by, night_id)
    values (po.pool_id, 'casual', 'pending', left(v_course, 80), coalesce(v_day, current_date), n.host_id, p_night) returning id into mid;
    insert into public.tag_match_players (match_id, member_id, score, confirmed_at, disputed_at)
    select mid, c.member_id, c.strokes, c.confirmed_at, c.disputed_at from public._tag_night_carded(p_night) c where c.member_id = any (po.ids);
    perform public._tag_news(po.pool_id, 'result', btrim(n.title) || ' is in: ' || players || ' players on ' || cards || ' card' || case when cards = 1 then '' else 's' end
      || '. The whole field swaps ' || (select name from public.tag_pools where id = po.pool_id) || ' tags once everyone confirms their card (My Tag > MY ROUNDS).');
    if exists (select 1 from public.tag_match_players where match_id = mid and disputed_at is not null) then
      update public.tag_matches set status = 'disputed' where id = mid;
    elsif not exists (select 1 from public.tag_match_players where match_id = mid and confirmed_at is null) then
      perform public._tag_apply(mid);
    end if;
    made := made + 1;
  end loop;
  return made;
end $$;

-- ---------- host + players ----------
create or replace function public.tag_night_create(p_token text, p_title text, p_start timestamptz, p_course uuid, p_note text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members; v_id uuid; v_title text := btrim(coalesce(p_title, '')); v_note text := nullif(btrim(coalesce(p_note, '')), ''); po record;
begin
  me := public._tag_member(p_token);
  if not exists (select 1 from public.tags where holder_id = me.id) then raise exception 'no_tag'; end if;
  if length(v_title) not between 1 and 60 then raise exception 'title_required'; end if;
  if p_start is null or p_start < now() - interval '2 hours' then raise exception 'slot_too_soon'; end if;
  if p_start > now() + interval '30 days' then raise exception 'slot_too_far'; end if;
  if p_course is null or not exists (select 1 from public.courses where id = p_course) then raise exception 'unknown_course'; end if;
  if length(coalesce(v_note, '')) > 200 then raise exception 'note_too_long'; end if;
  if (select count(*) from public.tag_nights where host_id = me.id and closed_at is null and cancelled_at is null) >= 2 then raise exception 'too_many_nights'; end if;
  insert into public.tag_nights (host_id, title, course_id, starts_at, note) values (me.id, v_title, p_course, p_start, v_note) returning id into v_id;
  insert into public.tag_night_players (night_id, member_id, added_by) values (v_id, me.id, me.id);
  for po in select distinct t.pool_id from public.tags t where t.holder_id = me.id loop
    perform public._tag_news(po.pool_id, 'invite', public._tag_who(po.pool_id, me.id) || ' is running ' || v_title || ', ' || public._tag_slot_text(p_start, p_course)
      || '. Every tag set is on the line across the whole field. Check in on My Tag > MATCHUPS when you get there.' || coalesce(' "' || v_note || '"', ''));
  end loop;
  return v_id;
end $$;

create or replace function public.tag_night_checkin(p_token text, p_night uuid, p_in boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members; n public.tag_nights;
begin
  me := public._tag_member(p_token);
  select * into n from public.tag_nights where id = p_night for update;
  if not found or n.cancelled_at is not null then raise exception 'night_off'; end if;
  if n.closed_at is not null then raise exception 'night_closed'; end if;
  if p_in then
    if now() < n.starts_at - interval '3 hours' then raise exception 'night_not_open'; end if;
    insert into public.tag_night_players (night_id, member_id, added_by) values (p_night, me.id, me.id) on conflict do nothing;
  else
    if n.host_id = me.id then raise exception 'host_stays'; end if;
    if exists (select 1 from public._tag_night_carded(p_night) c where c.member_id = me.id) then raise exception 'already_on_card'; end if;
    delete from public.tag_night_players where night_id = p_night and member_id = me.id;
  end if;
end $$;

/** Host: check in a member, or add a guest (exactly one of the two). */
create or replace function public.tag_night_add(p_token text, p_night uuid, p_member uuid, p_guest text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare n public.tag_nights; g text := nullif(btrim(coalesce(p_guest, '')), '');
begin
  n := public._tag_night_host(p_token, p_night);
  if n.closed_at is not null then raise exception 'night_closed'; end if;
  if (p_member is null) = (g is null) then raise exception 'invalid_player'; end if;
  if (select count(*) from public.tag_night_players where night_id = p_night) >= 120 then raise exception 'night_full'; end if;
  if p_member is not null then
    if not exists (select 1 from public.tag_members where id = p_member) then raise exception 'unknown_member'; end if;
    insert into public.tag_night_players (night_id, member_id, added_by) values (p_night, p_member, n.host_id) on conflict do nothing;
  else
    if length(g) > 40 then raise exception 'name_too_long'; end if;
    if exists (select 1 from public.tag_night_players where night_id = p_night and lower(btrim(guest_name)) = lower(g)) then raise exception 'guest_taken'; end if;
    insert into public.tag_night_players (night_id, guest_name, added_by) values (p_night, g, n.host_id);
  end if;
end $$;

create or replace function public.tag_night_remove(p_token text, p_night uuid, p_member uuid, p_guest text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare n public.tag_nights;
begin
  n := public._tag_night_host(p_token, p_night);
  if n.closed_at is not null then raise exception 'night_closed'; end if;
  if p_member is not null then
    if p_member = n.host_id then raise exception 'host_stays'; end if;
    if exists (select 1 from public._tag_night_carded(p_night) c where c.member_id = p_member) then raise exception 'already_on_card'; end if;
    delete from public.tag_night_players where night_id = p_night and member_id = p_member;
  else
    delete from public.tag_night_players where night_id = p_night and lower(btrim(guest_name)) = lower(btrim(coalesce(p_guest, '')));
  end if;
end $$;

create or replace function public.tag_night_close(p_token text, p_night uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n public.tag_nights;
begin
  n := public._tag_night_host(p_token, p_night);
  if n.closed_at is not null then raise exception 'night_closed'; end if;
  if not exists (select 1 from public.club_rounds where night_id = p_night and status = 'saved') then raise exception 'no_cards_yet'; end if;
  return public._tag_night_close(p_night);
end $$;

create or replace function public.tag_night_cancel(p_token text, p_night uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare n public.tag_nights; po record;
begin
  n := public._tag_night_host(p_token, p_night);
  if n.closed_at is not null then raise exception 'night_closed'; end if;
  if exists (select 1 from public.club_rounds where night_id = p_night and status = 'saved') then raise exception 'cards_saved'; end if;
  update public.tag_nights set cancelled_at = now() where id = p_night;
  for po in select distinct t.pool_id from public.tags t where t.holder_id = n.host_id loop
    perform public._tag_news(po.pool_id, 'invite', btrim(n.title) || ' (' || public._tag_slot_text(n.starts_at, n.course_id) || ') is called off.');
  end loop;
end $$;

/** Every open night (and ones closed in the last 12 h), for anyone with a My Tag link. */
create or replace function public.tag_nights(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me public.tag_members;
begin
  me := public._tag_member(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', n.id, 'title', n.title, 'starts_at', n.starts_at, 'course_id', n.course_id,
      'course', (select name from public.courses where id = n.course_id), 'note', n.note,
      'host', (select jsonb_build_object('id', m.id, 'name', m.name, 'nickname', m.nickname) from public.tag_members m where m.id = n.host_id),
      'host_me', n.host_id = me.id, 'closed', n.closed_at is not null, 'closed_at', n.closed_at,
      'open', n.closed_at is null and now() >= n.starts_at - interval '3 hours',
      'me_in', exists (select 1 from public.tag_night_players x where x.night_id = n.id and x.member_id = me.id),
      'cards', (select count(*) from public.club_rounds r where r.night_id = n.id and r.status = 'saved'),
      'my_card', (select c.round_id from public._tag_night_carded(n.id) c where c.member_id = me.id limit 1),
      'players', coalesce((select jsonb_agg(jsonb_build_object('id', x.member_id, 'name', coalesce(m.name, x.guest_name), 'nickname', m.nickname,
                   'guest', x.member_id is null,
                   'carded', case when x.member_id is not null then exists (select 1 from public._tag_night_carded(n.id) c where c.member_id = x.member_id)
                                  else exists (select 1 from public.club_rounds r join public.club_round_players p on p.round_id = r.id
                                                where r.night_id = n.id and r.status = 'saved' and lower(btrim(p.guest_name)) = lower(btrim(x.guest_name))) end)
                   order by x.seq)
                 from public.tag_night_players x left join public.tag_members m on m.id = x.member_id where x.night_id = n.id), '[]'),
      'swaps', coalesce((select jsonb_agg(jsonb_build_object('pool_name', po.name, 'status', tm.status) order by po.sort, po.name)
                 from public.tag_matches tm join public.tag_pools po on po.id = tm.pool_id where tm.night_id = n.id and tm.status <> 'void'), '[]')
    ) order by n.starts_at)
    from public.tag_nights n
   where n.cancelled_at is null and n.starts_at < now() + interval '30 days'
     and ((n.closed_at is null and n.starts_at > now() - interval '12 hours') or n.closed_at > now() - interval '12 hours')), '[]');
end $$;

/** pg_cron: close nights 12 h after their start. */
create or replace function public.tag_night_tick() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n record; k int := 0;
begin
  for n in select id from public.tag_nights where closed_at is null and cancelled_at is null and starts_at < now() - interval '12 hours' loop
    perform public._tag_night_close(n.id);
    k := k + 1;
  end loop;
  return k;
end $$;

-- ---------- the Scorecard: a card on the night ----------
/** Called by round_save after the card is written: ties it to the night, checks its members in, closes when all are carded. */
create or replace function public._tag_night_card(p_round uuid, p_night uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare n public.tag_nights; dup text;
begin
  select * into n from public.tag_nights where id = p_night for update;
  if not found or n.cancelled_at is not null then raise exception 'night_off'; end if;
  if n.closed_at is not null then raise exception 'night_closed'; end if;
  if now() < n.starts_at - interval '3 hours' then raise exception 'night_not_open'; end if;
  select coalesce(nullif(btrim(m.nickname), ''), m.name) into dup
    from public.club_round_players p join public.tag_members m on m.id = p.member_id
   where p.round_id = p_round and exists (select 1 from public._tag_night_carded(p_night) c where c.member_id = p.member_id) limit 1;
  if dup is not null then raise exception 'already_on_card:%', dup; end if;
  update public.club_rounds set night_id = p_night where id = p_round;
  insert into public.tag_night_players (night_id, member_id, added_by)
  select p_night, p.member_id, (select created_by from public.club_rounds where id = p_round)
    from public.club_round_players p where p.round_id = p_round and p.member_id is not null
  on conflict do nothing;
  if not exists (select 1 from public.tag_night_players x where x.night_id = p_night and x.member_id is not null
                  and not exists (select 1 from public._tag_night_carded(p_night) c where c.member_id = x.member_id)) then
    perform public._tag_night_close(p_night);
  end if;
end $$;

select pg_temp.patch('public.round_save(text,jsonb)', array[
  'v_dnf int; v_old uuid;', 'v_dnf int; v_old uuid; v_night uuid;',
  '  if v_src is not null then
    if v_src !~',
  '  if nullif(p_round ->> ''night'', '''') is not null then
    begin v_night := (p_round ->> ''night'')::uuid; exception when others then raise exception ''invalid_round''; end;
  end if;
  if v_src is not null then
    if v_src !~',
  '  end loop;
  return rid;',
  '  end loop;
  if v_night is not null then perform public._tag_night_card(rid, v_night); end if;
  return rid;']);

select pg_temp.patch('public.round_save_swap(text,jsonb,uuid[])', array[
  '  rid := public.round_save(p_token, p_round);',
  '  if nullif(p_round ->> ''night'', '''') is not null and cardinality(coalesce(p_pools, ''{}'')) > 0 then raise exception ''night_tags_field''; end if;
  rid := public.round_save(p_token, p_round);']);

-- confirming your card confirms the night's field swaps too
select pg_temp.patch('public.round_confirm(text,uuid,boolean)', array[
  'where tm.round_id = p_round and tm.status = ''pending''',
  'where (tm.round_id = p_round or tm.night_id = (select night_id from public.club_rounds where id = p_round)) and tm.status = ''pending''']);

-- My Tag: a night swap confirms on your card (MY ROUNDS), so hand the client that card
select pg_temp.patch('public._tag_match_json(uuid,uuid)', array[
  '''round_id'', m.round_id,',
  '''round_id'', coalesce(m.round_id, (select c.round_id from public._tag_night_carded(m.night_id) c where c.member_id = p_me limit 1)), ''night_id'', m.night_id,']);

-- night cards already ping from the card; don't ping twice
select pg_temp.patch('public._tag_push_confirm_tag()', array[
  'or m.round_id is not null or', 'or m.round_id is not null or m.night_id is not null or']);

-- the result post names the night
select pg_temp.patch('public._tag_challenge_played()', array[
  '''Tag round'' || coalesce(', 'coalesce((select btrim(n.title) from public.tag_nights n where n.id = new.night_id), ''Tag round'') || coalesce(']);

-- DNF follows the player's card on a night swap too
create or replace function public._tag_match_player_dnf() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select coalesce(bool_or(p.dnf_after is not null), false) into new.dnf
    from public.tag_matches m
    join public.club_rounds r on r.id = m.round_id or (m.night_id is not null and r.night_id = m.night_id and r.status = 'saved')
    join public.club_round_players p on p.round_id = r.id and p.member_id = new.member_id
   where m.id = new.match_id;
  new.dnf := coalesce(new.dnf, false);
  return new;
end $$;

revoke all on function public._tag_night_carded(uuid), public._tag_night_host(text, uuid), public._tag_night_close(uuid),
  public._tag_night_card(uuid, uuid), public.tag_night_tick() from public, anon, authenticated;
grant execute on function public.tag_night_create(text, text, timestamptz, uuid, text), public.tag_night_checkin(text, uuid, boolean),
  public.tag_night_add(text, uuid, uuid, text), public.tag_night_remove(text, uuid, uuid, text), public.tag_night_close(text, uuid),
  public.tag_night_cancel(text, uuid), public.tag_nights(text) to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'tag-nights';
    perform cron.schedule('tag-nights', '*/15 * * * *', 'select public.tag_night_tick()');
  end if;
end $$;
