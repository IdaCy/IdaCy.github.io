import {
  buildFrontendAssignment,
  fetchCurrentAssignment,
  loadBenchmarkAndItem,
} from "../_shared/assignment.ts";
import { requireParticipant } from "../_shared/auth.ts";
import { HttpError, json } from "../_shared/http.ts";
import { withRequestPolicy } from "../_shared/policy.ts";

async function readOptionalJson(request: Request) {
  const text = await request.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (_error) {
    throw new HttpError(400, "Invalid JSON body.");
  }
}

Deno.serve((request) =>
  withRequestPolicy(request, { endpoint: "active-assignment", limit: 90, windowSeconds: 300 }, async () => {
    const { event, participant, serviceClient } = await requireParticipant(request);
    const assignment = await fetchCurrentAssignment(serviceClient, String(event.id), String(participant.id));

    if (request.method === "DELETE") {
      if (!assignment) {
        return json(null);
      }

      const payload = await readOptionalJson(request);
      const activeSeconds = Number(payload.activeSeconds || 0);
      const startedAt = String(assignment.claimed_at || payload.startedAt || "").trim() || null;
      const abandonedAt = new Date().toISOString();
      const startedAtTime = startedAt ? Date.parse(startedAt) : NaN;
      const wallClockSeconds = Number.isFinite(startedAtTime)
        ? Math.max(0, Math.round((Date.parse(abandonedAt) - startedAtTime) / 1000))
        : null;
      const clientActiveSeconds = Number.isFinite(activeSeconds) ? Math.max(0, Math.round(activeSeconds)) : 0;
      const canonicalActiveSeconds = wallClockSeconds ?? clientActiveSeconds;

      const priorSubmissionsResult = await serviceClient
        .from("submissions")
        .select("attempt_number")
        .eq("assignment_id", assignment.id)
        .order("attempt_number", { ascending: false })
        .limit(1);

      if (priorSubmissionsResult.error) {
        throw new HttpError(500, "Failed to load prior attempts.", priorSubmissionsResult.error);
      }

      const lastAttempt = Number(priorSubmissionsResult.data?.[0]?.attempt_number || 0);
      const { benchmark, item } = await loadBenchmarkAndItem(serviceClient, assignment);
      const submissionResult = await serviceClient
        .from("submissions")
        .insert({
          assignment_id: assignment.id,
          attempt_number: lastAttempt + 1,
          event_id: event.id,
          participant_id: participant.id,
          benchmark_id: benchmark.id,
          benchmark_item_id: item.id,
          submitted_answer: null,
          raw_payload: {
            ...payload,
            abandoned: true,
            clientActiveSeconds,
            clientStartedAt: payload.startedAt || null,
            canonicalStartedAt: startedAt,
          },
          active_seconds: canonicalActiveSeconds,
          wall_clock_seconds: wallClockSeconds,
          started_at: startedAt,
          submitted_at: abandonedAt,
          grading_status: "abandoned",
          score_value: null,
          explanation: "Participant gave up before submitting a final answer.",
        });

      if (submissionResult.error) {
        throw new HttpError(500, "Failed to store abandoned problem record.", submissionResult.error);
      }

      const abandonResult = await serviceClient
        .from("assignments")
        .update({
          status: "abandoned",
          submitted_at: abandonedAt,
        })
        .eq("id", assignment.id)
        .eq("participant_id", String(participant.id))
        .eq("status", "claimed");

      if (abandonResult.error) {
        throw new HttpError(500, "Failed to abandon active problem.", abandonResult.error);
      }

      return json(null);
    }

    if (request.method !== "GET") {
      throw new HttpError(405, "Use GET or DELETE on /active-assignment.");
    }

    if (!assignment) {
      return json(null);
    }

    const { benchmark, item } = await loadBenchmarkAndItem(serviceClient, assignment);
    return json(
      await buildFrontendAssignment({
        serviceClient,
        assignment,
        benchmark,
        item,
      }),
    );
  })
);
