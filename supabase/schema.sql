-- Book Club database, with logins.
-- Paste all of this into Supabase > SQL Editor > New query, then press "Run".

create table if not exists books (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  author      text,
  year        int,
  read_on     date,          -- when the club read / discussed it
  description text,
  cover       text,          -- a picture: either a web link or an uploaded photo
  added_by    text,          -- name shown in the app
  added_by_id uuid default auth.uid() references auth.users on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists ratings (
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid not null references books(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  member     text not null,  -- name shown in the app
  language   numeric(2,1) not null check (language between 1 and 5),  -- e.g. 4.2
  content    numeric(2,1) not null check (content between 1 and 5),
  comment    text,
  created_at timestamptz not null default now(),
  unique (book_id, user_id)  -- one score per member per book
);

-- Only people who are signed in can see or change anything.
alter table books   enable row level security;
alter table ratings enable row level security;

-- Books: every member can read, add and edit; only the person who added a book can delete it.
create policy "members read books"   on books for select to authenticated using (true);
create policy "members add books"    on books for insert to authenticated with check (added_by_id = auth.uid());
create policy "members edit books"   on books for update to authenticated using (true) with check (true);
create policy "adder deletes book"   on books for delete to authenticated using (added_by_id = auth.uid());

-- Scores: every member can read them all, but only add, change or remove their own.
create policy "members read scores"  on ratings for select to authenticated using (true);
create policy "own score insert"     on ratings for insert to authenticated with check (user_id = auth.uid());
create policy "own score update"     on ratings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own score delete"     on ratings for delete to authenticated using (user_id = auth.uid());
