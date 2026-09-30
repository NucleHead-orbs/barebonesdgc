-- Innova custom disc orders (PREP → INNOVA ORDER).
--   Source of truth for the catalog = Innova's own order form (.xlsx) that the TD uploads. It is stored
--   untouched in the private event-assets bucket at <event_id>/innova/<order_id>/<file>, parsed in the
--   browser (src/lib/innova/form.ts) and filled back in on export. Nothing about molds or prices lives here.
--   disc_orders.lines   : {"<sheet row>": {"mold": "<name on the form>", "q": {"M": 10, "N": 5, ...}}}
--                         The mold name guards the row: a newer form is re-matched by name (remapLines).
--   disc_orders.details : what goes in the form's header (dates, contact, addresses, artwork, die, notes).
--                         Card number / expiry / CVC are NEVER stored: the TD types them into the file.
-- TD-only (can_td), same as every PREP table.

create table if not exists public.disc_orders (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  title       text not null default 'Innova order' check (length(btrim(title)) between 1 and 80),
  form_path   text check (form_path is null or length(form_path) <= 300),
  form_name   text check (form_name is null or length(form_name) <= 200),
  form_label  text check (form_label is null or length(form_label) <= 80),
  lines       jsonb not null default '{}' check (jsonb_typeof(lines) = 'object'),
  details     jsonb not null default '{}' check (jsonb_typeof(details) = 'object'
                and not (details ?| array['card', 'cc', 'card_number', 'cvc', 'cvv', 'exp', 'expiry'])),
  status      text not null default 'draft' check (status in ('draft', 'sent')),
  sent_at     timestamptz,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists disc_orders_event on public.disc_orders(event_id, created_at);

create or replace function public._disc_orders_touch() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.sent_at := case when new.status = 'sent' then coalesce(new.sent_at, now()) else null end;
  return new;
end $$;
drop trigger if exists disc_orders_touch on public.disc_orders;
create trigger disc_orders_touch before insert or update on public.disc_orders
  for each row execute function public._disc_orders_touch();

alter table public.disc_orders enable row level security;
drop policy if exists "td only" on public.disc_orders;
create policy "td only" on public.disc_orders for all to authenticated
  using (public.can_td(event_id)) with check (public.can_td(event_id));
revoke all on public.disc_orders from anon;
grant select, insert, update, delete on public.disc_orders to authenticated;
