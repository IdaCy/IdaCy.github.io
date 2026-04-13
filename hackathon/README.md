# Time Horizons Hackathon Frontend

This directory is the public static page for the Time Horizons human solving times hackathon at `/hackathon/` under `IdaCy.github.io`.

## Current state

- `index.html`, `styles.css`, and `app.js` provide a small public landing page.
- The page includes top links, the heading section, About, Schedule, and FAQ.
- The public landing page does not link to task prompts, mock assignments, participant auth, submissions, live stats, or admin controls.
- `contest/`, `problems/example-physical/`, and `submissions/` are unlinked after-release prototypes.
- The after-release prototype stores example submissions in browser `localStorage`; the live version should use backend storage and server-side timing.

## Public privacy model

- The static site should not contain private benchmark items.
- GitHub Pages serves files directly, so anything committed under this directory should be treated as public.
- Real task prompts, participant state, and submission handling should stay out of this public directory until the intended release path is decided.
