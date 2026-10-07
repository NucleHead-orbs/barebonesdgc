-- =====================================================================
-- Round stories + @mentions (locked 2026-10-06, Mike: "generate fun summaries of the round results and add that to the
-- Settled round results message" + "add a way to @mention at players").
-- Choices: house roast engine (no AI), every applied tag round, Full Bare Bones tone, mentions highlight + ping.
--
-- Source of truth: tag_matches + tag_match_players (scores, tag_before/after, set by _tag_apply) and, when the round
-- came from the Scorecard, club_rounds/club_round_players (hole by hole). Nothing new is stored for stories: the text
-- lands in the Board post (tag_chat, kind 'system').
--
-- Rules (deterministic: same round -> same story; a line is picked by hashing the match id):
--   * Winner = best score (ties: the better tag after the swap). Margin = runner-up minus winner.
--     0 tie | 1-2 nail-biter | 3-5 solid | 6+ blowout. One line from that bank.
--   * Hole-by-hole (Scorecard rounds only), in this order, max 3 extras: an ace, else an eagle; the birdie leader (3+);
--     the worst blow-up (3+ over par on a hole); the winner going bogey-free (9+ holes, every hole scored);
--     last place when 3+ played (alone at the bottom). Then the winner's tag move.
--   * A round that settles a challenge: the SETTLED post gets the story. Any other applied tag round: a RESULTS post
--     (event 'result') with the scores + the story. Only sets with the Board on (same as every house post).
--
-- @mentions: a Board message that contains "@<name>" of someone holding a tag in that set (nickname, or name) records
-- a mention (tag_chat_mentions). Longest names win ("@Danny Walden" is Danny Walden, not a "Danny"); not yourself;
-- 10 per message max. _tag_chat_rows returns 'mentions' [{id, label}] per line. tag_mentions(token) = my mentions
-- from the last 14 days (still in the set, message not hidden, Board on) for the My Tag bell.
-- =====================================================================

-- ---------- stories ----------
create or replace function public._bb_pick(p_seed text, p_lines text[]) returns text
language sql immutable set search_path = public, pg_temp as $$
  select p_lines[1 + (abs(hashtext(p_seed)::bigint) % cardinality(p_lines))::int]
$$;

create or replace function public._bb_fill(p text, p_keys text[], p_vals text[]) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare out text := p;
begin
  for i in 1 .. coalesce(cardinality(p_keys), 0) loop
    out := replace(out, '{' || p_keys[i] || '}', coalesce(p_vals[i], ''));
  end loop;
  return out;
end $$;

create or replace function public._tag_story_holes(p_round uuid, p_ids uuid[], p_names text[])
returns table (member_id uuid, name text, hole int, label text, score int, par int)
language sql stable security definer set search_path = public, pg_temp as $$
  select cp.member_id, p_names[array_position(p_ids, cp.member_id)], h.i::int,
         coalesce(nullif(cr.hole_labels[h.i::int], ''), h.i::text), h.s::int, cr.pars[h.i::int]::int
    from public.club_rounds cr join public.club_round_players cp on cp.round_id = cr.id
    cross join lateral unnest(cp.scores) with ordinality h(s, i)
   where cr.id = p_round and cp.member_id = any(p_ids) and h.s is not null and cr.pars[h.i::int] is not null
$$;

create or replace function public._tag_round_story(p_match uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  m public.tag_matches;
  ids uuid[]; nm text[]; sc int[]; tb int[]; ta int[];
  n int; w text; r text; l text; mg int; seed text; out text[] := '{}'; extras int := 0;
  k text[] := array['w', 'r', 'l', 'm', 's', 't']; v text[];
  ace record; eagle record; bird record; blow record; clean boolean;
begin
  select * into m from public.tag_matches where id = p_match;
  if not found then return ''; end if;
  select array_agg(p.member_id order by p.score, p.tag_after nulls last, p.member_id),
         array_agg(coalesce(nullif(btrim(x.nickname), ''), x.name) order by p.score, p.tag_after nulls last, p.member_id),
         array_agg(p.score order by p.score, p.tag_after nulls last, p.member_id),
         array_agg(p.tag_before order by p.score, p.tag_after nulls last, p.member_id),
         array_agg(p.tag_after order by p.score, p.tag_after nulls last, p.member_id)
    into ids, nm, sc, tb, ta
    from public.tag_match_players p join public.tag_members x on x.id = p.member_id
   where p.match_id = p_match and p.score is not null;
  n := coalesce(cardinality(ids), 0);
  if n < 2 then return ''; end if;
  w := nm[1]; r := nm[2]; l := nm[n]; mg := sc[2] - sc[1]; seed := p_match::text;
  v := array[w, r, l, mg::text, case when mg = 1 then 'stroke' else 'strokes' end, sc[1]::text];

  out := out || public._bb_fill(case
    when mg = 0 then public._bb_pick(seed || 'tie', array[
      'Dead even at {t}. Nobody finished first, and there''s no shame in that.',
      'Tied at {t}. Everybody went home a little unsatisfied. The tags settled it.',
      '{t} apiece. Same length, same result. The tag rules broke the tie.'])
    when mg <= 2 then public._bb_pick(seed || 'close', array[
      '{w} by {m} {s}. Tight. Uncomfortably tight.',
      '{w} edged {r} by {m}. {r} pulled out a little too early.',
      '{w} by a hair ({m}). {r} will be thinking about this one in the shower.',
      '{m} {s} in it. {r} got close, but close only counts in horseshoes and hand grenades.'])
    when mg <= 5 then public._bb_pick(seed || 'solid', array[
      '{w} by {m}. Firm, steady, no performance issues.',
      '{w} handled {r} by {m}. {r} showed up, {w} showed off.',
      '{w} by {m}. {r} kept it in the fairway, just not long enough.',
      '{w} by {m}. {r} ran out of stamina down the stretch.'])
    else public._bb_pick(seed || 'blowout', array[
      '{w} by {m}. That wasn''t a round, that was a public spanking.',
      '{w} won by {m}. {r} came up short all day and blamed the wind.',
      '{m} strokes. {r} is going to need a minute. And maybe some ice.',
      '{w} by {m}. {r} brought a putter to a pissing contest.'])
  end, k, v);

  -- hole by hole, when the round came off the Scorecard
  if m.round_id is not null and exists (select 1 from public.club_rounds where id = m.round_id and not coalesce(totals_only, false)) then
    select name, label into ace from public._tag_story_holes(m.round_id, ids, nm) where score = 1 order by hole, name limit 1;
    if found then
      out := out || public._bb_fill(public._bb_pick(seed || 'ace', array[
        'ACE by {p} on hole {h}. Chains are still shaking and so is {p}.',
        '{p} ACED hole {h}. First round''s on {p}.']), array['p', 'h'], array[ace.name, ace.label]);
      extras := extras + 1;
    else
      select name, label into eagle from public._tag_story_holes(m.round_id, ids, nm) where score > 1 and score <= par - 2 order by hole, name limit 1;
      if found then
        out := out || public._bb_fill(public._bb_pick(seed || 'eagle', array[
          '{p} eagled hole {h}. Nobody asked, but we all saw it.',
          'Eagle on hole {h} from {p}. Showing off is a lifestyle.']), array['p', 'h'], array[eagle.name, eagle.label]);
        extras := extras + 1;
      end if;
    end if;

    select name, count(*)::int c into bird from public._tag_story_holes(m.round_id, ids, nm) where score = par - 1 group by name order by count(*) desc, min(hole) limit 1;
    if found and bird.c >= 3 then
      out := out || public._bb_fill(public._bb_pick(seed || 'bird', array[
        '{p} dropped {n} birdies. Cocky, and earned it.',
        '{n} birdies from {p}. Somebody''s been practicing alone.']), array['p', 'n'], array[bird.name, bird.c::text]);
      extras := extras + 1;
    end if;

    select name, label, score into blow from public._tag_story_holes(m.round_id, ids, nm) where score - par >= 3 order by score - par desc, hole limit 1;
    if found and extras < 3 then
      out := out || public._bb_fill(public._bb_pick(seed || 'blow', array[
        '{p} took {x} on hole {h}. We don''t talk about hole {h}.',
        '{p} carded {x} on hole {h}. It happens to everyone. Mostly {p}.']), array['p', 'h', 'x'], array[blow.name, blow.label, case when blow.score in (8, 11, 18) then 'an ' else 'a ' end || blow.score]);
      extras := extras + 1;
    end if;

    select count(*) >= 9 and bool_and(score <= par)
           and count(*) = (select cardinality(pars) from public.club_rounds where id = m.round_id)
      into clean from public._tag_story_holes(m.round_id, ids, nm) where member_id = ids[1];
    if coalesce(clean, false) and extras < 3 then
      out := out || public._bb_fill(public._bb_pick(seed || 'clean', array[
        '{w} went bogey-free. Clean as a fresh bag tag.',
        'Not one bogey from {w}. Smooth operator.']), k, v);
      extras := extras + 1;
    end if;
  end if;

  if n >= 3 and extras < 3 and sc[n] > sc[n - 1] then
    out := out || public._bb_fill(public._bb_pick(seed || 'last', array[
      '{l} brought up the rear. As usual.',
      '{l} finished last and called it "a nice walk".']), k, v);
  end if;

  if ta[1] is not null and tb[1] is not null and ta[1] < tb[1] then
    out := out || ('{w} climbs from #' || tb[1] || ' to #' || ta[1] || '.');
  elsif ta[1] is not null then
    out := out || ('{w} keeps #' || ta[1] || '.');
  end if;
  return public._bb_fill(array_to_string(out, ' '), k, v);
end $$;

-- house posts get a 'result' event (every other applied tag round)
alter table public.tag_chat drop constraint if exists tag_chat_kind_check;
alter table public.tag_chat add constraint tag_chat_kind_check check (
  (kind = 'chat' and event is null) or
  (kind = 'system' and member_id is null and event in ('challenge', 'accepted', 'declined', 'expired', 'played', 'lapsed', 'bomb', 'penalty', 'matchmaker',
                                                       'scheduled', 'jumpin', 'dropout', 'vouched', 'result')));

-- SETTLED keeps its headline and gains the story
create or replace function public._tag_challenge_news() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare a text := public._tag_who(new.pool_id, new.challenger_id); b text := public._tag_who(new.pool_id, new.challenged_id);
        an int; bn int; story text;
begin
  if tg_op = 'INSERT' then
    perform public._tag_news(new.pool_id, 'challenge', a || ' called out ' || b || '. 48 hours to answer.');
  elsif new.status is distinct from old.status then
    if new.status = 'accepted' then
      perform public._tag_news(new.pool_id, 'accepted', b || ' accepted ' || a || '''s challenge. 7 days to play it.');
    elsif new.status = 'declined' then
      perform public._tag_news(new.pool_id, 'declined', b || ' ducked ' || a || '''s challenge.');
    elsif new.status = 'expired' then
      perform public._tag_news(new.pool_id, 'expired', b || ' went silent on ' || a || '''s challenge. Counts as a decline.');
    elsif new.status = 'played' then
      select number into an from public.tags where pool_id = new.pool_id and holder_id = new.challenger_id;
      select number into bn from public.tags where pool_id = new.pool_id and holder_id = new.challenged_id;
      story := case when new.match_id is not null then public._tag_round_story(new.match_id) else '' end;
      perform public._tag_news(new.pool_id, 'played', case
        when an is not null and bn is not null and an < bn then 'Challenge settled: ' || a || ' took the higher tag from ' || b || '.'
        else 'Challenge settled: ' || b || ' held off ' || a || '.' end || coalesce(nullif(' ' || story, ' '), ''));
    elsif new.status = 'lapsed' then
      perform public._tag_news(new.pool_id, 'lapsed', a || ' vs ' || b || ' never got played. Challenge lapsed.');
    end if;
  end if;
  return new;
end $$;

-- applied tag rounds: settle a challenge (SETTLED post) or post RESULTS
create or replace function public._tag_challenge_played() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare settled int; line text;
begin
  if new.status = 'applied' and old.status is distinct from 'applied' then
    update public.tag_challenges c set status = 'played', match_id = new.id
     where c.pool_id = new.pool_id and c.status = 'accepted'
       and exists (select 1 from public.tag_match_players p where p.match_id = new.id and p.member_id = c.challenger_id)
       and exists (select 1 from public.tag_match_players p where p.match_id = new.id and p.member_id = c.challenged_id);
    get diagnostics settled = row_count;
    if settled = 0 then
      select string_agg(coalesce(nullif(btrim(x.nickname), ''), x.name) || ' ' || p.score, ', ' order by p.score, p.tag_after nulls last, p.member_id)
        into line from public.tag_match_players p join public.tag_members x on x.id = p.member_id where p.match_id = new.id and p.score is not null;
      if line is not null then
        perform public._tag_news(new.pool_id, 'result',
          'Tag round' || coalesce(' at ' || nullif(btrim(new.course), ''), '') || ': ' || line || '. ' || public._tag_round_story(new.id));
      end if;
    end if;
  end if;
  return new;
end $$;

-- ---------- @mentions ----------
create table if not exists public.tag_chat_mentions (
  chat_id   bigint not null references public.tag_chat(id) on delete cascade,
  member_id uuid not null references public.tag_members(id) on delete cascade,
  label     text not null,
  primary key (chat_id, member_id)
);
create index if not exists tag_chat_mentions_member on public.tag_chat_mentions (member_id, chat_id desc);
alter table public.tag_chat_mentions enable row level security;
revoke all on public.tag_chat_mentions from anon, authenticated;

create or replace function public._re_escape(p text) returns text
language sql immutable set search_path = public, pg_temp as $$ select regexp_replace(p, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') $$;

create or replace function public._tag_chat_mentions() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare txt text := new.body; c record; pat text; hits int := 0;
begin
  if new.kind <> 'chat' or position('@' in txt) = 0 then return new; end if;
  for c in
    select x.id, lbl from public.tags t join public.tag_members x on x.id = t.holder_id
      cross join lateral (select distinct unnest(array[nullif(btrim(x.nickname), ''), btrim(x.name)]) lbl) z
     where t.pool_id = new.pool_id and x.id is distinct from new.member_id and lbl is not null and length(lbl) >= 2
     order by length(lbl) desc, lbl
  loop
    exit when hits >= 10;
    pat := '(^|[^[:alnum:]_])@' || public._re_escape(c.lbl) || '($|[^[:alnum:]_])';
    if txt ~* pat then
      insert into public.tag_chat_mentions (chat_id, member_id, label) values (new.id, c.id, c.lbl) on conflict do nothing;
      if found then hits := hits + 1; end if;
      txt := regexp_replace(txt, '@' || public._re_escape(c.lbl), '', 'gi');  -- a longer name already claimed this text
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists tag_chat_mentions_ins on public.tag_chat;
create trigger tag_chat_mentions_ins after insert on public.tag_chat for each row execute function public._tag_chat_mentions();

-- same signature: lines gain 'mentions'
create or replace function public._tag_chat_rows(p_pool uuid, p_after bigint, p_all boolean) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(r order by (r->>'id')::bigint), '[]'::jsonb) from (
    select jsonb_build_object('id', c.id, 'member_id', c.member_id, 'name', m.name, 'nickname', m.nickname, 'body', c.body, 'at', c.at,
             'number', (select number from public.tags where pool_id = c.pool_id and holder_id = c.member_id), 'hidden', c.hidden,
             'kind', c.kind, 'event', c.event,
             'mentions', coalesce((select jsonb_agg(jsonb_build_object('id', cm.member_id, 'label', cm.label) order by cm.label)
                                     from public.tag_chat_mentions cm where cm.chat_id = c.id), '[]'::jsonb)) r
      from public.tag_chat c left join public.tag_members m on m.id = c.member_id
     where c.pool_id = p_pool and c.id > coalesce(p_after, 0) and (p_all or not c.hidden)
     order by c.id desc limit 150) z
$$;

/** My @mentions, newest first: last 14 days, sets I still hold a tag in, Board on, message not hidden. */
create or replace function public.tag_mentions(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me public.tag_members;
begin
  me := public._tag_member(p_token);
  return coalesce((select jsonb_agg(j order by (j->>'chat_id')::bigint desc) from (
    select jsonb_build_object('chat_id', c.id, 'pool_id', po.id, 'pool', po.slug,
             'from', coalesce(nullif(btrim(x.nickname), ''), x.name), 'body', left(c.body, 160), 'at', c.at) j
      from public.tag_chat_mentions cm
      join public.tag_chat c on c.id = cm.chat_id
      join public.tag_pools po on po.id = c.pool_id
      left join public.tag_members x on x.id = c.member_id
     where cm.member_id = me.id and not c.hidden and po.chat and c.at > now() - interval '14 days'
       and exists (select 1 from public.tags t where t.pool_id = po.id and t.holder_id = me.id)
     order by c.id desc limit 30) z), '[]'::jsonb);
end $$;
revoke all on function public.tag_mentions(text) from public;
grant execute on function public.tag_mentions(text) to anon, authenticated;
revoke all on function public._tag_round_story(uuid), public._tag_chat_mentions(), public._tag_story_holes(uuid, uuid[], text[]), public._bb_pick(text, text[]), public._bb_fill(text, text[], text[]), public._re_escape(text) from public, anon, authenticated;
