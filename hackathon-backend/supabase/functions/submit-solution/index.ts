import { loadBenchmarkAndItem } from "../_shared/assignment.ts";
import { getEnv } from "../_shared/env.ts";
import { requireParticipant } from "../_shared/auth.ts";
import { HttpError, json, readJson } from "../_shared/http.ts";
import { withRequestPolicy } from "../_shared/policy.ts";
import { scoreSubmission } from "../_shared/scoring.ts";

function isSuccessful(scoring: { gradingStatus: string; scoreValue: number | null }) {
  return scoring.gradingStatus === "correct" || scoring.scoreValue === 1;
}

function isTerminalNonRetryable(scoring: { gradingStatus: string; scoreValue: number | null }) {
  return ["pending_llm", "pending_manual", "recorded_score", "correct"].includes(scoring.gradingStatus);
}

Deno.serve((request) =>
  withRequestPolicy(request, { endpoint: "submit-solution", limit: 180, windowSeconds: 300 }, async () => {
    if (request.method !== "POST") {
      throw new HttpError(405, "Use POST for submissions.");
    }

    const { event, participant, serviceClient } = await requireParticipant(request);
    const payload = await readJson(request);
    const assignmentId = String(payload.assignmentId || "").trim();
    const answer = String(payload.answer || "").trim();
    const activeSeconds = Number(payload.activeSeconds || 0);

    if (!assignmentId || !answer) {
      throw new HttpError(400, "assignmentId and answer are required.");
    }

    const assignmentResult = await serviceClient
      .from("assignments")
      .select("*")
      .eq("id", assignmentId)
      .eq("event_id", event.id)
      .eq("participant_id", participant.id)
      .eq("status", "claimed")
      .single();

    if (assignmentResult.error) {
      throw new HttpError(500, "Failed to resolve started problem.", assignmentResult.error);
    }

    const assignment = assignmentResult.data;
    const priorSubmissionsResult = await serviceClient
      .from("submissions")
      .select("attempt_number, grading_status, score_value")
      .eq("assignment_id", assignment.id)
      .order("attempt_number", { ascending: true });

    if (priorSubmissionsResult.error) {
      throw new HttpError(500, "Failed to load prior attempts.", priorSubmissionsResult.error);
    }

    const priorAttempts = priorSubmissionsResult.data || [];
    if (priorAttempts.some((attempt) => attempt.grading_status === "correct" || Number(attempt.score_value) === 1)) {
      throw new HttpError(409, "This problem was already completed successfully.");
    }
    if (priorAttempts.length >= 3) {
      throw new HttpError(409, "You have already used all 3 attempts for this problem.");
    }

    const startedAt = String(payload.startedAt || assignment.claimed_at || "").trim() || null;
    const { benchmark, item } = await loadBenchmarkAndItem(serviceClient, assignment);
    const answerKey = (item.answer_key || {}) as Record<string, unknown>;
    const scoring = scoreSubmission({
      scorer: String(benchmark.scorer || ""),
      gradingMode: String(benchmark.grading_mode || ""),
      answerKey,
      rawAnswer: answer,
    });

    const attemptNumber = priorAttempts.length + 1;
    const submittedAt = new Date().toISOString();
    const startedAtTime = startedAt ? Date.parse(startedAt) : NaN;
    const wallClockSeconds = Number.isFinite(startedAtTime)
      ? Math.max(0, Math.round((Date.parse(submittedAt) - startedAtTime) / 1000))
      : null;
    const successful = isSuccessful(scoring);
    const attemptsRemaining = Math.max(0, 3 - attemptNumber);
    const canRetry = !successful && scoring.gradingStatus === "incorrect" && attemptsRemaining > 0;
    const terminal = successful || !canRetry || isTerminalNonRetryable(scoring);

    const submissionResult = await serviceClient
      .from("submissions")
      .insert({
        assignment_id: assignment.id,
        attempt_number: attemptNumber,
        event_id: event.id,
        participant_id: participant.id,
        benchmark_id: benchmark.id,
        benchmark_item_id: item.id,
        submitted_answer: answer,
        raw_payload: payload,
        active_seconds: Number.isFinite(activeSeconds) ? Math.max(0, Math.round(activeSeconds)) : 0,
        wall_clock_seconds: wallClockSeconds,
        started_at: startedAt,
        submitted_at: submittedAt,
        grading_status: scoring.gradingStatus,
        score_value: scoring.scoreValue,
        explanation: scoring.explanation,
      })
      .select("*")
      .single();

    if (submissionResult.error) {
      throw new HttpError(500, "Failed to store submission attempt.", submissionResult.error);
    }

    const assignmentUpdate = await serviceClient
      .from("assignments")
      .update({
        status: terminal ? "submitted" : "claimed",
        submitted_at: terminal ? submittedAt : null,
      })
      .eq("id", assignment.id);

    if (assignmentUpdate.error) {
      throw new HttpError(500, "Failed to update problem status.", assignmentUpdate.error);
    }

    if (scoring.gradingStatus === "pending_llm" || scoring.gradingStatus === "pending_manual") {
      const { graderModel } = getEnv();
      const gradingJob = await serviceClient
        .from("grading_jobs")
        .upsert(
          {
            submission_id: submissionResult.data.id,
            status: "queued",
            grader_model: scoring.gradingStatus === "pending_llm" ? graderModel : null,
            request_payload: {
              benchmarkKey: benchmark.benchmark_key,
              scorer: benchmark.scorer,
              gradingMode: benchmark.grading_mode,
              answerKey,
              attemptNumber,
            },
          },
          { onConflict: "submission_id" },
        );

      if (gradingJob.error) {
        throw new HttpError(500, "Failed to queue grading job.", gradingJob.error);
      }
    }

    return json({
      assignmentId: assignment.id,
      benchmarkId: benchmark.benchmark_key,
      participantEmail: participant.email,
      participantName: participant.name,
      submittedAnswer: answer,
      gradingStatus: scoring.gradingStatus,
      scoreValue: scoring.scoreValue,
      activeSeconds: Number.isFinite(activeSeconds) ? Math.max(0, Math.round(activeSeconds)) : 0,
      submittedAt,
      explanation: scoring.explanation,
      attemptNumber,
      attemptsRemaining,
      canRetry,
      terminal,
      successful,
    });
  })
);
