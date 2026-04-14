import { getCurrentEvent } from "./auth.ts";
import { getServiceClient } from "./db.ts";
import { getEnv } from "./env.ts";
import { HttpError, corsHeaders, json } from "./http.ts";

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip") || "unknown";
}

function getIdentityHint(request: Request): { identityHint: string | null; authSource: string } {
  const headerIdentity = request.headers.get("x-hackathon-participant-email");
  if (headerIdentity) {
    return {
      identityHint: headerIdentity.trim().toLowerCase(),
      authSource: "header",
    };
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    return {
      identityHint: `bearer:${authHeader.slice(0, 18)}`,
      authSource: "bearer",
    };
  }

  return {
    identityHint: null,
    authSource: "anonymous",
  };
}

function floorWindow(now: Date, windowSeconds: number): string {
  const windowMs = windowSeconds * 1000;
  const floored = Math.floor(now.getTime() / windowMs) * windowMs;
  return new Date(floored).toISOString();
}

async function enforceRateLimit(
  request: Request,
  endpoint: string,
  limit: number,
  windowSeconds: number,
) {
  const serviceClient = getServiceClient();
  const ipAddress = getClientIp(request);
  const { identityHint, authSource } = getIdentityHint(request);
  const key = identityHint || `ip:${ipAddress}`;
  const windowStart = floorWindow(new Date(), windowSeconds);

  const result = await serviceClient.rpc("bump_rate_limit", {
    p_scope: endpoint,
    p_key: key,
    p_window_start: windowStart,
    p_limit: limit,
    p_metadata: {
      ip_address: ipAddress,
      auth_source: authSource,
    },
  });

  if (result.error) {
    throw new HttpError(500, "Failed to evaluate rate limit.", result.error);
  }

  const row = result.data?.[0];
  if (!row?.allowed) {
    throw new HttpError(
      429,
      `Rate limit exceeded for ${endpoint}. Try again shortly.`,
      {
        endpoint,
        limit,
        windowSeconds,
        requestCount: row?.request_count ?? null,
      },
    );
  }

  return {
    serviceClient,
    ipAddress,
    identityHint,
    authSource,
  };
}

async function safeAuditLog({
  serviceClient,
  request,
  endpoint,
  status,
  identityHint,
  authSource,
  metadata,
}: {
  serviceClient: ReturnType<typeof getServiceClient>;
  request: Request;
  endpoint: string;
  status: number;
  identityHint: string | null;
  authSource: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    const event = await getCurrentEvent(serviceClient);
    await serviceClient.from("api_request_logs").insert({
      event_id: event.id,
      endpoint,
      method: request.method,
      status,
      ip_address: getClientIp(request),
      identity_hint: identityHint,
      auth_source: authSource,
      metadata: {
        user_agent: request.headers.get("user-agent"),
        ...metadata,
      },
    });
  } catch (_error) {
    // Keep request handling non-blocking if audit logging fails.
  }
}

export async function withRequestPolicy(
  request: Request,
  {
    endpoint,
    limit = 120,
    windowSeconds = 300,
  }: {
    endpoint: string;
    limit?: number;
    windowSeconds?: number;
  },
  handler: () => Promise<Response>,
) {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }

  const { serviceClient, identityHint, authSource } = await enforceRateLimit(
    request,
    endpoint,
    limit,
    windowSeconds,
  );

  let response: Response;
  try {
    response = await handler();
  } catch (error) {
    if (error instanceof HttpError) {
      response = json(
        {
          error: error.message,
          details: error.details ?? null,
        },
        { status: error.status },
      );
    } else {
      response = json(
        {
          error: error instanceof Error ? error.message : "Unexpected backend error.",
        },
        { status: 500 },
      );
    }
  }

  await safeAuditLog({
    serviceClient,
    request,
    endpoint,
    status: response.status,
    identityHint,
    authSource,
  });

  return response;
}
