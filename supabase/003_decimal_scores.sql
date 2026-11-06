-- Update 3: scores with one decimal (1.0 – 5.0, e.g. 4.2).
-- Run this once in Supabase > SQL Editor > New query. It is safe to run again.
-- Existing whole-number scores are kept (4 becomes 4.0).

alter table ratings alter column language type numeric(2,1) using language::numeric(2,1);
alter table ratings alter column content  type numeric(2,1) using content::numeric(2,1);

-- Keep scores between 1.0 and 5.0
alter table ratings drop constraint if exists ratings_language_check;
alter table ratings drop constraint if exists ratings_content_check;
alter table ratings add constraint ratings_language_check check (language between 1 and 5);
alter table ratings add constraint ratings_content_check  check (content  between 1 and 5);

-- Shows the new column types (both should say "numeric"):
select column_name, data_type from information_schema.columns
where table_name = 'ratings' and column_name in ('language', 'content');
