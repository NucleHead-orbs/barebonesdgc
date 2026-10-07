-- =====================================================================
-- Jump-ins can drop out up to tee time (locked 2026-10-07, Mike: "Can we add a drop out button as well?" -> "Jump-ins:
-- up to tee time"). Jumping IN still closes 2 hours before tee; dropping OUT now closes at tee time. After jump-ins
-- close, the Board post doesn't promise an open spot. Patched in place from the live definition.
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

select pg_temp.patch('public.tag_challenge_leave(text,uuid)', array[
  'if c.tee_at is not null and now() >= c.tee_at - interval ''2 hours'' then raise exception ''slot_closed''',
  'if c.tee_at is not null and now() >= c.tee_at then raise exception ''slot_closed''',
  '|| '' vs '' || public._tag_who(c.pool_id, c.challenged_id) || ''. A spot just opened.'');',
  '|| '' vs '' || public._tag_who(c.pool_id, c.challenged_id) || ''.'' || case when c.tee_at is null or now() < c.tee_at - interval ''2 hours'' then '' A spot just opened.'' else '''' end);']);
