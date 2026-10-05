-- Tag heat: time bombs, challenges, group chat (locked 2026-10-04, Mike: "put activity time bombs on the top 5 tags. If they
-- are inactive for 1 week, their tag explodes, moving them to the bottom and shifting everyone else up. ... a group chat and a
-- challenge a player function. A player may decline 3 challenges, on the 4th - their rank drops 5 places.")
-- Answers: TD switches per tag set; active = a confirmed tag round; challenge up to 5 spots above, accept/decline, play in
-- 7 days, 48 h silence = decline, 1 open challenge each, no re-challenging the same person within 7 days; every 4th decline
-- drops 5 places and the count starts over.
-- Source of truth:
--   tag_pools.bombs / challenges / chat : the TD's switches per set. bombs_since = when bombs were switched on (the clock floor).
--   A top-5 holder's fuse = 7 days from the latest of: a tag round they played that applied, a tag round they confirmed,
--   being issued their tag, entering the top 5 (tag_fuse.top_since), bombs_since. Moving up because someone above
--   exploded doesn't reset an existing fuse; moving INTO the top 5 starts a fresh one. Computed, never stored (_tag_active_at).
--   tag_fuse       : who is in the top 5 of a bombs-on set and since when (kept in sync by tag_tick).
--   tag_challenges : challenger -> challenged in one set. open -> accepted | declined | expired | cancelled;
--                    accepted -> played (a tag round with both of them applied) | lapsed (7 days, no round, no penalty).
--   tag_drops      : every bomb and decline penalty (who, from #, to #, when). Public feed. The latest decline-drop
--                    resets that player's decline count.
--   tag_chat       : one group chat per set. Members holding a tag in the set read and post from My Tag; TDs can hide.
-- Rules:
--   * Bomb: a top-5 holder (by tag number among held tags) inactive for 7 days explodes: they take the last held tag and
--     everyone below them moves up one. Checked by tag_tick() every 15 minutes (pg_cron).
--   * Decline penalty: declines (incl. 48 h silence) since your last decline-drop; the 4th drops you 5 places
--     (or to the bottom if fewer), the players in between move up one.
--   * Drops write the tag ledger (kind bomb / penalty) like any other move.
--   * Every write is a function; the new tables have no client grants. Safe to re-run.
-- =====================================================================

alter table public.tag_pools add column if not exists bombs boolean not null default false;
alter table public.tag_pools add column if not exists challenges boolean not null default false;
alter table public.tag_pools add column if not exists chat boolean not null default false;
alter table public.tag_pools add column if not exists bombs_since timestamptz;

alter table public.tag_history drop constraint if exists tag_history_kind_check;
alter table public.tag_history add constraint tag_history_kind_check check (kind in ('issued', 'moved', 'released', 'retired', 'undo', 'bomb', 'penalty'));

create table if not exists public.tag_challenges (
  id            uuid primary key default gen_random_uuid(),
  pool_id       uuid not null references public.tag_pools(id) on delete cascade,
  challenger_id uuid not null references public.tag_members(id) on delete cascade,
  challenged_id uuid not null references public.tag_members(id) on delete cascade,
  status        text not null default 'open' check (status in ('open', 'accepted', 'declined', 'expired', 'cancelled', 'played', 'lapsed')),
  from_number   integer, -- challenger's tag when sent
  to_number     integer, -- challenged's tag when sent
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '48 hours',
  responded_at  timestamptz,
  due_at        timestamptz,
  match_id      uuid references public.tag_matches(id) on delete set null,
  check (challenger_id <> challenged_id)
);
create index if not exists tag_challenges_pool on public.tag_challenges (pool_id, status);
create index if not exists tag_challenges_challenged on public.tag_challenges (challenged_id, pool_id, status);

create table if not exists public.tag_fuse (
  pool_id   uuid not null references public.tag_pools(id) on delete cascade,
  member_id uuid not null references public.tag_members(id) on delete cascade,
  top_since timestamptz not null default now(),
  primary key (pool_id, member_id)
);

create table if not exists public.tag_drops (
  id          bigint generated always as identity primary key,
  pool_id     uuid not null references public.tag_pools(id) on delete cascade,
  member_id   uuid references public.tag_members(id) on delete set null,
  kind        text not null check (kind in ('bomb', 'decline')),
  from_number integer not null,
  to_number   integer not null,
  at          timestamptz not null default now()
);
create index if not exists tag_drops_pool on public.tag_drops (pool_id, at desc);

create table if not exists public.tag_chat (
  id        bigint generated always as identity primary key,
  pool_id   uuid not null references public.tag_pools(id) on delete cascade,
  member_id uuid references public.tag_members(id) on delete set null,
  body      text not null check (length(btrim(body)) between 1 and 500),
  at        timestamptz not null default now(),
  hidden    boolean not null default false,
  hidden_by text
);
create index if not exists tag_chat_pool on public.tag_chat (pool_id, id desc);

alter table public.tag_challenges enable row level security;
alter table public.tag_drops enable row level security;
alter table public.tag_chat enable row level security;
alter table public.tag_fuse enable row level security;
revoke all on public.tag_challenges, public.tag_drops, public.tag_chat, public.tag_fuse from anon, authenticated;

-- ---------- helpers ----------
/** When this holder's fuse was last reset (see header). A top-5 holder not synced into tag_fuse yet counts as entering now. */
create or replace function public._tag_active_at(p_pool uuid, p_member uuid) returns timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  select greatest(
    (select max(m.applied_at) from public.tag_matches m join public.tag_match_players p on p.match_id = m.id
      where m.pool_id = p_pool and m.status = 'applied' and p.member_id = p_member),
    (select max(p.confirmed_at) from public.tag_matches m join public.tag_match_players p on p.match_id = m.id
      where m.pool_id = p_pool and m.status in ('pending', 'applied') and p.member_id = p_member),
    (select max(h.at) from public.tag_history h where h.pool_id = p_pool and h.member_id = p_member and h.kind = 'issued'),
    coalesce((select f.top_since from public.tag_fuse f where f.pool_id = p_pool and f.member_id = p_member), now()),
    (select bombs_since from public.tag_pools where id = p_pool))
$$;

/** Keep tag_fuse = the current top 5 of a set (new entrants start now). */
create or replace function public._tag_fuse_sync(p_pool uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.tag_fuse f where f.pool_id = p_pool and f.member_id not in
    (select holder_id from public.tags where pool_id = p_pool and status = 'held' order by number limit 5);
  insert into public.tag_fuse (pool_id, member_id)
  select p_pool, holder_id from (select holder_id from public.tags where pool_id = p_pool and status = 'held' order by number limit 5) t
  on conflict do nothing;
end $$;

/**
 * Move a holder down: p_places spots (null = to the bottom). Everyone they pass moves up one. Writes the ledger + tag_drops.
 * Returns the new number (or the old one if nothing moved).
 */
create or replace function public._tag_drop(p_pool uuid, p_member uuid, p_places int, p_kind text) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare nums int[]; holders uuid[]; i int; j int; k int; n int;
begin
  perform 1 from public.tags where pool_id = p_pool for update;
  select array_agg(number order by number), array_agg(holder_id order by number) into nums, holders
    from public.tags where pool_id = p_pool and status = 'held';
  n := coalesce(array_length(nums, 1), 0);
  i := array_position(holders, p_member);
  if i is null then raise exception 'no_tag_in_pool'; end if;
  j := case when p_places is null then n else least(i + p_places, n) end;
  if j <= i then return nums[i]; end if;
  for k in i .. j - 1 loop
    update public.tags set holder_id = holders[k + 1], moved_at = now(), moves = moves + 1 where pool_id = p_pool and number = nums[k];
    insert into public.tag_history (pool_id, number, kind, member_id, prev_id)
    values (p_pool, nums[k], case when p_kind = 'bomb' then 'bomb' else 'penalty' end, holders[k + 1], holders[k]);
  end loop;
  update public.tags set holder_id = p_member, moved_at = now(), moves = moves + 1 where pool_id = p_pool and number = nums[j];
  insert into public.tag_history (pool_id, number, kind, member_id, prev_id)
  values (p_pool, nums[j], case when p_kind = 'bomb' then 'bomb' else 'penalty' end, p_member, holders[j]);
  insert into public.tag_drops (pool_id, member_id, kind, from_number, to_number) values (p_pool, p_member, p_kind, nums[i], nums[j]);
  return nums[j];
end $$;

/** Declines (incl. silence) since this player's last decline-drop in this set. */
create or replace function public._tag_declines(p_pool uuid, p_member uuid) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from public.tag_challenges c
   where c.pool_id = p_pool and c.challenged_id = p_member and c.status in ('declined', 'expired')
     and c.responded_at > coalesce((select max(d.at) from public.tag_drops d where d.pool_id = p_pool and d.member_id = p_member and d.kind = 'decline'), '-infinity')
$$;

/** After a decline: the 4th since the last drop costs 5 places. */
create or replace function public._tag_strike(p_pool uuid, p_member uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public._tag_declines(p_pool, p_member) >= 4 and exists (select 1 from public.tags where pool_id = p_pool and holder_id = p_member) then
    perform public._tag_drop(p_pool, p_member, 5, 'decline');
  end if;
end $$;

/** The clock: expire silent challenges, lapse unplayed ones, explode idle top-5 tags. Run by pg_cron every 15 minutes. */
create or replace function public.tag_tick() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c record; p record; t record; booms int := 0; expired int := 0; lapsed int := 0; again boolean; blown uuid[];
begin
  for c in select * from public.tag_challenges where status = 'open' and expires_at <= now() order by created_at for update skip locked loop
    update public.tag_challenges set status = 'expired', responded_at = c.expires_at where id = c.id;
    perform public._tag_strike(c.pool_id, c.challenged_id);
    expired := expired + 1;
  end loop;
  update public.tag_challenges set status = 'lapsed' where status = 'accepted' and due_at <= now();
  get diagnostics lapsed = row_count;
  for p in select * from public.tag_pools where bombs loop
    blown := '{}';
    loop
      perform public._tag_fuse_sync(p.id);
      again := false;
      for t in select number, holder_id from public.tags where pool_id = p.id and status = 'held' order by number limit 5 loop
        if not t.holder_id = any(blown) and public._tag_active_at(p.id, t.holder_id) <= now() - interval '7 days' then
          perform public._tag_drop(p.id, t.holder_id, null, 'bomb');
          blown := blown || t.holder_id;
          booms := booms + 1; again := true;
          exit;  -- the top 5 just changed: sync and look again (each holder explodes at most once per tick)
        end if;
      end loop;
      exit when not again;
    end loop;
  end loop;
  delete from public.tag_fuse f using public.tag_pools po where po.id = f.pool_id and not po.bombs;
  return jsonb_build_object('booms', booms, 'expired', expired, 'lapsed', lapsed);
end $$;

-- a tag round with both players applied settles their accepted challenge
create or replace function public._tag_challenge_played() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'applied' and old.status is distinct from 'applied' then
    update public.tag_challenges c set status = 'played', match_id = new.id
     where c.pool_id = new.pool_id and c.status = 'accepted'
       and exists (select 1 from public.tag_match_players p where p.match_id = new.id and p.member_id = c.challenger_id)
       and exists (select 1 from public.tag_match_players p where p.match_id = new.id and p.member_id = c.challenged_id);
  end if;
  return new;
end $$;
drop trigger if exists tag_matches_challenge on public.tag_matches;
create trigger tag_matches_challenge after update of status on public.tag_matches for each row execute function public._tag_challenge_played();

-- ---------- My Tag ----------
/** Everything heat-related for this player, per set they hold a tag in. */
create or replace function public.tag_heat(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me public.tag_members;
begin
  me := public._tag_member(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'pool_id', po.id, 'pool', po.slug, 'bombs', po.bombs, 'challenges', po.challenges, 'chat', po.chat,
      'number', t.number,
      'top5', (select count(*) from public.tags x where x.pool_id = po.id and x.status = 'held' and x.number < t.number) < 5,
      'fuse_at', case when po.bombs then public._tag_active_at(po.id, me.id) + interval '7 days' end,
      'declines', public._tag_declines(po.id, me.id),
      'targets', case when po.challenges then coalesce((select jsonb_agg(jsonb_build_object('member_id', x.id, 'name', x.name, 'nickname', x.nickname, 'number', h.number) order by h.number)
                   from (select number, holder_id, row_number() over (order by number desc) rn from public.tags
                          where pool_id = po.id and status = 'held' and number < t.number) h
                   join public.tag_members x on x.id = h.holder_id where h.rn <= 5), '[]') else '[]' end,
      'list', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'status', c.status, 'mine', c.challenger_id = me.id,
                     'other', (select jsonb_build_object('id', o.id, 'name', o.name, 'nickname', o.nickname,
                                 'number', (select number from public.tags where pool_id = po.id and holder_id = o.id))
                               from public.tag_members o where o.id = case when c.challenger_id = me.id then c.challenged_id else c.challenger_id end),
                     'created_at', c.created_at, 'expires_at', c.expires_at, 'due_at', c.due_at, 'responded_at', c.responded_at) order by c.created_at desc)
                   from public.tag_challenges c
                  where c.pool_id = po.id and (c.challenger_id = me.id or c.challenged_id = me.id)
                    and (c.status in ('open', 'accepted') or c.created_at > now() - interval '14 days')), '[]'),
      'last_chat', (select max(id) from public.tag_chat where pool_id = po.id and not hidden)
    ) order by po.sort)
    from public.tags t join public.tag_pools po on po.id = t.pool_id where t.holder_id = me.id), '[]');
