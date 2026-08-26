create table if not exists public.search_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  search_filters jsonb not null check (jsonb_typeof(search_filters) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists search_history_user_created_idx
  on public.search_history (user_id, created_at desc);

alter table public.search_history enable row level security;

create policy "Users can view their own search history"
  on public.search_history for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can create their own search history"
  on public.search_history for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can delete their own search history"
  on public.search_history for delete
  to authenticated
  using (auth.uid() = user_id);
