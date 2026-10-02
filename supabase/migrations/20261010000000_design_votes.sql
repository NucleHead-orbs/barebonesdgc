-- Design votes: the crew + TDs pick between designs (locked 2026-10-02, Mike: "design choice voting board for the crew").
-- Source of truth:
--   design_polls        : one question per event ("Which trophy wins 1st?"), optional closes_at, closed_at, winner.
--   design_poll_options : which design_assets are on the ballot (this event's designs only).
--   design_poll_votes   : one vote per voter per poll: a crew member (crew_id) or a TD (td_email), + optional comment.
-- Rules:
--   * One pick + optional comment, changeable until the poll closes (closed_at set, or closes_at passed).
--   * Crew vote and read only through crew_polls / crew_vote (token). They see totals only after they vote
--     (or once the poll is closed), never who voted for what. TDs see every vote with names (RLS select).
--   * TDs vote through td_vote (their login email). Nobody writes votes directly.
--   * A design on a ballot is viewable by the crew (crew_design_file allows it), even if not crew_visible.
--   * An option with votes can't be removed (FK); deleting the whole poll removes its votes.
--   * Polls are per event; duplicating an event does not copy them.
--   * Safe to re-run.
-- =====================================================================

alter table public.design_assets drop constraint if exists design_assets_category_check;
alter table public.design_assets add constraint design_assets_category_check
  check (category in ('disc', 'shirts', 'tee_signs', 'trophies', 'flyer', 'logos', 'prize_bucks', 'signage', 'merch', 'other'));

create table if not exists public.design_polls (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.events(id) on delete cascade,
  title            text not null check (length(btrim(title)) between 1 and 80),
  question         text check (question is null or length(question) <= 300),
  closes_at        timestamptz,
  closed_at        timestamptz,
  winner_option_id uuid,
  created_by       text,
  created_at       timestamptz not null default now()
);
create index if not exists design_polls_event on public.design_polls(event_id, created_at);

create table if not exists public.design_poll_options (
  id         uuid primary key default gen_random_uuid(),
  poll_id    uuid not null references public.design_polls(id) on delete cascade,
  asset_id   uuid not null references public.design_assets(id) on delete cascade,
  sort       integer not null default 0,
  unique (poll_id, asset_id),
  unique (id, poll_id)
);

alter table public.design_polls drop constraint if exists design_polls_winner_fkey;
alter table public.design_polls add constraint design_polls_winner_fkey
  foreign key (winner_option_id) references public.design_poll_options(id) on delete set null;

create table if not exists public.design_poll_votes (
  id         uuid primary key default gen_random_uuid(),
  poll_id    uuid not null references public.design_polls(id) on delete cascade,
  option_id  uuid not null,
  crew_id    uuid references public.crew(id) on delete cascade,
  td_email   text check (td_email is null or td_email = lower(btrim(td_email))),
  comment    text check (comment is null or length(comment) <= 280),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(crew_id, td_email) = 1),
  unique (poll_id, crew_id),
  unique (poll_id, td_email),
  -- the pick must be an option of this poll; an option with votes can't be deleted on its own
  foreign key (option_id, poll_id) references public.design_poll_options(id, poll_id)
);

-- ---------- integrity triggers ----------
create or replace function public._poll_option_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select event_id from public.design_assets where id = new.asset_id)
     is distinct from (select event_id from public.design_polls where id = new.poll_id) then
    raise exception 'wrong_event';
  end if;
  return new;
end $$;
drop trigger if exists design_poll_options_check on public.design_poll_options;
create trigger design_poll_options_check before insert or update on public.design_poll_options
  for each row execute function public._poll_option_check();

create or replace function public._poll_winner_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.winner_option_id is not null
     and not exists (select 1 from public.design_poll_options where id = new.winner_option_id and poll_id = new.id) then
    raise exception 'winner_not_an_option';
  end if;
  if tg_op = 'UPDATE' and new.event_id <> old.event_id then raise exception 'wrong_event'; end if;
  return new;
end $$;
drop trigger if exists design_polls_check on public.design_polls;
create trigger design_polls_check before insert or update on public.design_polls
  for each row execute function public._poll_winner_check();

create or replace function public._poll_open(p public.design_polls) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select p.closed_at is null and (p.closes_at is null or p.closes_at > now())
$$;

-- ---------- RLS: TD-only; votes are read-only to TDs (writes go through the RPCs) ----------
alter table public.design_polls        enable row level security;
alter table public.design_poll_options enable row level security;
alter table public.design_poll_votes   enable row level security;
revoke all on public.design_polls, public.design_poll_options, public.design_poll_votes from anon, authenticated;
grant select, insert, update, delete on public.design_polls, public.design_poll_options to authenticated;
grant select on public.design_poll_votes to authenticated;
drop policy if exists "td only" on public.design_polls;
create policy "td only" on public.design_polls for all to authenticated using (public.can_td(event_id)) with check (public.can_td(event_id));
drop policy if exists "td only" on public.design_poll_options;
create policy "td only" on public.design_poll_options for all to authenticated
  using (public.can_td((select p.event_id from public.design_polls p where p.id = poll_id)))
  with check (public.can_td((select p.event_id from public.design_polls p where p.id = poll_id)));
drop policy if exists "td reads" on public.design_poll_votes;
create policy "td reads" on public.design_poll_votes for select to authenticated
  using (public.can_td((select p.event_id from public.design_polls p where p.id = poll_id)));

