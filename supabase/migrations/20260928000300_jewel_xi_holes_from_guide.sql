-- Jewel XI course: distances, OB and rules from YT & Beard's course guide (the one with the hole updates),
-- confirmed as the source of truth by Mike 2026-09-28. Replaces the handoff values seeded in 20260926000100.
-- Pars are unchanged (6 and 15 are par 4, par 62). This migration refuses to run if any par differs,
-- so it can never change scoring. Narrator quotes are kept, except 18 and 20, whose old quotes described
-- the old island hole.
-- Idempotent: safe to re-run.
do $$
declare bad int;
begin
  select count(*) into bad
  from public.holes h join public.events e on e.id = h.event_id and e.slug = 'jewel-xi-2026'
  join (values (1,3),(2,3),(3,3),(4,3),(5,3),(6,4),(7,3),(8,3),(9,3),(10,3),(11,3),(12,3),(13,3),(14,3),(15,4),(16,3),(17,3),(18,3),(19,3),(20,3)) as p(n, par)
    on p.n = h.n
  where h.par <> p.par;
  if bad > 0 then raise exception 'jewel-xi-2026: % hole par(s) differ from the guide; not applying', bad; end if;
end $$;

update public.holes h set dist_ft = v.dist, ob = v.ob, rules = v.rules, quote = coalesce(v.quote, h.quote)
from public.events e, (values
  (1, 202,'Parking lot, sidewalk & the Boner OB', '{}'::text[], null),
  (2, 322,'Water OB · Mando + drop zone', array['Mando: through the marked trees','Missed mando → drop zone, +1']::text[], null),
  (3, 338,'Green & water OB', '{}'::text[], null),
  (4, 258,'Clear shot', '{}'::text[], null),
  (5, 275,'Green, street, sidewalk & parking lot OB', '{}'::text[], null),
  (6, 558,'Green & fence line OB', '{}'::text[], null),
  (7, 317,'Fence line OB', '{}'::text[], null),
  (8, 279,'Water OB', array['OB: play from last safe location','Watch for golfers on hole 9: they have right of way']::text[], null),
  (9, 280,'Water, green & over the fence OB', array['OB: play from last safe location','Watch for golfers on hole 8']::text[], null),
  (10,280,'Water, culvert to water & over the fence OB · sidewalk outside culvert is IN', array['OB: play from last safe location']::text[], null),
  (11,227,'Water, green, fence line & painted line OB', array['OB: play from last safe location']::text[], null),
  (12,252,'Water & fence line OB', array['OB: play from last safe location']::text[], null),
  (13,251,'Water & greens OB', array['OB: play from last safe location']::text[], null),
  (14,483,'Fence line, green & painted line at end of fence OB', array['OB: play from last safe location']::text[], null),
  (15,558,'Green & painted line right OB · Mando + drop zone', array['Mando: left of the marked tree','Missed mando → drop zone, +1','Just the tip of the penisinsula is OB']::text[], null),
  (16,291,'Water, painted line right, wall & beyond OB', '{}'::text[], null),
  (17,350,'Green OB', array['OB: play from last safe location']::text[], null),
  (18,190,'Island hole · must land safely', array['Miss the island → advance to the Rec/Ladies pad','Shoot from there until you land safe']::text[], 'Island hole mon. You will miss this putt. Jackass.'),
  (19,488,'Fence line right OB', '{}'::text[], null),
  (20,300,'Land it in the square', array['Miss the square → advance to the next tee','Shoot from there until safe']::text[], 'Here we are asking you to put a circle in a square.')
) as v(n, dist, ob, rules, quote)
where e.slug = 'jewel-xi-2026' and h.event_id = e.id and h.n = v.n;
