create table if not exists public.event_invites (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  email text not null,
  role text not null default 'participant',
  team text,
  affiliation text,
  allow_private_tracks boolean not null default false,
  status text not null default 'invited',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, email)
);

create table if not exists public.api_request_logs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete set null,
  participant_id uuid references public.participants(id) on delete set null,
  endpoint text not null,
  method text not null,
  status integer not null,
  ip_address text,
  identity_hint text,
  auth_source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.api_rate_limits (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  key text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  last_request_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (scope, key, window_start)
);

create index if not exists event_invites_event_email_idx on public.event_invites(event_id, email);
create index if not exists api_request_logs_event_created_idx on public.api_request_logs(event_id, created_at desc);
create index if not exists api_request_logs_participant_created_idx on public.api_request_logs(participant_id, created_at desc);
create index if not exists api_rate_limits_scope_key_window_idx on public.api_rate_limits(scope, key, window_start desc);

drop trigger if exists event_invites_set_updated_at on public.event_invites;
create trigger event_invites_set_updated_at
before update on public.event_invites
for each row execute procedure public.set_updated_at();

create or replace function public.bump_rate_limit(
  p_scope text,
  p_key text,
  p_window_start timestamptz,
  p_limit integer,
  p_metadata jsonb default '{}'::jsonb
)
returns table (request_count integer, allowed boolean)
language plpgsql
as $$
declare v_count integer;
begin
  insert into public.api_rate_limits (
    scope,
    key,
    window_start,
    request_count,
    last_request_at,
    metadata
  )
  values (
    p_scope,
    p_key,
    p_window_start,
    1,
    now(),
    p_metadata
  )
  on conflict (scope, key, window_start)
  do update set
    request_count = public.api_rate_limits.request_count + 1,
    last_request_at = now(),
    metadata = coalesce(public.api_rate_limits.metadata, '{}'::jsonb) || coalesce(excluded.metadata, '{}'::jsonb)
  returning public.api_rate_limits.request_count into v_count;

  return query
  select v_count, v_count <= p_limit;
end;
$$;
