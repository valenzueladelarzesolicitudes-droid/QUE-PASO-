begin;

drop trigger calendar_items_realtime on public.calendar_items;

-- Give every item a unique ID while preserving rows imported under different accounts.
with duplicate_items as (
  select user_id, id,
    row_number() over (partition by id order by user_id) as position
  from public.calendar_items
)
update public.calendar_items as item
set id = gen_random_uuid()::text
from duplicate_items as duplicate
where item.user_id = duplicate.user_id
  and item.id = duplicate.id
  and duplicate.position > 1;

alter table public.calendar_items
  drop constraint calendar_items_pkey,
  drop constraint calendar_items_user_id_fkey;

alter table public.calendar_items
  add primary key (id),
  add unique (user_id, id),
  alter column user_id drop not null,
  add constraint calendar_items_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete set null;

drop policy "Owners manage their calendar" on public.calendar_items;

create policy "Signed-in users read the shared calendar"
  on public.calendar_items for select to authenticated
  using ((select auth.uid()) is not null);

create policy "Signed-in users add to the shared calendar"
  on public.calendar_items for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Signed-in users edit the shared calendar"
  on public.calendar_items for update to authenticated
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

create policy "Signed-in users remove shared calendar items"
  on public.calendar_items for delete to authenticated
  using ((select auth.uid()) is not null);

revoke update on public.calendar_items from authenticated;
grant update (title, date, type, important, done) on public.calendar_items to authenticated;

drop policy "Owners receive their calendar updates" on realtime.messages;

create policy "Signed-in users receive shared calendar updates"
  on realtime.messages for select to authenticated
  using (
    (select auth.uid()) is not null
    and extension = 'broadcast'
    and (select realtime.topic()) = 'calendar:shared'
    and topic = (select realtime.topic())
  );

create or replace function public.notify_calendar_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform realtime.send('{}'::jsonb, 'changed', 'calendar:shared', true);
  return null;
end;
$$;

create trigger calendar_items_realtime
after insert or update or delete on public.calendar_items
for each statement execute function public.notify_calendar_change();

commit;
