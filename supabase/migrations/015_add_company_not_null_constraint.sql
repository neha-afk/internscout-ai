-- Align migration history with the live internships schema.
-- Existing rows must already satisfy this constraint in the live database.
alter table public.internships
  alter column company set not null;
