import { getCurrentEvent, getInviteForEmail, resolveIdentity } from "../_shared/auth.ts";
import { getServiceClient } from "../_shared/db.ts";
import { getEnv } from "../_shared/env.ts";
import { HttpError, json, readJson } from "../_shared/http.ts";
import { withRequestPolicy } from "../_shared/policy.ts";

Deno.serve((request) =>
  withRequestPolicy(request, { endpoint: "register-participant", limit: 30, windowSeconds: 300 }, async () => {
    if (request.method !== "POST") {
      throw new HttpError(405, "Use POST for participant registration.");
    }

    const payload = await readJson(request);
    const name = String(payload.name || "").trim();
    const email = String(payload.email || "").trim().toLowerCase();
    const team = String(payload.team || "").trim() || null;
    const affiliation = String(payload.affiliation || "").trim() || null;

    if (!name || !email) {
      throw new HttpError(400, "Name and email are required.");
    }

    const identity = await resolveIdentity(request);
    if (identity?.email && identity.email !== email) {
      throw new HttpError(
        400,
        "Authenticated email does not match the submitted registration email.",
      );
    }

    const serviceClient = getServiceClient();
    const event = await getCurrentEvent(serviceClient);
    const { requireInvite } = getEnv();
    const invite = await getInviteForEmail(serviceClient, String(event.id), email);

    if (requireInvite && !invite) {
      throw new HttpError(403, "This email is not invited for the current event.");
    }

    const existingParticipant = await serviceClient
      .from("participants")
      .select("*")
      .eq("email", email)
      .maybeSingle();

    if (existingParticipant.error) {
      throw new HttpError(500, "Failed to look up existing participant.", existingParticipant.error);
    }

    const participantUpsert = await serviceClient
      .from("participants")
      .upsert(
        {
          auth_user_id: identity?.authUserId ?? existingParticipant.data?.auth_user_id ?? null,
          email,
          name,
          team: invite?.team || team,
          affiliation: invite?.affiliation || affiliation,
          role: invite?.role || existingParticipant.data?.role || "participant",
          metadata: {
            registration_source: identity?.source || "manual",
            invite_id: invite?.id || null,
          },
        },
        { onConflict: "email" },
      )
      .select("*")
      .single();

    if (participantUpsert.error) {
      throw new HttpError(500, "Failed to upsert participant.", participantUpsert.error);
    }

    const participant = participantUpsert.data;
    const registration = await serviceClient
      .from("event_participants")
      .upsert(
        {
          event_id: event.id,
          participant_id: participant.id,
          status: invite?.status === "revoked" ? "blocked" : "registered",
          metadata: {
            invite_id: invite?.id || null,
            allow_private_tracks: Boolean(invite?.allow_private_tracks),
            invite_role: invite?.role || "participant",
          },
        },
        { onConflict: "event_id,participant_id" },
      );

    if (registration.error) {
      throw new HttpError(500, "Failed to register participant for event.", registration.error);
    }

    return json({
      id: participant.id,
      name: participant.name,
      email: participant.email,
      team: participant.team,
      affiliation: participant.affiliation,
      canAccessPrivate: Boolean(invite?.allow_private_tracks || participant.role === "admin"),
    });
  })
);
