create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  subtitle text,
  description text,
  status text not null default 'planning',
  starts_at timestamptz,
  ends_at timestamptz,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  email text not null unique,
  name text not null,
  team text,
  affiliation text,
  role text not null default 'participant',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  status text not null default 'registered',
  joined_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (event_id, participant_id)
);

create table if not exists public.benchmarks (
  id uuid primary key default gen_random_uuid(),
  benchmark_key text not null unique,
  title text not null,
  description text,
  domain text,
  contributor text,
  visibility text not null default 'public',
  baseline_status text not null default 'estimated_only',
  item_count integer not null default 0,
  scorer text not null,
  grading_mode text not null,
  frontend_mode text not null,
  estimated_range jsonb,
  real_range jsonb,
  total_estimated_hours numeric,
  priority text not null default 'follow_up',
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_tracks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  track_key text not null,
  title text not null,
  description text,
  requires_backend boolean not null default false,
  benchmark_keys jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, track_key)
);

create table if not exists public.benchmark_items (
  id uuid primary key default gen_random_uuid(),
  benchmark_id uuid not null references public.benchmarks(id) on delete cascade,
  item_key text not null,
  visibility text not null default 'public',
  render_payload jsonb not null default '{}'::jsonb,
  answer_key jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (benchmark_id, item_key)
);

create table if not exists public.event_benchmark_configs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  benchmark_id uuid not null references public.benchmarks(id) on delete cascade,
  enabled boolean not null default true,
  requires_backend boolean not null default false,
  sampling_strategy text not null default 'sequential',
  target_assignments integer,
  max_assignments_per_participant integer not null default 1,
  priority_override text,
  notes_override text,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, benchmark_id)
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  benchmark_id uuid not null references public.benchmarks(id) on delete cascade,
  benchmark_item_id uuid not null references public.benchmark_items(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete set null,
  status text not null default 'queued',
  delivery_mode text not null default 'direct',
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  released_at timestamptz,
  submitted_at timestamptz,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (event_id, benchmark_item_id)
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null unique references public.assignments(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  benchmark_id uuid not null references public.benchmarks(id) on delete cascade,
  benchmark_item_id uuid not null references public.benchmark_items(id) on delete cascade,
  submitted_answer text,
  raw_payload jsonb not null default '{}'::jsonb,
  active_seconds integer not null default 0,
  wall_clock_seconds integer,
  started_at timestamptz,
  submitted_at timestamptz not null default now(),
  grading_status text not null default 'pending_manual',
  score_value numeric,
  explanation text,
  grader_output jsonb,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.grading_jobs (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.submissions(id) on delete cascade,
  status text not null default 'queued',
  grader_model text,
  grader_version text,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb,
  error_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activity_heartbeats (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  tab_visible boolean,
  active_seconds_delta integer not null default 0,
  captured_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists assignments_event_status_idx on public.assignments(event_id, status);
create index if not exists assignments_participant_status_idx on public.assignments(participant_id, status);
create index if not exists benchmark_items_benchmark_idx on public.benchmark_items(benchmark_id);
create index if not exists submissions_event_idx on public.submissions(event_id);
create index if not exists submissions_participant_idx on public.submissions(participant_id);
create index if not exists event_tracks_event_idx on public.event_tracks(event_id);
create index if not exists event_benchmark_configs_event_idx on public.event_benchmark_configs(event_id);

drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at
before update on public.events
for each row execute procedure public.set_updated_at();

drop trigger if exists participants_set_updated_at on public.participants;
create trigger participants_set_updated_at
before update on public.participants
for each row execute procedure public.set_updated_at();

drop trigger if exists benchmarks_set_updated_at on public.benchmarks;
create trigger benchmarks_set_updated_at
before update on public.benchmarks
for each row execute procedure public.set_updated_at();

drop trigger if exists event_tracks_set_updated_at on public.event_tracks;
create trigger event_tracks_set_updated_at
before update on public.event_tracks
for each row execute procedure public.set_updated_at();

drop trigger if exists benchmark_items_set_updated_at on public.benchmark_items;
create trigger benchmark_items_set_updated_at
before update on public.benchmark_items
for each row execute procedure public.set_updated_at();

drop trigger if exists event_benchmark_configs_set_updated_at on public.event_benchmark_configs;
create trigger event_benchmark_configs_set_updated_at
before update on public.event_benchmark_configs
for each row execute procedure public.set_updated_at();

drop trigger if exists assignments_set_updated_at on public.assignments;
create trigger assignments_set_updated_at
before update on public.assignments
for each row execute procedure public.set_updated_at();

drop trigger if exists submissions_set_updated_at on public.submissions;
create trigger submissions_set_updated_at
before update on public.submissions
for each row execute procedure public.set_updated_at();

drop trigger if exists grading_jobs_set_updated_at on public.grading_jobs;
create trigger grading_jobs_set_updated_at
before update on public.grading_jobs
for each row execute procedure public.set_updated_at();
