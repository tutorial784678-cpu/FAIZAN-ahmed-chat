alter table public.push_subscriptions
  add column if not exists notify_messages boolean not null default true,
  add column if not exists notify_calls boolean not null default true,
  add column if not exists sound_enabled boolean not null default true;

create unique index if not exists push_subscriptions_endpoint_uidx
  on public.push_subscriptions(endpoint);

alter table public.push_subscriptions enable row level security;

do $$
declare p record;
begin
  for p in select policyname from pg_policies
    where schemaname='public' and tablename='push_subscriptions'
  loop
    execute format('drop policy %I on public.push_subscriptions', p.policyname);
  end loop;
end $$;

create policy "users_read_own_push_subscriptions"
on public.push_subscriptions for select to authenticated
using (user_id = (select auth.uid()));

create policy "users_insert_own_push_subscriptions"
on public.push_subscriptions for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "users_update_own_push_subscriptions"
on public.push_subscriptions for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "users_delete_own_push_subscriptions"
on public.push_subscriptions for delete to authenticated
using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.push_subscriptions to authenticated;
