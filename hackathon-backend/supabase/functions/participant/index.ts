import { requireParticipant } from "../_shared/auth.ts";
import { json } from "../_shared/http.ts";
import { withRequestPolicy } from "../_shared/policy.ts";

Deno.serve((request) =>
  withRequestPolicy(request, { endpoint: "participant", limit: 60, windowSeconds: 300 }, async () => {
    const { participant, canAccessPrivate } = await requireParticipant(request);
    return json({
      id: participant.id,
      name: participant.name,
      email: participant.email,
      team: participant.team,
      affiliation: participant.affiliation,
      canAccessPrivate,
    });
  })
);
