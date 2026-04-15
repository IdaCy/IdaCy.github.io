import { requireParticipant } from "../_shared/auth.ts";
import { json, HttpError } from "../_shared/http.ts";
import { withRequestPolicy } from "../_shared/policy.ts";
import { displayProblemTitle } from "../_shared/problem_title.ts";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

const EXCLUDED_BENCHMARK_KEYS = new Set([
  "chess_puzzles",
  "shade_monitor_action_only",
  "shade_monitor_cot_action",
]);

function stableShuffleKey(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

Deno.serve((request) =>
  withRequestPolicy(request, { endpoint: "catalog", limit: 60, windowSeconds: 300 }, async () => {
    if (request.method !== "GET") {
      throw new HttpError(405, "Use GET for catalog.");
    }

    const { event, participant, serviceClient, canAccessPrivate } = await requireParticipant(request);

    const [benchmarksResult, configsResult, itemsResult, assignmentsResult, submissionsResult] = await Promise.all([
      serviceClient.from("benchmarks").select("*").order("title"),
      serviceClient
        .from("event_benchmark_configs")
        .select("*")
        .eq("event_id", event.id),
      serviceClient.from("benchmark_items").select("*").order("item_key"),
      serviceClient
        .from("assignments")
        .select("id, benchmark_id, benchmark_item_id, participant_id, status")
        .eq("event_id", event.id)
        .not("participant_id", "is", null)
        .range(0, 9999),
      serviceClient
        .from("submissions")
        .select("id, benchmark_id, benchmark_item_id, participant_id, grading_status, score_value")
        .eq("event_id", event.id)
        .range(0, 9999),
    ]);

    if (benchmarksResult.error) {
      throw benchmarksResult.error;
    }
    if (configsResult.error) {
      throw configsResult.error;
    }
    if (itemsResult.error) {
      throw itemsResult.error;
    }
    if (assignmentsResult.error) {
      throw assignmentsResult.error;
    }
    if (submissionsResult.error) {
      throw submissionsResult.error;
    }

    const configByBenchmarkId = new Map(
      (configsResult.data || []).map((row) => [row.benchmark_id, row]),
    );
    const assignments = assignmentsResult.data || [];
    const submissions = submissionsResult.data || [];
    const participantId = String(participant.id);

    const itemsByBenchmarkId = new Map<string, Record<string, unknown>[]>();
    for (const item of itemsResult.data || []) {
      const benchmarkId = String(item.benchmark_id);
      if (!itemsByBenchmarkId.has(benchmarkId)) {
        itemsByBenchmarkId.set(benchmarkId, []);
      }
      itemsByBenchmarkId.get(benchmarkId)!.push(item);
    }

    const payload = (benchmarksResult.data || [])
      .filter((benchmark) => {
        if (EXCLUDED_BENCHMARK_KEYS.has(String(benchmark.benchmark_key))) {
          return false;
        }
        const config = configByBenchmarkId.get(benchmark.id);
        if (!config || config.enabled === false) {
          return false;
        }
        if (benchmark.visibility === "private" && !canAccessPrivate) {
          return false;
        }
        return true;
      })
      .map((benchmark) => {
        const config = configByBenchmarkId.get(benchmark.id);
        const benchmarkKey = String(benchmark.benchmark_key);
        const benchmarkItems = [...(itemsByBenchmarkId.get(String(benchmark.id)) || [])].sort((left, right) => {
          const leftKey = stableShuffleKey(`${benchmarkKey}:${String(left.item_key)}`);
          const rightKey = stableShuffleKey(`${benchmarkKey}:${String(right.item_key)}`);
          return leftKey - rightKey || String(left.item_key).localeCompare(String(right.item_key));
        });
        return {
          id: benchmarkKey,
          title: benchmark.title,
          description: benchmark.description,
          domain: benchmark.domain,
          contributor: benchmark.contributor,
          visibility: benchmark.visibility,
          baselineStatus: benchmark.baseline_status,
          itemCount: benchmark.item_count,
          scorer: benchmark.scorer,
          gradingMode: benchmark.grading_mode,
          frontendMode: benchmark.frontend_mode,
          estimatedRange: benchmark.estimated_range,
          realRange: benchmark.real_range,
          totalEstimatedHours: benchmark.total_estimated_hours,
          priority: config?.priority_override || benchmark.priority,
          notes: config?.notes_override || benchmark.notes || "",
          problems: benchmarkItems.map((item) => {
            const renderPayload = asObject(item.render_payload);
            const metadata = asObject(item.metadata);
            const itemId = String(item.id);
            const itemAssignments = assignments.filter((assignment) => String(assignment.benchmark_item_id) === itemId);
            const itemSubmissions = submissions.filter((submission) => String(submission.benchmark_item_id) === itemId);
            const participantAssignment = itemAssignments.find(
              (assignment) => String(assignment.participant_id || "") === participantId,
            );
            const participantSubmission = itemSubmissions.find(
              (submission) => String(submission.participant_id || "") === participantId,
            );
            const attemptedParticipants = new Set(
              [
                ...itemAssignments.map((assignment) => String(assignment.participant_id || "")),
                ...itemSubmissions.map((submission) => String(submission.participant_id || "")),
              ].filter(Boolean),
            );
            const successfulParticipants = new Set(
              itemSubmissions
                .filter((submission) => submission.grading_status === "correct")
                .map((submission) => String(submission.participant_id || ""))
                .filter(Boolean),
            );
            return {
              id: item.item_key,
              title: displayProblemTitle(String(benchmark.benchmark_key), String(item.item_key), renderPayload),
              estimatedMinutes: metadata.estimated_minutes ?? asObject(metadata.estimated_time).median ?? null,
              attempted: attemptedParticipants.size,
              successes: successfulParticipants.size,
              startedByMe: Boolean(participantAssignment || participantSubmission),
              submittedByMe: Boolean(participantSubmission),
              myAssignmentId: participantAssignment?.id || null,
              myStatus: participantSubmission?.grading_status || participantAssignment?.status || null,
            };
          }),
        };
      });

    return json(payload);
  })
);
