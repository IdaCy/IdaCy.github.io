import { requireParticipant } from "../_shared/auth.ts";
import { HttpError, json } from "../_shared/http.ts";
import { withRequestPolicy } from "../_shared/policy.ts";

Deno.serve((request) =>
  withRequestPolicy(request, { endpoint: "live-stats", limit: 60, windowSeconds: 300 }, async () => {
    if (request.method !== "GET") {
      throw new HttpError(405, "Use GET for live stats.");
    }

    const { serviceClient, event, canAccessPrivate } = await requireParticipant(request);

    const [participantsResult, submissionsResult, assignmentsResult, benchmarksResult, configsResult] =
      await Promise.all([
        serviceClient.from("event_participants").select("*").eq("event_id", event.id),
        serviceClient.from("submissions").select("*").eq("event_id", event.id),
        serviceClient.from("assignments").select("*").eq("event_id", event.id),
        serviceClient.from("benchmarks").select("*"),
        serviceClient.from("event_benchmark_configs").select("*").eq("event_id", event.id),
      ]);

    if (participantsResult.error) {
      throw new HttpError(500, "Failed to load participant counts.", participantsResult.error);
    }
    if (submissionsResult.error) {
      throw new HttpError(500, "Failed to load submissions.", submissionsResult.error);
    }
    if (assignmentsResult.error) {
      throw new HttpError(500, "Failed to load assignments.", assignmentsResult.error);
    }
    if (benchmarksResult.error) {
      throw new HttpError(500, "Failed to load benchmarks.", benchmarksResult.error);
    }
    if (configsResult.error) {
      throw new HttpError(500, "Failed to load event benchmark configs.", configsResult.error);
    }

    const benchmarks = benchmarksResult.data || [];
    const benchmarkById = new Map(benchmarks.map((row) => [row.id, row]));
    const enabledBenchmarkIds = new Set(
      (configsResult.data || [])
        .filter((row) => row.enabled !== false)
        .map((row) => row.benchmark_id),
    );
    const visibleBenchmarkIds = new Set(
      benchmarks
        .filter((benchmark) =>
          (enabledBenchmarkIds.size === 0 || enabledBenchmarkIds.has(benchmark.id)) &&
          (canAccessPrivate || benchmark.visibility !== "private")
        )
        .map((benchmark) => benchmark.id),
    );
    const assignments = (assignmentsResult.data || []).filter((row) => visibleBenchmarkIds.has(row.benchmark_id));
    const submissions = (submissionsResult.data || []).filter((row) => visibleBenchmarkIds.has(row.benchmark_id));

    const participantIds = [...new Set(submissions.map((row) => row.participant_id))];
    const participantNameById = new Map<string, string>();
    if (participantIds.length > 0) {
      const participantRows = await serviceClient
        .from("participants")
        .select("id, name, email")
        .in("id", participantIds);
      if (participantRows.error) {
        throw new HttpError(500, "Failed to resolve participant names.", participantRows.error);
      }
      for (const row of participantRows.data || []) {
        participantNameById.set(row.id, row.name || row.email);
      }
    }

    const leaderboardMap = new Map<string, {
      label: string;
      submissions: number;
      resolved: number;
      correct: number;
      seconds: number;
    }>();

    for (const submission of submissions) {
      const participantId = String(submission.participant_id);
      if (!leaderboardMap.has(participantId)) {
        leaderboardMap.set(participantId, {
          label: participantNameById.get(participantId) || participantId,
          submissions: 0,
          resolved: 0,
          correct: 0,
          seconds: 0,
        });
      }
      const row = leaderboardMap.get(participantId)!;
      row.submissions += 1;
      row.seconds += Number(submission.active_seconds || 0);
      if (["correct", "incorrect", "recorded_score", "blocked"].includes(submission.grading_status)) {
        row.resolved += 1;
      }
      if (submission.grading_status === "correct") {
        row.correct += 1;
      }
    }

    const coverage = benchmarks
      .filter((benchmark) => visibleBenchmarkIds.has(benchmark.id))
      .map((benchmark) => {
        const benchmarkAssignments = assignments.filter((assignment) => assignment.benchmark_id === benchmark.id);
        const benchmarkSubmissions = submissions.filter((submission) => submission.benchmark_id === benchmark.id);
        const uniqueAssignmentIds = new Set(benchmarkSubmissions.map((submission) => submission.assignment_id));
        return {
          benchmarkId: benchmark.benchmark_key,
          title: benchmark.title,
          availableInMock: benchmarkAssignments.length,
          submittedInMock: uniqueAssignmentIds.size,
          rawSubmissionCount: benchmarkSubmissions.length,
          coverageRatio: benchmarkAssignments.length > 0
            ? uniqueAssignmentIds.size / benchmarkAssignments.length
            : 0,
          collectedHours: benchmarkSubmissions.reduce(
            (sum, submission) => sum + Number(submission.active_seconds || 0),
            0,
          ) / 3600,
        };
      })
      .filter((row) => row.availableInMock > 0)
      .sort((left, right) =>
        right.coverageRatio - left.coverageRatio ||
        right.rawSubmissionCount - left.rawSubmissionCount
      );

    return json({
      participantCount: (participantsResult.data || []).length,
      submissionCount: submissions.length,
      uniqueAssignmentsCovered: new Set(submissions.map((row) => row.assignment_id)).size,
      resolvedCount: submissions.filter((row) =>
        ["correct", "incorrect", "recorded_score", "blocked"].includes(row.grading_status)
      ).length,
      pendingCount: submissions.filter((row) =>
        ["pending_llm", "pending_manual"].includes(row.grading_status)
      ).length,
      collectedHours: submissions.reduce(
        (sum, row) => sum + Number(row.active_seconds || 0),
        0,
      ) / 3600,
      leaderboard: [...leaderboardMap.values()].sort((left, right) =>
        right.submissions - left.submissions || left.seconds - right.seconds
      ),
      coverage,
    });
  })
);
