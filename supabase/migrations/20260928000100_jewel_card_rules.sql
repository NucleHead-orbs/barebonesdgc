-- Jewel XI's locked card rules (2026-09-26) move from app defaults into its own saved settings,
-- so every other event starts clean (no Jewel double-up order on someone else's course).
-- PM divisions are not stored here: they come from divisions.wave_default (the build menu).
-- Only fills a round that has no saved settings yet; never overwrites a TD's edits.
insert into public.builder_settings (event_id, round, settings)
select e.id, r.round, jsonb_build_object('doubleUp', jsonb_build_array(6, 15, 14, 19, 17, 16),
                                         'sortBy', case when r.round = 1 then 'reg' else 'r1' end)
from public.events e cross join (values (1::smallint), (2::smallint)) r(round)
where e.slug = 'jewel-xi-2026'
on conflict (event_id, round) do nothing;
