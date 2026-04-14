alter table public.submissions
  add column if not exists attempt_number integer not null default 1;

alter table public.submissions
  drop constraint if exists submissions_assignment_id_key;

create unique index if not exists submissions_assignment_attempt_key
  on public.submissions(assignment_id, attempt_number);

create index if not exists submissions_assignment_attempt_idx
  on public.submissions(assignment_id, attempt_number);
