create table if not exists public.user_internships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  internship_source_url text not null,
  company text,
  role text,
  application_url text,
  status text not null default 'saved' check (
    status in ('saved', 'applied', 'assessment', 'interview', 'offer', 'rejected')
  ),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, internship_source_url)
);

create index if not exists user_internships_user_id_idx
  on public.user_internships (user_id);
create index if not exists user_internships_status_idx
  on public.user_internships (status);

create or replace function public.set_user_internships_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_internships_set_updated_at on public.user_internships;
create trigger user_internships_set_updated_at
before update on public.user_internships
for each row execute function public.set_user_internships_updated_at();

alter table public.user_internships enable row level security;

create policy "Users can view their own internships"
  on public.user_internships for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can save their own internships"
  on public.user_internships for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own internships"
  on public.user_internships for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own internships"
  on public.user_internships for delete
  to authenticated
  using (auth.uid() = user_id);
