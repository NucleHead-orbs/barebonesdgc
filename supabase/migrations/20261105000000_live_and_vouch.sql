-- Live rounds + TD vouch (locked 2026-10-05, Mike: "let's add that live look in, with a public view, and since I know everyone
-- on the card, I'd like to allow the tags to be on the line." Answers: live on by default (SHARE LIVE switch turns it off);
-- a "Live now" strip on the club home + Rounds page, tap for the full card, guest names as typed, gone 30 min after the last
-- score or when saved; a TD vouches a saved round to put tags on the line, players still confirm).
-- Source of truth:
--   club_live : a round in progress, pushed from the scorer's phone (the card the phone holds is still the truth until
--               SAVE; this is a public mirror). id = random id the phone made; the phone proves it's the same card with
--               a secret it keeps (stored hashed). Anyone can read; only that phone can write.
--   tag_matches.vouched_by : the TD/league admin who put a saved round's tags on the line past the rules.
-- Rules:
--   * round_live_push(id, secret, token, card): card = {course, pars[], labels[]|null, players:[{name, member_id|null,
--     scores[]}]}. 1-30 holes, 1-8 players, scores 1-20 or null. First push claims the id; later pushes need the same
--     secret. Pushes closer than 2 seconds apart are ignored. At most 60 live cards at once (site-wide). Ended cards
--     ignore pushes. Cards older than 2 days are cleaned up on any push.
--   * round_live_end(id, secret): the phone saved or threw the card away.
--   * live_rounds(): public; not ended, last push within 30 minutes. live_round(id): public; anything pushed in the last
--     12 hours (so a shared link still shows the final card).
--   * td_round_vouch(round, pool): can_tag(pool). A saved, undisputed round from the last 14 days with 2+ holders of that
--     set on it, not already exchanged in that set. Makes the tag round (pending, nobody confirmed yet); every holder on it
--     confirms on My Tag and the tags swap on the last confirmation, like any other. Skips the Early Access 3-player /
--     challenge rule and the tee-off lock (the TD vouches for the card). Raffle tickets are unchanged (3 players or a
--     settled challenge). The Board posts it.
-- =====================================================================

create table if not exists public.club_live (
  id          uuid primary key,
  secret_hash text not null,
  member_id   uuid references public.tag_members(id) on delete set null,
  course      text not null default '',
  card        jsonb not null,
  started_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  ended_at    timestamptz
);
create index if not exists club_live_updated on public.club_live (updated_at desc);
alter table public.club_live enable row level security;
revoke all on public.club_live from anon, authenticated;

/** A card is sane: holes, players, scores. Raises invalid_card. */
create or replace function public._live_check(p jsonb) returns void
language plpgsql immutable as $$
declare n int; pl jsonb;
begin
  if jsonb_typeof(p) <> 'object' or jsonb_typeof(p -> 'pars') <> 'array' or jsonb_typeof(p -> 'players') <> 'array' then raise exception 'invalid_card'; end if;
  if length(p::text) > 20000 then raise exception 'invalid_card'; end if;
  n := jsonb_array_length(p -> 'pars');
  if n not between 1 and 30 or jsonb_array_length(p -> 'players') not between 1 and 8 then raise exception 'invalid_card'; end if;
  if exists (select 1 from jsonb_array_elements(p -> 'pars') x where jsonb_typeof(x) <> 'number' or x::int not between 2 and 7) then raise exception 'invalid_card'; end if;
  for pl in select * from jsonb_array_elements(p -> 'players') loop
    if jsonb_typeof(pl -> 'scores') <> 'array' or jsonb_array_length(pl -> 'scores') > n or length(coalesce(pl ->> 'name', '')) not between 1 and 60 then raise exception 'invalid_card'; end if;
    if exists (select 1 from jsonb_array_elements(pl -> 'scores') x where jsonb_typeof(x) not in ('number', 'null') or (jsonb_typeof(x) = 'number' and x::int not between 1 and 20)) then
      raise exception 'invalid_card';
    end if;
  end loop;
end $$;

create or replace function public.round_live_push(p_id uuid, p_secret text, p_token text, p_card jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.club_live; mid uuid;
begin
  if p_id is null or length(coalesce(p_secret, '')) < 20 then raise exception 'invalid_live'; end if;
  perform public._live_check(p_card);
  if nullif(p_token, '') is not null then select id into mid from public.tag_members where token = p_token; end if;
  select * into v from public.club_live where id = p_id for update;
  if v.id is null then
    delete from public.club_live where updated_at < now() - interval '2 days';
    if (select count(*) from public.club_live where ended_at is null and updated_at > now() - interval '30 minutes') >= 60 then raise exception 'busy'; end if;
    insert into public.club_live (id, secret_hash, member_id, course, card) values (p_id, md5(p_secret), mid, left(coalesce(p_card ->> 'course', ''), 80), p_card);
    return;
  end if;
  if v.secret_hash <> md5(p_secret) then raise exception 'invalid_live'; end if;
  if v.ended_at is not null or v.updated_at > now() - interval '2 seconds' then return; end if;
  update public.club_live set card = p_card, course = left(coalesce(p_card ->> 'course', ''), 80), member_id = coalesce(mid, member_id), updated_at = now() where id = p_id;
end $$;

create or replace function public.round_live_end(p_id uuid, p_secret text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.club_live set ended_at = coalesce(ended_at, now()) where id = p_id and secret_hash = md5(coalesce(p_secret, ''));
end $$;

create or replace function public._live_json(l public.club_live) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', l.id, 'course', l.course, 'card', l.card - 'secret', 'started_at', l.started_at, 'updated_at', l.updated_at,
    'ended', l.ended_at is not null)
$$;

create or replace function public.live_rounds() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(public._live_json(l) order by l.started_at), '[]') from public.club_live l
   where l.ended_at is null and l.updated_at > now() - interval '30 minutes'
