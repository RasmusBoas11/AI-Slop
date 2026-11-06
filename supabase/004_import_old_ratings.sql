-- Update 4: import old ratings for members who don't have an account yet.
-- Run this once in Supabase > SQL Editor > New query. It is safe to run again.
-- It also includes update 3 (decimal scores), so you can skip 003 if you haven't run it.

-- A. Scores with one decimal (1.0 – 5.0)
alter table ratings alter column language type numeric(2,1) using language::numeric(2,1);
alter table ratings alter column content  type numeric(2,1) using content::numeric(2,1);
alter table ratings drop constraint if exists ratings_language_check;
alter table ratings drop constraint if exists ratings_content_check;
alter table ratings add constraint ratings_language_check check (language between 1 and 5);
alter table ratings add constraint ratings_content_check  check (content  between 1 and 5);

-- B. A score can belong to just a name (no account yet). One such score per name per book.
alter table ratings alter column user_id drop not null;
create unique index if not exists ratings_book_member_unclaimed
  on ratings (book_id, lower(member)) where user_id is null;

-- C. The admin may add, change and remove any score (needed for importing).
drop policy if exists "admin manages scores" on ratings;
create policy "admin manages scores" on ratings for all to authenticated
  using (is_admin()) with check (is_admin());

-- D. When a member signs in, scores imported under their name are linked to their account.
--    The name must match the name they signed up with (not case-sensitive).
create or replace function claim_my_ratings() returns integer
language plpgsql security definer set search_path = public as $$
declare
  my_name text;
  linked integer;
begin
  select trim(coalesce(raw_user_meta_data->>'display_name', '')) into my_name
  from auth.users where id = auth.uid();
  if my_name = '' then return 0; end if;

  update ratings r set user_id = auth.uid()
  where r.user_id is null
    and lower(trim(r.member)) = lower(my_name)
    and not exists (select 1 from ratings x where x.book_id = r.book_id and x.user_id = auth.uid());
  get diagnostics linked = row_count;
  return linked;
end;
$$;
revoke all on function claim_my_ratings() from public, anon;
grant execute on function claim_my_ratings() to authenticated;

-- Check: language/content should say "numeric", user_id should say "YES" (can be empty)
select column_name, data_type, is_nullable from information_schema.columns
where table_name = 'ratings' and column_name in ('language', 'content', 'user_id');