end $$;

/** Challenge someone up to 5 spots above you. Returns the challenge id. */
create or replace function public.tag_challenge(p_token text, p_pool uuid, p_target uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members; po public.tag_pools; mine int; theirs int; v_id uuid;
begin
  me := public._tag_member(p_token);
  select * into po from public.tag_pools where id = p_pool;
  if po.id is null or not po.challenges then raise exception 'challenges_off'; end if;
  perform 1 from public.tags where pool_id = p_pool for update;
  select number into mine from public.tags where pool_id = p_pool and holder_id = me.id;
  select number into theirs from public.tags where pool_id = p_pool and holder_id = p_target;
  if mine is null then raise exception 'no_tag_in_pool'; end if;
  if theirs is null or p_target = me.id then raise exception 'invalid_target'; end if;
  if theirs > mine or (select count(*) from public.tags where pool_id = p_pool and status = 'held' and number >= theirs and number < mine) > 5 then
    raise exception 'out_of_range';
  end if;
  if exists (select 1 from public.tag_challenges where pool_id = p_pool and challenger_id = me.id and status in ('open', 'accepted')) then
    raise exception 'one_at_a_time';
  end if;
  if exists (select 1 from public.tag_challenges where pool_id = p_pool and challenger_id = me.id and challenged_id = p_target
              and created_at > now() - interval '7 days') then
    raise exception 'too_soon';
  end if;
  insert into public.tag_challenges (pool_id, challenger_id, challenged_id, from_number, to_number)
  values (p_pool, me.id, p_target, mine, theirs) returning tag_challenges.id into v_id;
  return v_id;
end $$;

/** Accept or decline a challenge sent to you. Declining counts toward the 4th-decline drop. Returns the new status. */
create or replace function public.tag_challenge_respond(p_token text, p_challenge uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members; c public.tag_challenges;
begin
  me := public._tag_member(p_token);
  select * into c from public.tag_challenges where id = p_challenge for update;
  if c.id is null or c.challenged_id <> me.id then raise exception 'not_your_challenge'; end if;
  if c.status <> 'open' then raise exception 'challenge_%', c.status; end if;
  if c.expires_at <= now() then
    update public.tag_challenges set status = 'expired', responded_at = c.expires_at where id = c.id;
    perform public._tag_strike(c.pool_id, me.id);
    return 'expired';
  end if;
  if p_accept then
    update public.tag_challenges set status = 'accepted', responded_at = now(), due_at = now() + interval '7 days' where id = c.id;
    return 'accepted';
  end if;
  update public.tag_challenges set status = 'declined', responded_at = now() where id = c.id;
  perform public._tag_strike(c.pool_id, me.id);
  return 'declined';
end $$;

/** The challenger takes back a challenge nobody has answered. */
create or replace function public.tag_challenge_cancel(p_token text, p_challenge uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members;
begin
  me := public._tag_member(p_token);
  update public.tag_challenges set status = 'cancelled', responded_at = now() where id = p_challenge and challenger_id = me.id and status = 'open';
  if not found then raise exception 'cannot_cancel'; end if;
end $$;

-- ---------- chat ----------
create or replace function public._tag_chat_rows(p_pool uuid, p_after bigint, p_all boolean) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(r order by (r->>'id')::bigint), '[]'::jsonb) from (
    select jsonb_build_object('id', c.id, 'member_id', c.member_id, 'name', m.name, 'nickname', m.nickname, 'body', c.body, 'at', c.at,
             'number', (select number from public.tags where pool_id = c.pool_id and holder_id = c.member_id), 'hidden', c.hidden) r
      from public.tag_chat c left join public.tag_members m on m.id = c.member_id
     where c.pool_id = p_pool and c.id > coalesce(p_after, 0) and (p_all or not c.hidden)
     order by c.id desc limit 150) z
$$;

/** The set's chat, newer than p_after (0 = the latest 150). Members of the set only. */
create or replace function public.tag_chat_read(p_token text, p_pool uuid, p_after bigint) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me public.tag_members;
begin
  me := public._tag_member(p_token);
  if not exists (select 1 from public.tags where pool_id = p_pool and holder_id = me.id) then raise exception 'no_tag_in_pool'; end if;
  if not (select chat from public.tag_pools where id = p_pool) then raise exception 'chat_off'; end if;
  return public._tag_chat_rows(p_pool, p_after, false);
end $$;

create or replace function public.tag_chat_post(p_token text, p_pool uuid, p_body text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members; b text := btrim(coalesce(p_body, '')); v_id bigint;
begin
  me := public._tag_member(p_token);
  if not exists (select 1 from public.tags where pool_id = p_pool and holder_id = me.id) then raise exception 'no_tag_in_pool'; end if;
  if not (select chat from public.tag_pools where id = p_pool) then raise exception 'chat_off'; end if;
  if length(b) not between 1 and 500 then raise exception 'invalid_message'; end if;
  if exists (select 1 from public.tag_chat where pool_id = p_pool and member_id = me.id and at > now() - interval '3 seconds') then raise exception 'slow_down'; end if;
  if (select count(*) from public.tag_chat where member_id = me.id and at > now() - interval '1 day') >= 300 then raise exception 'slow_down'; end if;
  insert into public.tag_chat (pool_id, member_id, body) values (p_pool, me.id, b) returning tag_chat.id into v_id;
  return v_id;
end $$;

-- ---------- public board ----------
/** What the tag board shows: switches, fuses on the top 5, live challenges, decline counts, recent explosions. */
create or replace function public.tag_board_heat(p_slug text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('bombs', po.bombs, 'challenges', po.challenges, 'chat', po.chat,
    'fuses', case when po.bombs then coalesce((select jsonb_agg(jsonb_build_object('number', t.number, 'fuse_at', public._tag_active_at(po.id, t.holder_id) + interval '7 days') order by t.number)
               from (select * from public.tags where pool_id = po.id and status = 'held' order by number limit 5) t), '[]') else '[]' end,
    'live', coalesce((select jsonb_agg(jsonb_build_object('status', c.status, 'from', a.name, 'to', b.name,
               'from_number', (select number from public.tags where pool_id = po.id and holder_id = a.id),
               'to_number', (select number from public.tags where pool_id = po.id and holder_id = b.id),
               'expires_at', c.expires_at, 'due_at', c.due_at) order by c.created_at desc)
             from public.tag_challenges c join public.tag_members a on a.id = c.challenger_id join public.tag_members b on b.id = c.challenged_id
            where c.pool_id = po.id and c.status in ('open', 'accepted')), '[]'),
    'declines', coalesce((select jsonb_object_agg(t.number, d) from (
               select t.number, public._tag_declines(po.id, t.holder_id) d from public.tags t where t.pool_id = po.id and t.status = 'held') t
             where t.d > 0), '{}'),
    'drops', coalesce((select jsonb_agg(jsonb_build_object('kind', d.kind, 'name', m.name, 'from', d.from_number, 'to', d.to_number, 'at', d.at) order by d.at desc)
             from (select * from public.tag_drops where pool_id = po.id order by at desc limit 10) d left join public.tag_members m on m.id = d.member_id), '[]'))
  from public.tag_pools po where po.slug = p_slug
$$;

-- ---------- TD ----------
/** Switch bombs / challenges / chat for a set. Turning bombs on starts everyone's clock now. */
create or replace function public.td_tag_heat_set(p_pool uuid, p_bombs boolean, p_challenges boolean, p_chat boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._need_tag(p_pool);
  update public.tag_pools set
    bombs_since = case when p_bombs and not bombs then now() else bombs_since end,
    bombs = coalesce(p_bombs, bombs), challenges = coalesce(p_challenges, challenges), chat = coalesce(p_chat, chat)
  where id = p_pool;
end $$;

create or replace function public.td_tag_chat(p_pool uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._need_tag(p_pool);
  return public._tag_chat_rows(p_pool, 0, true);
end $$;

create or replace function public.td_tag_chat_hide(p_id bigint, p_hide boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare pool uuid;
begin
  select pool_id into pool from public.tag_chat where id = p_id;
  if pool is null then raise exception 'not_found'; end if;
  perform public._need_tag(pool);
  update public.tag_chat set hidden = p_hide, hidden_by = case when p_hide then public.my_email() end where id = p_id;
end $$;

revoke execute on function public._tag_active_at(uuid, uuid), public._tag_fuse_sync(uuid), public._tag_drop(uuid, uuid, int, text), public._tag_declines(uuid, uuid),
  public._tag_strike(uuid, uuid), public.tag_tick(), public._tag_chat_rows(uuid, bigint, boolean) from public, anon, authenticated;
grant execute on function public.tag_heat(text), public.tag_challenge(text, uuid, uuid), public.tag_challenge_respond(text, uuid, boolean),
  public.tag_challenge_cancel(text, uuid), public.tag_chat_read(text, uuid, bigint), public.tag_chat_post(text, uuid, text),
  public.tag_board_heat(text) to anon, authenticated;
revoke execute on function public.td_tag_heat_set(uuid, boolean, boolean, boolean), public.td_tag_chat(uuid), public.td_tag_chat_hide(bigint, boolean) from public, anon;
grant execute on function public.td_tag_heat_set(uuid, boolean, boolean, boolean), public.td_tag_chat(uuid), public.td_tag_chat_hide(bigint, boolean) to authenticated;

-- ---------- the clock: every 15 minutes (pg_cron where available) ----------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'tag-tick';
    perform cron.schedule('tag-tick', '*/15 * * * *', 'select public.tag_tick()');
  end if;
end $$;

-- ---------- data: all three on for Jewel XI Early Access ----------
update public.tag_pools set bombs = true, challenges = true, chat = true, bombs_since = coalesce(bombs_since, now()) where slug = 'jewel-xi-ea';
