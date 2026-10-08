-- =====================================================================
-- Board replies (locked 2026-10-07, Mike: "if someone asks a question, I should just be able to respond to it in the
-- same thread" -> "Threads under the message").
-- Source of truth: tag_chat.reply_to = the thread's first message (one level: replying to a reply joins the same thread).
-- Rules:
--   * tag_chat_post(token, pool, body, reply) - reply is optional; the message replied to must be in the same set and
--     not hidden ('reply_gone'). Any message can start a thread, the house's posts included.
--   * The author of the message you tapped REPLY on gets a ping in their My Tag bell (a tag_chat_mentions row, flagged
--     'reply' in tag_mentions when the body doesn't @ them anyway). Not yourself, not the house, not ex-holders.
--   * Board reads (_tag_chat_rows, tag_board_read reactions) also carry the first message of any thread in the window,
--     so a reply to an old message always shows its thread.
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

alter table public.tag_chat add column if not exists reply_to bigint references public.tag_chat(id) on delete set null;
create index if not exists tag_chat_reply on public.tag_chat (reply_to) where reply_to is not null;

/** The ids a board shows: the newest 150 (+ hidden for the TD) and the first message of every thread among them. */
create or replace function public._tag_board_ids(p_pool uuid, p_after bigint, p_all boolean) returns setof bigint
language sql stable security definer set search_path = public, pg_temp as $$
  with win as (
    select c.id, c.reply_to from public.tag_chat c
     where c.pool_id = p_pool and c.id > coalesce(p_after, 0) and (p_all or not c.hidden)
     order by c.id desc limit 150)
  select id from win
  union
  select p.id from win w join public.tag_chat p on p.id = w.reply_to where p_all or not p.hidden
$$;

create or replace function public._tag_chat_rows(p_pool uuid, p_after bigint, p_all boolean) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(r order by (r->>'id')::bigint), '[]'::jsonb) from (
    select jsonb_build_object('id', c.id, 'member_id', c.member_id, 'name', m.name, 'nickname', m.nickname, 'body', c.body, 'at', c.at,
             'number', (select number from public.tags where pool_id = c.pool_id and holder_id = c.member_id), 'hidden', c.hidden,
             'kind', c.kind, 'event', c.event, 'reply_to', c.reply_to,
             'mentions', coalesce((select jsonb_agg(jsonb_build_object('id', cm.member_id, 'label', cm.label) order by cm.label)
                                     from public.tag_chat_mentions cm where cm.chat_id = c.id), '[]'::jsonb)) r
      from public.tag_chat c left join public.tag_members m on m.id = c.member_id
     where c.id in (select public._tag_board_ids(p_pool, p_after, p_all))) z
$$;

select pg_temp.patch('public.tag_board_read(text,uuid,bigint)', array[
  'where cr.chat_id in (select id from public.tag_chat where pool_id = p_pool and not hidden order by id desc limit 150)',
  'where cr.chat_id in (select public._tag_board_ids(p_pool, 0, false))']);

select pg_temp.patch('public.tag_mentions(text)', array[
  '''body'', left(c.body, 160), ''at'', c.at) j',
  '''body'', left(c.body, 160), ''at'', c.at, ''reply'', c.reply_to is not null and position(lower(''@'' || cm.label) in lower(c.body)) = 0) j']);

drop function if exists public.tag_chat_post(text, uuid, text);
create or replace function public.tag_chat_post(p_token text, p_pool uuid, p_body text, p_reply bigint default null) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.tag_members; b text := btrim(coalesce(p_body, '')); v_id bigint; par public.tag_chat;
begin
  me := public._tag_member(p_token);
  if not exists (select 1 from public.tags where pool_id = p_pool and holder_id = me.id) then raise exception 'no_tag_in_pool'; end if;
  if not (select chat from public.tag_pools where id = p_pool) then raise exception 'chat_off'; end if;
  if length(b) not between 1 and 500 then raise exception 'invalid_message'; end if;
  if exists (select 1 from public.tag_chat where pool_id = p_pool and member_id = me.id and at > now() - interval '3 seconds') then raise exception 'slow_down'; end if;
  if (select count(*) from public.tag_chat where member_id = me.id and at > now() - interval '1 day') >= 300 then raise exception 'slow_down'; end if;
  if p_reply is not null then
    select * into par from public.tag_chat where id = p_reply;
    if par.id is null or par.pool_id <> p_pool or par.hidden then raise exception 'reply_gone'; end if;
  end if;
  insert into public.tag_chat (pool_id, member_id, body, reply_to) values (p_pool, me.id, b, coalesce(par.reply_to, par.id))
  returning tag_chat.id into v_id;
  if par.member_id is not null and par.member_id <> me.id
     and exists (select 1 from public.tags where pool_id = p_pool and holder_id = par.member_id) then
    insert into public.tag_chat_mentions (chat_id, member_id, label) values (v_id, par.member_id, public._tag_short(par.member_id)) on conflict do nothing;
  end if;
  return v_id;
end $$;

revoke all on function public._tag_board_ids(uuid, bigint, boolean) from public, anon, authenticated;
revoke all on function public.tag_chat_post(text, uuid, text, bigint) from public;
grant execute on function public.tag_chat_post(text, uuid, text, bigint) to anon, authenticated;
