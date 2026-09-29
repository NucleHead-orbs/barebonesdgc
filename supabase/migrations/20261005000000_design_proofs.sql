-- Design proofs + crew can see designs (locked 2026-09-29, Mike: "I'd like the crew to see these designs")
-- Source of truth:
--   design_assets.proof       : null = a plain uploaded design; else which built-in proof page renders it
--                               (disc | shirt | screen_print | tee_signs). The proof art ships with the site.
--   design_assets.proof_opts  : the TD's picks on that proof ({"foil","plastic"} | {"palette"} | {"inks","shirt"} | {"palette","bg"}).
--   design_assets.crew_visible: the TD switched it on for the crew. Off by default: designs stay TD-only.
-- Rules:
--   * Crew read designs only through crew_designs(token): their own event, crew_visible only, latest file only.
--   * Files stay in the private bucket. A crew member gets a short-lived link through the crew-design-url function,
--     which asks crew_design_file(token, file) for the path first (same checks), then signs it. No public storage policy.
--   * Safe to re-run.
-- =====================================================================

alter table public.design_assets add column if not exists proof text;
alter table public.design_assets add column if not exists proof_opts jsonb not null default '{}'::jsonb;
alter table public.design_assets add column if not exists crew_visible boolean not null default false;
alter table public.design_assets drop constraint if exists design_assets_proof_check;
alter table public.design_assets add constraint design_assets_proof_check check (proof is null or proof in ('disc', 'shirt', 'screen_print', 'tee_signs'));
alter table public.design_assets drop constraint if exists design_assets_proof_opts_check;
alter table public.design_assets add constraint design_assets_proof_opts_check check (jsonb_typeof(proof_opts) = 'object' and length(proof_opts::text) <= 500);
alter table public.design_assets drop constraint if exists design_assets_category_check;
alter table public.design_assets add constraint design_assets_category_check
  check (category in ('disc', 'shirts', 'tee_signs', 'flyer', 'logos', 'prize_bucks', 'signage', 'merch', 'other'));

/** The crew's view of the design board: crew-visible designs of their event, newest file first. */
create or replace function public.crew_designs(p_token text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.crew;
begin
  c := public._crew(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'category', a.category, 'title', a.title, 'status', a.status, 'notes', a.notes,
      'proof', a.proof, 'proof_opts', a.proof_opts, 'updated_at', a.updated_at,
      'file', (select jsonb_build_object('id', f.id, 'version', f.version, 'file_name', f.file_name, 'mime', f.mime, 'bytes', f.bytes)
                 from public.design_files f where f.asset_id = a.id order by f.version desc limit 1))
    order by a.category, a.created_at)
    from public.design_assets a where a.event_id = c.event_id and a.crew_visible), '[]');
end $$;

/** Path of one crew-visible file (latest or not) for the signing function. Same checks as crew_designs. */
create or replace function public.crew_design_file(p_token text, p_file uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.crew; r jsonb;
begin
  c := public._crew(p_token);
  select jsonb_build_object('path', f.path, 'file_name', f.file_name) into r
    from public.design_files f join public.design_assets a on a.id = f.asset_id
   where f.id = p_file and a.event_id = c.event_id and a.crew_visible;
  if r is null then raise exception 'not_found'; end if;
  return r;
end $$;

revoke execute on function public.crew_designs(text), public.crew_design_file(text, uuid) from public;
grant execute on function public.crew_designs(text), public.crew_design_file(text, uuid) to anon, authenticated;
