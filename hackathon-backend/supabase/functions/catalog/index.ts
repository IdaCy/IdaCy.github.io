import { requireParticipant } from "../_shared/auth.ts";
import { json, HttpError } from "../_shared/http.ts";
import { withRequestPolicy } from "../_shared/policy.ts";

Deno.serve((request) =>
  withRequestPolicy(request, { endpoint: "catalog", limit: 60, windowSeconds: 300 }, async () => {
    if (request.method !== "GET") {
      throw new HttpError(405, "Use GET for catalog.");
    }

    const { event, serviceClient, canAccessPrivate } = await requireParticipant(request);

    const [benchmarksResult, configsResult] = await Promise.all([
      serviceClient.from("benchmarks").select("*").order("title"),
      serviceClient
        .from("event_benchmark_configs")
        .select("*")
        .eq("event_id", event.id),
    ]);

    if (benchmarksResult.error) {
      throw benchmarksResult.error;
    }
    if (configsResult.error) {
      throw configsResult.error;
    }

    const configByBenchmarkId = new Map(
      (configsResult.data || []).map((row) => [row.benchmark_id, row]),
    );

    const payload = (benchmarksResult.data || [])
      .filter((benchmark) => {
        const config = configByBenchmarkId.get(benchmark.id);
        if (!(config ? config.enabled !== false : true)) {
          return false;
        }
        if (benchmark.visibility === "private" && !canAccessPrivate) {
          return false;
        }
        return true;
      })
      .map((benchmark) => {
        const config = configByBenchmarkId.get(benchmark.id);
        return {
          id: benchmark.benchmark_key,
          title: benchmark.title,
          description: benchmark.description,
          domain: benchmark.domain,
          contributor: benchmark.contributor,
          visibility: benchmark.visibility,
          baselineStatus: benchmark.baseline_status,
          itemCount: benchmark.item_count,
          scorer: benchmark.scorer,
          gradingMode: benchmark.grading_mode,
          frontendMode: benchmark.frontend_mode,
          estimatedRange: benchmark.estimated_range,
          realRange: benchmark.real_range,
          totalEstimatedHours: benchmark.total_estimated_hours,
          priority: config?.priority_override || benchmark.priority,
          notes: config?.notes_override || benchmark.notes || "",
        };
      });

    return json(payload);
  })
);
