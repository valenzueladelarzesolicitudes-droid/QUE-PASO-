begin;

create table public.supplier_orders (
  id uuid primary key default gen_random_uuid(),
  supplier text not null check (length(btrim(supplier)) between 1 and 180),
  month smallint not null check (month between 1 and 12),
  year smallint not null check (year between 1900 and 9999),
  order_number text check (length(order_number) between 1 and 100),
  invoice_number text check (length(invoice_number) between 1 and 100),
  status text check (status in ('pending', 'received', 'entered')),
  received_on date check (received_on between '0001-01-01' and '9999-12-31'),
  notes text check (length(notes) <= 2000),
  source_key text unique check (source_key ~ '^[0-9a-f]{64}$')
);

alter table public.supplier_orders enable row level security;
revoke all on public.supplier_orders from public, anon, authenticated;
grant select, insert, delete on public.supplier_orders to authenticated;
grant update (supplier, month, year, order_number, invoice_number, status, received_on, notes)
  on public.supplier_orders to authenticated;

create policy "Signed-in accounts manage supplier orders"
  on public.supplier_orders for all to authenticated
  using ((select auth.uid()) is not null and not coalesce((select auth.jwt()) ->> 'is_anonymous' = 'true', false))
  with check ((select auth.uid()) is not null and not coalesce((select auth.jwt()) ->> 'is_anonymous' = 'true', false));

create policy "Signed-in accounts receive supplier order updates"
  on realtime.messages for select to authenticated
  using (
    (select auth.uid()) is not null
    and not coalesce((select auth.jwt()) ->> 'is_anonymous' = 'true', false)
    and extension = 'broadcast'
    and (select realtime.topic()) = 'suppliers:shared'
    and topic = (select realtime.topic())
  );

create function public.notify_supplier_order_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform realtime.send('{}'::jsonb, 'changed', 'suppliers:shared', true);
  return null;
end;
$$;

revoke all on function public.notify_supplier_order_change() from public, anon, authenticated;

create trigger supplier_orders_realtime
  after insert or update or delete on public.supplier_orders
  for each statement execute function public.notify_supplier_order_change();

commit;
