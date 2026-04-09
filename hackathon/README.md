# Time Horizons Hackathon Frontend

This directory is the static frontend for the hackathon control room that will be hosted at `/hackathon/` under `IdaCy.github.io`.

## Current state

- `index.html`, `styles.css`, and `app.js` provide a working static UI.
- `config.js` is still set to `backendMode: "mock"` so the app works without secrets.
- `data/catalog.js` is the current benchmark catalog snapshot.
- `data/mockData.js` seeds a demo queue and one protected-task placeholder.
- `lib/provider.js` supports both:
  - mock mode with `localStorage`
  - API mode once the backend is deployed
- `lib/auth.js` now provides a browser-side Supabase magic-link flow for API mode.

## Live privacy model

- The static site should never bundle private benchmark items.
- In live mode, participants authenticate with a magic link.
- The backend only returns benchmarks, tracks, and assignments the participant is allowed to access.
- Private items are delivered one assignment at a time.
- Asset files can be exposed through signed URLs instead of raw storage paths.
- Backend request logging and rate limiting are scaffolded server-side.

## Switching to live backend mode

1. Deploy the Supabase scaffold from your private backend workspace.
2. Replace the placeholders in `config.js`.
3. Set `backendMode` to `"api"`.
4. Set `apiBaseUrl` to `https://REPLACE_WITH_SUPABASE_PROJECT_REF.supabase.co/functions/v1`.
5. Rebuild the benchmark manifest from the submitted `time-horizons` task directories.

## What remains placeholder-driven

- Supabase project URL and anon key
- final magic-link redirect URL
- final invite list
- final event window
- final private payload bucket contents for `monitor_training_poisoning`
- grader-model selection for async scored benchmarks
- final multimodal asset uploads
