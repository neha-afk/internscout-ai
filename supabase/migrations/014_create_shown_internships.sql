create table if not exists public.shown_internships (
  user_id uuid not null references auth.users(id) on delete cascade,
  normalized_url text not null,
  first_shown_at timestamptz not null default now(),
  last_shown_at timestamptz not null default now(),
  primary key (user_id, normalized_url)
);
create index if not exists shown_internships_user_last_idx on public.shown_internships(user_id, last_shown_at desc);
alter table public.shown_internships enable row level security;
create policy "Users can view their own shown internships" on public.shown_internships for select to authenticated using (auth.uid() = user_id);
create policy "Users can record their own shown internships" on public.shown_internships for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can update their own shown internships" on public.shown_internships for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
