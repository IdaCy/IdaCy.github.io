import {
  buildFrontendAssignment,
  fetchCurrentAssignment,
  loadBenchmarkAndItem,
} from "../_shared/assignment.ts";
import { requireParticipant } from "../_shared/auth.ts";
import { HttpError, json, readJson } from "../_shared/http.ts";
import { withRequestPolicy } from "../_shared/policy.ts";

Deno.serve((request) =>
  withRequestPolicy(request, { endpoint: "claim-assignment", limit: 45, windowSeconds: 300 }, async () => {
    if (request.method !== "POST") {
      throw new HttpError(405, "Use POST for claiming assignments.");
    }

    const { event, participant, serviceClient, canAccessPrivate } = await requireParticipant(request);
    const existing = await fetchCurrentAssignment(serviceClient, String(event.id), String(participant.id));
    if (existing) {
      const { benchmark, item } = await loadBenchmarkAndItem(serviceClient, existing);
      return json(await buildFrontendAssignment({ serviceClient, assignment: existing, benchmark, item }));
    }

    const payload = await readJson(request);
    const trackId = String(payload.trackId || "").trim();
    const preferredBenchmarkKey = String(payload.benchmarkId || "").trim();

    let benchmarkKeys: string[] = [];
    if (trackId) {
      const trackResult = await serviceClient
        .from("event_tracks")
        .select("*")
        .eq("event_id", event.id)
        .eq("track_key", trackId)
        .maybeSingle();

      if (trackResult.error) {
        throw new HttpError(500, "Failed to resolve requested track.", trackResult.error);
      }

      if (trackResult.data?.requires_backend && !canAccessPrivate) {
        throw new HttpError(403, "This participant is not allowed to access private tracks.");
      }

      if (trackResult.data && Array.isArray(trackResult.data.benchmark_keys)) {
        benchmarkKeys = [...trackResult.data.benchmark_keys];
      }
    }

    if (preferredBenchmarkKey) {
      benchmarkKeys = [
        preferredBenchmarkKey,
        ...benchmarkKeys.filter((key) => key !== preferredBenchmarkKey),
      ];
    }

    if (benchmarkKeys.length === 0) {
      const fallbackTracks = await serviceClient
        .from("event_tracks")
        .select("*")
        .eq("event_id", event.id)
        .order("sort_order", { ascending: true })
        .limit(1);

      if (fallbackTracks.error) {
        throw new HttpError(500, "Failed to determine fallback track.", fallbackTracks.error);
      }

      const firstTrack = fallbackTracks.data?.[0];
      benchmarkKeys = Array.isArray(firstTrack?.benchmark_keys) ? firstTrack.benchmark_keys : [];
    }

    const benchmarksResult = await serviceClient
      .from("benchmarks")
      .select("id, benchmark_key, visibility")
      .in("benchmark_key", benchmarkKeys);

    if (benchmarksResult.error) {
      throw new HttpError(500, "Failed to load benchmark ids for the requested track.", benchmarksResult.error);
    }

    const benchmarkIdByKey = new Map(
      (benchmarksResult.data || [])
        .filter((row) => canAccessPrivate || row.visibility !== "private")
        .map((row) => [row.benchmark_key, row.id]),
    );

    const orderedBenchmarkIds = benchmarkKeys
      .map((key) => benchmarkIdByKey.get(key))
      .filter(Boolean);

    const priorSubmissionsResult = await serviceClient
      .from("submissions")
      .select("benchmark_item_id")
      .eq("event_id", event.id)
      .eq("participant_id", participant.id);

    if (priorSubmissionsResult.error) {
      throw new HttpError(500, "Failed to load prior participant submissions.", priorSubmissionsResult.error);
    }

    const completedItemIds = new Set(
      (priorSubmissionsResult.data || []).map((row) => String(row.benchmark_item_id)),
    );

    let selectedAssignment: Record<string, unknown> | null = null;
    for (const benchmarkId of orderedBenchmarkIds) {
      const assignmentResult = await serviceClient
        .from("assignments")
        .select("*")
        .eq("event_id", event.id)
        .eq("benchmark_id", benchmarkId)
        .in("status", ["queued", "released"])
        .is("participant_id", null)
        .order("created_at", { ascending: true })
        .limit(50);

      if (assignmentResult.error) {
        throw new HttpError(500, "Failed to look up an available assignment.", assignmentResult.error);
      }

      selectedAssignment = (assignmentResult.data || []).find(
        (row) => !completedItemIds.has(String(row.benchmark_item_id)),
      ) || null;

      if (selectedAssignment) {
        break;
      }
    }

    if (!selectedAssignment) {
      return json(null);
    }

    const claimResult = await serviceClient
      .from("assignments")
      .update({
        participant_id: String(participant.id),
        status: "claimed",
        claimed_at: new Date().toISOString(),
        released_at: null,
      })
      .eq("id", selectedAssignment.id)
      .in("status", ["queued", "released"])
      .is("participant_id", null)
      .select("*")
      .maybeSingle();

    if (claimResult.error) {
      throw new HttpError(500, "Failed to claim assignment.", claimResult.error);
    }
    if (!claimResult.data) {
      return json(null);
    }

    const { benchmark, item } = await loadBenchmarkAndItem(serviceClient, claimResult.data);
    return json(
      await buildFrontendAssignment({
        serviceClient,
        assignment: claimResult.data,
        benchmark,
        item,
        trackIds: trackId ? [trackId] : [],
      }),
    );
  })
);
