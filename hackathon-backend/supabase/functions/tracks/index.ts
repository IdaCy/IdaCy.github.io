import { requireParticipant } from "../_shared/auth.ts";
import { HttpError, json } from "../_shared/http.ts";
import { withRequestPolicy } from "../_shared/policy.ts";

Deno.serve((request) =>
  withRequestPolicy(request, { endpoint: "tracks", limit: 60, windowSeconds: 300 }, async () => {
    if (request.method !== "GET") {
      throw new HttpError(405, "Use GET for tracks.");
    }

    const { event, serviceClient, canAccessPrivate } = await requireParticipant(request);

    const { data, error } = await serviceClient
      .from("event_tracks")
      .select("*")
      .eq("event_id", event.id)
      .order("sort_order", { ascending: true });

    if (error) {
      throw error;
    }

    return json(
      (data || [])
        .filter((track) => canAccessPrivate || track.requires_backend !== true)
        .map((track) => ({
          id: track.track_key,
          title: track.title,
          description: track.description,
          requiresBackend: track.requires_backend,
          benchmarkIds: Array.isArray(track.benchmark_keys) ? track.benchmark_keys : [],
        })),
    );
  })
);
