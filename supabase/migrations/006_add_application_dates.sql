alter table public.saved_internships
  add column if not exists application_deadline date,
  add column if not exists follow_up_date date;
