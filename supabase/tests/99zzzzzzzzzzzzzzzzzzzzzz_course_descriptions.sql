-- Course descriptions. Owner = mike@yourmindsite.me (bug squasher test made that auth user).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.refused(sql text, want text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm like '%' || want || '%'; end $$;
grant execute on function pg_temp.refused(text, text) to anon, authenticated;
insert into courses (name) values ('Describe Park');
create temp table d_ctx (k text primary key, v text);
grant all on d_ctx to anon, authenticated;
insert into d_ctx select 'c', id::text from courses where name = 'Describe Park';
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from d_ctx where k = key $$;
grant execute on function pg_temp.v(text) to anon, authenticated;
set client_min_messages = notice;

select set_config('request.jwt.claims', '', false); set role anon;
select pg_temp.ok(pg_temp.refused(format('select owner_course_describe(%L, ''hi'')', pg_temp.v('c')), 'permission denied'), 'anon can''t write');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000f02')::text, false); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select owner_course_describe(%L, ''hi'')', pg_temp.v('c')), 'forbidden'), 'other signed-in people can''t write');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000f01')::text, false); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('select owner_course_describe(%L, %L)', pg_temp.v('c'), repeat('x', 1501)), 'too_long'), '1500 characters max');
select owner_course_describe(pg_temp.v('c')::uuid, '  Trees eat discs. **Bring a spare.**  ');
reset role;
select set_config('request.jwt.claims', '', false); set role anon;
select pg_temp.ok((select description = 'Trees eat discs. **Bring a spare.**' and description_at is not null from courses where id = pg_temp.v('c')::uuid), 'anyone reads it (trimmed)');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000f01')::text, false); set role authenticated;
select owner_course_describe(pg_temp.v('c')::uuid, '   ');
reset role;
select pg_temp.ok((select description is null from courses where id = pg_temp.v('c')::uuid), 'blank clears it');
select set_config('request.jwt.claims', '', false);
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000f02', 'app_metadata', json_build_object('role', 'td'))::text, false); set role authenticated;
select pg_temp.ok(pg_temp.refused(format('update courses set description = ''sneaky'' where id = %L', pg_temp.v('c')), 'forbidden'), 'a TD editing the library can''t touch the write-up');
update courses set notes = 'TD note' where id = pg_temp.v('c')::uuid;
reset role;
select pg_temp.ok((select notes = 'TD note' from courses where id = pg_temp.v('c')::uuid), 'but can still edit the rest');
select set_config('request.jwt.claims', '', false);
