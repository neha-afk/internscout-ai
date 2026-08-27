create table if not exists public.application_copilot_outputs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  internship_id uuid not null references public.internships(id) on delete cascade,
  resume_id uuid not null references public.user_resumes(id) on delete cascade,
  output_type text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, internship_id, resume_id, output_type)
);
alter table public.application_copilot_outputs enable row level security;
create policy "Users can manage their own copilot outputs" on public.application_copilot_outputs for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
