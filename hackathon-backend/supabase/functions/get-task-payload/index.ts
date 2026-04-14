import { buildFrontendAssignment, loadBenchmarkAndItem } from "../_shared/assignment.ts";
import { requireParticipant } from "../_shared/auth.ts";
import { HttpError, json } from "../_shared/http.ts";
import { withRequestPolicy } from "../_shared/policy.ts";

Deno.serve((request) =>
  withRequestPolicy(request, { endpoint: "get-task-payload", limit: 120, windowSeconds: 300 }, async () => {
    if (request.method !== "GET") {
      throw new HttpError(405, "Use GET for task payload delivery.");
    }

    const { participant, serviceClient } = await requireParticipant(request);
    const assignmentId = new URL(request.url).searchParams.get("assignmentId");
    if (!assignmentId) {
      throw new HttpError(400, "assignmentId query parameter is required.");
    }

    const assignmentResult = await serviceClient
      .from("assignments")
      .select("*")
      .eq("id", assignmentId)
      .eq("participant_id", participant.id)
      .maybeSingle();

    if (assignmentResult.error) {
      throw new HttpError(500, "Failed to fetch assignment.", assignmentResult.error);
    }
    if (!assignmentResult.data) {
      throw new HttpError(404, "Assignment not found for current participant.");
    }

    const { benchmark, item } = await loadBenchmarkAndItem(serviceClient, assignmentResult.data);
    return json(
      await buildFrontendAssignment({
        serviceClient,
        assignment: assignmentResult.data,
        benchmark,
        item,
      }),
    );
  })
);
