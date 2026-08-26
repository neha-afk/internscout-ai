create extension if not exists pgcrypto;

create table if not exists public.internships (
  id uuid primary key default gen_random_uuid(),
  company text,
  role text,
  description text,
  location text,
  work_mode text check (work_mode is null or work_mode in ('remote', 'hybrid', 'onsite')),
  posted_date timestamptz,
  deadline timestamptz,
  duration text,
  stipend text,
  experience_required text,
  graduation_requirements text,
  required_skills jsonb not null default '[]'::jsonb,
  application_url text,
  source_url text not null unique,
  source_domain text,
  status text not null default 'active' check (status in ('active', 'closed', 'expired')),
  verification_status text check (
    verification_status is null or
    verification_status in ('verified', 'likely_legitimate', 'needs_review', 'suspicious')
  ),
  verification_score integer check (
    verification_score is null or verification_score between 0 and 100
  ),
  verification_reasons jsonb not null default '[]'::jsonb,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists internships_role_idx on public.internships (role);
create index if not exists internships_company_idx on public.internships (company);
create index if not exists internships_status_idx on public.internships (status);
create index if not exists internships_verification_status_idx
  on public.internships (verification_status);
create index if not exists internships_last_verified_at_idx
  on public.internships (last_verified_at);

create or replace function public.set_internships_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists internships_set_updated_at on public.internships;
create trigger internships_set_updated_at
before update on public.internships
for each row execute function public.set_internships_updated_at();

alter table public.internships enable row level security;
