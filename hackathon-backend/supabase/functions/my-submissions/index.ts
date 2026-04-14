import { requireParticipant } from "../_shared/auth.ts";
import { HttpError, json } from "../_shared/http.ts";
import { withRequestPolicy } from "../_shared/policy.ts";

Deno.serve((request) =>
  withRequestPolicy(request, { endpoint: "my-submissions", limit: 60, windowSeconds: 300 }, async () => {
    if (request.method !== "GET") {
      throw new HttpError(405, "Use GET for my submissions.");
    }

    const { event, participant, serviceClient } = await requireParticipant(request);
    const submissionsResult = await serviceClient
      .from("submissions")
      .select("*")
      .eq("event_id", event.id)
      .eq("participant_id", participant.id)
      .order("submitted_at", { ascending: false });

    if (submissionsResult.error) {
      throw new HttpError(500, "Failed to load participant submissions.", submissionsResult.error);
    }

    const benchmarkIds = [...new Set((submissionsResult.data || []).map((row) => row.benchmark_id))];
    const benchmarkMap = new Map<string, string>();
    if (benchmarkIds.length > 0) {
      const benchmarksResult = await serviceClient
        .from("benchmarks")
        .select("id, benchmark_key")
        .in("id", benchmarkIds);

      if (benchmarksResult.error) {
        throw new HttpError(500, "Failed to resolve benchmark keys.", benchmarksResult.error);
      }

      for (const benchmark of benchmarksResult.data || []) {
        benchmarkMap.set(benchmark.id, benchmark.benchmark_key);
      }
    }

    return json(
      (submissionsResult.data || []).map((submission) => ({
        assignmentId: submission.assignment_id,
        attemptNumber: submission.attempt_number || 1,
        benchmarkId: benchmarkMap.get(submission.benchmark_id) || submission.benchmark_id,
        participantEmail: participant.email,
        participantName: participant.name,
        submittedAnswer: submission.submitted_answer,
        gradingStatus: submission.grading_status,
        scoreValue: submission.score_value,
        activeSeconds: submission.active_seconds,
        submittedAt: submission.submitted_at,
        explanation: submission.explanation,
      })),
    );
  })
);
