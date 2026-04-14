import { getEnv } from "./env.ts";

export class HttpError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function corsHeaders(extra: HeadersInit = {}): HeadersInit {
  const { allowedOrigin } = getEnv();
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-hackathon-participant-email",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Content-Type": "application/json",
    ...extra,
  };
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: corsHeaders(init.headers),
  });
}

export function noContent(init: ResponseInit = {}): Response {
  return new Response(null, {
    status: 204,
    ...init,
    headers: corsHeaders(init.headers),
  });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch (_error) {
    throw new HttpError(400, "Invalid JSON body.");
  }
}

export async function withHandler(
  request: Request,
  handler: () => Promise<Response>,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }

  try {
    return await handler();
  } catch (error) {
    if (error instanceof HttpError) {
      return json(
        {
          error: error.message,
          details: error.details ?? null,
        },
        { status: error.status },
      );
    }

    return json(
      {
        error: error instanceof Error ? error.message : "Unexpected backend error.",
      },
      { status: 500 },
    );
  }
}
