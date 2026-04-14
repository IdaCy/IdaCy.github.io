alter table public.assignments
  add column if not exists assignment_slot integer not null default 1;

alter table public.assignments
  drop constraint if exists assignments_event_id_benchmark_item_id_key;

create unique index if not exists assignments_event_item_slot_key
  on public.assignments(event_id, benchmark_item_id, assignment_slot);

create index if not exists assignments_event_benchmark_status_idx
  on public.assignments(event_id, benchmark_id, status);
