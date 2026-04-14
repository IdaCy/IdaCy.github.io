import { getEnv } from "./env.ts";
import { getServiceClient, getUserClient } from "./db.ts";
import { HttpError } from "./http.ts";

type Identity = {
  authUserId: string | null;
  email: string;
  source: "auth" | "header";
};

export type ParticipantContext = {
  event: Record<string, unknown>;
  identity: Identity;
  participant: Record<string, unknown>;
  eventParticipant: Record<string, unknown>;
  invite: Record<string, unknown> | null;
  canAccessPrivate: boolean;
  serviceClient: ReturnType<typeof getServiceClient>;
};

export async function getCurrentEvent(serviceClient = getServiceClient()) {
  const { eventSlug } = getEnv();
  const { data, error } = await serviceClient
    .from("events")
    .select("*")
    .eq("slug", eventSlug)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "Failed to load current hackathon event.", error);
  }
  if (!data) {
    throw new HttpError(
      500,
      `Event '${eventSlug}' not found. Seed the events table from config/event_template.json first.`,
    );
  }
  return data;
}

export async function resolveIdentity(request: Request): Promise<Identity | null> {
  const { allowHeaderIdentity, requireAuth } = getEnv();
  const emailHeader = request.headers.get("x-hackathon-participant-email");
  if (emailHeader && allowHeaderIdentity) {
    return {
      authUserId: null,
      email: emailHeader.trim().toLowerCase(),
      source: "header",
    };
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    if (requireAuth) {
      return null;
    }
    return null;
  }

  const userClient = getUserClient(authHeader);
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user?.email) {
    throw new HttpError(401, "Supabase auth lookup failed.", error);
  }

  return {
    authUserId: data.user.id,
    email: data.user.email.toLowerCase(),
    source: "auth",
  };
}

export async function getInviteForEmail(
  serviceClient: ReturnType<typeof getServiceClient>,
  eventId: string,
  email: string,
) {
  const inviteResult = await serviceClient
    .from("event_invites")
    .select("*")
    .eq("event_id", eventId)
    .eq("email", email)
    .maybeSingle();

  if (inviteResult.error) {
    throw new HttpError(500, "Failed to look up participant invite.", inviteResult.error);
  }

  return inviteResult.data;
}

export async function requireParticipant(request: Request): Promise<ParticipantContext> {
  const { requireInvite } = getEnv();
  const serviceClient = getServiceClient();
  const event = await getCurrentEvent(serviceClient);
  const identity = await resolveIdentity(request);

  if (!identity) {
    throw new HttpError(
      401,
      "Missing participant identity. Live mode requires Supabase auth. Header-based identity is only allowed when explicitly enabled in backend config.",
    );
  }

  const invite = await getInviteForEmail(serviceClient, String(event.id), identity.email);
  if (requireInvite && !invite) {
    throw new HttpError(403, "This email is not invited for the current event.");
  }

  let participant = null;
  if (identity.authUserId) {
    const byAuth = await serviceClient
      .from("participants")
      .select("*")
      .eq("auth_user_id", identity.authUserId)
      .maybeSingle();
    if (byAuth.error) {
      throw new HttpError(500, "Failed to fetch participant by auth user id.", byAuth.error);
    }
    participant = byAuth.data;
  }

  if (!participant) {
    const byEmail = await serviceClient
      .from("participants")
      .select("*")
      .eq("email", identity.email)
      .maybeSingle();
    if (byEmail.error) {
      throw new HttpError(500, "Failed to fetch participant by email.", byEmail.error);
    }
    participant = byEmail.data;
  }

  if (!participant) {
    throw new HttpError(404, "Participant not registered for the hackathon yet.");
  }

  const eventParticipantResult = await serviceClient
    .from("event_participants")
    .select("*")
    .eq("event_id", event.id)
    .eq("participant_id", participant.id)
    .maybeSingle();

  if (eventParticipantResult.error) {
    throw new HttpError(500, "Failed to fetch event participant record.", eventParticipantResult.error);
  }

  const eventParticipant = eventParticipantResult.data;
  if (!eventParticipant) {
    throw new HttpError(403, "Participant is not registered for the current event.");
  }
  if (["blocked", "revoked"].includes(String(eventParticipant.status || ""))) {
    throw new HttpError(403, "Participant access for this event is blocked.");
  }

  const eventParticipantMetadata =
    eventParticipant.metadata && typeof eventParticipant.metadata === "object"
      ? eventParticipant.metadata as Record<string, unknown>
      : {};

  const canAccessPrivate =
    Boolean(
      invite?.allow_private_tracks ||
      eventParticipantMetadata.allow_private_tracks ||
      participant.role === "admin",
    );

  return {
    event,
    identity,
    participant,
    eventParticipant,
    invite,
    canAccessPrivate,
    serviceClient,
  };
}

export function assertAdmin(email: string) {
  const { adminEmails } = getEnv();
  if (!adminEmails.includes(email.toLowerCase())) {
    throw new HttpError(403, "Admin access required for this endpoint.");
  }
}
