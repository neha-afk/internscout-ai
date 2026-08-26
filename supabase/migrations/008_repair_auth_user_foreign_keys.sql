-- Forward repair for deployments where migration 007 was recorded before its
-- ownership constraints were corrected.

insert into public.profiles (id)
select id
from auth.users
on conflict (id) do nothing;

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

alter table public.profiles
  add constraint profiles_id_fkey
  foreign key (id) references auth.users(id) on delete cascade
  not valid;

alter table public.saved_internships
  add constraint saved_internships_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade
  not valid;
