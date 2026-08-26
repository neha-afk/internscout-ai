-- Normalize ownership around Supabase Auth. Do not create or use a
-- public.users table; auth.users is the identity source of truth.

-- Ensure existing authenticated users have the profile row required by the UI.
insert into public.profiles (id)
select id
from auth.users
on conflict (id) do nothing;

-- Create profiles automatically for future Auth signups.
create or replace function public.handle_new_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_auth_user_profile();

-- Drop every foreign key involving the ownership columns. This handles the
-- confirmed legacy constraint name as well as deployments with another name.
do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select c.conrelid::regclass as table_name, c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and (
        (t.relname = 'saved_internships' and exists (
          select 1
          from unnest(c.conkey) as key_column(attnum)
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = key_column.attnum
          where a.attname = 'user_id'
        ))
        or
        (t.relname = 'profiles' and exists (
          select 1
          from unnest(c.conkey) as key_column(attnum)
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = key_column.attnum
          where a.attname = 'id'
        ))
      )
  loop
    execute format(
      'alter table %s drop constraint %I',
      constraint_record.table_name,
      constraint_record.conname
    );
  end loop;
end;
$$;

-- NOT VALID preserves pre-existing legacy rows while enforcing the correct
-- Auth relationship for all new inserts and updates.
alter table public.profiles
  add constraint profiles_id_fkey
  foreign key (id) references auth.users(id) on delete cascade
  not valid;

alter table public.saved_internships
  add constraint saved_internships_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade
  not valid;
