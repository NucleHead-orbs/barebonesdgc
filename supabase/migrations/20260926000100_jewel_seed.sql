-- Jewel XI reference data: event, 20 holes (source: HOLES array in the design handoff), divisions.
-- Idempotent: safe to re-run.
insert into public.events (slug, name, starts_on, ends_on)
values ('jewel-xi-2026', 'The Bare Bones Jewel XI World Tour', '2026-11-21', '2026-11-22')
on conflict (slug) do update set name = excluded.name, starts_on = excluded.starts_on, ends_on = excluded.ends_on;

insert into public.holes (event_id, n, par, dist_ft, ob, quote, rules)
select e.id, v.n, v.par, v.dist, v.ob, v.quote, v.rules
from public.events e, (values
  (1,3,192,'Green, parking lot & sidewalk OB','The Boner, parking lot & sidewalk are all OB!','{}'::text[]),
  (2,3,321,'Pond OB · Mando + DZ','Gotta make it through them there trees, and the pond is OB!',array['Mando: pass between the trees','Missed mando → head to the DZ']::text[]),
  (3,3,336,'Green & pond OB','Don''t go on the green or in the pond, they''re OB. Ya idjit.','{}'::text[]),
  (4,3,258,'Clear shot','Try not to hit any trees, ya got a clear shot dummy!','{}'::text[]),
  (5,3,267,'Green, parking lot & sidewalk OB','The Green, parking lot & sidewalk are all OB!','{}'::text[]),
  (6,4,570,'Green, curb R, fence long, painted line R OB','Relax, you''re gonna be fine. Or maybe you won''t.','{}'::text[]),
  (7,3,320,'Over the fence OB','You go over the fence, you go OB! Ya idjit.','{}'::text[]),
  (8,3,300,'Water OB','See that water? Yeah, that''s prolly gonna be OB. Like for sure.','{}'::text[]),
  (9,3,288,'Green, lake & fence long OB','I''m a lake. Feed me. Don''t suck!','{}'::text[]),
  (10,3,348,'Lake, green, fence, drainage OB · cart path IN','Lot''s o'' OB! This could get dicey.','{}'::text[]),
  (11,3,270,'Green, lake, fence, wall, painted line R OB','Be good or be dead!','{}'::text[]),
  (12,3,249,'Green, lake & over fence OB','Hit the green, land in the lake, or go over the fence… YOU''RE BONED!!','{}'::text[]),
  (13,3,345,'Lake & greens OB · bunker is fine','Your discs are miiine. Yeah. All that just happened.','{}'::text[]),
  (14,3,447,'Green & driving range OB','Thinking about the driving range or the green? Don''t. That''s stupid.','{}'::text[]),
  (15,4,510,'Green & lake OB · Mando + DZ','Keep it LEFT of those marked trees. Missed the mando? Head to the DZ, bonehead.',array['Mando: keep LEFT of the marked trees','Missed mando → head to the DZ']::text[]),
  (16,3,357,'Lake OB','Brought to you by the fine folks at the American Red Cross.','{}'::text[]),
  (17,3,369,'Green & painted line OB','For the love of Shultzy STOP THROWING ON THE GREEN! Idjit.','{}'::text[]),
  (18,3,189,'All OB off the fairway','Yup, all OB. Play it where it last crossed safe. You''re welcome.',array['OB: play from where it last crossed safe']::text[]),
  (19,3,400,'OB left & right','Send it straight down the ol'' poop chute.','{}'::text[]),
  (20,3,250,'Island hole · DZ if missed','Island hole mon. Shoot until made. You will miss this putt. Jackass.',array['Miss the island → advance to DZ','Shoot from the DZ until made']::text[])
) as v(n, par, dist, ob, quote, rules)
where e.slug = 'jewel-xi-2026'
on conflict (event_id, n) do update set par = excluded.par, dist_ft = excluded.dist_ft,
  ob = excluded.ob, quote = excluded.quote, rules = excluded.rules;

insert into public.divisions (event_id, code, sort, wave_default)
select e.id, v.code, v.sort, v.wave
from public.events e, (values
  ('MPO',1,'PM'),
  ('FPO',2,'PM'),
  ('MP40',3,'PM'),
  ('FP40',4,'PM'),
  ('MP50',5,'PM'),
  ('MP55',6,'PM'),
  ('MA1',7,'PM'),
  ('FA1',8,'AM'),
  ('MA40',9,'PM'),
  ('MA50',10,'AM'),
  ('MA60',11,'AM'),
  ('MA2',12,'AM'),
  ('FA2',13,'AM'),
  ('MA3',14,'AM'),
  ('FA3',15,'AM')
) as v(code, sort, wave)
where e.slug = 'jewel-xi-2026'
on conflict (event_id, code) do update set sort = excluded.sort, wave_default = excluded.wave_default;
