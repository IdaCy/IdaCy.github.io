import { appCapabilities, appConfig } from "./config.js";
import { benchmarkCatalog, hackathonTracks } from "./data/catalog.js";
import { createAuthController } from "./lib/auth.js";
import { createProvider } from "./lib/provider.js";

const authController = createAuthController(appConfig);
const provider = createProvider(appConfig, authController);

const state = {
  participant: null,
  catalog: provider.mode === "mock" ? benchmarkCatalog : [],
  tracks: provider.mode === "mock" ? hackathonTracks : [],
  liveStats: null,
  mySubmissions: [],
  activeAssignment: null,
  selectedTrackId: "launch-exact",
  preferredBenchmarkId: null,
  draftAnswer: "",
  exportPayload: "",
  filters: {
    query: "",
    domain: "all",
    baseline: "estimated_only",
    visibility: "all",
    priority: "all",
  },
  flash: null,
  timerStartedAtMs: null,
  timerIntervalId: null,
  auth: {
    ready: provider.mode === "mock",
    configured: provider.mode === "mock" ? false : authController.configured,
    user: null,
    lastEmailSent: "",
  },
  backendError: null,
};

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatHours(value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return value >= 100 ? `${Math.round(value)}h` : `${value.toFixed(1)}h`;
}

function formatMinutesRange(range) {
  if (!range) {
    return "n/a";
  }
  return `${range.min}-${range.max} ${range.unit}`;
}

