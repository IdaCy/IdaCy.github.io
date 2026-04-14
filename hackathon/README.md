# Time Horizons Hackathon Frontend

This directory is the public static page for the Time Horizons human solving times hackathon at `/hackathon/` under `IdaCy.github.io`.

## Current state

- `index.html`, `styles.css`, and `app.js` provide the public landing page.
- `contest/` and `submissions/` are static pages that call Supabase Edge Functions from `../hackathon-backend/`.
- `release.js` handles Supabase email/password auth, participant registration, catalog loading, assignment claiming, prompt rendering, submission, and live stats polling.
- `hackathon-config.js` must be filled with the Supabase project URL and anon key before launch.
- `problems/example-physical/` is retained as an old static example; the live contest flow renders assignments dynamically.

## Public privacy model

- The static site should not contain private benchmark items.
- GitHub Pages serves files directly, so anything committed under this directory should be treated as public.
- Real task prompts, answer keys, participant state, and submission handling should stay out of this public directory. Put them in Supabase through the backend seed flow.
- Public Supabase anon keys are acceptable in `hackathon-config.js`; never put the service-role key in this directory.
