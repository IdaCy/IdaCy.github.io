import { assertAdmin, requireParticipant } from "../_shared/auth.ts";
import { HttpError, json } from "../_shared/http.ts";
import { withRequestPolicy } from "../_shared/policy.ts";

Deno.serve((request) =>
  withRequestPolicy(request, { endpoint: "submissions", limit: 60, windowSeconds: 300 }, async () => {
    if (request.method !== "GET") {
      throw new HttpError(405, "Use GET for submissions.");
    }

    const { event, participant, serviceClient } = await requireParticipant(request);
    assertAdmin(String(participant.email));

    const submissionsResult = await serviceClient
      .from("submissions")
      .select("*")
      .eq("event_id", event.id)
      .order("submitted_at", { ascending: false });

    if (submissionsResult.error) {
      throw new HttpError(500, "Failed to load event submissions.", submissionsResult.error);
    }

    return json(submissionsResult.data || []);
  })
);
