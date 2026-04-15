import {
  buildFrontendAssignment,
  loadBenchmarkAndItem,
} from "../_shared/assignment.ts";
import { requireParticipant } from "../_shared/auth.ts";
import { HttpError, json, readJson } from "../_shared/http.ts";
import { withRequestPolicy } from "../_shared/policy.ts";

const EXCLUDED_BENCHMARK_KEYS = new Set([
  "chess_puzzles",
  "ctrl_alt_deceit_sandbag",
  "shade_monitor_action_only",
  "shade_monitor_cot_action",
]);

Deno.serve((request) =>
  withRequestPolicy(request, { endpoint: "claim-assignment", limit: 90, windowSeconds: 300 }, async () => {
    if (request.method !== "POST") {
      throw new HttpError(405, "Use POST for starting a problem.");
    }

    const { event, participant, serviceClient, canAccessPrivate } = await requireParticipant(request);
    const payload = await readJson(request);
    const benchmarkKey = String(payload.benchmarkId || "").trim();
    const itemKey = String(payload.itemId || "").trim();

    if (!benchmarkKey || !itemKey) {
      throw new HttpError(400, "benchmarkId and itemId are required.");
    }

    const benchmarkResult = await serviceClient
      .from("benchmarks")
      .select("id, benchmark_key, visibility")
      .eq("benchmark_key", benchmarkKey)
      .maybeSingle();

    if (benchmarkResult.error) {
      throw new HttpError(500, "Failed to resolve requested benchmark.", benchmarkResult.error);
    }
    if (!benchmarkResult.data) {
      throw new HttpError(404, "Benchmark not found.");
    }
    if (EXCLUDED_BENCHMARK_KEYS.has(String(benchmarkResult.data.benchmark_key))) {
      throw new HttpError(404, "Problem not found.");
    }
    const configResult = await serviceClient
      .from("event_benchmark_configs")
      .select("enabled")
      .eq("event_id", event.id)
      .eq("benchmark_id", benchmarkResult.data.id)
      .maybeSingle();

    if (configResult.error) {
      throw new HttpError(500, "Failed to resolve event benchmark configuration.", configResult.error);
    }
    if (!configResult.data || configResult.data.enabled === false) {
      throw new HttpError(404, "Problem not found.");
    }
    if (benchmarkResult.data.visibility === "private" && !canAccessPrivate) {
      throw new HttpError(403, "This participant is not allowed to access this private benchmark.");
    }

    const itemResult = await serviceClient
      .from("benchmark_items")
      .select("id")
      .eq("benchmark_id", benchmarkResult.data.id)
      .eq("item_key", itemKey)
      .maybeSingle();

    if (itemResult.error) {
      throw new HttpError(500, "Failed to resolve requested problem.", itemResult.error);
    }
    if (!itemResult.data) {
      throw new HttpError(404, "Problem not found.");
    }

    const existingAttemptResult = await serviceClient
      .from("assignments")
      .select("*")
      .eq("event_id", event.id)
      .eq("benchmark_item_id", itemResult.data.id)
      .eq("participant_id", participant.id)
      .maybeSingle();

    if (existingAttemptResult.error) {
      throw new HttpError(500, "Failed to check whether you already started this problem.", existingAttemptResult.error);
    }
    if (existingAttemptResult.data) {
      throw new HttpError(409, "You have already started this problem, so it cannot be started again.");
    }

    const existingSubmissionResult = await serviceClient
      .from("submissions")
      .select("id")
      .eq("event_id", event.id)
      .eq("benchmark_item_id", itemResult.data.id)
      .eq("participant_id", participant.id)
      .limit(1);

    if (existingSubmissionResult.error) {
      throw new HttpError(500, "Failed to check whether you already submitted this problem.", existingSubmissionResult.error);
    }
    if ((existingSubmissionResult.data || []).length > 0) {
      throw new HttpError(409, "You have already started this problem, so it cannot be started again.");
    }

    const assignmentResult = await serviceClient
      .from("assignments")
      .select("*")
      .eq("event_id", event.id)
      .eq("benchmark_item_id", itemResult.data.id)
      .in("status", ["queued", "released"])
      .is("participant_id", null)
      .order("assignment_slot", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (assignmentResult.error) {
      throw new HttpError(500, "Failed to find an available assignment slot.", assignmentResult.error);
    }
    if (!assignmentResult.data) {
      throw new HttpError(409, "No attempt slots remain for this problem.");
    }

    const claimResult = await serviceClient
      .from("assignments")
      .update({
        participant_id: String(participant.id),
        status: "claimed",
        claimed_at: new Date().toISOString(),
        released_at: null,
      })
      .eq("id", assignmentResult.data.id)
      .in("status", ["queued", "released"])
      .is("participant_id", null)
      .select("*")
      .maybeSingle();

    if (claimResult.error) {
      throw new HttpError(500, "Failed to start problem.", claimResult.error);
    }
    if (!claimResult.data) {
      throw new HttpError(409, "This problem was just started by someone else. Choose another one.");
    }

    const { benchmark, item } = await loadBenchmarkAndItem(serviceClient, claimResult.data);
    return json(
      await buildFrontendAssignment({
        serviceClient,
        assignment: claimResult.data,
        benchmark,
        item,
      }),
    );
  })
);
