-- DGS exports carry no registration id, and ~25% of players have no PDGA#.
-- Match order is now: dgs_id (if ever supplied) -> PDGA# -> exact name (case/space-insensitive).
-- Without the name fallback, re-importing duplicates every player without a PDGA#.
create unique index if not exists players_name_uq on public.players(event_id, lower(btrim(name)));

create or replace function public.td_import_players(p_event_id uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  it jsonb; v_id uuid; ins int := 0; upd int := 0; skipped jsonb := '[]';
  v_name text; v_div text; v_dgs text; v_pdga text;
begin
  perform public._require_td();
  for it in select value from jsonb_array_elements(p_rows) loop
    v_name := btrim(regexp_replace(coalesce(it->>'name', ''), '\s+', ' ', 'g'));
    v_div  := upper(btrim(coalesce(it->>'div_code', '')));
    v_dgs  := nullif(btrim(coalesce(it->>'dgs_id', '')), '');
    v_pdga := nullif(btrim(coalesce(it->>'pdga', '')), '');
    if v_name = '' then skipped := skipped || jsonb_build_object('row', it, 'reason', 'no_name'); continue; end if;
    if v_div = 'SPON' then skipped := skipped || jsonb_build_object('row', it, 'reason', 'sponsor_only'); continue; end if;
    if not exists (select 1 from public.divisions where event_id = p_event_id and code = v_div) then
      skipped := skipped || jsonb_build_object('row', it, 'reason', 'unknown_division'); continue;
    end if;

    v_id := null;
    if v_dgs  is not null then select id into v_id from public.players where event_id = p_event_id and dgs_id = v_dgs; end if;
    if v_id is null and v_pdga is not null then select id into v_id from public.players where event_id = p_event_id and pdga = v_pdga; end if;
    if v_id is null then select id into v_id from public.players where event_id = p_event_id and lower(btrim(name)) = lower(v_name); end if;

    if v_id is null then
      insert into public.players (event_id, name, div_code, rating, pdga, dgs_id, reg_order)
      values (p_event_id, v_name, v_div, nullif(it->>'rating','')::int, v_pdga, v_dgs, nullif(it->>'reg_order','')::int);
      ins := ins + 1;
    else
      update public.players set name = v_name, div_code = v_div,
        rating    = coalesce(nullif(it->>'rating','')::int, rating),   -- never wipe a hand-entered rating
        pdga      = coalesce(v_pdga, pdga), dgs_id = coalesce(v_dgs, dgs_id),
        reg_order = coalesce(nullif(it->>'reg_order','')::int, reg_order)
      where id = v_id;
      upd := upd + 1;
    end if;
  end loop;
  return jsonb_build_object('inserted', ins, 'updated', upd, 'skipped', skipped);
end $$;

revoke execute on function public.td_import_players(uuid, jsonb) from public, anon;
grant execute on function public.td_import_players(uuid, jsonb) to authenticated;
