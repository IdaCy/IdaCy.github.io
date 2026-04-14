# Time Horizons Hackathon Backend

This directory is the Supabase backend for the `IdaCy.github.io/hackathon/` task-delivery flow.
The public frontend remains static GitHub Pages, but registration, task payloads, assignment
state, submissions, scoring, and live stats are served from Supabase Edge Functions backed by
hosted Postgres.

It is designed around `Supabase` because the hackathon needs:

- authenticated participant registration
- private-task delivery for `monitor_training_poisoning`
- shared assignments and submissions
- live event stats
- async grading for LLM-graded tracks
- signed storage URLs for multimodal or protected assets

## Directory layout

- `config/event_template.json`
  Event slug, track definitions, and launch defaults
- `config/catalog_overrides.json`
  Manual overrides that should win over raw upstream task metadata
- `scripts/export_time_horizons_manifest.py`
  Builds a normalized manifest from one or more `time-horizons` `task_data/` trees
- `supabase/migrations/0001_hackathon_schema.sql`
  Initial schema for events, participants, benchmarks, items, assignments, submissions, and grading jobs
- `supabase/functions/`
  Edge-function endpoints for a future frontend API provider

## Step-by-step setup

1. Create a Supabase project.

2. Fill in the placeholders in `.env.example` and copy them into your local shell or Supabase secrets.

3. Apply the schema:

```bash
cd /Users/ifc24/Develop/IdaCy.github.io/hackathon-backend
supabase db push
```

4. Build a manifest from the submitted repository checkouts.
   For the hackathon-selected `configs/hackathon_problems.json` problem set:

```bash
python scripts/export_time_horizons_manifest.py \
  --source /Users/ifc24/Develop/fp-th-intuit-physical/rhys_time_horizons/task_data \
  --problem-config /Users/ifc24/Develop/fp-th-intuit-physical/rhys_time_horizons/configs/hackathon_problems.json \
  --overrides config/catalog_overrides.json \
  --output /tmp/time-horizons-manifest.json \
  --include-items
```

5. Review the manifest and load it into:
   - `benchmarks`
   - `benchmark_items`
   - `event_tracks`
   - `event_benchmark_configs`
   - `assignments`
   - `event_invites`

   You can now generate seed SQL directly:

```bash
python scripts/build_seed_sql.py \
  --manifest /tmp/time-horizons-manifest.json \
  --event-config config/event_template.json \
  --invites-csv config/invites_template.csv \
  --assignments-per-item 5 \
  --output /tmp/hackathon-seed.sql
```

   Then apply it:

```bash
psql "$SUPABASE_DB_URL" -f /tmp/hackathon-seed.sql
```

6. Seed the event row from `config/event_template.json`.

7. Deploy the edge functions:

```bash
supabase functions deploy catalog
supabase functions deploy tracks
supabase functions deploy participant
supabase functions deploy register-participant
supabase functions deploy active-assignment
supabase functions deploy claim-assignment
supabase functions deploy get-task-payload
supabase functions deploy submit-solution
supabase functions deploy my-submissions
supabase functions deploy submissions
supabase functions deploy live-stats
supabase functions deploy admin-reset
```

8. Fill in `../hackathon/hackathon-config.js` with the public Supabase project URL and anon key
   before publishing. The static frontend calls these Edge Functions and no longer stores contest
   submissions in browser `localStorage`.

9. Turn on auth and delivery hardening before live use:
   - Supabase email/password auth, with email confirmations disabled for lowest-friction event signup or enabled if you can handle the email confirmation flow
   - invite seeding in `event_invites`
   - row-level policies if clients ever query tables directly
   - private storage bucket for images and protected attachments
   - fixed grader model and audit logging for LLM-graded tasks

## Missing information still represented as placeholders

- final Supabase project URL and keys
- final event dates and participant allowlist
- fixed grader model/version
- final policy on whether `monitor_training_poisoning` is shipped as private in the live event
- exact source refs to import from the upstream submission repo
- any event-specific invite list beyond the template CSV

## API contract expected by the frontend

- `GET /catalog`
- `GET /tracks`
- `GET /participant`
- `POST /register-participant`
- `GET /active-assignment`
- `DELETE /active-assignment`
- `POST /claim-assignment`
- `GET /get-task-payload?assignmentId=...`
- `POST /submit-solution`
- `GET /my-submissions`
- `GET /submissions`
- `GET /live-stats`
- `POST /admin-reset`

The static frontend in `../hackathon/release.js` uses this contract.
