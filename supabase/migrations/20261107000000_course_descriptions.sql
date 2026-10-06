-- Course descriptions (locked 2026-10-06, Mike: "Maybe we should start a course description section, I could probably have
-- some fun with that." Answers: a public Courses page + the scorecard; only the owner writes them).
-- Source of truth: courses.description = the owner's write-up (public). courses.notes stays the TDs' working note.
-- Rules: owner_course_describe(course, text): is_owner() only; 0-1500 characters; blank clears it. **double stars** = bold,
-- blank line = new paragraph (rendered by the site). Anyone can read it with the rest of the course library.
-- =====================================================================

alter table public.courses add column if not exists description text;
alter table public.courses drop constraint if exists courses_description_check;
alter table public.courses add constraint courses_description_check check (description is null or length(description) between 1 and 1500);
alter table public.courses add column if not exists description_at timestamptz;

create or replace function public.owner_course_describe(p_course uuid, p_text text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t text := nullif(btrim(coalesce(p_text, '')), '');
begin
  perform public._need_owner();
  if t is not null and length(t) > 1500 then raise exception 'too_long'; end if;
  update public.courses set description = t, description_at = now() where id = p_course;
  if not found then raise exception 'not_found'; end if;
end $$;
revoke execute on function public.owner_course_describe(uuid, text) from public, anon;
grant execute on function public.owner_course_describe(uuid, text) to authenticated;

-- TDs can edit courses directly (course library); the description stays the owner's.
create or replace function public._course_description_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated')
     and (new.description is distinct from (case when tg_op = 'UPDATE' then old.description end)
          or new.description_at is distinct from (case when tg_op = 'UPDATE' then old.description_at end))
     and not public.is_owner() then
    raise exception 'forbidden';
  end if;
  return new;
end $$;
drop trigger if exists courses_description_guard on public.courses;
create trigger courses_description_guard before insert or update on public.courses for each row execute function public._course_description_guard();
