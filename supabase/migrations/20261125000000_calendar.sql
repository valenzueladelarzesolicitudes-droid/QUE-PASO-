create table public.calendar_items (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null check (length(id) between 1 and 100),
  title text not null check (length(btrim(title)) between 1 and 120),
  date date not null check (date between '0001-01-01' and '9999-12-31'),
  type text not null check (type in ('task', 'event')),
  important boolean not null default false,
  done boolean not null default false check (type = 'task' or not done),
  primary key (user_id, id)
);

alter table public.calendar_items enable row level security;
revoke all on public.calendar_items from public, anon, authenticated;
grant select, insert, update, delete on public.calendar_items to authenticated;

create policy "Owners manage their calendar"
  on public.calendar_items
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Owners receive their calendar updates"
  on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and (select realtime.topic()) = 'calendar:' || (select auth.uid())::text
    and topic = (select realtime.topic())
  );

create function public.notify_calendar_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    '{}'::jsonb,
    'changed',
    'calendar:' || coalesce(new.user_id, old.user_id)::text,
    true
  );
  return null;
end;
$$;

revoke all on function public.notify_calendar_change() from public, anon, authenticated;

create trigger calendar_items_realtime
after insert or update or delete on public.calendar_items
for each row execute function public.notify_calendar_change();
