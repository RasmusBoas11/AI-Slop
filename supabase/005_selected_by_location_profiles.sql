-- Update 5: "Selected by" + review location on books, and profile pictures.
-- Run this once in Supabase > SQL Editor > New query. It is safe to run again.

-- 1. Who selected the book, and where the club reviewed it
alter table books add column if not exists selected_by text;
alter table books add column if not exists review_location text;

-- 2. Member profiles (name + profile picture)
create table if not exists profiles (
  user_id    uuid primary key default auth.uid() references auth.users on delete cascade,
  name       text not null default '',
  avatar     text,  -- a small square picture, stored as a data link
  updated_at timestamptz not null default now()
);
alter table profiles drop constraint if exists profiles_avatar_size;
alter table profiles add constraint profiles_avatar_size check (avatar is null or length(avatar) < 400000);

alter table profiles enable row level security;
drop policy if exists "members see profiles" on profiles;
drop policy if exists "own profile insert" on profiles;
drop policy if exists "own profile update" on profiles;
create policy "members see profiles" on profiles for select to authenticated using (true);
create policy "own profile insert" on profiles for insert to authenticated with check (user_id = auth.uid());
create policy "own profile update" on profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 3. Give everyone who already has an account a profile
insert into profiles (user_id, name)
select id, coalesce(nullif(trim(raw_user_meta_data->>'display_name'), ''), split_part(email, '@', 1))
from auth.users
on conflict (user_id) do nothing;

-- Check: shows the members (the "Selected by" list in the app uses these names)
select name from profiles order by name;
