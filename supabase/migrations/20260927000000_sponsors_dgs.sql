-- Sponsors come from the DGS export ("Jewel hole sponsor" column); the TD curates them in /td.
-- Rules:
--   * Import only ADDS sponsors (matched by registrant name, case/space-insensitive). It never
--     overwrites what the TD set (display name, hole, tier, logo, visibility) and never deletes.
--   * New imported sponsors land HIDDEN. Nothing shows publicly until the TD approves it,
--     because the registrant name is often not the business name ("Alex Crook" -> "Anc porter services").
--   * Logos live in the public `sponsor-logos` bucket; only the TD can write there.

alter table public.sponsors
  add column if not exists source_name text,                         -- registrant name as listed in DGS; null = added by hand
  add column if not exists hidden boolean not null default false,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists sponsors_source_uq
  on public.sponsors (event_id, lower(btrim(source_name))) where source_name is not null;

-- Public sees approved sponsors only; the TD sees everything.
drop policy if exists "public read" on public.sponsors;
create policy "public read" on public.sponsors for select to anon, authenticated
  using (not hidden or public.is_td());

-- p_names: ["Becky Bare", "Mickipedia.com", ...]  Returns {inserted, existing}.
create or replace function public.td_import_sponsors(p_event_id uuid, p_names jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_name text; ins int := 0; ex int := 0; v_sort int;
begin
  perform public._require_td();
  select coalesce(max(sort), 0) into v_sort from public.sponsors where event_id = p_event_id;
  for v_name in select btrim(regexp_replace(value, '\s+', ' ', 'g')) from jsonb_array_elements_text(p_names) loop
    continue when v_name = '';
    if exists (select 1 from public.sponsors
               where event_id = p_event_id and lower(btrim(source_name)) = lower(v_name)) then
      ex := ex + 1;
    else
      v_sort := v_sort + 1;
      insert into public.sponsors (event_id, name, source_name, hidden, sort)
      values (p_event_id, v_name, v_name, true, v_sort);
      ins := ins + 1;
    end if;
  end loop;
  return jsonb_build_object('inserted', ins, 'existing', ex);
end $$;

revoke execute on function public.td_import_sponsors(uuid, jsonb) from public, anon;
grant execute on function public.td_import_sponsors(uuid, jsonb) to authenticated;

-- Logo storage: public read by URL, TD-only writes. 2 MB cap, raster images only (no SVG: it can carry script).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sponsor-logos', 'sponsor-logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "td writes sponsor logos" on storage.objects;
create policy "td writes sponsor logos" on storage.objects for insert to authenticated
  with check (bucket_id = 'sponsor-logos' and public.is_td());
drop policy if exists "td updates sponsor logos" on storage.objects;
create policy "td updates sponsor logos" on storage.objects for update to authenticated
  using (bucket_id = 'sponsor-logos' and public.is_td()) with check (bucket_id = 'sponsor-logos' and public.is_td());
drop policy if exists "td deletes sponsor logos" on storage.objects;
create policy "td deletes sponsor logos" on storage.objects for delete to authenticated
  using (bucket_id = 'sponsor-logos' and public.is_td());
