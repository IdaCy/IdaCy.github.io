const TIMER_KEY_PREFIX = "time-horizons-assignment-started-at:";
const EXCLUDED_BENCHMARK_IDS = new Set([
  "chess_puzzles",
  "shade_monitor_action_only",
  "shade_monitor_cot_action",
]);

const state = {
  client: null,
  session: null,
  participant: null,
  catalog: [],
  activeAssignment: null,
  submissionResult: null,
  stats: null,
  submissions: [],
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

function titleCasePhrase(value) {
  const acronyms = new Set(["api", "cli", "csv", "json", "pr", "ssn", "url", "yaml"]);
  const smallWords = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (acronyms.has(lower)) return lower.toUpperCase();
      if (index > 0 && smallWords.has(lower)) return lower;
      return `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
    })
    .join(" ");
}

function compactText(value, maxWords = 7) {
  return String(value || "")
    .replace(/[`*_#>]+/g, "")
    .replace(/^(I('| wi)ll|I propose|Create|Add|Implement|Allow)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[ :;,.]+|[ :;,.]+$/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(" ");
}

function extract(pattern, text) {
  const match = String(text || "").match(pattern);
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

function isRawProblemTitle(title, itemId) {
  return !title || title === itemId || title.includes("__transcripts_") || /^sandbag_\d+$/.test(title);
}

function promptTextFromAssignment(assignment) {
  return (assignment?.promptBlocks || [])
    .map((block) => block?.text || "")
    .filter(Boolean)
    .join("\n");
}

function inferProblemTitle(benchmarkId, itemId, text = "") {
  if (benchmarkId === "ctrl_alt_deceit_sandbag") {
    const plan = extract(/Plan:\s*(.*?)(?:\n\nCode:|\nCode:|$)/is, text);
    if (plan) {
      const topic = extract(/\b(?:for|on)\s+(?:this|the|a|an)?\s*([^,.]+?)\s+task\b/i, plan) ||
        extract(/\bto\s+(predict|detect|classify)\s+([^,.]+)/i, plan) ||
        compactText(plan, 5);
      return `Solver Review: ${compactText(topic, 5)}`;
    }
    return "Solver Underperformance Review";
  }
  if (benchmarkId === "shade_monitor_action_only" || benchmarkId === "shade_monitor_cot_action") {
    return `SHADE: ${titleCasePhrase(String(itemId || "").split("__", 1)[0] || "Monitoring Review")}`;
  }
  if (benchmarkId === "vibe_coding_sabotage") {
    const match = String(itemId || "").match(/^PR\d+_([^_]+)_(?:honest|cached_[^_]+_[^_]+)_[^_]+_\d+_(.+)$/) ||
      String(itemId || "").match(/^PR\d+_honest_cache_([^_]+)_\d+_\d+_(.+)$/);
    return match ? `PR Review: ${titleCasePhrase(match[1])}: ${titleCasePhrase(match[2])}` : "PR Sabotage Review";
  }
  if (benchmarkId === "hash") {
    const fnName = String(itemId || "").match(/^hash_hash_(.*?)__/)?.[1] || "hash";
    const length = String(itemId || "").match(/len(\d+)_/)?.[1];
    const chain = String(itemId || "").match(/chain(\d+)_/)?.[1];
    return [titleCasePhrase(`hash ${fnName}`), length ? `Len ${length}` : "", chain ? `Chain ${chain}` : ""]
      .filter(Boolean)
      .join(" ");
  }
  if (benchmarkId === "n_hop_lookup") {
    const hop = String(itemId || "").match(/^hop(\d+)_/)?.[1];
    return hop ? `${hop}-Hop Lookup` : "Lookup Chain";
  }
  if (benchmarkId === "stego_monitor") return "Stego Check";
  if (benchmarkId === "stego_decode") return "Stego Decode";
  if (benchmarkId === "stego_encode") return "Stego Encode";
  return itemId;
}

function displayProblemTitle(benchmarkId, itemId, title, text = "") {
  return isRawProblemTitle(String(title || ""), String(itemId || ""))
    ? inferProblemTitle(benchmarkId, itemId, text)
    : title;
}

function assignmentStartKey(assignmentId) {
  return `${TIMER_KEY_PREFIX}${assignmentId}`;
}

function getAssignmentStart(assignmentId, claimedAt = null) {
  if (!assignmentId) {
    return Date.now();
  }
  const claimedAtMs = Date.parse(claimedAt || "");
  if (Number.isFinite(claimedAtMs) && claimedAtMs > 0) {
    window.localStorage.setItem(assignmentStartKey(assignmentId), String(claimedAtMs));
    return claimedAtMs;
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

function getActiveAssignmentStart() {
  if (!state.activeAssignment) {
    return Date.now();
  }
  return getAssignmentStart(state.activeAssignment.id, state.activeAssignment.claimedAt);
}

function getActiveSeconds() {
  if (!state.activeAssignment) {
    return 0;
  }
  if (
    state.submissionResult &&
    !state.submissionResult.canRetry &&
    Number.isFinite(Number(state.submissionResult.activeSeconds))
  ) {
    return Math.max(0, Math.round(Number(state.submissionResult.activeSeconds)));
  }
  return Math.max(0, Math.round((Date.now() - getActiveAssignmentStart()) / 1000));
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
  const [catalog, activeAssignment, submissions, stats] = await Promise.all([
    apiFetch("catalog"),
    apiFetch("active-assignment"),
    apiFetch("my-submissions"),
    apiFetch("live-stats"),
  ]);
  state.catalog = catalog || [];
  state.activeAssignment = activeAssignment || null;
  state.submissions = submissions || [];
  state.stats = stats || null;
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
    state.submissionResult = null;
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

async function handleStartProblem(benchmarkId, itemId) {
  if (EXCLUDED_BENCHMARK_IDS.has(String(benchmarkId))) {
    setError("That problem is not available for this event.");
    render();
    return;
  }
  try {
    const assignment = await apiFetch("claim-assignment", {
      method: "POST",
      body: JSON.stringify({
        benchmarkId,
        itemId,
      }),
    });
    state.activeAssignment = assignment || null;
    state.submissionResult = null;
    if (assignment) {
      getAssignmentStart(assignment.id, assignment.claimedAt);
      setMessage("Problem started. Your timer is running.");
      render();
      await refreshStatsIfSignedIn();
      state.activeAssignment = assignment;
    } else {
      setMessage("No attempt slot is currently available for that problem.");
    }
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
    const submission = await apiFetch("submit-solution", {
      method: "POST",
      body: JSON.stringify({
        assignmentId: state.activeAssignment.id,
        answer,
        activeSeconds,
        startedAt: new Date(getActiveAssignmentStart()).toISOString(),
      }),
    });
    state.submissionResult = submission;
    state.error = "";
    state.message = "";
    await refreshStatsIfSignedIn();
  } catch (error) {
    setError(error);
  }
  render();
}

function handleTryAgain() {
  state.submissionResult = null;
  state.error = "";
  state.message = "";
  render();
}

async function returnToProblems(message) {
  if (state.activeAssignment) {
    window.localStorage.removeItem(assignmentStartKey(state.activeAssignment.id));
  }
  state.activeAssignment = null;
  state.submissionResult = null;
  setMessage(message);
  await loadContestData();
}

async function handleNextProblem() {
  try {
    await returnToProblems("Choose another problem.");
  } catch (error) {
    setError(error);
  }
  render();
}

async function handleProblemsLink(event) {
  if (!state.activeAssignment) {
    return;
  }

  event.preventDefault();

  if (state.submissionResult && !state.submissionResult.canRetry) {
    await handleNextProblem();
    return;
  }

  const confirmed = window.confirm(
    "Confirm you're going back to the main page? That means giving up on this problem. It's fine, but FYI!",
  );
  if (!confirmed) {
    return;
  }

  try {
    await apiFetch("active-assignment", {
      method: "DELETE",
      body: JSON.stringify({
        activeSeconds: getActiveSeconds(),
        startedAt: new Date(getActiveAssignmentStart()).toISOString(),
      }),
    });
    await returnToProblems("Problem marked as given up. Choose another problem.");
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
    <label>${escapeHtml(answerSpec?.instruction || "Enter only the requested final answer. If the problem asks for several values, include all of them in the requested format.")}
      <textarea name="answer" placeholder="${escapeHtml(answerSpec?.placeholder || "")}" required></textarea>
    </label>
  `;
}

function formatSubmittedAnswer(submission) {
  if (submission.gradingStatus === "abandoned" && !submission.submittedAnswer) {
    return "(gave up before submitting)";
  }
  return submission.submittedAnswer || "";
}

function renderSubmissionResult() {
  const result = state.submissionResult;
  if (!result) {
    return "";
  }

  const attemptText = `Attempt ${Number(result.attemptNumber || 1)} of 3`;
  let message = "Submission saved.";
  if (result.successful) {
    message = "Correct.";
  } else if (result.canRetry) {
    message = `That was not correct. ${Number(result.attemptsRemaining || 0)} attempts remaining.`;
  } else if (result.gradingStatus === "incorrect") {
    message = "That was not correct. No attempts remaining.";
  } else if (String(result.gradingStatus || "").startsWith("pending")) {
    message = "Submission saved for grading.";
  }

  return `
    <div class="submission-result" role="status">
      <span class="status-pill">${escapeHtml(attemptText)}</span>
      <p>${escapeHtml(message)}</p>
      <div class="inline-actions">
        ${result.canRetry ? `<button class="btn btn--primary" type="button" data-try-again>Try Again</button>` : ""}
        ${result.canRetry ? "" : `<button class="btn btn--secondary" type="button" data-next-problem>Next Problem</button>`}
      </div>
    </div>
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
          <h2>${escapeHtml(displayProblemTitle(
            assignment.benchmarkId,
            assignment.itemId || assignment.title,
            assignment.title,
            promptTextFromAssignment(assignment),
          ))}</h2>
        </div>
        <div class="problem-statement">
          ${(assignment.promptBlocks || []).map(renderPromptBlock).join("")}
        </div>
        ${state.submissionResult ? renderSubmissionResult() : `
          <form class="answer-form" data-answer-form>
            ${renderAnswerInput(assignment.answerSpec)}
            <div class="inline-actions">
              <button class="btn btn--primary" type="submit">Submit Answer</button>
            </div>
          </form>
        `}
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

function groupCatalogByDomain(catalog) {
  const groups = new Map();
  for (const benchmark of catalog) {
    const domain = benchmark.domain || "Other";
    if (!groups.has(domain)) {
      groups.set(domain, []);
    }
    groups.get(domain).push(benchmark);
  }
  return [...groups.entries()].sort((left, right) => left[0].localeCompare(right[0]));
}

function renderProblemList() {
  const visibleCatalog = state.catalog.filter((benchmark) =>
    !EXCLUDED_BENCHMARK_IDS.has(String(benchmark.id)) &&
    (benchmark.visibility !== "private" || state.participant?.canAccessPrivate)
  );
  if (!visibleCatalog.length) {
    return `<div class="submission-empty">No problems are available for this account yet.</div>`;
  }

  return groupCatalogByDomain(visibleCatalog).map(([domain, benchmarks]) => `
    <section class="surface-card problem-domain">
      <div class="surface-card__header">
        <p class="surface-card__eyebrow">Domain</p>
        <h2>${escapeHtml(domain)}</h2>
      </div>
      ${benchmarks.map(renderBenchmarkProblems).join("")}
    </section>
  `).join("");
}

function renderBenchmarkProblems(benchmark) {
  const problems = Array.isArray(benchmark.problems) ? benchmark.problems : [];
  return `
    <article class="problem-family">
      <div class="problem-family__header">
        <div>
          <h3>${escapeHtml(benchmark.title)}</h3>
          <p>${escapeHtml(benchmark.description || benchmark.id)}</p>
        </div>
        <span class="status-pill">${escapeHtml(benchmark.gradingMode)}</span>
      </div>
      <table class="contest-table problem-table">
        <thead>
          <tr>
            <th>Problem</th>
            <th>Estimate</th>
            <th>Attempted</th>
            <th>Successes</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${problems.map((problem) => renderProblemRow(benchmark, problem)).join("")}
        </tbody>
      </table>
    </article>
  `;
}

function renderProblemRow(benchmark, problem) {
  const blocked = Boolean(problem.startedByMe);
  const status = problem.submittedByMe ? (problem.myStatus || "submitted") : blocked ? "blocked" : "not started";
  const action = blocked
    ? `<button class="btn btn--secondary" type="button" disabled>${escapeHtml(status)}</button>`
    : `<button class="btn btn--primary" type="button" data-start-problem data-benchmark-id="${escapeHtml(benchmark.id)}" data-item-id="${escapeHtml(problem.id)}">Start</button>`;
  return `
    <tr>
      <td>
        <strong>${escapeHtml(displayProblemTitle(benchmark.id, problem.id, problem.title))}</strong>
        <span class="problem-id">${escapeHtml(problem.id)}</span>
      </td>
      <td>${formatMinutes(problem.estimatedMinutes)}</td>
      <td>${escapeHtml(problem.attempted || 0)}</td>
      <td>${escapeHtml(problem.successes || 0)}</td>
      <td>${action}</td>
    </tr>
  `;
}

function renderProblemsPanel() {
  return `
    <section class="surface-card important-note">
      <div class="surface-card__header">
        <p class="surface-card__eyebrow">Important</p>
        <h2>Important, read first:</h2>
      </div>
      <ul>
        <li>attempt any number of problems below!</li>
        <li>rule: don't use any AI, but any other tools are okay</li>
        <li>you can only click at any one problem once, and then your time for that problem is running</li>
        <li>you won't be able to open any one problem twice</li>
        <li>everything takes a second or a few to load</li>
      </ul>
    </section>
    <section class="contest-layout">
      <article class="surface-card">
        <div class="surface-card__header">
          <p class="surface-card__eyebrow">Problems</p>
          <h2>Choose a problem to start</h2>
          <p>After you start a problem, that problem is blocked for your account and cannot be started again.</p>
        </div>
      </article>
      <aside class="surface-card">
        <div class="surface-card__header">
          <p class="surface-card__eyebrow">Live Stats</p>
          <h2>${escapeHtml(getConfig().eventName || "Hackathon")}</h2>
        </div>
        ${renderStats()}
      </aside>
    </section>
    ${renderProblemList()}
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

function renderSubmissionsTable() {
  if (!state.submissions.length) {
    return `<div class="submission-empty">No submissions yet.</div>`;
  }
  return `
    <table class="contest-table">
      <thead>
        <tr>
          <th>Benchmark</th>
          <th>Attempt</th>
          <th>Time</th>
          <th>Status</th>
          <th>Answer</th>
        </tr>
      </thead>
      <tbody>
        ${state.submissions.map((submission) => `
          <tr>
            <td>${escapeHtml(submission.benchmarkId)}</td>
            <td>${escapeHtml(submission.attemptNumber || 1)}</td>
            <td>${formatSeconds(submission.activeSeconds)}</td>
            <td><span class="status-pill">${escapeHtml(submission.gradingStatus)}</span></td>
            <td class="submission-answer">${escapeHtml(formatSubmittedAnswer(submission))}</td>
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
    ${!state.session ? renderAuth() : !state.participant ? renderRegistration() : state.activeAssignment ? renderAssignment() : renderProblemsPanel()}
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
  root.querySelector("[data-answer-form]")?.addEventListener("submit", handleSubmit);
  root.querySelector("[data-try-again]")?.addEventListener("click", handleTryAgain);
  root.querySelector("[data-next-problem]")?.addEventListener("click", handleNextProblem);
  root.querySelectorAll("[data-start-problem]").forEach((button) => {
    button.addEventListener("click", () => handleStartProblem(button.dataset.benchmarkId, button.dataset.itemId));
  });
  root.querySelector("[data-sign-out]")?.addEventListener("click", handleSignOut);
}

function bindGlobalNav() {
  document.querySelectorAll("[data-problems-link]").forEach((link) => {
    link.addEventListener("click", handleProblemsLink);
  });
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

bindGlobalNav();
boot().catch((error) => {
  setError(error);
  render();
});
