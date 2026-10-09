-- =====================================================================
-- Phone alerts (Web Push) for My Tag (locked 2026-10-08, Mike: "lots of users asking if there is a way to push
-- notifications to their phone for challenges and mentions" -> "Everything aimed at you", personal home-screen app
-- on iPhone, no quiet hours).
--
-- Source of truth:
--   tag_push_subs   one row per phone/browser that turned alerts on (the Web Push endpoint + its keys), per member.
--   tag_members.push_off  the alert kinds a member switched off (all on by default).
--   tag_push_queue  the outbox: one row per alert per member, deduped by (member, kind, ref). Only members with at
--                   least one phone get rows. The tag-push Edge Function sends them and reports back.
-- Kinds (deterministic producers, all triggers except the fuse sweep):
--   challenge  someone challenged you                         (tag_challenges insert)
--   answer     your challenge was accepted / declined / expired (tag_challenges status leaves 'open')
--   slot       a time was proposed to you / your time got OK'd (tag_challenges tee_at / locked_at)
--   mention    @mentioned or replied to on a Board            (tag_chat_mentions insert)
--   invite     invited to a casual round                       (tag_casual_players insert, invited)
--   confirm    a round waits on your confirm                    (tag_match_players / club_round_players insert)
--   fuse       your time-bomb fuse has under 24 hours left      (_tag_push_tick sweep, every 15 minutes)
--   test       SEND A TEST from My Tag
-- Delivery: an insert into the queue pokes the tag-push function right away (pg_net), and a 1-minute cron pokes it
-- again so nothing waits on a lost poke. Its URL, a shared secret and the VAPID keys live in Vault (never in git):
-- tag_push_url, tag_push_secret, tag_vapid_public, tag_vapid_private. Alerts older than a day are dropped unsent.
-- A push never breaks the action that caused it (every producer swallows its own errors).
-- =====================================================================

do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then create extension if not exists pg_net; end if;
end $$;

alter table public.tag_members add column if not exists push_off text[] not null default '{}';

create table if not exists public.tag_push_subs (
  endpoint   text primary key check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  member_id  uuid not null references public.tag_members(id) on delete cascade,
  p256dh     text not null check (length(p256dh) between 20 and 200),
  auth       text not null check (length(auth) between 8 and 100),
  ua         text check (ua is null or length(ua) <= 300),
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  fails      int not null default 0
);
create index if not exists tag_push_subs_member on public.tag_push_subs (member_id);

create table if not exists public.tag_push_queue (
  id         bigint generated always as identity primary key,
  member_id  uuid not null references public.tag_members(id) on delete cascade,
  kind       text not null check (kind in ('challenge', 'answer', 'slot', 'mention', 'invite', 'confirm', 'fuse', 'test')),
  ref        text not null,
  title      text not null check (length(title) <= 120),
  body       text not null check (length(body) <= 300),
  url        text not null check (url ~ '^/' and length(url) <= 300),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at    timestamptz,
  tries      int not null default 0,
  error      text,
  unique (member_id, kind, ref)
);
create index if not exists tag_push_queue_todo on public.tag_push_queue (id) where sent_at is null;

alter table public.tag_push_subs enable row level security;
alter table public.tag_push_queue enable row level security;
revoke all on public.tag_push_subs, public.tag_push_queue from anon, authenticated;

create or replace function public._tag_push_kinds() returns text[] language sql immutable as $$
  select array['challenge', 'answer', 'slot', 'mention', 'invite', 'confirm', 'fuse']
$$;

