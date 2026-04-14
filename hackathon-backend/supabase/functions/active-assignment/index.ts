import {
  buildFrontendAssignment,
  fetchCurrentAssignment,
  loadBenchmarkAndItem,
} from "../_shared/assignment.ts";
import { requireParticipant } from "../_shared/auth.ts";
import { HttpError, json } from "../_shared/http.ts";
import { withRequestPolicy } from "../_shared/policy.ts";

Deno.serve((request) =>
  withRequestPolicy(request, { endpoint: "active-assignment", limit: 90, windowSeconds: 300 }, async () => {
    const { event, participant, serviceClient } = await requireParticipant(request);
    const assignment = await fetchCurrentAssignment(serviceClient, String(event.id), String(participant.id));

    if (request.method === "DELETE") {
      if (!assignment) {
        return json(null);
      }

      const releaseResult = await serviceClient
        .from("assignments")
        .update({
          status: "released",
          participant_id: null,
          released_at: new Date().toISOString(),
        })
        .eq("id", assignment.id)
        .eq("participant_id", String(participant.id));

      if (releaseResult.error) {
        throw new HttpError(500, "Failed to release active assignment.", releaseResult.error);
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