-- ---------- the crew's ballot ----------
/** One poll as the voter sees it. Totals only once v_mine is set or the poll is closed. */
create or replace function public._poll_view(p public.design_polls, p_crew uuid, p_email text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_mine jsonb; v_open boolean := public._poll_open(p); v_show boolean;
begin
  select jsonb_build_object('option_id', v.option_id, 'comment', v.comment, 'updated_at', v.updated_at) into v_mine
    from public.design_poll_votes v
   where v.poll_id = p.id and ((p_crew is not null and v.crew_id = p_crew) or (p_email is not null and v.td_email = p_email));
  v_show := v_mine is not null or not v_open;
  return jsonb_build_object(
    'id', p.id, 'title', p.title, 'question', p.question, 'closes_at', p.closes_at, 'open', v_open,
    'winner_option_id', case when not v_open then p.winner_option_id end,
    'mine', v_mine,
    'total', case when v_show then (select count(*) from public.design_poll_votes where poll_id = p.id) end,
    'options', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'asset_id', a.id, 'title', a.title, 'notes', a.notes,
        'votes', case when v_show then (select count(*) from public.design_poll_votes v where v.option_id = o.id) end,
        'file', (select jsonb_build_object('id', f.id, 'version', f.version, 'file_name', f.file_name, 'mime', f.mime)
                   from public.design_files f where f.asset_id = a.id order by f.version desc limit 1))
      order by o.sort, a.title)
      from public.design_poll_options o join public.design_assets a on a.id = o.asset_id where o.poll_id = p.id), '[]'));
end $$;

/** Every poll on the crew member's event that has a ballot, open ones first, newest first. */
create or replace function public.crew_polls(p_token text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.crew;
begin
  c := public._crew(p_token);
  return coalesce((select jsonb_agg(public._poll_view(p, c.id, null) order by public._poll_open(p) desc, p.created_at desc)
    from public.design_polls p
   where p.event_id = c.event_id and exists (select 1 from public.design_poll_options o where o.poll_id = p.id)), '[]');
end $$;

create or replace function public._cast_vote(p public.design_polls, p_option uuid, p_comment text, p_crew uuid, p_email text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if not public._poll_open(p) then raise exception 'poll_closed'; end if;
  if not exists (select 1 from public.design_poll_options where id = p_option and poll_id = p.id) then raise exception 'not_an_option'; end if;
  if length(v_comment) > 280 then raise exception 'comment_too_long'; end if;
  if p_crew is not null then
    insert into public.design_poll_votes (poll_id, option_id, crew_id, comment) values (p.id, p_option, p_crew, v_comment)
    on conflict (poll_id, crew_id) do update set option_id = excluded.option_id, comment = excluded.comment, updated_at = now();
  else
    insert into public.design_poll_votes (poll_id, option_id, td_email, comment) values (p.id, p_option, p_email, v_comment)
    on conflict (poll_id, td_email) do update set option_id = excluded.option_id, comment = excluded.comment, updated_at = now();
  end if;
end $$;

/** Crew vote (or change their vote). Returns the poll as they now see it (with totals). */
create or replace function public.crew_vote(p_token text, p_poll uuid, p_option uuid, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.crew; p public.design_polls;
begin
  c := public._crew(p_token);
  select * into p from public.design_polls where id = p_poll and event_id = c.event_id for update;
  if not found then raise exception 'not_found'; end if;
  perform public._cast_vote(p, p_option, p_comment, c.id, null);
  return public._poll_view(p, c.id, null);
end $$;

/** TD vote (or change). The vote is tied to the TD's login email. */
create or replace function public.td_vote(p_poll uuid, p_option uuid, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.design_polls; v_me text := public.my_email();
begin
  select * into p from public.design_polls where id = p_poll for update;
  if not found or not public.can_td(p.event_id) then raise exception 'not_found'; end if;
  if v_me is null then raise exception 'not_signed_in'; end if;
  perform public._cast_vote(p, p_option, p_comment, null, v_me);
  return public._poll_view(p, null, v_me);
end $$;

-- ---------- crew can open the files of designs on a ballot ----------
create or replace function public.crew_design_file(p_token text, p_file uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.crew; r jsonb;
begin
  c := public._crew(p_token);
  select jsonb_build_object('path', f.path, 'file_name', f.file_name) into r
    from public.design_files f join public.design_assets a on a.id = f.asset_id
   where f.id = p_file and a.event_id = c.event_id
     and (a.crew_visible or exists (select 1 from public.design_poll_options o where o.asset_id = a.id));
  if r is null then raise exception 'not_found'; end if;
  return r;
end $$;

revoke execute on function public._poll_view(public.design_polls, uuid, text), public._cast_vote(public.design_polls, uuid, text, uuid, text),
  public._poll_open(public.design_polls) from public, anon, authenticated;
revoke execute on function public.crew_polls(text), public.crew_vote(text, uuid, uuid, text), public.td_vote(uuid, uuid, text),
  public.crew_design_file(text, uuid) from public;
revoke execute on function public.td_vote(uuid, uuid, text) from anon;
grant execute on function public._poll_open(public.design_polls) to authenticated;
grant execute on function public.crew_polls(text), public.crew_vote(text, uuid, uuid, text), public.crew_design_file(text, uuid) to anon, authenticated;
grant execute on function public.td_vote(uuid, uuid, text) to authenticated;