function formatRelativeDate(dateString) {
  if (!dateString) {
    return "n/a";
  }
  const date = new Date(dateString);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderChip(label, tone = "muted") {
  return `<span class="chip" data-tone="${tone}">${escapeHtml(label)}</span>`;
}

function getTrackById(trackId) {
  return state.tracks.find((track) => track.id === trackId) || state.tracks[0] || {
    id: "unavailable",
    title: "Track unavailable",
    description: "Sign in and register to load event tracks.",
    benchmarkIds: [],
    requiresBackend: false,
  };
}

function getBenchmarkById(benchmarkId) {
  return state.catalog.find((benchmark) => benchmark.id === benchmarkId) || null;
}

function getAccessStage() {
  if (provider.mode === "mock") {
    return "ready";
  }
  if (!state.auth.ready) {
    return "loading";
  }
  if (!state.auth.user) {
    return "auth_required";
  }
  if (!state.participant) {
    return "registration_required";
  }
  return "ready";
}

function getElapsedSeconds() {
  if (!state.activeAssignment || !state.timerStartedAtMs) {
    return 0;
  }
  return Math.max(0, Math.round((Date.now() - state.timerStartedAtMs) / 1000));
}

function startTimerIfNeeded() {
  if (!state.activeAssignment || state.timerIntervalId) {
    updateTimerLabel();
    return;
  }

  state.timerIntervalId = window.setInterval(() => {
    updateTimerLabel();
  }, 1000);

  updateTimerLabel();
}

function stopTimerIfNeeded() {
  if (state.timerIntervalId) {
    window.clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
  }
}

function updateTimerLabel() {
  const value = getElapsedSeconds();
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  const label = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  const timerNode = document.getElementById("assignment-timer");
  if (timerNode) {
    timerNode.textContent = label;
  }
}

function setFlash(tone, title, text) {
  state.flash = { tone, title, text };
}

function clearFlash() {
  state.flash = null;
}

function isErrorStatus(error, status) {
  return Number(error?.status) === status || String(error?.message || "").includes(`: ${status} `);
}

function getErrorText(error) {
  return error?.message || "Unexpected error.";
}

function getFilteredCatalog() {
  const { query, domain, baseline, visibility, priority } = state.filters;
  const normalizedQuery = query.trim().toLowerCase();

  return state.catalog.filter((benchmark) => {
    if (domain !== "all" && benchmark.domain !== domain) {
      return false;
    }
    if (baseline !== "all" && benchmark.baselineStatus !== baseline) {
      return false;
    }
    if (visibility !== "all" && benchmark.visibility !== visibility) {
      return false;
    }
    if (priority !== "all" && benchmark.priority !== priority) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    const haystack = [
      benchmark.title,
      benchmark.description,
      benchmark.domain,
      benchmark.contributor,
      benchmark.notes,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

function renderHeroSection() {
  const currentTrack = getTrackById(state.selectedTrackId);
  const focusedBenchmark = getBenchmarkById(state.preferredBenchmarkId);
  const accessStage = getAccessStage();
  const heroStatusText =
    provider.mode === "mock"
      ? "Mock solve flow active; backend still required for private tracks and shared stats"
      : accessStage === "auth_required"
      ? "Sign in with a magic link to access the live event"
      : accessStage === "registration_required"
      ? "Authenticated; event registration still required"
      : "Backend-connected event mode";

  return `
    <section class="hero-panel">
      <div class="hero-panel__intro">
        <p class="eyebrow">Human Baselines In Progress</p>
        <h1>Time Horizons Hackathon</h1>
        <p class="hero-copy">
          This subpage is the operational front-end for collecting human solve-time
          baselines on benchmarks that currently only have estimated horizons.
        </p>
        <div class="pill-row" style="margin-top: 18px;">
          ${renderChip(`Track: ${currentTrack?.title || "n/a"}`, "accent")}
          ${focusedBenchmark ? renderChip(`Queue focus: ${focusedBenchmark.title}`, "success") : renderChip("Queue focus: auto-allocation", "muted")}
        </div>
      </div>
      <div class="hero-panel__status">
        <div class="metric-tile">
          <span class="metric-tile__label">Frontend mode</span>
          <strong id="hero-backend-mode">${escapeHtml(provider.mode.toUpperCase())}</strong>
        </div>
        <div class="metric-tile">
          <span class="metric-tile__label">Current event</span>
          <strong id="hero-event-name">${escapeHtml(appConfig.event.name)}</strong>
        </div>
        <div class="metric-tile metric-tile--accent">
          <span class="metric-tile__label">Status</span>
          <strong id="hero-status-text">${escapeHtml(heroStatusText)}</strong>
        </div>
      </div>
    </section>
  `;
}

function renderOverviewSection() {
  const accessStage = getAccessStage();
  const visibleCatalog = state.catalog;
  const exactLaunchBenchmarks = state.catalog.filter((item) =>
    ["launch", "sample_first"].includes(item.priority)
  );

  const publicEstimatedOnly = state.catalog.filter(
    (item) => item.baselineStatus === "estimated_only" && item.visibility === "public"
  );

  return `
    <section id="overview" class="section-grid">
      <article class="surface-card">
        <div class="surface-card__header">
          <div>
            <p class="surface-card__eyebrow">Scope</p>
            <h2>What this app is handling</h2>
            <p>
              Static subpage frontend, mock-mode demo queue, real benchmark catalog,
              and explicit placeholders for private delivery, async grading, and shared
              event stats.
            </p>
          </div>
          <div class="pill-row">
            ${renderChip(`Mode: ${provider.mode}`, provider.mode === "mock" ? "warning" : "success")}
            ${renderChip("Frontend live", "success")}
            ${renderChip("Backend placeholders wired", "accent")}
          </div>
        </div>

        <div class="stat-grid">
          <article class="stat-card">
            <p class="stat-card__value">${visibleCatalog.filter((item) => item.baselineStatus === "estimated_only").length}</p>
            <p class="stat-card__label">Benchmarks without real baselines</p>
          </article>
          <article class="stat-card">
            <p class="stat-card__value">${visibleCatalog.filter((item) => item.baselineStatus === "has_real").length}</p>
            <p class="stat-card__label">Benchmarks already carrying real baselines</p>
          </article>
          <article class="stat-card">
            <p class="stat-card__value">${visibleCatalog.filter((item) => item.baselineStatus === "estimated_only" && item.visibility === "private").length}</p>
            <p class="stat-card__label">Estimated-only private tracks</p>
          </article>
          <article class="stat-card">
            <p class="stat-card__value">${formatNumber(publicEstimatedOnly.reduce((sum, item) => sum + item.itemCount, 0))}</p>
            <p class="stat-card__label">Public estimated-only items listed here</p>
          </article>
        </div>

        <div class="callout" style="margin-top: 18px;">
          ${provider.mode === "mock" ? `
            <strong>Important:</strong>
            current mock mode is only a frontend stand-in. It cannot serve
            <code>monitor_training_poisoning</code> or synchronize real multi-user stats.
            The solve queue therefore demonstrates the workflow with public demo imports and a
            private-task placeholder.
          ` : accessStage === "auth_required" ? `
            <strong>Private data stays off the public site.</strong>
            In API mode the frontend only becomes usable after participant sign-in and registration.
            Assigned tasks are delivered one at a time by the backend.
          ` : `
            <strong>Live privacy model:</strong>
            catalog, assignments, and stats are served through the backend; private task payloads
            are not bundled into the static site.
          `}
        </div>
      </article>

      <aside class="surface-card">
        <div class="surface-card__header">
          <div>
            <p class="surface-card__eyebrow">Launch shape</p>
            <h2>Recommended first-event mix</h2>
          </div>
        </div>
        <div class="coverage-list">
          ${exactLaunchBenchmarks.slice(0, 6).map((benchmark) => `
            <article class="coverage-card">
              <div class="coverage-card__header">
                <div>
                  <h3>${escapeHtml(benchmark.title)}</h3>
                  <p>${escapeHtml(benchmark.notes)}</p>
                </div>
                <div class="chip-row">
                  ${renderChip(benchmark.priority.replaceAll("_", " "), benchmark.priority === "launch" ? "success" : "accent")}
                  ${renderChip(`${benchmark.itemCount} items`, "muted")}
                </div>
              </div>
            </article>
          `).join("")}
        </div>
      </aside>
    </section>
  `;
}

function renderBenchmarkCard(benchmark) {
  const canDirectQueue =
    benchmark.frontendMode === "direct" &&
    benchmark.baselineStatus === "estimated_only" &&
    benchmark.visibility === "public";
  const isFocused = state.preferredBenchmarkId === benchmark.id;

  return `
    <article class="benchmark-card" data-benchmark-id="${escapeHtml(benchmark.id)}">
      <div class="benchmark-card__header">
        <div>
          <h3>${escapeHtml(benchmark.title)}</h3>
          <p>${escapeHtml(benchmark.description)}</p>
        </div>
        <div class="chip-row">
          ${renderChip(benchmark.baselineStatus === "estimated_only" ? "needs real baseline" : "has real baseline", benchmark.baselineStatus === "estimated_only" ? "warning" : "success")}
          ${renderChip(benchmark.visibility, benchmark.visibility === "private" ? "warning" : "muted")}
          ${renderChip(benchmark.priority.replaceAll("_", " "), "accent")}
        </div>
      </div>

      <div class="pill-row">
        ${renderChip(benchmark.domain)}
        ${renderChip(`scorer: ${benchmark.scorer}`)}
        ${renderChip(`frontend: ${benchmark.frontendMode}`)}
        ${renderChip(`grading: ${benchmark.gradingMode}`)}
      </div>

      <div class="meta-grid">
        <div class="meta-grid__cell">
          <span class="meta-grid__label">Contributor</span>
          <span class="meta-grid__value">${escapeHtml(benchmark.contributor)}</span>
        </div>
        <div class="meta-grid__cell">
          <span class="meta-grid__label">Items</span>
          <span class="meta-grid__value">${formatNumber(benchmark.itemCount)}</span>
        </div>
        <div class="meta-grid__cell">
          <span class="meta-grid__label">Estimated range</span>
          <span class="meta-grid__value">${formatMinutesRange(benchmark.estimatedRange)}</span>
        </div>
        <div class="meta-grid__cell">
          <span class="meta-grid__label">1x coverage</span>
          <span class="meta-grid__value">${benchmark.totalEstimatedHours == null ? "n/a" : formatHours(benchmark.totalEstimatedHours)}</span>
        </div>
      </div>

      <div class="inline-actions" style="margin-top: 16px;">
        ${canDirectQueue ? `
          <button class="btn btn--secondary" type="button" data-action="queue-benchmark" data-benchmark-id="${escapeHtml(benchmark.id)}">
            ${isFocused ? "Focused In Queue" : "Focus In Queue"}
          </button>
        ` : `
          <span class="muted-text">This benchmark is listed for planning, but not fully imported into mock solve mode.</span>
        `}
      </div>
    </article>
  `;
}

function renderBenchmarksSection() {
  const accessStage = getAccessStage();
  if (provider.mode === "api" && accessStage !== "ready") {
    return `
      <section id="benchmarks" class="surface-card">
        <div class="empty-state">
          <h3>Benchmark browser locked</h3>
          <p>${accessStage === "auth_required" ? "Sign in first to load the live event catalog." : accessStage === "registration_required" ? "Complete event registration to load benchmark access." : "Preparing authenticated session."}</p>
        </div>
      </section>
    `;
  }

  const filtered = getFilteredCatalog();
  const domains = Array.from(new Set(state.catalog.map((item) => item.domain))).sort();
  const priorities = Array.from(new Set(state.catalog.map((item) => item.priority))).sort();

  return `
    <section id="benchmarks" class="surface-card">
      <div class="surface-card__header">
        <div>
          <p class="surface-card__eyebrow">Benchmark Browser</p>
          <h2>Target pool for human-baseline collection</h2>
          <p>
            Catalog is seeded from the current submitted task definitions and filtered toward
            the estimated-only benchmarks that need hackathon attention.
          </p>
        </div>
        <div class="pill-row">
          ${renderChip(`${filtered.length} visible`, "success")}
          ${renderChip(`${state.catalog.filter((item) => item.baselineStatus === "estimated_only").length} no-baseline tasks`, "warning")}
        </div>
      </div>

      <div class="benchmark-controls">
        <div class="field">
          <label for="filter-query">Search</label>
          <input id="filter-query" name="filter-query" type="text" value="${escapeHtml(state.filters.query)}" placeholder="task, scorer, contributor">
        </div>
        <div class="field">
          <label for="filter-domain">Domain</label>
          <select id="filter-domain" name="filter-domain">
            <option value="all"${state.filters.domain === "all" ? " selected" : ""}>All domains</option>
            ${domains.map((domain) => `<option value="${escapeHtml(domain)}"${state.filters.domain === domain ? " selected" : ""}>${escapeHtml(domain)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="filter-baseline">Baseline status</label>
          <select id="filter-baseline" name="filter-baseline">
            <option value="all"${state.filters.baseline === "all" ? " selected" : ""}>All</option>
            <option value="estimated_only"${state.filters.baseline === "estimated_only" ? " selected" : ""}>Needs real baseline</option>
            <option value="has_real"${state.filters.baseline === "has_real" ? " selected" : ""}>Already has real baseline</option>
          </select>
        </div>
        <div class="field">
          <label for="filter-visibility">Visibility</label>
          <select id="filter-visibility" name="filter-visibility">
            <option value="all"${state.filters.visibility === "all" ? " selected" : ""}>All</option>
            <option value="public"${state.filters.visibility === "public" ? " selected" : ""}>Public</option>
            <option value="private"${state.filters.visibility === "private" ? " selected" : ""}>Private</option>
          </select>
        </div>
        <div class="field">
          <label for="filter-priority">Priority</label>
          <select id="filter-priority" name="filter-priority">
            <option value="all"${state.filters.priority === "all" ? " selected" : ""}>All priorities</option>
            ${priorities.map((priority) => `<option value="${escapeHtml(priority)}"${state.filters.priority === priority ? " selected" : ""}>${escapeHtml(priority.replaceAll("_", " "))}</option>`).join("")}
          </select>
        </div>
      </div>

      <div class="benchmark-list" style="margin-top: 20px;">
        ${filtered.map(renderBenchmarkCard).join("") || `
          <div class="empty-state">No benchmarks match the current filters.</div>
        `}
      </div>
    </section>
  `;
}

function renderParticipantPanel() {
  if (provider.mode === "api") {
    if (!state.auth.ready) {
      return `
        <article class="surface-card">
          <div class="empty-state">
            <h3>Preparing auth</h3>
            <p>Checking for an active magic-link session.</p>
          </div>
        </article>
      `;
    }

    if (!state.auth.configured) {
      return `
        <article class="surface-card">
          <div class="empty-state">
            <h3>Auth not configured</h3>
            <p>Set the Supabase URL, anon key, and redirect URL in the frontend config before switching to API mode.</p>
          </div>
        </article>
      `;
    }

    if (!state.auth.user) {
      return `
        <article class="surface-card">
          <div class="surface-card__header">
            <div>
              <p class="surface-card__eyebrow">Participant Access</p>
              <h3>Sign in with a magic link</h3>
              <p>
                Live mode is invite-gated. Enter the email address that was allowlisted for the event.
              </p>
            </div>
          </div>
          <form id="magic-link-form" class="form-grid">
            <div class="field">
              <label for="magic-link-email">Email</label>
              <input id="magic-link-email" name="email" type="email" placeholder="ida@example.org" required>
            </div>
            <div class="inline-actions" style="grid-column: 1 / -1;">
              <button class="btn btn--primary" type="submit">Send Magic Link</button>
            </div>
          </form>
          ${state.auth.lastEmailSent ? `
            <div class="callout" style="margin-top: 14px;">
              <strong>Magic link sent</strong><br>
              Check ${escapeHtml(state.auth.lastEmailSent)} for the sign-in link, then return here.
            </div>
          ` : ""}
        </article>
      `;
    }

    if (!state.participant) {
      return `
        <article class="surface-card">
          <div class="surface-card__header">
            <div>
              <p class="surface-card__eyebrow">Participant Registration</p>
              <h3>Finish event registration</h3>
              <p>
                Authenticated as ${escapeHtml(state.auth.user.email || "unknown user")}. Submit your profile to register for this hackathon event.
              </p>
            </div>
          </div>
          <form id="participant-form" class="form-grid">
            <div class="field">
              <label for="participant-name">Name</label>
              <input id="participant-name" name="name" type="text" placeholder="Ida Caspary" required>
            </div>
            <div class="field">
              <label for="participant-email">Email</label>
              <input id="participant-email" name="email" type="email" value="${escapeHtml(state.auth.user.email || "")}" readonly required>
            </div>
            <div class="field">
              <label for="participant-team">Team</label>
              <input id="participant-team" name="team" type="text" placeholder="Reasoning Track">
            </div>
            <div class="field">
              <label for="participant-affiliation">Affiliation</label>
              <input id="participant-affiliation" name="affiliation" type="text" placeholder="Imperial College London">
            </div>
            <div class="inline-actions" style="grid-column: 1 / -1;">
              <button class="btn btn--primary" type="submit">Register For Event</button>
              <button class="btn btn--ghost" type="button" id="signout-btn">Sign Out</button>
            </div>
          </form>
        </article>
      `;
    }

    return `
      <article class="surface-card">
        <div class="surface-card__header">
          <div>
            <p class="surface-card__eyebrow">Participant</p>
            <h3>${escapeHtml(state.participant.name)}</h3>
            <p>${escapeHtml(state.participant.email)}</p>
          </div>
          <div class="chip-row">
            ${renderChip(state.participant.team || "no team", "accent")}
            ${renderChip(state.participant.affiliation || "registered participant", "muted")}
            ${renderChip(state.participant.canAccessPrivate ? "private-track access" : "public-track access", state.participant.canAccessPrivate ? "success" : "warning")}
          </div>
        </div>
        <div class="inline-actions">
          <button class="btn btn--ghost" type="button" id="signout-btn">Sign Out</button>
        </div>
      </article>
    `;
  }

  if (!state.participant) {
    return `
      <article class="surface-card">
        <div class="surface-card__header">
          <div>
            <p class="surface-card__eyebrow">Participant</p>
            <h3>Create local profile</h3>
            <p>
              In mock mode this stays in browser storage. In API mode this should be replaced by
              magic-link auth plus event registration.
            </p>
          </div>
        </div>
        <form id="participant-form" class="form-grid">
          <div class="field">
            <label for="participant-name">Name</label>
            <input id="participant-name" name="name" type="text" placeholder="Ida Caspary" required>
          </div>
          <div class="field">
            <label for="participant-email">Email</label>
            <input id="participant-email" name="email" type="email" placeholder="ida@example.org" required>
          </div>
          <div class="field">
            <label for="participant-team">Team</label>
            <input id="participant-team" name="team" type="text" placeholder="Reasoning Track">
          </div>
          <div class="field">
            <label for="participant-affiliation">Affiliation</label>
            <input id="participant-affiliation" name="affiliation" type="text" placeholder="Imperial College London">
          </div>
          <div class="inline-actions" style="grid-column: 1 / -1;">
            <button class="btn btn--primary" type="submit">Save Local Profile</button>
          </div>
        </form>
      </article>
    `;
  }

  return `
    <article class="surface-card">
      <div class="surface-card__header">
        <div>
          <p class="surface-card__eyebrow">Participant</p>
          <h3>${escapeHtml(state.participant.name)}</h3>
          <p>${escapeHtml(state.participant.email)}</p>
        </div>
        <div class="chip-row">
          ${renderChip(state.participant.team || "no team", "accent")}
          ${renderChip(state.participant.affiliation || "local profile", "muted")}
        </div>
      </div>
      <div class="inline-actions">
        <button class="btn btn--ghost" type="button" id="edit-profile-btn">Edit profile</button>
      </div>
    </article>
  `;
}

function renderMySubmissionCard(submission) {
  const benchmark = state.catalog.find((item) => item.id === submission.benchmarkId);
  return `
    <article class="submission-card">
      <div class="submission-card__header">
        <div>
          <h3>${escapeHtml(benchmark?.title || submission.benchmarkId)}</h3>
          <p>Submitted ${formatRelativeDate(submission.submittedAt)}</p>
        </div>
        <div class="chip-row">
          ${renderChip(submission.gradingStatus.replaceAll("_", " "), submission.gradingStatus === "correct" ? "success" : submission.gradingStatus === "incorrect" ? "warning" : "accent")}
        </div>
      </div>
      <div class="meta-grid">
        <div class="meta-grid__cell">
          <span class="meta-grid__label">Answer</span>
          <span class="meta-grid__value">${escapeHtml(submission.submittedAnswer || "n/a")}</span>
        </div>
        <div class="meta-grid__cell">
          <span class="meta-grid__label">Active time</span>
          <span class="meta-grid__value">${Math.round((submission.activeSeconds || 0) / 60)} min</span>
        </div>
        <div class="meta-grid__cell">
          <span class="meta-grid__label">Score value</span>
          <span class="meta-grid__value">${submission.scoreValue == null ? "pending" : escapeHtml(submission.scoreValue)}</span>
        </div>
        <div class="meta-grid__cell">
          <span class="meta-grid__label">Explanation</span>
          <span class="meta-grid__value">${escapeHtml(submission.explanation || "n/a")}</span>
        </div>
      </div>
    </article>
  `;
}

function renderSolveSidebar() {
  const track = getTrackById(state.selectedTrackId);
  const isBlockedTrack = provider.mode === "mock" && track.requiresBackend;
  const focusedBenchmark = getBenchmarkById(state.preferredBenchmarkId);

  return `
    <div class="assignment-panel">
      ${renderParticipantPanel()}

      <article class="surface-card">
        <div class="surface-card__header">
          <div>
            <p class="surface-card__eyebrow">Queue</p>
            <h3>Claim the next task</h3>
            <p>
              This queue is seeded with demo imports and placeholders. The real backend should
              allocate one task at a time and track shared coverage centrally.
            </p>
          </div>
        </div>

        <div class="field">
          <label for="track-select">Track</label>
          <select id="track-select" name="track-select">
            ${state.tracks.map((candidate) => `
              <option value="${escapeHtml(candidate.id)}"${candidate.id === state.selectedTrackId ? " selected" : ""}>
                ${escapeHtml(candidate.title)}
              </option>
            `).join("")}
          </select>
        </div>

        <div class="callout" style="margin-top: 14px;">
          <strong>${escapeHtml(track.title)}</strong><br>
          ${escapeHtml(track.description)}
        </div>

        ${focusedBenchmark ? `
          <div class="callout" style="margin-top: 14px;">
            <strong>Queue focus</strong><br>
            ${escapeHtml(focusedBenchmark.title)} is currently prioritized when a matching mock task exists in this track.
          </div>
        ` : ""}

        <div class="inline-actions" style="margin-top: 14px;">
          <button class="btn btn--primary" type="button" id="claim-task-btn"${!state.participant || isBlockedTrack ? " disabled" : ""}>
            Claim Next Task
          </button>
          <button class="btn btn--ghost" type="button" id="release-task-btn"${state.activeAssignment ? "" : " disabled"}>
            Release Active Task
          </button>
        </div>

        ${isBlockedTrack ? `
          <div class="status-banner" data-tone="warning" style="margin-top: 14px;">
            <div>
              <strong>Backend required for this track</strong>
              <p>Private or signed-payload delivery is not available in mock mode.</p>
            </div>
          </div>
        ` : ""}
      </article>

      <article class="surface-card">
        <div class="surface-card__header">
          <div>
            <p class="surface-card__eyebrow">My Submissions</p>
            <h3>Recent work</h3>
          </div>
          <div class="chip-row">
            ${renderChip(`${state.mySubmissions.length} stored locally`, "success")}
          </div>
        </div>
        <div class="submission-list">
          ${state.mySubmissions.slice(0, 4).map(renderMySubmissionCard).join("") || `
            <div class="empty-state">No submissions yet in this browser profile.</div>
          `}
        </div>
      </article>
    </div>
  `;
}

function renderPromptBlocks(blocks) {
  const renderPromptContent = (text) => {
    const source = String(text ?? "");
    const fencePattern = /```([a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g;
    const parts = [];
    let cursor = 0;
    let match = fencePattern.exec(source);

    while (match) {
      const before = source.slice(cursor, match.index);
      if (before.trim()) {
        parts.push(
          `<div class="prompt-copy">${escapeHtml(before).replaceAll("\n", "<br>")}</div>`
        );
      }
      parts.push(
        `<pre class="code-block"><code>${escapeHtml(match[2].trim())}</code></pre>`
      );
      cursor = match.index + match[0].length;
      match = fencePattern.exec(source);
    }

    const after = source.slice(cursor);
    if (after.trim() || parts.length === 0) {
      parts.push(
        `<div class="prompt-copy">${escapeHtml(after || source).replaceAll("\n", "<br>")}</div>`
      );
    }

    return parts.join("");
  };

  return blocks
    .map((block) => {
      if (block.type === "image") {
        return `
          <figure class="prompt-block prompt-block--image">
            <img class="prompt-image" src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt || "")}">
            ${block.caption ? `<figcaption class="helper-text">${escapeHtml(block.caption)}</figcaption>` : ""}
          </figure>
        `;
      }

      return `
        <div class="prompt-block${block.type === "callout" ? " prompt-block--callout" : ""}">
          ${renderPromptContent(block.text)}
        </div>
      `;
    })
    .join("");
}

function renderAnswerField(assignment) {
  const spec = assignment.answerSpec;

  if (spec.type === "single_choice") {
    return `
      <div class="answer-grid">
        <p class="helper-text">${escapeHtml(spec.instruction)}</p>
        <div class="answer-options">
          ${spec.options.map((option) => `
            <label class="answer-option">
              <input
                type="radio"
                name="assignment-answer"
                value="${escapeHtml(option.key)}"
                ${state.draftAnswer === option.key ? "checked" : ""}
              >
              <span class="answer-option__key">${escapeHtml(option.key)}</span>
              <span class="answer-option__body">${escapeHtml(option.label)}</span>
            </label>
          `).join("")}
        </div>
      </div>
    `;
  }

  if (spec.type === "range") {
    return `
      <div class="field">
        <label for="assignment-answer-range">${escapeHtml(spec.instruction)}</label>
        <input
          id="assignment-answer-range"
          name="assignment-answer-range"
          type="number"
          min="${spec.min}"
          max="${spec.max}"
          value="${escapeHtml(state.draftAnswer)}"
          placeholder="${escapeHtml(spec.placeholder || "")}"
        >
      </div>
    `;
  }

  if (spec.type === "placeholder") {
    return `
      <div class="field">
        <label for="assignment-answer-placeholder">${escapeHtml(spec.instruction)}</label>
        <textarea id="assignment-answer-placeholder" disabled>${escapeHtml(spec.placeholder || "")}</textarea>
      </div>
    `;
  }

  return `
    <div class="field">
      <label for="assignment-answer-input">${escapeHtml(spec.instruction)}</label>
      <textarea
        id="assignment-answer-input"
        name="assignment-answer-input"
        placeholder="${escapeHtml(spec.placeholder || "")}"
      >${escapeHtml(state.draftAnswer)}</textarea>
    </div>
  `;
}

function renderSolveMainPanel() {
  if (!state.activeAssignment) {
    return `
      <article class="task-card">
        <div class="empty-state">
          <h3>No active assignment</h3>
          <p>Claim a task from the queue to start the solve flow.</p>
        </div>
      </article>
    `;
  }

  const benchmark = state.catalog.find((item) => item.id === state.activeAssignment.benchmarkId);
  const isBlocked = state.activeAssignment.availability === "backend_only";

  return `
    <article class="task-card">
      <div class="task-card__header">
        <div>
          <h2 class="task-card__title">${escapeHtml(state.activeAssignment.title)}</h2>
          <p class="task-card__subtitle">${escapeHtml(benchmark?.description || "")}</p>
        </div>
        <div class="chip-row">
          ${renderChip(benchmark?.title || state.activeAssignment.benchmarkId, "accent")}
          ${renderChip(`${state.activeAssignment.estimatedMinutes} min est.`, "muted")}
        </div>
      </div>

      <div class="task-meta">
        <div class="meta-grid__cell">
          <span class="meta-grid__label">Visibility</span>
          <span class="meta-grid__value">${escapeHtml(state.activeAssignment.visibility)}</span>
        </div>
        <div class="meta-grid__cell">
          <span class="meta-grid__label">Grading</span>
          <span class="meta-grid__value">${escapeHtml(benchmark?.gradingMode || "n/a")}</span>
        </div>
        <div class="meta-grid__cell">
          <span class="meta-grid__label">Scorer</span>
          <span class="meta-grid__value">${escapeHtml(benchmark?.scorer || "n/a")}</span>
        </div>
        <div class="meta-grid__cell">
          <span class="meta-grid__label">Selected track</span>
          <span class="meta-grid__value">${escapeHtml(getTrackById(state.selectedTrackId).title)}</span>
        </div>
      </div>

      <div class="timer-panel">
        <div>
          <div class="metric-tile__label">Elapsed solve time</div>
          <div class="timer-panel__value" id="assignment-timer">00:00</div>
        </div>
        <div class="helper-text">
          ${provider.mode === "mock"
            ? "Mock mode records wall-clock time. Real mode should replace this with active heartbeat-based timing."
            : "Live mode currently records client-side elapsed time. The backend schema is prepared for heartbeat-based active timing."}
        </div>
      </div>

      <div class="task-prompt" style="margin-top: 18px;">
        ${renderPromptBlocks(state.activeAssignment.promptBlocks)}
      </div>

      ${isBlocked ? `
        <div class="status-banner" data-tone="warning">
          <div>
            <strong>Placeholder only</strong>
            <p>This assignment demonstrates the protected-task rendering slot but cannot be solved from static mode.</p>
          </div>
        </div>
      ` : `
        <form id="assignment-form">
          ${renderAnswerField(state.activeAssignment)}
          <div class="inline-actions" style="margin-top: 16px;">
            <button class="btn btn--primary" type="submit">Submit Solution</button>
            <button class="btn btn--secondary" type="button" id="clear-answer-btn">Clear Draft</button>
          </div>
        </form>
      `}
    </article>
  `;
}

function renderSolveSection() {
  return `
    <section id="solve" class="surface-card">
      <div class="surface-card__header">
        <div>
          <p class="surface-card__eyebrow">Solve</p>
          <h2>Assignment queue and submission flow</h2>
          <p>
            This flow is already usable in mock mode. When the backend is available, the same UI
            should claim one assignment at a time, fetch private payloads, and write live stats to the shared store.
          </p>
        </div>
      </div>

      ${state.flash ? `
        <div class="status-banner" data-tone="${escapeHtml(state.flash.tone)}" style="margin-bottom: 18px;">
          <div>
            <strong>${escapeHtml(state.flash.title)}</strong>
            <p>${escapeHtml(state.flash.text)}</p>
          </div>
        </div>
      ` : ""}

      <div class="queue-layout">
        ${renderSolveSidebar()}
        ${renderSolveMainPanel()}
      </div>
    </section>
  `;
}

function renderLiveStatsSection() {
  const accessStage = getAccessStage();
  if (provider.mode === "api" && accessStage !== "ready") {
    return `
      <section id="stats" class="surface-card">
        <div class="empty-state">
          <h3>Live stats locked</h3>
          <p>${accessStage === "auth_required" ? "Sign in first to view event stats." : accessStage === "registration_required" ? "Complete event registration before loading shared stats." : "Preparing authenticated session."}</p>
        </div>
      </section>
    `;
  }

  const stats = state.liveStats || {
    participantCount: 0,
    submissionCount: 0,
    uniqueAssignmentsCovered: 0,
    resolvedCount: 0,
    pendingCount: 0,
    collectedHours: 0,
    leaderboard: [],
    coverage: [],
  };

  const maxCoverage = Math.max(...stats.coverage.map((row) => row.coverageRatio), 0.01);

  return `
    <section id="stats" class="surface-card">
      <div class="surface-card__header">
        <div>
          <p class="surface-card__eyebrow">Live Stats</p>
          <h2>Event dashboard</h2>
          <p>
            In mock mode these are local-browser aggregates. API mode should replace this with
            shared event metrics and benchmark-level coverage over the full assignment pool.
          </p>
        </div>
        <div class="chip-row">
          ${renderChip(provider.mode === "mock" ? "local-only stats" : "shared event stats", provider.mode === "mock" ? "warning" : "success")}
        </div>
      </div>

      <div class="stat-grid">
        <article class="stat-card">
          <p class="stat-card__value">${formatNumber(stats.participantCount)}</p>
          <p class="stat-card__label">Participants seen by this mode</p>
        </article>
        <article class="stat-card">
          <p class="stat-card__value">${formatNumber(stats.submissionCount)}</p>
          <p class="stat-card__label">Submissions recorded</p>
        </article>
        <article class="stat-card">
          <p class="stat-card__value">${formatNumber(stats.uniqueAssignmentsCovered)}</p>
          <p class="stat-card__label">Unique assignments covered</p>
        </article>
        <article class="stat-card">
          <p class="stat-card__value">${formatHours(stats.collectedHours)}</p>
          <p class="stat-card__label">Human-hours logged in this mode</p>
        </article>
      </div>

      <div class="section-grid" style="margin-top: 20px;">
        <article class="surface-card">
          <div class="surface-card__header">
            <div>
              <p class="surface-card__eyebrow">Coverage</p>
              <h3>Imported benchmark progress</h3>
            </div>
          </div>
          <div class="bar-chart">
            ${stats.coverage.map((row) => `
              <div class="bar-row">
                <span class="bar-row__label">${escapeHtml(row.title)}</span>
                <div class="bar-row__track">
                  <div class="bar-row__fill" style="width: ${Math.max(6, (row.coverageRatio / maxCoverage) * 100)}%"></div>
                </div>
                <span class="bar-row__value">${row.submittedInMock}/${row.availableInMock}</span>
              </div>
            `).join("") || `<div class="empty-state">No coverage data yet.</div>`}
          </div>
        </article>

        <article class="surface-card">
          <div class="surface-card__header">
            <div>
              <p class="surface-card__eyebrow">Leaderboard</p>
              <h3>Current local standings</h3>
            </div>
          </div>
          <div class="benchmark-list">
            ${stats.leaderboard.map((row) => `
              <article class="benchmark-card">
                <div class="benchmark-card__header">
                  <div>
                    <h3>${escapeHtml(row.label)}</h3>
                    <p>${row.submissions} submissions, ${row.resolved} resolved, ${row.correct} exact-score correct</p>
                  </div>
                  <div class="chip-row">
                    ${renderChip(`${Math.round(row.seconds / 60)} min`, "muted")}
                  </div>
                </div>
              </article>
            `).join("") || `<div class="empty-state">No local leaderboard entries yet.</div>`}
          </div>
        </article>
      </div>
    </section>
  `;
}

function renderAdminSection() {
  return `
    <section id="admin" class="surface-card">
      <div class="surface-card__header">
        <div>
          <p class="surface-card__eyebrow">Admin</p>
          <h2>Backend placeholders and local controls</h2>
          <p>
            The frontend is done enough to demo, but these values still need to be collected and
            wired before the private track can run for real.
          </p>
        </div>
      </div>

      <div class="section-grid">
        <article class="surface-card">
          <div class="surface-card__header">
            <div>
              <p class="surface-card__eyebrow">Missing inputs</p>
              <h3>Configuration still needed</h3>
            </div>
          </div>
          <div class="benchmark-list">
            ${Object.entries(appConfig.placeholders).map(([key, value]) => `
              <article class="benchmark-card">
                <div class="benchmark-card__header">
                  <div>
                    <h3>${escapeHtml(key)}</h3>
                    <p>${escapeHtml(value)}</p>
                  </div>
                </div>
              </article>
            `).join("")}
          </div>
        </article>

        <article class="surface-card">
          <div class="surface-card__header">
            <div>
              <p class="surface-card__eyebrow">Local controls</p>
              <h3>Export and reset</h3>
            </div>
          </div>
          <div class="inline-actions">
            <button class="btn btn--secondary" type="button" id="refresh-stats-btn">Refresh Stats</button>
            <button class="btn btn--secondary" type="button" id="export-state-btn">Export Local State</button>
            <button class="btn btn--accent" type="button" id="reset-local-btn">Reset Local Mock Data</button>
          </div>
          <div class="admin-log" style="margin-top: 16px;">
            <label for="admin-export-area"><strong>Local export payload</strong></label>
            <textarea id="admin-export-area" placeholder="Local export appears here after clicking Export Local State.">${escapeHtml(state.exportPayload)}</textarea>
          </div>
        </article>
      </div>

      <article class="surface-card" style="margin-top: 20px;">
        <div class="surface-card__header">
          <div>
            <p class="surface-card__eyebrow">Backend contract</p>
            <h3>What this frontend expects next</h3>
          </div>
        </div>
        <div class="link-list">
          <span>Deploy the private backend workspace separately before switching to API mode.</span>
          <span class="muted-text">${escapeHtml(appCapabilities.backendRequiredFor.join(" · "))}</span>
        </div>
      </article>
    </section>
  `;
}

function renderApp() {
  const root = document.getElementById("app-root");
  if (!root) {
    return;
  }

  root.innerHTML = `
    ${renderHeroSection()}
    ${renderOverviewSection()}
    ${renderBenchmarksSection()}
    ${renderSolveSection()}
    ${renderLiveStatsSection()}
    ${renderAdminSection()}
  `;

  attachListeners();
  if (state.activeAssignment) {
    startTimerIfNeeded();
  } else {
    stopTimerIfNeeded();
  }
}

async function refreshData(options = {}) {
  const { preserveFlash = false } = options;
  if (!preserveFlash) {
    clearFlash();
  }

  state.backendError = null;

  if (provider.mode === "api" && !state.auth.user) {
    state.participant = null;
    state.catalog = [];
    state.tracks = [];
    state.mySubmissions = [];
    state.liveStats = null;
    state.activeAssignment = null;
    state.timerStartedAtMs = null;
    state.draftAnswer = "";
    renderApp();
    return;
  }

  if (provider.mode === "api") {
    try {
      state.participant = await provider.getParticipant();
    } catch (error) {
      if (isErrorStatus(error, 404)) {
        state.participant = null;
        state.catalog = [];
        state.tracks = [];
        state.mySubmissions = [];
        state.liveStats = null;
        state.activeAssignment = null;
        state.timerStartedAtMs = null;
        state.draftAnswer = "";
        renderApp();
        return;
      }

      state.backendError = getErrorText(error);
      setFlash("error", "Backend error", state.backendError);
      renderApp();
      return;
    }
  }

  if (provider.mode === "mock") {
    state.participant = await provider.getParticipant();
  }

  try {
    const [catalog, tracks, mySubmissions, liveStats, activeAssignment] = await Promise.all([
      provider.getCatalog?.(),
      provider.getTracks?.(),
      provider.getMySubmissions(),
      provider.getLiveStats(),
      provider.getActiveAssignment(),
    ]);

    if (Array.isArray(catalog)) {
      state.catalog = catalog;
    }

    if (Array.isArray(tracks)) {
      state.tracks = tracks;
    }

    state.mySubmissions = mySubmissions;
    state.liveStats = liveStats;
    state.activeAssignment = activeAssignment;
  } catch (error) {
    state.backendError = getErrorText(error);
    setFlash("error", "Load failed", state.backendError);
  }

  if (!state.tracks.some((track) => track.id === state.selectedTrackId)) {
    state.selectedTrackId = state.tracks[0]?.id || state.selectedTrackId;
  }

  if (
    state.preferredBenchmarkId &&
    !state.catalog.some((benchmark) => benchmark.id === state.preferredBenchmarkId)
  ) {
    state.preferredBenchmarkId = null;
  }

  if (state.activeAssignment && !state.timerStartedAtMs) {
    state.timerStartedAtMs = Date.now();
  }

  if (!state.activeAssignment) {
    state.timerStartedAtMs = null;
    state.draftAnswer = "";
  }

  renderApp();
}

function attachListeners() {
  const magicLinkForm = document.getElementById("magic-link-form");
  if (magicLinkForm) {
    magicLinkForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(magicLinkForm);
      const email = String(formData.get("email") || "").trim();
      try {
        await authController.sendMagicLink(email);
        state.auth.lastEmailSent = email;
        setFlash("success", "Magic link sent", `Check ${email} for the sign-in link.`);
      } catch (error) {
        setFlash("error", "Sign-in failed", getErrorText(error));
      }
      renderApp();
    });
  }

  const participantForm = document.getElementById("participant-form");
  if (participantForm) {
    participantForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(participantForm);
      try {
        await provider.saveParticipant({
          name: String(formData.get("name") || "").trim(),
          email: String(formData.get("email") || "").trim(),
          team: String(formData.get("team") || "").trim(),
          affiliation: String(formData.get("affiliation") || "").trim(),
        });
        setFlash(
          "success",
          provider.mode === "mock" ? "Profile saved" : "Registration complete",
          provider.mode === "mock"
            ? "Local participant profile is ready for the queue."
            : "Authenticated participant is registered for the live event."
        );
      } catch (error) {
        setFlash("error", "Registration failed", getErrorText(error));
      }
      await refreshData({ preserveFlash: true });
    });
  }

  const editProfileButton = document.getElementById("edit-profile-btn");
  if (editProfileButton && provider.mode === "mock") {
    editProfileButton.addEventListener("click", async () => {
      await provider.saveParticipant(null);
      setFlash("warning", "Profile cleared", "Local profile cleared so you can enter a new one.");
      await refreshData({ preserveFlash: true });
    });
  }

  const signoutButton = document.getElementById("signout-btn");
  if (signoutButton) {
    signoutButton.addEventListener("click", async () => {
      await authController.signOut();
      state.auth.user = null;
      state.auth.lastEmailSent = "";
      state.participant = null;
      state.catalog = [];
      state.tracks = [];
      state.mySubmissions = [];
      state.liveStats = null;
      state.activeAssignment = null;
      state.timerStartedAtMs = null;
      state.draftAnswer = "";
      setFlash("warning", "Signed out", "Authentication session cleared.");
      renderApp();
    });
  }

  const trackSelect = document.getElementById("track-select");
  if (trackSelect) {
    trackSelect.addEventListener("change", (event) => {
      state.selectedTrackId = event.target.value;
      const currentTrack = getTrackById(state.selectedTrackId);
      if (
        state.preferredBenchmarkId &&
        currentTrack &&
        !currentTrack.benchmarkIds.includes(state.preferredBenchmarkId)
      ) {
        state.preferredBenchmarkId = null;
      }
      renderApp();
    });
  }

  const claimButton = document.getElementById("claim-task-btn");
  if (claimButton) {
    claimButton.addEventListener("click", async () => {
      try {
        const assignment = await provider.claimNextAssignment({
          trackId: state.selectedTrackId,
          benchmarkId: state.preferredBenchmarkId,
        });
        if (!assignment) {
          setFlash(
            "warning",
            "No demo task available",
            "This track has no unsolved mock assignment left in the current import."
          );
        } else {
          state.activeAssignment = assignment;
          state.timerStartedAtMs = Date.now();
          state.draftAnswer = "";
          state.preferredBenchmarkId = assignment.benchmarkId;
          setFlash("success", "Assignment claimed", `Loaded ${assignment.title}.`);
        }
      } catch (error) {
        setFlash("error", "Claim failed", getErrorText(error));
      }
      await refreshData({ preserveFlash: true });
    });
  }

  const releaseButton = document.getElementById("release-task-btn");
  if (releaseButton) {
    releaseButton.addEventListener("click", async () => {
      await provider.clearActiveAssignment();
      state.activeAssignment = null;
      state.timerStartedAtMs = null;
      state.draftAnswer = "";
      setFlash("warning", "Assignment released", "Active task released back to the local queue.");
      await refreshData({ preserveFlash: true });
    });
  }

  document.querySelectorAll("[data-action='queue-benchmark']").forEach((button) => {
    button.addEventListener("click", () => {
      const benchmarkId = button.dataset.benchmarkId;
      const preferredTrack = state.tracks.find((track) => track.benchmarkIds.includes(benchmarkId));
      if (preferredTrack) {
        state.selectedTrackId = preferredTrack.id;
      }
      state.preferredBenchmarkId = benchmarkId;
      window.location.hash = "solve";
      renderApp();
    });
  });

  const filterQuery = document.getElementById("filter-query");
  if (filterQuery) {
    filterQuery.addEventListener("input", (event) => {
      state.filters.query = event.target.value;
      renderApp();
    });
  }

  ["filter-domain", "filter-baseline", "filter-visibility", "filter-priority"].forEach((id) => {
    const node = document.getElementById(id);
    if (node) {
      node.addEventListener("change", (event) => {
        const key = id.replace("filter-", "");
        state.filters[key] = event.target.value;
        renderApp();
      });
    }
  });

  document.querySelectorAll("input[name='assignment-answer']").forEach((radio) => {
    radio.addEventListener("change", (event) => {
      state.draftAnswer = event.target.value;
    });
  });

  const answerInput = document.getElementById("assignment-answer-input");
  if (answerInput) {
    answerInput.addEventListener("input", (event) => {
      state.draftAnswer = event.target.value;
    });
  }

  const answerRange = document.getElementById("assignment-answer-range");
  if (answerRange) {
    answerRange.addEventListener("input", (event) => {
      state.draftAnswer = event.target.value;
    });
  }

  const clearAnswerButton = document.getElementById("clear-answer-btn");
  if (clearAnswerButton) {
    clearAnswerButton.addEventListener("click", () => {
      state.draftAnswer = "";
      renderApp();
    });
  }

  const assignmentForm = document.getElementById("assignment-form");
  if (assignmentForm) {
    assignmentForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.activeAssignment) {
        return;
      }

      if (!state.draftAnswer.trim()) {
        setFlash("warning", "Answer required", "Enter an answer before submitting.");
        renderApp();
        return;
      }

      try {
        await provider.submitSolution({
          assignmentId: state.activeAssignment.id,
          answer: state.draftAnswer,
          activeSeconds: getElapsedSeconds(),
        });
        setFlash("success", "Submission recorded", "Stored the answer and refreshed your local stats.");
        state.activeAssignment = null;
        state.timerStartedAtMs = null;
        state.draftAnswer = "";
      } catch (error) {
        setFlash("error", "Submit failed", getErrorText(error));
      }
      await refreshData({ preserveFlash: true });
    });
  }

  const refreshStatsButton = document.getElementById("refresh-stats-btn");
  if (refreshStatsButton) {
    refreshStatsButton.addEventListener("click", async () => {
      setFlash("success", "Stats refreshed", "Refreshed the local provider state.");
      await refreshData({ preserveFlash: true });
    });
  }

  const exportStateButton = document.getElementById("export-state-btn");
  if (exportStateButton) {
    exportStateButton.addEventListener("click", async () => {
      const payload = await provider.exportLocalState();
      state.exportPayload = payload;
      setFlash("success", "Export generated", "Local export payload written into the admin text area.");
      renderApp();
    });
  }

  const resetLocalButton = document.getElementById("reset-local-btn");
  if (resetLocalButton) {
    resetLocalButton.addEventListener("click", async () => {
      await provider.resetLocalState();
      state.timerStartedAtMs = null;
      state.draftAnswer = "";
      state.exportPayload = "";
      setFlash("warning", "Local mock state reset", "Profile, submissions, and active assignment were reset to the seeded demo state.");
      await refreshData({ preserveFlash: true });
    });
  }
}

async function init() {
  if (provider.mode === "api") {
    const authState = await authController.init();
    state.auth.ready = true;
    state.auth.configured = authState.configured;
    state.auth.user = authState.user;
  }
  await refreshData();
}

void init();
