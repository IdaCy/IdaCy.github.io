const TIMER_KEY_PREFIX = "time-horizons-assignment-started-at:";

const state = {
  client: null,
  session: null,
  participant: null,
  tracks: [],
  catalog: [],
  activeAssignment: null,
  stats: null,
  submissions: [],
  selectedTrackId: "",
  selectedBenchmarkId: "",
  timerId: null,
  message: "",
  error: "",
};

function getConfig() {
  return window.HACKATHON_CONFIG || {};
}

function isConfigured() {
  const config = getConfig();
  return (
    config.supabaseUrl &&
    config.supabaseAnonKey &&
    !String(config.supabaseUrl).includes("REPLACE_WITH") &&
    !String(config.supabaseAnonKey).includes("REPLACE_WITH")
  );
}

function functionsBaseUrl() {
  const config = getConfig();
  const explicitUrl = String(config.functionsBaseUrl || "");
  const url = explicitUrl && !explicitUrl.includes("REPLACE_WITH")
    ? explicitUrl
    : `${config.supabaseUrl}/functions/v1`;
  return url.replace(/\/$/, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatSeconds(seconds) {
  const safeSeconds = Math.max(0, Math.round(Number(seconds || 0)));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatMinutes(minutes) {
  const value = Number(minutes || 0);
  if (!Number.isFinite(value)) {
    return "unknown";
  }
  if (value < 1) {
    return `${Math.round(value * 60)} sec`;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} min`;
}

function assignmentStartKey(assignmentId) {
  return `${TIMER_KEY_PREFIX}${assignmentId}`;
}

function getAssignmentStart(assignmentId) {
  if (!assignmentId) {
    return Date.now();
  }
  const key = assignmentStartKey(assignmentId);
  const existing = Number(window.localStorage.getItem(key));
  if (Number.isFinite(existing) && existing > 0) {
    return existing;
  }
  const now = Date.now();
  window.localStorage.setItem(key, String(now));
  return now;
}

function getActiveSeconds() {
  if (!state.activeAssignment) {
    return 0;
  }
  return Math.max(0, Math.round((Date.now() - getAssignmentStart(state.activeAssignment.id)) / 1000));
}

async function apiFetch(endpoint, options = {}) {
  if (!state.session?.access_token) {
    throw new Error("Sign in before using the contest app.");
  }

  const response = await fetch(`${functionsBaseUrl()}/${endpoint.replace(/^\//, "")}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.session.access_token}`,
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with HTTP ${response.status}`);
  }
  return payload;
}

async function refreshSession() {
  const { data } = await state.client.auth.getSession();
  state.session = data.session || null;
}

async function loadParticipant() {
  try {
    state.participant = await apiFetch("participant");
  } catch (error) {
    if (!String(error.message || "").includes("Participant not registered")) {
      throw error;
    }
    state.participant = null;
  }
}

async function loadContestData() {
  if (!state.participant) {
    return;
  }
  const [tracks, catalog, activeAssignment, submissions, stats] = await Promise.all([
    apiFetch("tracks"),
    apiFetch("catalog"),
    apiFetch("active-assignment"),
    apiFetch("my-submissions"),
    apiFetch("live-stats"),
  ]);
  state.tracks = tracks || [];
  state.catalog = catalog || [];
  state.activeAssignment = activeAssignment || null;
  state.submissions = submissions || [];
  state.stats = stats || null;
  if (!state.selectedTrackId && state.tracks[0]) {
    state.selectedTrackId = state.tracks[0].id;
  }
}

async function boot() {
  if (!isConfigured()) {
    render();
    return;
  }
  if (!window.supabase?.createClient) {
    state.error = "Supabase client failed to load.";
    render();
    return;
  }

  const config = getConfig();
  state.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  await refreshSession();
  if (state.session) {
    await loadParticipant();
    await loadContestData();
  }
  render();
  window.setInterval(refreshStatsIfSignedIn, 10000);
}

async function refreshStatsIfSignedIn() {
  if (!state.session || !state.participant) {
    return;
  }
  try {
    const [submissions, stats] = await Promise.all([
      apiFetch("my-submissions"),
      apiFetch("live-stats"),
    ]);
    state.submissions = submissions || [];
    state.stats = stats || null;
    render();
  } catch (error) {
    state.error = error.message;
    render();
  }
}

function setMessage(message) {
  state.message = message;
  state.error = "";
}

function setError(error) {
  state.error = error instanceof Error ? error.message : String(error);
  state.message = "";
}

async function handleAuth(event, mode) {
  event.preventDefault();
  const form = event.currentTarget;
  const email = form.email.value.trim();
  const password = form.password.value;
  try {
    const authCall = mode === "signup"
      ? state.client.auth.signUp({ email, password })
      : state.client.auth.signInWithPassword({ email, password });
    const { data, error } = await authCall;
    if (error) {
      throw error;
    }
    state.session = data.session || null;
    if (!state.session) {
      setMessage("Check your email, then return here and sign in.");
    } else {
      setMessage("Signed in.");
      await loadParticipant();
      await loadContestData();
    }
  } catch (error) {
    setError(error);
  }
  render();
}

async function handleSignOut() {
  try {
    await state.client.auth.signOut();
    state.session = null;
    state.participant = null;
    state.activeAssignment = null;
    state.submissions = [];
    state.stats = null;
    setMessage("Signed out.");
  } catch (error) {
    setError(error);
  }
  render();
}

async function handleRegister(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    state.participant = await apiFetch("register-participant", {
      method: "POST",
      body: JSON.stringify({
        name: form.name.value.trim(),
        email: state.session.user.email,
        team: form.team.value.trim(),
        affiliation: form.affiliation.value.trim(),
      }),
    });
    setMessage("Registration saved.");
    await loadContestData();
  } catch (error) {
    setError(error);
  }
  render();
}

async function handleClaim(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const assignment = await apiFetch("claim-assignment", {
      method: "POST",
      body: JSON.stringify({
        trackId: form.trackId.value,
        benchmarkId: form.benchmarkId.value,
      }),
    });
    state.activeAssignment = assignment || null;
    if (assignment) {
      getAssignmentStart(assignment.id);
      setMessage("Task claimed. Submit once you are done.");
    } else {
      setMessage("No task is currently available for that selection.");
    }
  } catch (error) {
    setError(error);
  }
  render();
}

async function handleReleaseAssignment() {
  try {
    await apiFetch("active-assignment", { method: "DELETE" });
    state.activeAssignment = null;
    setMessage("Task released.");
    await loadContestData();
  } catch (error) {
    setError(error);
  }
  render();
}

async function handleSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const answer = new FormData(form).get("answer");
  if (!String(answer || "").trim()) {
    setError("Enter an answer before submitting.");
    render();
    return;
  }

  try {
    const activeSeconds = getActiveSeconds();
    await apiFetch("submit-solution", {
      method: "POST",
      body: JSON.stringify({
        assignmentId: state.activeAssignment.id,
        answer,
        activeSeconds,
        startedAt: new Date(getAssignmentStart(state.activeAssignment.id)).toISOString(),
      }),
    });
    window.localStorage.removeItem(assignmentStartKey(state.activeAssignment.id));
    state.activeAssignment = null;
    setMessage("Submission saved.");
    await loadContestData();
  } catch (error) {
    setError(error);
  }
  render();
}

function renderAuth() {
  return `
    <section class="contest-layout">
      <article class="surface-card">
        <div class="surface-card__header">
          <p class="surface-card__eyebrow">Sign In</p>
          <h2>Use your event account</h2>
        </div>
        <form class="answer-form" data-auth-form="signin">
          <label>Email <input class="text-input" name="email" type="email" autocomplete="email" required></label>
          <label>Password <input class="text-input" name="password" type="password" autocomplete="current-password" required></label>
          <button class="btn btn--primary" type="submit">Sign In</button>
        </form>
      </article>
      <aside class="surface-card">
        <div class="surface-card__header">
          <p class="surface-card__eyebrow">Create Account</p>
          <h2>First time here?</h2>
          <p>Use the same email you used for the event invite.</p>
        </div>
        <form class="answer-form" data-auth-form="signup">
          <label>Email <input class="text-input" name="email" type="email" autocomplete="email" required></label>
          <label>Password <input class="text-input" name="password" type="password" autocomplete="new-password" minlength="8" required></label>
          <button class="btn btn--secondary" type="submit">Create Account</button>
        </form>
      </aside>
    </section>
  `;
}

function renderRegistration() {
  return `
    <section class="surface-card">
      <div class="surface-card__header">
        <p class="surface-card__eyebrow">Registration</p>
        <h2>Choose a display name</h2>
        <p>Signed in as ${escapeHtml(state.session.user.email)}.</p>
      </div>
      <form class="answer-form registration-form" data-registration-form>
        <label>Display name <input class="text-input" name="name" autocomplete="name" required></label>
        <label>Team <input class="text-input" name="team" autocomplete="organization"></label>
        <label>Affiliation <input class="text-input" name="affiliation" autocomplete="organization"></label>
        <button class="btn btn--primary" type="submit">Save Registration</button>
      </form>
    </section>
  `;
}

function renderPromptBlock(block) {
  if (block.type === "image") {
    return `
      <figure class="prompt-image">
        <img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt || "")}">
        ${block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ""}
      </figure>
    `;
  }
  return `<pre class="prompt-text">${escapeHtml(block.text || "")}</pre>`;
}

function renderAnswerInput(answerSpec) {
  if (answerSpec?.type === "single_choice" && Array.isArray(answerSpec.options)) {
    return `
      <fieldset class="mcqa-options">
        <legend>${escapeHtml(answerSpec.instruction || "Answer")}</legend>
        ${answerSpec.options.map((option) => `
          <label class="mcqa-option">
            <input type="radio" name="answer" value="${escapeHtml(option.key)}" required>
            <span>${escapeHtml(option.key)}</span>
            <strong>${escapeHtml(option.label)}</strong>
          </label>
        `).join("")}
      </fieldset>
    `;
  }

  if (answerSpec?.type === "range") {
    return `
      <label>${escapeHtml(answerSpec.instruction || "Answer")}
        <input class="text-input" name="answer" type="number" min="${escapeHtml(answerSpec.min ?? 0)}" max="${escapeHtml(answerSpec.max ?? 100)}" placeholder="${escapeHtml(answerSpec.placeholder || "")}" required>
      </label>
    `;
  }

  return `
    <label>${escapeHtml(answerSpec?.instruction || "Answer")}
      <textarea name="answer" placeholder="${escapeHtml(answerSpec?.placeholder || "")}" required></textarea>
    </label>
  `;
}

function renderAssignment() {
  const assignment = state.activeAssignment;
  if (!assignment) {
    return "";
  }
  return `
    <section class="contest-layout">
      <article class="surface-card problem-card">
        <div class="surface-card__header">
          <p class="surface-card__eyebrow">${escapeHtml(assignment.benchmarkId)}</p>
          <h2>${escapeHtml(assignment.title)}</h2>
        </div>
        <div class="problem-statement">
          ${(assignment.promptBlocks || []).map(renderPromptBlock).join("")}
        </div>
        <form class="answer-form" data-answer-form>
          ${renderAnswerInput(assignment.answerSpec)}
          <div class="inline-actions">
            <button class="btn btn--primary" type="submit">Submit Answer</button>
            <button class="btn btn--secondary" type="button" data-release-assignment>Release Task</button>
          </div>
        </form>
      </article>
      <aside class="surface-card">
        <div class="surface-card__header">
          <p class="surface-card__eyebrow">Timer</p>
          <h2 data-elapsed>${formatSeconds(getActiveSeconds())}</h2>
        </div>
        <div class="sidebar-list">
          <div class="sidebar-row"><span>Estimate</span><strong>${formatMinutes(assignment.estimatedMinutes)}</strong></div>
          <div class="sidebar-row"><span>Scoring</span><strong>${escapeHtml(assignment.grading?.mode || "recorded")}</strong></div>
          <div class="sidebar-row"><span>Visibility</span><strong>${escapeHtml(assignment.visibility)}</strong></div>
        </div>
      </aside>
    </section>
  `;
}

function renderClaimPanel() {
  const publicCatalog = state.catalog.filter((benchmark) => benchmark.visibility !== "private" || state.participant?.canAccessPrivate);
  return `
    <section class="contest-layout">
      <article class="surface-card">
        <div class="surface-card__header">
          <p class="surface-card__eyebrow">Claim</p>
          <h2>Choose what to work on next</h2>
        </div>
        <form class="answer-form" data-claim-form>
          <label>Track
            <select class="text-input" name="trackId">
              <option value="">Any track</option>
              ${state.tracks.map((track) => `
                <option value="${escapeHtml(track.id)}" ${track.id === state.selectedTrackId ? "selected" : ""}>${escapeHtml(track.title)}</option>
              `).join("")}
            </select>
          </label>
          <label>Benchmark
            <select class="text-input" name="benchmarkId">
              <option value="">Any benchmark in track</option>
              ${publicCatalog.map((benchmark) => `
                <option value="${escapeHtml(benchmark.id)}" ${benchmark.id === state.selectedBenchmarkId ? "selected" : ""}>${escapeHtml(benchmark.title)}</option>
              `).join("")}
            </select>
          </label>
          <button class="btn btn--primary" type="submit">Claim Task</button>
        </form>
      </article>
      <aside class="surface-card">
        <div class="surface-card__header">
          <p class="surface-card__eyebrow">Live Stats</p>
          <h2>${escapeHtml(getConfig().eventName || "Hackathon")}</h2>
        </div>
        ${renderStats()}
      </aside>
    </section>
    <section class="surface-card">
      <div class="surface-card__header">
        <p class="surface-card__eyebrow">Benchmarks</p>
        <h2>Available problem families</h2>
      </div>
      ${renderCatalogTable(publicCatalog)}
    </section>
  `;
}

function renderStats() {
  const stats = state.stats;
  if (!stats) {
    return `<p class="hero-copy">Stats will appear after the backend responds.</p>`;
  }
  return `
    <div class="sidebar-list">
      <div class="sidebar-row"><span>Participants</span><strong>${escapeHtml(stats.participantCount)}</strong></div>
      <div class="sidebar-row"><span>Submissions</span><strong>${escapeHtml(stats.submissionCount)}</strong></div>
      <div class="sidebar-row"><span>Resolved</span><strong>${escapeHtml(stats.resolvedCount)}</strong></div>
      <div class="sidebar-row"><span>Collected</span><strong>${Number(stats.collectedHours || 0).toFixed(2)} hr</strong></div>
    </div>
  `;
}

function renderCatalogTable(catalog) {
  if (!catalog.length) {
    return `<div class="submission-empty">No benchmark catalog is available for this account yet.</div>`;
  }
  return `
    <table class="contest-table">
      <thead>
        <tr>
          <th>Benchmark</th>
          <th>Items</th>
          <th>Estimate</th>
          <th>Mode</th>
        </tr>
      </thead>
      <tbody>
        ${catalog.map((benchmark) => `
          <tr>
            <td><strong>${escapeHtml(benchmark.title)}</strong><br><span>${escapeHtml(benchmark.id)}</span></td>
            <td>${escapeHtml(benchmark.itemCount)}</td>
            <td>${formatMinutes(benchmark.estimatedRange?.median || benchmark.estimatedRange?.max)}</td>
            <td><span class="status-pill">${escapeHtml(benchmark.gradingMode)}</span></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderSubmissionsTable() {
  if (!state.submissions.length) {
    return `<div class="submission-empty">No submissions yet.</div>`;
  }
  return `
    <table class="contest-table">
      <thead>
        <tr>
          <th>Benchmark</th>
          <th>Time</th>
          <th>Status</th>
          <th>Answer</th>
        </tr>
      </thead>
      <tbody>
        ${state.submissions.map((submission) => `
          <tr>
            <td>${escapeHtml(submission.benchmarkId)}</td>
            <td>${formatSeconds(submission.activeSeconds)}</td>
            <td><span class="status-pill">${escapeHtml(submission.gradingStatus)}</span></td>
            <td class="submission-answer">${escapeHtml(submission.submittedAnswer)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderStatus() {
  if (state.error) {
    return `<div class="submission-empty status-error" role="alert">${escapeHtml(state.error)}</div>`;
  }
  if (state.message) {
    return `<div class="submission-empty status-message" role="status">${escapeHtml(state.message)}</div>`;
  }
  return "";
}

function renderContestApp(root) {
  if (!isConfigured()) {
    root.innerHTML = `
      <section class="surface-card">
        <div class="surface-card__header">
          <p class="surface-card__eyebrow">Setup</p>
          <h2>Supabase config needed</h2>
          <p>Fill in hackathon/hackathon-config.js with the Supabase project URL and anon key before launch.</p>
        </div>
      </section>
    `;
    return;
  }

  root.innerHTML = `
    ${renderStatus()}
    ${state.session ? renderSignedInHeader() : ""}
    ${!state.session ? renderAuth() : !state.participant ? renderRegistration() : state.activeAssignment ? renderAssignment() : renderClaimPanel()}
    ${state.session && state.participant ? `
      <section class="surface-card">
        <div class="surface-card__header">
          <p class="surface-card__eyebrow">My Submissions</p>
          <h2>Recent work</h2>
        </div>
        ${renderSubmissionsTable()}
      </section>
    ` : ""}
  `;
}

function renderSignedInHeader() {
  return `
    <section class="contest-toolbar">
      <span>${escapeHtml(state.participant?.name || state.session.user.email)}</span>
      <button class="btn btn--secondary" type="button" data-sign-out>Sign Out</button>
    </section>
  `;
}

function renderSubmissionsApp(root) {
  if (!isConfigured()) {
    root.innerHTML = `
      <section class="surface-card">
        <h2>Supabase config needed</h2>
        <p>Fill in hackathon/hackathon-config.js before loading submissions.</p>
      </section>
    `;
    return;
  }

  root.innerHTML = `
    ${renderStatus()}
    ${state.session ? renderSignedInHeader() : renderAuth()}
    ${state.session && !state.participant ? renderRegistration() : ""}
    ${state.session && state.participant ? `
      <section class="surface-card">
        <div class="surface-card__header">
          <p class="surface-card__eyebrow">My Submissions</p>
          <h2>Status table</h2>
        </div>
        ${renderSubmissionsTable()}
      </section>
    ` : ""}
  `;
}

function bind(root) {
  root.querySelectorAll("[data-auth-form]").forEach((form) => {
    form.addEventListener("submit", (event) => handleAuth(event, form.dataset.authForm));
  });
  root.querySelector("[data-registration-form]")?.addEventListener("submit", handleRegister);
  root.querySelector("[data-claim-form]")?.addEventListener("submit", handleClaim);
  root.querySelector("[data-answer-form]")?.addEventListener("submit", handleSubmit);
  root.querySelector("[data-release-assignment]")?.addEventListener("click", handleReleaseAssignment);
  root.querySelector("[data-sign-out]")?.addEventListener("click", handleSignOut);
}

function render() {
  const contestRoot = document.querySelector("[data-contest-app]");
  const submissionsRoot = document.querySelector("[data-submissions-app]");
  const root = contestRoot || submissionsRoot;
  if (!root) {
    return;
  }
  if (state.timerId) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }
  if (contestRoot) {
    renderContestApp(contestRoot);
    bind(contestRoot);
  }
  if (submissionsRoot) {
    renderSubmissionsApp(submissionsRoot);
    bind(submissionsRoot);
  }
  if (state.activeAssignment) {
    state.timerId = window.setInterval(() => {
      const node = document.querySelector("[data-elapsed]");
      if (node) {
        node.textContent = formatSeconds(getActiveSeconds());
      }
    }, 1000);
  }
}

boot().catch((error) => {
  setError(error);
  render();
});
