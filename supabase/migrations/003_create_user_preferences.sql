create table if not exists public.user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  preferred_roles jsonb not null default '[]'::jsonb check (jsonb_typeof(preferred_roles) = 'array'),
  preferred_work_modes jsonb not null default '[]'::jsonb check (jsonb_typeof(preferred_work_modes) = 'array'),
  preferred_locations jsonb not null default '[]'::jsonb check (jsonb_typeof(preferred_locations) = 'array'),
  skills jsonb not null default '[]'::jsonb check (jsonb_typeof(skills) = 'array'),
  graduation_year integer check (graduation_year is null or graduation_year between 1900 and 2200),
  experience_level text check (
    experience_level is null or
    experience_level in ('fresher', 'beginner', 'intermediate', 'experienced')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_preferences_user_id_idx
  on public.user_preferences (user_id);

create or replace function public.set_user_preferences_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_preferences_set_updated_at on public.user_preferences;
create trigger user_preferences_set_updated_at
before update on public.user_preferences
for each row execute function public.set_user_preferences_updated_at();

alter table public.user_preferences enable row level security;

create policy "Users can view their own preferences"
  on public.user_preferences for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can create their own preferences"
  on public.user_preferences for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own preferences"
  on public.user_preferences for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own preferences"
  on public.user_preferences for delete
  to authenticated
  using (auth.uid() = user_id);
