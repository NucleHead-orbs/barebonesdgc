-- Who reacted (locked 2026-10-05, Mike: "Is there a way I can tell who clicked emojis on a message?" -> everyone can see).
-- tag_board_read's reactions gain 'who': {kind: [names, first reaction first]} next to counts and mine. Same shape otherwise.
-- Names: nickname if set, else name. Only members of the set can read the Board, so only they see who reacted.

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
        select r.chat_id, jsonb_build_object('counts', jsonb_object_agg(r.kind, r.n), 'mine', coalesce(jsonb_agg(r.kind) filter (where r.mine), '[]'),
                 'who', jsonb_object_agg(r.kind, r.names)) r
          from (select cr.chat_id, cr.kind, count(*) n, bool_or(cr.member_id = me.id) mine,
                       jsonb_agg(coalesce(nullif(btrim(m.nickname), ''), m.name) order by cr.at, m.name) names
                  from public.tag_chat_reactions cr join public.tag_members m on m.id = cr.member_id
                 where cr.chat_id in (select id from public.tag_chat where pool_id = p_pool and not hidden order by id desc limit 150)
                 group by cr.chat_id, cr.kind) r
         group by r.chat_id) x), '{}'));
end $$;