/** Queue one alert (no phone, kind switched off, or already queued = nothing). Never raises. */
create or replace function public._tag_push(p_member uuid, p_kind text, p_ref text, p_title text, p_body text, p_path text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.tag_members;
begin
  select * into m from public.tag_members where id = p_member;
  if m.id is null or p_kind = any (m.push_off) or not exists (select 1 from public.tag_push_subs where member_id = m.id) then return; end if;
  insert into public.tag_push_queue (member_id, kind, ref, title, body, url)
  values (m.id, p_kind, left(p_ref, 200), left(p_title, 120), left(coalesce(nullif(btrim(p_body), ''), ' '), 300),
          case when p_path like '/rounds/%' then p_path else '/tag/' || m.token || coalesce(p_path, '') end)
  on conflict (member_id, kind, ref) do nothing;
exception when others then
  raise warning 'tag push (%) skipped: %', p_kind, sqlerrm;
end $$;

/** Wake the sender (pg_net + Vault). Quietly does nothing where either is missing. */
create or replace function public._tag_push_poke() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_url text; v_secret text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') or to_regclass('vault.decrypted_secrets') is null then return; end if;
  execute 'select max(decrypted_secret) filter (where name = ''tag_push_url''), max(decrypted_secret) filter (where name = ''tag_push_secret'')
             from vault.decrypted_secrets where name in (''tag_push_url'', ''tag_push_secret'')' into v_url, v_secret;
  if v_url is null or v_secret is null then return; end if;
  execute 'select net.http_post(url := $1, body := ''{}''::jsonb, headers := jsonb_build_object(''content-type'', ''application/json'', ''x-push-secret'', $2), timeout_milliseconds := 10000)'
    using v_url, v_secret;
exception when others then
  raise warning 'tag push poke skipped: %', sqlerrm;
end $$;

create or replace function public._tag_push_queue_poke() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin perform public._tag_push_poke(); return null; end $$;
drop trigger if exists tag_push_queue_poke on public.tag_push_queue;
create trigger tag_push_queue_poke after insert on public.tag_push_queue for each statement execute function public._tag_push_queue_poke();

-- ---------- producers ----------
create or replace function public._tag_push_mention() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.tag_chat; who text; po public.tag_pools; reply boolean;
begin
  select * into c from public.tag_chat where id = new.chat_id;
  if c.id is null or c.member_id = new.member_id or c.hidden then return new; end if;
  select * into po from public.tag_pools where id = c.pool_id;
  who := coalesce(public._tag_short(c.member_id), 'The house');
  reply := c.reply_to is not null and position(lower('@' || new.label) in lower(c.body)) = 0;
  perform public._tag_push(new.member_id, 'mention', c.id::text,
    who || case when reply then ' replied to you' else ' mentioned you' end || ' · ' || po.name,
    c.body, '?tab=board&pool=' || po.slug || '&chat=' || c.id);
  return new;
end $$;
drop trigger if exists tag_push_mention on public.tag_chat_mentions;
create trigger tag_push_mention after insert on public.tag_chat_mentions for each row execute function public._tag_push_mention();

create or replace function public._tag_push_challenge() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare po text; a text; d text; other uuid;
begin
  select name into po from public.tag_pools where id = new.pool_id;
  a := public._tag_who(new.pool_id, new.challenger_id); d := public._tag_who(new.pool_id, new.challenged_id);
  if tg_op = 'INSERT' then
    if new.status = 'open' then
      perform public._tag_push(new.challenged_id, 'challenge', new.id::text, 'You''ve been challenged · ' || po,
        a || ' challenged you' || coalesce(' for #' || new.to_number, '') || '. You have 48 hours to answer on My Tag.', '');
    end if;
    return new;
  end if;
  if old.status = 'open' and new.status in ('accepted', 'declined', 'expired') then
    perform public._tag_push(new.challenger_id, 'answer', new.id::text || ':' || new.status,
      case new.status when 'accepted' then 'Challenge accepted · ' when 'declined' then 'Challenge declined · ' else 'Challenge expired · ' end || po,
      case new.status when 'accepted' then d || ' accepted. They pick the time and course first.'
                      when 'declined' then d || ' declined your challenge.'
                      else d || ' didn''t answer in 48 hours, so it counts as a decline.' end, '');
  end if;
  if new.status = 'accepted' and new.tee_at is not null and new.locked_at is null and new.slot_by is not null
     and (old.tee_at is distinct from new.tee_at or old.course_id is distinct from new.course_id or old.slot_by is distinct from new.slot_by) then
    other := case when new.slot_by = new.challenger_id then new.challenged_id else new.challenger_id end;
    perform public._tag_push(other, 'slot', new.id::text || ':' || extract(epoch from new.tee_at)::bigint || ':' || coalesce(new.course_id::text, '') || ':' || new.slot_by,
      'Tee time picked · ' || po,
      public._tag_who(new.pool_id, new.slot_by) || ' picked ' || public._tag_slot_text(new.tee_at, new.course_id) || '. OK it or pick another on My Tag.', '');
  end if;
  if old.locked_at is null and new.locked_at is not null and new.slot_by is not null then
    perform public._tag_push(new.slot_by, 'slot', new.id::text || ':locked:' || extract(epoch from new.tee_at)::bigint,
      'Locked in · ' || po, a || ' vs ' || d || ' is on: ' || public._tag_slot_text(new.tee_at, new.course_id) || '.', '');
  end if;
  return new;
end $$;
drop trigger if exists tag_push_challenge on public.tag_challenges;
create trigger tag_push_challenge after insert or update on public.tag_challenges for each row execute function public._tag_push_challenge();

create or replace function public._tag_push_invite() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare i public.tag_casual;
begin
  if not new.invited or new.status <> 'invited' then return new; end if;
  select * into i from public.tag_casual where id = new.invite_id;
  if i.id is null or i.host_id = new.member_id then return new; end if;
  perform public._tag_push(new.member_id, 'invite', i.id::text, public._tag_short(i.host_id) || ' invited you to a round',
    public._tag_slot_text(i.tee_at, i.course_id) || '. Tap I''M IN or CAN''T MAKE IT on My Tag.' || coalesce(' "' || i.note || '"', ''), '?tab=matchups');
  return new;
end $$;
drop trigger if exists tag_push_invite on public.tag_casual_players;
create trigger tag_push_invite after insert on public.tag_casual_players for each row execute function public._tag_push_invite();

create or replace function public._tag_push_confirm_tag() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.tag_matches;
begin
  if new.confirmed_at is not null then return new; end if;
  select * into m from public.tag_matches where id = new.match_id;
  if m.id is null or m.status <> 'pending' or m.round_id is not null or m.created_by = new.member_id then return new; end if;  -- Scorecard rounds ping from their card
  perform public._tag_push(new.member_id, 'confirm', m.id::text, 'Confirm your tag round',
    coalesce(public._tag_short(m.created_by), 'Someone') || ' logged a round' || coalesce(' at ' || m.course, '') || '. Check your score and confirm on My Tag.', '');
  return new;
end $$;
drop trigger if exists tag_push_confirm_tag on public.tag_match_players;
create trigger tag_push_confirm_tag after insert on public.tag_match_players for each row execute function public._tag_push_confirm_tag();

create or replace function public._tag_push_confirm_card() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.club_rounds;
begin
  if new.member_id is null or new.confirmed_at is not null then return new; end if;
  select * into r from public.club_rounds where id = new.round_id;
  if r.id is null or r.status <> 'saved' or r.created_by = new.member_id then return new; end if;
  perform public._tag_push(new.member_id, 'confirm', 'card:' || r.id, 'Confirm your round',
    coalesce(public._tag_short(r.created_by), 'Someone') || ' saved your round at ' || r.course || '. Check your score and confirm.', '/rounds/' || r.id);
  return new;
end $$;
drop trigger if exists tag_push_confirm_card on public.club_round_players;
create trigger tag_push_confirm_card after insert on public.club_round_players for each row execute function public._tag_push_confirm_card();

/** Every 15 minutes (cron): fuses with under 24 hours left. Every minute: poke the sender if anything's waiting. */
create or replace function public._tag_push_tick() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare f record;
begin
  if extract(minute from now())::int % 15 = 0 then
    for f in
      select t.pool_id, t.member_id, po.name, (select number from public.tags where pool_id = t.pool_id and holder_id = t.member_id) num,
             public._tag_active_at(t.pool_id, t.member_id) + interval '7 days' fuse_at
        from public.tag_fuse t join public.tag_pools po on po.id = t.pool_id
       where po.bombs and exists (select 1 from public.tag_push_subs s where s.member_id = t.member_id)
    loop
      if f.fuse_at > now() and f.fuse_at <= now() + interval '24 hours' then
        perform public._tag_push(f.member_id, 'fuse', f.pool_id || ':' || to_char(f.fuse_at, 'YYYYMMDDHH24MI'), 'Your fuse is lit · ' || f.name,
          coalesce('#' || f.num || ' ', 'Your tag ') || 'explodes in about ' || greatest(1, ceil(extract(epoch from f.fuse_at - now()) / 3600))::int
          || ' hours unless you play a tag round.', '');
      end if;
    end loop;
  end if;
  delete from public.tag_push_queue where created_at < now() - interval '30 days';
  if exists (select 1 from public.tag_push_queue where sent_at is null and tries < 5 and created_at > now() - interval '1 day') then
    perform public._tag_push_poke();
  end if;
end $$;

do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'tag-push';
    perform cron.schedule('tag-push', '* * * * *', 'select public._tag_push_tick()');
  end if;
end $$;

-- ---------- My Tag (token) ----------
/** This phone's state (pass its endpoint, or null) + how many phones + which kinds are off. */
create or replace function public.tag_push_status(p_token text, p_endpoint text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me public.tag_members;
begin
  me := public._tag_member(p_token);
  return jsonb_build_object(
    'device', p_endpoint is not null and exists (select 1 from public.tag_push_subs where endpoint = p_endpoint and member_id = me.id),
    'devices', (select count(*) from public.tag_push_subs where member_id = me.id),
    'off', to_jsonb(me.push_off), 'kinds', to_jsonb(public._tag_push_kinds()));
end $$;

/** Turn alerts on for this phone (a phone belongs to one member at a time: the latest link wins). */
create or replace function public.tag_push_subscribe(p_token text, p_endpoint text, p_p256dh text, p_auth text, p_ua text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members;
begin
  me := public._tag_member(p_token);
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 1000 then raise exception 'invalid_subscription'; end if;
  if coalesce(length(p_p256dh), 0) not between 20 and 200 or coalesce(length(p_auth), 0) not between 8 and 100 then raise exception 'invalid_subscription'; end if;
  if (select count(*) from public.tag_push_subs where member_id = me.id and endpoint <> p_endpoint) >= 10 then
    delete from public.tag_push_subs where endpoint = (select endpoint from public.tag_push_subs where member_id = me.id order by coalesce(last_ok_at, created_at) limit 1);
  end if;
  insert into public.tag_push_subs (endpoint, member_id, p256dh, auth, ua) values (p_endpoint, me.id, p_p256dh, p_auth, left(p_ua, 300))
  on conflict (endpoint) do update set member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua, fails = 0;
end $$;

create or replace function public.tag_push_unsubscribe(p_token text, p_endpoint text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members;
begin
  me := public._tag_member(p_token);
  delete from public.tag_push_subs where endpoint = p_endpoint and member_id = me.id;
end $$;

create or replace function public.tag_push_prefs(p_token text, p_off text[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members; v text[] := array(select distinct x from unnest(coalesce(p_off, '{}')) x order by 1);
begin
  me := public._tag_member(p_token);
  if not v <@ public._tag_push_kinds() then raise exception 'invalid_kind'; end if;
  update public.tag_members set push_off = v where id = me.id;
end $$;

/** SEND A TEST to every phone of mine (once a minute). */
create or replace function public.tag_push_test(p_token text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members; n int;
begin
  me := public._tag_member(p_token);
  if not exists (select 1 from public.tag_push_subs where member_id = me.id) then raise exception 'no_phone'; end if;
  insert into public.tag_push_queue (member_id, kind, ref, title, body, url)
  values (me.id, 'test', to_char(now(), 'YYYYMMDDHH24MI'), 'Bare Bones alerts are on', 'Nice. Challenges, @mentions and round stuff will land here.', '/tag/' || me.token)
  on conflict (member_id, kind, ref) do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- ---------- the sender (tag-push Edge Function, service role only) ----------
create or replace function public.tag_push_config() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r jsonb;
begin
  if to_regclass('vault.decrypted_secrets') is null then return '{}'; end if;
  execute 'select coalesce(jsonb_object_agg(name, decrypted_secret), ''{}'') from vault.decrypted_secrets
            where name in (''tag_push_secret'', ''tag_vapid_public'', ''tag_vapid_private'')' into r;
  return r;
end $$;

/** Claim up to 100 waiting alerts with their phones (skips rows another run holds for under 2 minutes). */
create or replace function public.tag_push_claim() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare ids bigint[];
begin
  select array_agg(id) into ids from (
    select id from public.tag_push_queue
     where sent_at is null and tries < 5 and created_at > now() - interval '1 day'
       and (claimed_at is null or claimed_at < now() - interval '2 minutes')
     order by id limit 100 for update skip locked) z;
  if ids is null then return '[]'; end if;
  update public.tag_push_queue set claimed_at = now(), tries = tries + 1 where id = any (ids);
  return coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'kind', q.kind, 'ref', q.ref, 'title', q.title, 'body', q.body, 'url', q.url,
            'subs', coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                                from public.tag_push_subs s where s.member_id = q.member_id), '[]')) order by q.id)
            from public.tag_push_queue q where q.id = any (ids)), '[]');
end $$;

/** Report a run: delivered alert ids, failed ones (id -> error), endpoints that worked / are gone for good. */
create or replace function public.tag_push_report(p_sent bigint[], p_failed jsonb, p_ok text[], p_gone text[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.tag_push_queue set sent_at = now(), error = null where id = any (coalesce(p_sent, '{}'));
  update public.tag_push_queue q set error = left(f.value, 300), claimed_at = null
    from jsonb_each_text(coalesce(p_failed, '{}')) f where q.id = f.key::bigint;
  update public.tag_push_subs set last_ok_at = now(), fails = 0 where endpoint = any (coalesce(p_ok, '{}'));
  delete from public.tag_push_subs where endpoint = any (coalesce(p_gone, '{}'));
end $$;

revoke all on function public._tag_push(uuid, text, text, text, text, text), public._tag_push_poke(), public._tag_push_tick(),
  public._tag_push_kinds(), public.tag_push_config(), public.tag_push_claim(), public.tag_push_report(bigint[], jsonb, text[], text[])
  from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.tag_push_config(), public.tag_push_claim(), public.tag_push_report(bigint[], jsonb, text[], text[]) to service_role;
  end if;
end $$;
revoke all on function public.tag_push_status(text, text), public.tag_push_subscribe(text, text, text, text, text), public.tag_push_unsubscribe(text, text),
  public.tag_push_prefs(text, text[]), public.tag_push_test(text) from public;
grant execute on function public.tag_push_status(text, text), public.tag_push_subscribe(text, text, text, text, text), public.tag_push_unsubscribe(text, text),
  public.tag_push_prefs(text, text[]), public.tag_push_test(text) to anon, authenticated;
