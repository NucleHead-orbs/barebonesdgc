-- Bug Squasher owner = Mike's TD login (mike@yourmindsite.me, the super admin account), not the club gmail seeded in
-- 20261029 (no TD account uses it, and whoever signed up with it later would have become the owner).
insert into public.app_owners (email) values ('mike@yourmindsite.me') on conflict do nothing;
delete from public.app_owners where email = 'superwhite14@gmail.com';
update public.app_releases set published_by = 'mike@yourmindsite.me' where version = '1.0.0' and published_by = 'superwhite14@gmail.com';
