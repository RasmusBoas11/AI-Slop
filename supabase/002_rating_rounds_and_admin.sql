-- Update 2: rating rounds + club admin.
-- Run this once in Supabase > SQL Editor > New query (after schema.sql).
-- It is safe to run again.

-- 1. Each book has a rating round that is open or closed.
alter table books add column if not exists rating_open boolean not null default true;
alter table books add column if not exists rating_closed_at timestamptz;

-- 2. Club admins (the admin can open and close rating rounds, and delete any book).
create table if not exists club_admins (
  user_id uuid primary key references auth.users on delete cascade
);
alter table club_admins enable row level security;
drop policy if exists "members see admins" on club_admins;
create policy "members see admins" on club_admins for select to authenticated using (true);

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from club_admins where user_id = auth.uid());
$$;

-- The first person who created an account becomes the admin.
-- (To make someone else admin later, see README.)
insert into club_admins (user_id)
select id from auth.users order by created_at limit 1
on conflict do nothing;

-- 3. Only the admin may open or close a rating round. Closing stamps the date.
create or replace function guard_rating_round() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.rating_open is distinct from old.rating_open then
    if not is_admin() then
      raise exception 'Only the club admin can open or close rating';
    end if;
    new.rating_closed_at := case when new.rating_open then null else now() end;
  end if;
  return new;
end;
$$;
drop trigger if exists books_guard_rating_round on books;
create trigger books_guard_rating_round before update on books
for each row execute function guard_rating_round();

-- 4. Scores can only be added, changed or removed while the book's rating is open.
drop policy if exists "own score insert" on ratings;
drop policy if exists "own score update" on ratings;
drop policy if exists "own score delete" on ratings;
create policy "own score insert" on ratings for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from books b where b.id = book_id and b.rating_open));
create policy "own score update" on ratings for update to authenticated
  using (user_id = auth.uid() and exists (select 1 from books b where b.id = book_id and b.rating_open))
  with check (user_id = auth.uid() and exists (select 1 from books b where b.id = book_id and b.rating_open));
create policy "own score delete" on ratings for delete to authenticated
  using (user_id = auth.uid() and exists (select 1 from books b where b.id = book_id and b.rating_open));

-- 5. The admin may delete any book (members can still delete books they added).
drop policy if exists "adder deletes book" on books;
drop policy if exists "adder or admin deletes book" on books;
create policy "adder or admin deletes book" on books for delete to authenticated
  using (added_by_id = auth.uid() or is_admin());

-- Show who the admin is:
select u.email as club_admin from club_admins a join auth.users u on u.id = a.user_id;
