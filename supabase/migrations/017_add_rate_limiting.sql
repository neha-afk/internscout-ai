-- Server-side API rate-limit counters. RLS is enabled with no permissive
-- policies; the service-role client is the only intended caller.
create table if not exists public.api_rate_limits (
  identifier text not null,
  route text not null,
  window_start timestamptz not null,
  request_count integer not null default 1,
  primary key (identifier, route, window_start)
);

create index if not exists api_rate_limits_lookup_idx
  on public.api_rate_limits (identifier, route, window_start);

alter table public.api_rate_limits enable row level security;

create or replace function public.check_rate_limit(
  p_identifier text,
  p_route text,
  p_max_requests integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_window_start timestamptz;
  current_request_count integer;
begin
  if p_identifier is null or p_identifier = ''
    or p_route is null or p_route = ''
    or p_max_requests < 1
    or p_window_seconds < 1 then
    raise exception 'Invalid rate-limit arguments';
  end if;

  current_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds)
      * p_window_seconds
  );

  insert into public.api_rate_limits (
    identifier, route, window_start, request_count
  )
  values (p_identifier, p_route, current_window_start, 1)
  on conflict (identifier, route, window_start)
  do update set request_count = public.api_rate_limits.request_count + 1
  returning request_count into current_request_count;

  return current_request_count <= p_max_requests;
end;
$$;

revoke all on function public.check_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, text, integer, integer)
  to service_role;

-- TODO: prune rows older than one hour in a future scheduled cleanup job.
