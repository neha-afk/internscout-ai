-- Migration: Document existing saved_internships and profiles tables
--
-- CONTEXT: These tables already exist in production but were created outside
-- of the migrations/ folder (likely via the Supabase dashboard). This
-- migration does NOT create new objects — it uses IF NOT EXISTS / DO blocks
-- so it is safe to run against production without altering live data or
-- structure. Its purpose is to bring these tables under version control.
--
-- Schema reverse-engineered on 2026-08-27 from live production via
-- information_schema.columns, table_constraints, and pg_policies.
--
-- ASSUMPTION: profiles.id and saved_internships.user_id reference
-- auth.users(id). information_schema could not resolve the auth schema
-- join directly (expected Supabase behavior), but this matches the
-- observed RLS policies (auth.uid() = id / auth.uid() = user_id) and is
-- the standard Supabase pattern. If this assumption is wrong, this
-- migration will fail loudly on the FOREIGN KEY line rather than silently
-- create an incorrect constraint — do not weaken this to "trust me" logic.

-- ============================================================
-- profiles
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  graduation_year integer,
  experience_years integer default 0,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'Users can view their own profile'
  ) then
    create policy "Users can view their own profile"
      on public.profiles for select
      to authenticated
      using (auth.uid() = id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'Users can create their own profile'
  ) then
    create policy "Users can create their own profile"
      on public.profiles for insert
      to authenticated
      with check (auth.uid() = id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'Users can update their own profile'
  ) then
    create policy "Users can update their own profile"
      on public.profiles for update
      to authenticated
      using (auth.uid() = id)
      with check (auth.uid() = id);
  end if;
end $$;

-- ============================================================
-- saved_internships
-- ============================================================

create table if not exists public.saved_internships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  internship_id uuid not null references public.internships(id),
  application_status text default 'saved',
  notes text,
  created_at timestamptz default now(),
  application_deadline date,
  follow_up_date date
);

alter table public.saved_internships enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'saved_internships'
      and policyname = 'Users can view their own saved internships'
  ) then
    create policy "Users can view their own saved internships"
      on public.saved_internships for select
      to authenticated
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'saved_internships'
      and policyname = 'Users can save internships'
  ) then
    create policy "Users can save internships"
      on public.saved_internships for insert
      to authenticated
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'saved_internships'
      and policyname = 'Users can update their own saved internships'
  ) then
    create policy "Users can update their own saved internships"
      on public.saved_internships for update
      to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'saved_internships'
      and policyname = 'Users can delete their own saved internships'
  ) then
    create policy "Users can delete their own saved internships"
      on public.saved_internships for delete
      to authenticated
      using (auth.uid() = user_id);
  end if;
end $$;

-- ============================================================
-- NOTE on public.users
-- ============================================================
-- No standalone public.users table was found in production. profiles.id
-- references auth.users(id) directly, which is the standard Supabase
-- pattern. Code/docs referencing "public.users" likely mean auth.users
-- via this profiles table. If a genuine public.users table is later
-- found, document and migrate it separately — do not guess its shape here.
