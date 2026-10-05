-- The Board + player profiles + Matchmaker (locked 2026-10-05, Mike: "a message board that has a selector for each of their
-- tags ... a way for players to share what days of the week they are available for challenges and what their fave courses
-- are ... have the system suggest matchups ... and encourage battles ourselves").
-- Answers: My Tag gets tabs (TAGS · BOARD · MATCHUPS); chat + reactions, and challenge / bomb / penalty news auto-posts;
-- one profile per player; suggest + a weekly Matchmaker post.
-- Source of truth:
--   tag_chat (kind, event) : the Board of each set. kind 'chat' = a player's message, 'system' = the house posting news
--                            (event: challenge | accepted | declined | expired | played | lapsed | bomb | penalty | matchmaker).
--   tag_chat_reactions     : one row per (message, player, reaction). Reactions: skull | fire | trash | flex.
--   tag_profiles           : one per player (club-wide, every set). am / pm = days free as a 7-bit mask (bit 0 = Mon ... bit 6 = Sun);
--                            courses = up to 3 favorite courses from the course library.
--   tag_matchmaker_posts   : (set, week) the weekly Matchmaker already posted, so it never posts twice.
-- Rules:
--   * News posts only land in sets with the Board (chat) switched on. Cancelled challenges stay quiet.
--   * A pairing (challenger below, target 1-5 spots above, challenges on) scores:
--       3 per shared favorite course + 2 per shared day (AM or PM overlap) + closeness (6 - spots apart)
--       + idle bonus for the target (days since their last applied round, cap 14, / 2)
--       - 6 if either already has an open/accepted challenge in the set.
--     Pairs the challenger can't challenge right now (7-day same-pair cooldown) are skipped.
--   * tag_matchups(token): my top 3 per set + why. tag_matchmaker(): Mondays 9am Arizona (16:00 UTC) posts each set's
--     3 best pairings, nobody twice, to the Board. Safe to re-run.
-- =====================================================================

alter table public.tag_chat add column if not exists kind text not null default 'chat';
alter table public.tag_chat add column if not exists event text;
alter table public.tag_chat drop constraint if exists tag_chat_kind_check;
alter table public.tag_chat add constraint tag_chat_kind_check check (
  (kind = 'chat' and event is null) or
  (kind = 'system' and member_id is null and event in ('challenge', 'accepted', 'declined', 'expired', 'played', 'lapsed', 'bomb', 'penalty', 'matchmaker')));

create table if not exists public.tag_chat_reactions (
  chat_id   bigint not null references public.tag_chat(id) on delete cascade,
  member_id uuid not null references public.tag_members(id) on delete cascade,
  kind      text not null check (kind in ('skull', 'fire', 'trash', 'flex')),
  at        timestamptz not null default now(),
  primary key (chat_id, member_id, kind)
);

create table if not exists public.tag_profiles (
  member_id  uuid primary key references public.tag_members(id) on delete cascade,
  am         smallint not null default 0 check (am between 0 and 127),
  pm         smallint not null default 0 check (pm between 0 and 127),
  courses    uuid[] not null default '{}' check (cardinality(courses) <= 3),
  updated_at timestamptz not null default now()
);

create table if not exists public.tag_matchmaker_posts (
  pool_id uuid not null references public.tag_pools(id) on delete cascade,
  week    date not null,
  chat_id bigint references public.tag_chat(id) on delete set null,
  primary key (pool_id, week)
);

alter table public.tag_chat_reactions enable row level security;
alter table public.tag_profiles enable row level security;
alter table public.tag_matchmaker_posts enable row level security;
revoke all on public.tag_chat_reactions, public.tag_profiles, public.tag_matchmaker_posts from anon, authenticated;

-- ---------- helpers ----------
create or replace function public._tag_who(p_pool uuid, p_member uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif(btrim(m.nickname), ''), m.name)
         || coalesce(' (#' || (select number from public.tags t where t.pool_id = p_pool and t.holder_id = m.id) || ')', '')
    from public.tag_members m where m.id = p_member
$$;

/** House post on a set's Board (only when its Board is on). */
create or replace function public._tag_news(p_pool uuid, p_event text, p_body text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  if not coalesce((select chat from public.tag_pools where id = p_pool), false) then return null; end if;
  insert into public.tag_chat (pool_id, member_id, body, kind, event) values (p_pool, null, left(p_body, 500), 'system', p_event)
  returning tag_chat.id into v_id;
  return v_id;
end $$;

create or replace function public._tag_challenge_news() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare a text := public._tag_who(new.pool_id, new.challenger_id); b text := public._tag_who(new.pool_id, new.challenged_id);
        an int; bn int;
begin
  if tg_op = 'INSERT' then
    perform public._tag_news(new.pool_id, 'challenge', a || ' called out ' || b || '. 48 hours to answer.');
  elsif new.status is distinct from old.status then
    if new.status = 'accepted' then
      perform public._tag_news(new.pool_id, 'accepted', b || ' accepted ' || a || '''s challenge. 7 days to play it.');
    elsif new.status = 'declined' then
      perform public._tag_news(new.pool_id, 'declined', b || ' ducked ' || a || '''s challenge.');
    elsif new.status = 'expired' then
      perform public._tag_news(new.pool_id, 'expired', b || ' went silent on ' || a || '''s challenge. Counts as a decline.');
    elsif new.status = 'played' then
      select number into an from public.tags where pool_id = new.pool_id and holder_id = new.challenger_id;
      select number into bn from public.tags where pool_id = new.pool_id and holder_id = new.challenged_id;
      perform public._tag_news(new.pool_id, 'played', case
        when an is not null and bn is not null and an < bn then 'Challenge settled: ' || a || ' took the higher tag from ' || b || '.'
        else 'Challenge settled: ' || b || ' held off ' || a || '.' end);
    elsif new.status = 'lapsed' then
      perform public._tag_news(new.pool_id, 'lapsed', a || ' vs ' || b || ' never got played. Challenge lapsed.');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists tag_challenges_news on public.tag_challenges;
create trigger tag_challenges_news after insert or update of status on public.tag_challenges for each row execute function public._tag_challenge_news();

create or replace function public._tag_drop_news() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare who text := coalesce((select coalesce(nullif(btrim(nickname), ''), name) from public.tag_members where id = new.member_id), 'Someone');
begin
  if new.kind = 'bomb' then
    perform public._tag_news(new.pool_id, 'bomb', 'BOOM. ' || who || '''s #' || new.from_number || ' blew up after 7 idle days. Down to #' || new.to_number || '. Everyone below moves up.');
  else
    perform public._tag_news(new.pool_id, 'penalty', who || ' ducked one challenge too many: #' || new.from_number || ' down to #' || new.to_number || '.');
  end if;
  return new;
end $$;
drop trigger if exists tag_drops_news on public.tag_drops;
create trigger tag_drops_news after insert on public.tag_drops for each row execute function public._tag_drop_news();

-- the TD's chat view and the old My Tag chat get the new keys too (same signature)
create or replace function public._tag_chat_rows(p_pool uuid, p_after bigint, p_all boolean) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(r order by (r->>'id')::bigint), '[]'::jsonb) from (
    select jsonb_build_object('id', c.id, 'member_id', c.member_id, 'name', m.name, 'nickname', m.nickname, 'body', c.body, 'at', c.at,
             'number', (select number from public.tags where pool_id = c.pool_id and holder_id = c.member_id), 'hidden', c.hidden,
             'kind', c.kind, 'event', c.event) r
      from public.tag_chat c left join public.tag_members m on m.id = c.member_id
     where c.pool_id = p_pool and c.id > coalesce(p_after, 0) and (p_all or not c.hidden)
     order by c.id desc limit 150) z
$$;

-- ---------- the Board (My Tag) ----------
/**
 * One Board read: new lines after p_after (0 = the latest 150) + the reaction tallies for the latest 150 visible lines
 * (reactions change on old lines, so they come every time). Members of the set only.
 */
create or replace function public.tag_board_read(p_token text, p_pool uuid, p_after bigint) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me public.tag_members;
begin
  me := public._tag_member(p_token);
  if not exists (select 1 from public.tags where pool_id = p_pool and holder_id = me.id) then raise exception 'no_tag_in_pool'; end if;
  if not (select chat from public.tag_pools where id = p_pool) then raise exception 'chat_off'; end if;
  return jsonb_build_object(
    'lines', public._tag_chat_rows(p_pool, p_after, false),
    'reactions', coalesce((select jsonb_object_agg(x.chat_id, x.r) from (
        select r.chat_id, jsonb_build_object('counts', jsonb_object_agg(r.kind, r.n), 'mine', coalesce(jsonb_agg(r.kind) filter (where r.mine), '[]')) r
          from (select cr.chat_id, cr.kind, count(*) n, bool_or(cr.member_id = me.id) mine
                  from public.tag_chat_reactions cr
                 where cr.chat_id in (select id from public.tag_chat where pool_id = p_pool and not hidden order by id desc limit 150)
                 group by cr.chat_id, cr.kind) r
         group by r.chat_id) x), '{}'));
end $$;

/** Toggle a reaction. Returns true when it's now on. */
create or replace function public.tag_chat_react(p_token text, p_chat bigint, p_kind text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members; c public.tag_chat;
begin
  me := public._tag_member(p_token);
  if p_kind not in ('skull', 'fire', 'trash', 'flex') then raise exception 'invalid_reaction'; end if;
  select * into c from public.tag_chat where id = p_chat;
  if c.id is null or c.hidden then raise exception 'not_found'; end if;
  if not exists (select 1 from public.tags where pool_id = c.pool_id and holder_id = me.id) then raise exception 'no_tag_in_pool'; end if;
  if not (select chat from public.tag_pools where id = c.pool_id) then raise exception 'chat_off'; end if;
  delete from public.tag_chat_reactions where chat_id = p_chat and member_id = me.id and kind = p_kind;
  if found then return false; end if;
  if (select count(*) from public.tag_chat_reactions where member_id = me.id and at > now() - interval '1 minute') >= 60 then raise exception 'slow_down'; end if;
  insert into public.tag_chat_reactions (chat_id, member_id, kind) values (p_chat, me.id, p_kind);
  return true;
end $$;

-- ---------- profiles ----------
/** My profile + the course library to pick from. */
create or replace function public.tag_profile_get(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me public.tag_members; pr public.tag_profiles;
begin
  me := public._tag_member(p_token);
  select * into pr from public.tag_profiles where member_id = me.id;
  return jsonb_build_object('am', coalesce(pr.am, 0), 'pm', coalesce(pr.pm, 0), 'courses', to_jsonb(coalesce(pr.courses, '{}'::uuid[])),
    'saved', pr.member_id is not null,
    'library', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'city', c.city) order by c.name) from public.courses c), '[]'));
end $$;

create or replace function public.tag_profile_save(p_token text, p_am int, p_pm int, p_courses uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members; cs uuid[] := array(select distinct x from unnest(coalesce(p_courses, '{}')) x where x is not null);
begin
  me := public._tag_member(p_token);
  if coalesce(p_am, 0) not between 0 and 127 or coalesce(p_pm, 0) not between 0 and 127 then raise exception 'invalid_days'; end if;
  if cardinality(cs) > 3 then raise exception 'too_many_courses'; end if;
  if exists (select 1 from unnest(cs) x where not exists (select 1 from public.courses c where c.id = x)) then raise exception 'unknown_course'; end if;
  insert into public.tag_profiles (member_id, am, pm, courses, updated_at) values (me.id, coalesce(p_am, 0), coalesce(p_pm, 0), cs, now())
  on conflict (member_id) do update set am = excluded.am, pm = excluded.pm, courses = excluded.courses, updated_at = now();
end $$;

-- ---------- matchmaking ----------
create or replace function public._tag_days(p_mask int) returns text[]
language sql immutable as $$
  select coalesce(array_agg(d order by i), '{}') from unnest(array['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) with ordinality as t(d, i)
   where (p_mask >> (i::int - 1)) & 1 = 1
$$;

/**
 * Every challengeable pairing in a set right now, scored (see header). a = challenger (below), b = target (1-5 above).
 * Rows: a, b, a_number, b_number, score, days (shared day names), courses (shared course names), idle (target's idle days).
 */
create or replace function public._tag_pairs(p_pool uuid)
returns table (a uuid, b uuid, a_number int, b_number int, score numeric, days text[], courses text[], idle int)
language sql stable security definer set search_path = public, pg_temp as $$
  with held as (
    select t.holder_id m, t.number, row_number() over (order by t.number) rk from public.tags t where t.pool_id = p_pool and t.status = 'held'
  ), busy as (
    select challenger_id m from public.tag_challenges where pool_id = p_pool and status in ('open', 'accepted')
    union select challenged_id from public.tag_challenges where pool_id = p_pool and status in ('open', 'accepted')
  ), pairs as (
    select x.m a, y.m b, x.number a_number, y.number b_number, x.rk - y.rk gap,
           ((coalesce(pa.am, 0) & coalesce(pb.am, 0)) | (coalesce(pa.pm, 0) & coalesce(pb.pm, 0))) shared,
           array(select c.name from public.courses c where c.id = any(coalesce(pa.courses, '{}')) and c.id = any(coalesce(pb.courses, '{}')) order by c.name) courses,
           least(14, greatest(0, extract(day from now() - coalesce(
             (select max(mt.applied_at) from public.tag_matches mt join public.tag_match_players mp on mp.match_id = mt.id
               where mt.pool_id = p_pool and mt.status = 'applied' and mp.member_id = y.m),
             (select max(h.at) from public.tag_history h where h.pool_id = p_pool and h.member_id = y.m and h.kind = 'issued'), now()))))::int idle,
           (x.m in (select m from busy) or y.m in (select m from busy)) busy
      from held x join held y on y.rk < x.rk and x.rk - y.rk <= 5
      left join public.tag_profiles pa on pa.member_id = x.m
      left join public.tag_profiles pb on pb.member_id = y.m
     where (select challenges from public.tag_pools where id = p_pool)
       and not exists (select 1 from public.tag_challenges c where c.pool_id = p_pool and c.challenger_id = x.m and c.challenged_id = y.m
                        and c.created_at > now() - interval '7 days')
  )
  select a, b, a_number, b_number,
         3 * cardinality(courses) + 2 * cardinality(public._tag_days(shared)) + (6 - gap) + idle / 2.0 - case when busy then 6 else 0 end,
         public._tag_days(shared), courses, idle
    from pairs
$$;

/** My Matchups: per set I hold a tag in (challenges on), my 3 best targets and why. */
create or replace function public.tag_matchups(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me public.tag_members;
begin
  me := public._tag_member(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object('pool_id', po.id, 'pool', po.slug, 'pool_name', po.name, 'number', t.number,
      'open', exists (select 1 from public.tag_challenges c where c.pool_id = po.id and c.challenger_id = me.id and c.status in ('open', 'accepted')),
      'picks', coalesce((select jsonb_agg(jsonb_build_object('member_id', p.b, 'name', m.name, 'nickname', m.nickname, 'number', p.b_number,
                 'score', round(p.score, 1), 'days', to_jsonb(p.days), 'courses', to_jsonb(p.courses), 'idle', p.idle,
                 'their_days', to_jsonb(public._tag_days(coalesce(pr.am, 0) | coalesce(pr.pm, 0))),
                 'busy', exists (select 1 from public.tag_challenges c where c.pool_id = po.id and status in ('open', 'accepted') and (c.challenger_id = p.b or c.challenged_id = p.b)))
               order by p.score desc, p.b_number)
             from (select * from public._tag_pairs(po.id) where a = me.id order by score desc, b_number limit 3) p
             join public.tag_members m on m.id = p.b left join public.tag_profiles pr on pr.member_id = p.b), '[]')
    ) order by po.sort)
    from public.tags t join public.tag_pools po on po.id = t.pool_id
   where t.holder_id = me.id and po.challenges), '[]');
end $$;

/** The weekly Matchmaker: each set with Board + challenges on gets its 3 best pairings (nobody twice). Once per week per set. */
create or replace function public.tag_matchmaker() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare po record; p record; used uuid[]; lines text[]; wk date := (date_trunc('week', now() at time zone 'America/Phoenix'))::date; posted int := 0; v_id bigint;
begin
  for po in select * from public.tag_pools where chat and challenges loop
    if exists (select 1 from public.tag_matchmaker_posts where pool_id = po.id and week = wk) then continue; end if;
    used := '{}'; lines := '{}';
    for p in select * from public._tag_pairs(po.id) order by score desc, b_number, a_number loop
      continue when p.a = any(used) or p.b = any(used);
      lines := lines || (public._tag_who(po.id, p.a) || ' vs ' || public._tag_who(po.id, p.b)
        || coalesce(': ' || nullif(concat_ws(', ',
             case when cardinality(p.days) > 0 then 'both free ' || array_to_string(p.days[1:3], '/') end,
             case when cardinality(p.courses) > 0 then 'both love ' || array_to_string(p.courses, ' & ') end,
             case when p.idle >= 7 then '#' || p.b_number || ' hasn''t moved in ' || p.idle || ' days' end), ''), ''));
      used := used || p.a || p.b;
      exit when cardinality(lines) >= 3;
    end loop;
    if cardinality(lines) = 0 then continue; end if;
    v_id := public._tag_news(po.id, 'matchmaker', 'MATCHMAKER: this week''s hottest matchups' || E'\n' || array_to_string(lines, E'\n') || E'\n' || 'Lower tag: open My Tag > MATCHUPS and throw down.');
    insert into public.tag_matchmaker_posts (pool_id, week, chat_id) values (po.id, wk, v_id);
    posted := posted + 1;
  end loop;
  return posted;
end $$;

revoke execute on function public._tag_who(uuid, uuid), public._tag_news(uuid, text, text), public._tag_days(int), public._tag_pairs(uuid),
  public.tag_matchmaker() from public, anon, authenticated;
grant execute on function public.tag_board_read(text, uuid, bigint), public.tag_chat_react(text, bigint, text), public.tag_profile_get(text),
  public.tag_profile_save(text, int, int, uuid[]), public.tag_matchups(text) to anon, authenticated;

-- Mondays 9:00 Arizona (no DST) = 16:00 UTC
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'tag-matchmaker';
    perform cron.schedule('tag-matchmaker', '0 16 * * 1', 'select public.tag_matchmaker()');
  end if;
end $$;
