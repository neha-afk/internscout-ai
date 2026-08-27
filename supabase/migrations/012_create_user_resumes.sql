create table if not exists public.user_resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  extracted_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists user_resumes_user_id_idx on public.user_resumes(user_id);
alter table public.user_resumes enable row level security;
create policy "Users can manage their own resumes" on public.user_resumes for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
insert into storage.buckets (id, name, public) values ('resumes', 'resumes', false) on conflict (id) do nothing;
create policy "Users can access their own resume files" on storage.objects for all to authenticated using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);

create table if not exists public.resume_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  resume_id uuid not null references public.user_resumes(id) on delete cascade,
  internship_id uuid not null references public.internships(id) on delete cascade,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  unique(user_id, resume_id, internship_id)
);
alter table public.resume_analyses enable row level security;
create policy "Users can manage their own resume analyses" on public.resume_analyses for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
