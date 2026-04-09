import { benchmarkCatalog, hackathonTracks } from "../data/catalog.js";
import {
  demoAssignments,
  seedParticipants,
  seedSubmissions,
} from "../data/mockData.js";

const STORAGE_KEYS = {
  seeded: "hackathon.seeded.v1",
  participant: "hackathon.participant.v1",
  submissions: "hackathon.submissions.v1",
  activeAssignmentId: "hackathon.active-assignment.v1",
};

function readJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function writeJson(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function ensureMockSeed() {
  if (window.localStorage.getItem(STORAGE_KEYS.seeded)) {
    return;
  }
  writeJson(STORAGE_KEYS.submissions, seedSubmissions);
  window.localStorage.setItem(STORAGE_KEYS.seeded, "true");
}

function parseIntegerLike(value) {
  const matches = String(value ?? "").match(/\d+/g);
  return matches ? matches[matches.length - 1] : null;
}

function normalizePfList(value) {
  return String(value ?? "")
    .toUpperCase()
    .split(/[\s,]+/)
    .filter(Boolean)
    .join(",");
}

function scoreMockSubmission(assignment, rawAnswer) {
  const answer = String(rawAnswer ?? "").trim();
  const grading = assignment.grading;

  if (grading.mode === "backend_only") {
    return {
      gradingStatus: "blocked",
      scoreValue: null,
      explanation: "Private task payload requires backend delivery.",
    };
  }

  if (grading.mode === "pending_llm") {
    return {
      gradingStatus: "pending_llm",
      scoreValue: null,
      explanation: "Queued for fixed grader-model review.",
    };
  }

  if (grading.mode === "score_only") {
    const numeric = Number(answer);
    return {
      gradingStatus: "recorded_score",
      scoreValue: Number.isFinite(numeric) ? numeric : null,
      explanation: "Raw human review score recorded.",
    };
  }

  if (grading.mode === "exact") {
    const isCorrect = answer === grading.expected;
    return {
      gradingStatus: isCorrect ? "correct" : "incorrect",
      scoreValue: isCorrect ? 1 : 0,
      explanation: `Expected ${grading.expected}.`,
    };
  }

  if (grading.mode === "integer_last_token") {
    const extracted = parseIntegerLike(answer);
    const isCorrect = extracted === grading.expected;
    return {
      gradingStatus: isCorrect ? "correct" : "incorrect",
      scoreValue: isCorrect ? 1 : 0,
      explanation: `Parsed integer ${extracted ?? "none"}, expected ${grading.expected}.`,
    };
  }

  if (grading.mode === "pf_list") {
    const normalized = normalizePfList(answer);
    const isCorrect = normalized === grading.expected;
    return {
      gradingStatus: isCorrect ? "correct" : "incorrect",
      scoreValue: isCorrect ? 1 : 0,
      explanation: `Parsed ${normalized || "none"}, expected ${grading.expected}.`,
    };
  }

  if (grading.mode === "text_exact_casefold") {
    const isCorrect = answer.toLowerCase() === String(grading.expected).toLowerCase();
    return {
      gradingStatus: isCorrect ? "correct" : "incorrect",
      scoreValue: isCorrect ? 1 : 0,
      explanation: `Expected ${grading.expected}.`,
    };
  }

  if (grading.mode === "numeric_float") {
    const numeric = Number(answer);
    const expected = Number(grading.expected);
    const isCorrect = Number.isFinite(numeric) && Math.abs(numeric - expected) < 0.011;
    return {
      gradingStatus: isCorrect ? "correct" : "incorrect",
      scoreValue: isCorrect ? 1 : 0,
      explanation: `Expected about ${grading.expected}.`,
    };
  }

  return {
    gradingStatus: "pending_manual",
    scoreValue: null,
    explanation: "Scoring mode not wired in mock provider.",
  };
}

function buildLeaderboard(submissions) {
  const rows = new Map();

  for (const submission of submissions) {
    const key = submission.participantEmail || submission.participantName;
    if (!key) {
      continue;
    }
    if (!rows.has(key)) {
      rows.set(key, {
        label: submission.participantName || key,
        submissions: 0,
        resolved: 0,
        correct: 0,
        seconds: 0,
      });
    }
    const row = rows.get(key);
    row.submissions += 1;
    row.seconds += Number(submission.activeSeconds || 0);
    if (submission.gradingStatus === "correct" || submission.gradingStatus === "incorrect") {
      row.resolved += 1;
    }
    if (submission.gradingStatus === "correct") {
      row.correct += 1;
    }
  }

  return Array.from(rows.values()).sort((left, right) => {
    if (right.submissions !== left.submissions) {
      return right.submissions - left.submissions;
    }
    return left.seconds - right.seconds;
  });
}

function buildCoverage(submissions) {
  return benchmarkCatalog
    .map((benchmark) => {
      const matchingAssignments = demoAssignments.filter(
        (assignment) => assignment.benchmarkId === benchmark.id
      );
      const matchingIds = new Set(matchingAssignments.map((assignment) => assignment.id));
      const matchingSubmissions = submissions.filter((submission) =>
        matchingIds.has(submission.assignmentId)
      );
      const uniqueAssignmentIds = new Set(matchingSubmissions.map((submission) => submission.assignmentId));
      const collectedSeconds = matchingSubmissions.reduce(
        (sum, submission) => sum + Number(submission.activeSeconds || 0),
        0
      );

      return {
        benchmarkId: benchmark.id,
        title: benchmark.title,
        availableInMock: matchingAssignments.length,
        submittedInMock: uniqueAssignmentIds.size,
        rawSubmissionCount: matchingSubmissions.length,
        coverageRatio: matchingAssignments.length
          ? uniqueAssignmentIds.size / matchingAssignments.length
          : 0,
        collectedHours: collectedSeconds / 3600,
      };
    })
    .filter((row) => row.availableInMock > 0)
    .sort((left, right) => right.coverageRatio - left.coverageRatio || right.rawSubmissionCount - left.rawSubmissionCount);
}

function makeMockProvider() {
  ensureMockSeed();

  return {
    mode: "mock",

    async getCatalog() {
      return benchmarkCatalog;
    },

    async getTracks() {
      return hackathonTracks;
    },

    async getParticipant() {
      return readJson(STORAGE_KEYS.participant, null);
    },

    async saveParticipant(profile) {
      writeJson(STORAGE_KEYS.participant, profile);
      return profile;
    },

    async getActiveAssignment() {
      const activeId = readJson(STORAGE_KEYS.activeAssignmentId, null);
      return demoAssignments.find((assignment) => assignment.id === activeId) || null;
    },

    async clearActiveAssignment() {
      window.localStorage.removeItem(STORAGE_KEYS.activeAssignmentId);
    },

    async claimNextAssignment(options = {}) {
      const { trackId, benchmarkId } = options;
      const existing = await this.getActiveAssignment();
      if (existing) {
        return existing;
      }

      const participant = await this.getParticipant();
      if (!participant) {
        throw new Error("Participant profile required before claiming a task.");
      }

      const submissions = await this.getSubmissions();
      const solvedIds = new Set(
        submissions
          .filter((submission) => submission.participantEmail === participant.email)
          .map((submission) => submission.assignmentId)
      );

      const track = hackathonTracks.find((candidate) => candidate.id === trackId) || hackathonTracks[0];
      const available = demoAssignments.filter((assignment) => {
        if (!assignment.trackIds.includes(track.id)) {
          return false;
        }
        if (solvedIds.has(assignment.id)) {
          return false;
        }
        if (assignment.availability === "backend_only") {
          return false;
        }
        return true;
      });

      const nextAssignment =
        (benchmarkId
          ? available.find((assignment) => assignment.benchmarkId === benchmarkId)
          : null) ||
        available[0] ||
        null;
      if (nextAssignment) {
        writeJson(STORAGE_KEYS.activeAssignmentId, nextAssignment.id);
      }
      return nextAssignment;
    },

    async submitSolution(payload) {
      const participant = await this.getParticipant();
      if (!participant) {
        throw new Error("Participant profile required before submission.");
      }

      const assignment = demoAssignments.find((candidate) => candidate.id === payload.assignmentId);
      if (!assignment) {
        throw new Error("Assignment not found.");
      }

      const result = scoreMockSubmission(assignment, payload.answer);
      const submissions = await this.getSubmissions();

      const submissionRecord = {
        assignmentId: assignment.id,
        benchmarkId: assignment.benchmarkId,
        participantEmail: participant.email,
        participantName: participant.name,
        submittedAnswer: String(payload.answer ?? "").trim(),
        gradingStatus: result.gradingStatus,
        scoreValue: result.scoreValue,
        activeSeconds: Number(payload.activeSeconds || 0),
        submittedAt: new Date().toISOString(),
        explanation: result.explanation,
      };

      submissions.push(submissionRecord);
      writeJson(STORAGE_KEYS.submissions, submissions);
      await this.clearActiveAssignment();
      return submissionRecord;
    },

    async getSubmissions() {
      return readJson(STORAGE_KEYS.submissions, []);
    },

    async getMySubmissions() {
      const participant = await this.getParticipant();
      if (!participant) {
        return [];
      }
      const submissions = await this.getSubmissions();
      return submissions
        .filter((submission) => submission.participantEmail === participant.email)
        .sort((left, right) => new Date(right.submittedAt) - new Date(left.submittedAt));
    },

    async getLiveStats() {
      const submissions = await this.getSubmissions();
      const participant = await this.getParticipant();
      const participantEmails = new Set(seedParticipants.map((entry) => entry.email));
      if (participant?.email) {
        participantEmails.add(participant.email);
      }
      for (const submission of submissions) {
        if (submission.participantEmail) {
          participantEmails.add(submission.participantEmail);
        }
      }

      const uniqueSubmittedAssignments = new Set(submissions.map((submission) => submission.assignmentId));
      const resolved = submissions.filter((submission) =>
        ["correct", "incorrect", "recorded_score", "blocked"].includes(submission.gradingStatus)
      );
      const pending = submissions.filter((submission) =>
        ["pending_llm", "pending_manual"].includes(submission.gradingStatus)
      );
      const totalSeconds = submissions.reduce(
        (sum, submission) => sum + Number(submission.activeSeconds || 0),
        0
      );

      return {
        participantCount: participantEmails.size,
        submissionCount: submissions.length,
        uniqueAssignmentsCovered: uniqueSubmittedAssignments.size,
        resolvedCount: resolved.length,
        pendingCount: pending.length,
        collectedHours: totalSeconds / 3600,
        leaderboard: buildLeaderboard(submissions),
        coverage: buildCoverage(submissions),
      };
    },

    async exportLocalState() {
      return JSON.stringify(
        {
          participant: await this.getParticipant(),
          activeAssignment: await this.getActiveAssignment(),
          submissions: await this.getSubmissions(),
        },
        null,
        2
      );
    },

    async resetLocalState() {
      window.localStorage.removeItem(STORAGE_KEYS.participant);
      window.localStorage.removeItem(STORAGE_KEYS.submissions);
      window.localStorage.removeItem(STORAGE_KEYS.activeAssignmentId);
      window.localStorage.removeItem(STORAGE_KEYS.seeded);
      ensureMockSeed();
    },
  };
}

function makeApiProvider(apiBaseUrl, authController) {
  const endpoint = (path) => `${apiBaseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;

  async function request(path, options = {}) {
    const authHeaders = authController ? await authController.getRequestHeaders() : {};
    const response = await fetch(endpoint(path), {
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
        ...(options.headers || {}),
      },
      ...options,
    });

    if (!response.ok) {
      const message = await response.text();
      const error = new Error(`API ${path} failed: ${response.status} ${message}`);
      error.status = response.status;
      error.body = message;
      throw error;
    }

    return response.status === 204 ? null : response.json();
  }

  return {
    mode: "api",
    getCatalog: () => request("/catalog"),
    getTracks: () => request("/tracks"),
    getParticipant: () => request("/participant"),
    saveParticipant: (profile) => request("/register-participant", { method: "POST", body: JSON.stringify(profile) }),
    getActiveAssignment: () => request("/active-assignment"),
    clearActiveAssignment: () => request("/active-assignment", { method: "DELETE" }),
    claimNextAssignment: (options) => request("/claim-assignment", { method: "POST", body: JSON.stringify(options) }),
    submitSolution: (payload) => request("/submit-solution", { method: "POST", body: JSON.stringify(payload) }),
    getSubmissions: () => request("/submissions"),
    getMySubmissions: () => request("/my-submissions"),
    getLiveStats: () => request("/live-stats"),
    exportLocalState: async () => JSON.stringify({ note: "API mode export not implemented in frontend." }, null, 2),
    resetLocalState: async () => request("/admin/reset", { method: "POST" }),
  };
}

export function createProvider(config, authController = null) {
  if (config.backendMode === "api") {
    return makeApiProvider(config.apiBaseUrl, authController);
  }
  return makeMockProvider();
}
