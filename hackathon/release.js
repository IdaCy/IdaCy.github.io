const STORAGE_KEY = "time-horizons-hackathon-submissions-v1";
const EXAMPLE_PROBLEM_ID = "example-physical";

function getSubmissions() {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveSubmissions(submissions) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(submissions));
}

function getElapsedSeconds() {
  const start = Number(window.sessionStorage.getItem("example-physical-started-at") || Date.now());
  return Math.max(0, Math.round((Date.now() - start) / 1000));
}

function formatSeconds(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function updateTimer() {
  const node = document.querySelector("[data-elapsed]");
  if (node) {
    node.textContent = formatSeconds(getElapsedSeconds());
  }
}

function initProblemPage() {
  if (!document.body.dataset.problemPage) {
    return;
  }

  if (!window.sessionStorage.getItem("example-physical-started-at")) {
    window.sessionStorage.setItem("example-physical-started-at", String(Date.now()));
  }

  updateTimer();
  window.setInterval(updateTimer, 1000);

  const form = document.querySelector("[data-submission-form]");
  const answer = document.querySelector("[data-answer]");
  const status = document.querySelector("[data-submit-status]");
  if (!form || !answer || !status) {
    return;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const submittedAnswer = answer.value.trim();
    if (!submittedAnswer) {
      status.textContent = "Add an answer before submitting.";
      return;
    }

    const submissions = getSubmissions();
    submissions.unshift({
      id: `S${Date.now()}`,
      problemId: EXAMPLE_PROBLEM_ID,
      problemTitle: "Physical Intuition Example",
      answer: submittedAnswer,
      elapsedSeconds: getElapsedSeconds(),
      submittedAt: new Date().toISOString(),
      status: "Recorded",
    });
    saveSubmissions(submissions);
    status.textContent = "Submission recorded locally for this prototype.";
    answer.value = "";
  });
}

function initSubmissionsPage() {
  const tableBody = document.querySelector("[data-submissions-body]");
  const empty = document.querySelector("[data-submissions-empty]");
  if (!tableBody || !empty) {
    return;
  }

  const submissions = getSubmissions();
  tableBody.innerHTML = submissions
    .map((submission) => `
      <tr>
        <td>${escapeHtml(submission.id)}</td>
        <td><a href="../problems/${escapeHtml(submission.problemId)}/">${escapeHtml(submission.problemTitle)}</a></td>
        <td>${formatSeconds(Number(submission.elapsedSeconds || 0))}</td>
        <td><span class="status-pill">${escapeHtml(submission.status)}</span></td>
        <td class="submission-answer">${escapeHtml(submission.answer)}</td>
      </tr>
    `)
    .join("");

  empty.hidden = submissions.length > 0;
}

initProblemPage();
initSubmissionsPage();
