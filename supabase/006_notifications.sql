-- Update 6: notifications.
-- Run this once in Supabase > SQL Editor > New query. It is safe to run again.

-- Each phone that has turned notifications on (one row per phone)
create table if not exists push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint   text not null unique,   -- the phone's address at Apple/Google's push service
  p256dh     text not null,          -- the phone's encryption key
  auth       text not null,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;
drop policy if exists "own subscriptions read"   on push_subscriptions;
drop policy if exists "own subscriptions add"    on push_subscriptions;
drop policy if exists "own subscriptions change" on push_subscriptions;
drop policy if exists "own subscriptions remove" on push_subscriptions;
create policy "own subscriptions read"   on push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy "own subscriptions add"    on push_subscriptions for insert to authenticated with check (user_id = auth.uid());
create policy "own subscriptions change" on push_subscriptions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own subscriptions remove" on push_subscriptions for delete to authenticated using (user_id = auth.uid());

-- Check: should show the new table with 0 rows
select count(*) as phones_with_notifications from push_subscriptions;
