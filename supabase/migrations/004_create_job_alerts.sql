create table if not exists public.job_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  roles jsonb not null default '[]'::jsonb check (jsonb_typeof(roles) = 'array'),
  work_modes jsonb not null default '[]'::jsonb check (jsonb_typeof(work_modes) = 'array'),
  locations jsonb not null default '[]'::jsonb check (jsonb_typeof(locations) = 'array'),
  skills jsonb not null default '[]'::jsonb check (jsonb_typeof(skills) = 'array'),
  minimum_match_score integer check (
    minimum_match_score is null or minimum_match_score between 0 and 100
  ),
  is_active boolean not null default true,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_alerts_user_id_idx on public.job_alerts (user_id);
create index if not exists job_alerts_is_active_idx on public.job_alerts (is_active);

create or replace function public.set_job_alerts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists job_alerts_set_updated_at on public.job_alerts;
create trigger job_alerts_set_updated_at
before update on public.job_alerts
for each row execute function public.set_job_alerts_updated_at();

alter table public.job_alerts enable row level security;

create policy "Users can view their own job alerts"
  on public.job_alerts for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can create their own job alerts"
  on public.job_alerts for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own job alerts"
  on public.job_alerts for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own job alerts"
  on public.job_alerts for delete
  to authenticated
  using (auth.uid() = user_id);
