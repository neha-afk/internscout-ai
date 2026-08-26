-- Ensure the live database has exactly one Auth ownership foreign key for
-- each user-owned record, even when migrations 007/008 were partially run.

insert into public.profiles (id)
select id
from auth.users
on conflict (id) do nothing;

do $$
declare
  constraint_record record;
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Required table public.profiles does not exist';
  end if;
  if to_regclass('public.saved_internships') is null then
    raise exception 'Required table public.saved_internships does not exist';
  end if;

  -- Remove every FK attached to either ownership column, regardless of its
  -- current name or referenced table.
  for constraint_record in
    select c.conrelid::regclass as table_name, c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and (
        (t.relname = 'profiles' and exists (
          select 1
          from unnest(c.conkey) as key_column(attnum)
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = key_column.attnum
          where a.attname = 'id'
        ))
        or
        (t.relname = 'saved_internships' and exists (
          select 1
          from unnest(c.conkey) as key_column(attnum)
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = key_column.attnum
          where a.attname = 'user_id'
        ))
      )
  loop
    execute format('alter table %s drop constraint %I', constraint_record.table_name, constraint_record.conname);
  end loop;

  -- NOT VALID preserves any historical orphan rows while enforcing all new
  -- inserts and updates against auth.users.
  execute 'alter table public.profiles add constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade not valid';
  execute 'alter table public.saved_internships add constraint saved_internships_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade not valid';
end;
$$;

-- Verification query (run separately after applying this migration):
-- select
--   tc.table_schema || '.' || tc.table_name as source_table,
--   kcu.column_name as source_column,
--   ccu.table_schema || '.' || ccu.table_name as referenced_table,
--   ccu.column_name as referenced_column
-- from information_schema.table_constraints tc
-- join information_schema.key_column_usage kcu
--   on tc.constraint_name = kcu.constraint_name
--  and tc.table_schema = kcu.table_schema
--  and tc.table_name = kcu.table_name
-- join information_schema.constraint_column_usage ccu
--   on tc.constraint_name = ccu.constraint_name
--  and tc.table_schema = ccu.table_schema
-- where tc.constraint_type = 'FOREIGN KEY'
--   and ((tc.table_schema = 'public' and tc.table_name = 'profiles' and kcu.column_name = 'id')
--     or (tc.table_schema = 'public' and tc.table_name = 'saved_internships' and kcu.column_name = 'user_id'))
-- order by source_table;
