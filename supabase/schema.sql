-- Book Club database.
-- Paste all of this into Supabase > SQL Editor > New query, then press "Run".

create table if not exists books (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  author      text,
  year        int,
  read_on     date,          -- when the club read / discussed it
  description text,
  cover       text,          -- a picture: either a web link or an uploaded photo
  added_by    text,
  created_at  timestamptz not null default now()
);

create table if not exists ratings (
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid not null references books(id) on delete cascade,
  member     text not null,
  language   smallint not null check (language between 1 and 5),
  content    smallint not null check (content between 1 and 5),
  comment    text,
  created_at timestamptz not null default now(),
  unique (book_id, member)   -- one score per member per book
);

-- Anyone who has the app's link can read and edit the club's books.
-- That's fine for a private book club; see README for how to lock it down later.
alter table books   enable row level security;
alter table ratings enable row level security;

create policy "club can use books"   on books   for all to anon using (true) with check (true);
create policy "club can use ratings" on ratings for all to anon using (true) with check (true);
