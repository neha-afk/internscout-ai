create table if not exists public.job_alert_matches (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.job_alerts(id) on delete cascade,
  internship_source_url text not null,
  match_score integer not null check (match_score between 0 and 100),
  matched_reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(matched_reasons) = 'array'),
  detected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (alert_id, internship_source_url)
);

create index if not exists job_alert_matches_alert_id_idx
  on public.job_alert_matches (alert_id);
create index if not exists job_alert_matches_source_url_idx
  on public.job_alert_matches (internship_source_url);
create index if not exists job_alert_matches_detected_at_idx
  on public.job_alert_matches (detected_at);

alter table public.job_alert_matches enable row level security;

create policy "Users can view matches for their own alerts"
  on public.job_alert_matches for select
  to authenticated
  using (
    exists (
      select 1
      from public.job_alerts
      where public.job_alerts.id = job_alert_matches.alert_id
        and public.job_alerts.user_id = auth.uid()
    )
  );