$$;

create or replace function public.live_round(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select public._live_json(l) from public.club_live l where l.id = p_id and l.updated_at > now() - interval '12 hours'
$$;

revoke execute on function public._live_check(jsonb), public._live_json(public.club_live) from public, anon, authenticated;
grant execute on function public.round_live_push(uuid, text, text, jsonb), public.round_live_end(uuid, text), public.live_rounds(), public.live_round(uuid) to anon, authenticated;

-- ---------- TD vouch ----------
alter table public.tag_matches add column if not exists vouched_by text;
alter table public.tag_chat drop constraint if exists tag_chat_kind_check;
alter table public.tag_chat add constraint tag_chat_kind_check check (
  (kind = 'chat' and event is null) or
  (kind = 'system' and member_id is null and event in ('challenge', 'accepted', 'declined', 'expired', 'played', 'lapsed', 'bomb', 'penalty', 'matchmaker',
                                                      'scheduled', 'jumpin', 'dropout', 'vouched')));

/** Early Access rule check (redefined): a TD-vouched tag round is exempt. */
create or replace function public._ea_round_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare m record;
begin
  for m in select tm.id, tm.pool_id from public.tag_matches tm join public.early_access ea on ea.pool_id = tm.pool_id
            where tm.id in (select distinct match_id from new_rows) and tm.status <> 'void' and tm.vouched_by is null loop
    if not public._ea_line_ok(m.pool_id, array(select member_id from public.tag_match_players where match_id = m.id)) then
      raise exception 'needs_challenge';
    end if;
  end loop;
  return null;
end $$;

/** Sets the signed-in admin can vouch on this saved round: 2+ holders on the card, not exchanged yet. */
create or replace function public.td_round_vouch_options(p_round uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('pool_id', po.id, 'name', po.name,
      'holders', (select jsonb_agg(jsonb_build_object('name', m.name, 'nickname', m.nickname, 'number', t.number) order by t.number)
                    from public.club_round_players p join public.tags t on t.pool_id = po.id and t.holder_id = p.member_id
                    join public.tag_members m on m.id = p.member_id where p.round_id = r.id)) order by po.sort), '[]')
    from public.club_rounds r cross join public.tag_pools po
   where r.id = p_round and r.status = 'saved' and public.can_tag(po.id)
     and (select count(*) from public.club_round_players p join public.tags t on t.pool_id = po.id and t.holder_id = p.member_id where p.round_id = r.id) >= 2
     and not exists (select 1 from public.tag_matches tm where tm.pool_id = po.id and tm.round_id = r.id and tm.status <> 'void')
$$;

create or replace function public.td_round_vouch(p_round uuid, p_pool uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare rd public.club_rounds; mid uuid; who text;
begin
  perform public._need_tag(p_pool);
  select * into rd from public.club_rounds where id = p_round and status = 'saved';
  if not found then raise exception 'not_found'; end if;
  if exists (select 1 from public.club_round_players where round_id = p_round and disputed_at is not null) then raise exception 'round_disputed'; end if;
  if rd.played_on < current_date - 14 then raise exception 'invalid_date'; end if;
  if exists (select 1 from public.tag_matches where pool_id = p_pool and round_id = p_round and status <> 'void') then raise exception 'already_exchanged'; end if;
  if (select count(*) from public.club_round_players p join public.tags t on t.pool_id = p_pool and t.holder_id = p.member_id where p.round_id = p_round) < 2 then
    raise exception 'need_two_holders';
  end if;
  insert into public.tag_matches (pool_id, source, status, course, played_on, created_by_td, round_id, vouched_by)
  values (p_pool, 'casual', 'pending', left(rd.course, 80), rd.played_on, coalesce(public.my_email(), 'admin'), p_round, coalesce(public.my_email(), 'admin'))
  returning id into mid;
  insert into public.tag_match_players (match_id, member_id, score)
  select mid, p.member_id, p.strokes from public.club_round_players p join public.tags t on t.pool_id = p_pool and t.holder_id = p.member_id
   where p.round_id = p_round;
  select string_agg(public._tag_who(p_pool, member_id), ', ' order by score) into who from public.tag_match_players where match_id = mid;
  perform public._tag_news(p_pool, 'vouched', 'The TD vouched for a round at ' || coalesce(nullif(rd.course, ''), 'the course') || ': ' || who
    || '. Tags are on the line. Everyone on it, confirm on My Tag.');
  return mid;
end $$;
revoke execute on function public.td_round_vouch_options(uuid), public.td_round_vouch(uuid, uuid) from public, anon;
grant execute on function public.td_round_vouch_options(uuid), public.td_round_vouch(uuid, uuid) to authenticated;
