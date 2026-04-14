import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getEnv } from "./env.ts";
import { HttpError } from "./http.ts";
import { displayProblemTitle } from "./problem_title.ts";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function toNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function getRangeMedian(range: unknown): number | null {
  const record = asObject(range);
  const median = toNumber(record.median);
  if (median != null) {
    return median;
  }
  const min = toNumber(record.min);
  const max = toNumber(record.max);
  if (min != null && max != null) {
    return (min + max) / 2;
  }
  return null;
}

async function signStoragePath(
  serviceClient: SupabaseClient,
  storagePath: string,
) {
  const { storageBucket } = getEnv();
  const result = await serviceClient.storage
    .from(storageBucket)
    .createSignedUrl(storagePath, 60 * 60);

  if (result.error) {
    throw new HttpError(500, `Failed to sign asset '${storagePath}'.`, result.error);
  }

  return result.data.signedUrl;
}

async function signImageEntries(
  serviceClient: SupabaseClient,
  renderPayload: Record<string, unknown>,
) {
  const imageEntries = asArray<unknown>(renderPayload.images);
  const signedImages = [];

  for (const entry of imageEntries) {
    if (typeof entry === "string") {
      signedImages.push({ src: entry, alt: "" });
      continue;
    }

    const record = asObject(entry);
    const storagePath = String(record.storagePath || record.path || "").trim();
    const src = storagePath
      ? await signStoragePath(serviceClient, storagePath)
      : String(record.url || record.src || "").trim();

    if (!src) {
      continue;
    }

    signedImages.push({
      src,
      alt: String(record.alt || ""),
      caption: String(record.caption || ""),
    });
  }

  return signedImages;
}

async function normalizePromptBlocks(
  serviceClient: SupabaseClient,
  renderPayload: Record<string, unknown>,
) {
  const promptBlocks = asArray<unknown>(renderPayload.promptBlocks);
  const inputBlocks = asArray<unknown>(renderPayload.input);
  const sourceBlocks = promptBlocks.length > 0
    ? promptBlocks
    : inputBlocks.length > 0
    ? inputBlocks
    : [{
      type: "text",
      text: String(
        renderPayload.input ??
          renderPayload.prompt ??
          "Placeholder task payload missing. Populate benchmark_items.render_payload.",
      ),
    }];

  const normalizedBlocks = [];
  for (const block of sourceBlocks) {
    if (typeof block === "string") {
      normalizedBlocks.push({ type: "text", text: block });
      continue;
    }

    const record = asObject(block);
    const type = String(record.type || "text");
    if (type === "image" || record.storagePath || record.path || record.src || record.url) {
      const storagePath = String(record.storagePath || record.path || "").trim();
      const src = storagePath
        ? await signStoragePath(serviceClient, storagePath)
        : String(record.src || record.url || "").trim();
      if (!src) {
        continue;
      }
      normalizedBlocks.push({
        type: "image",
        src,
        alt: String(record.alt || record.alt_text || ""),
        caption: String(record.caption || record.description || ""),
      });
      continue;
    }

    normalizedBlocks.push({
      type,
      text: String(record.text || record.input || ""),
    });
  }

  const signedImages = await signImageEntries(serviceClient, renderPayload);
  for (const image of signedImages) {
    normalizedBlocks.push({
      type: "image",
      src: image.src,
      alt: image.alt,
      caption: image.caption,
    });
  }
  return normalizedBlocks;
}

function normalizeAnswerSpec(
  renderPayload: Record<string, unknown>,
  benchmark: Record<string, unknown>,
) {
  const answerSpec = asObject(renderPayload.answerSpec);
  if (Object.keys(answerSpec).length > 0) {
    return answerSpec;
  }

  const scorer = String(benchmark.scorer || "");
  const gradingMode = String(benchmark.grading_mode || "");
  const options = asArray<unknown>(renderPayload.options);

  if (options.length > 0) {
    return {
      type: "single_choice",
      instruction: "Choose one option.",
      options: options.map((option, index) => {
        if (typeof option === "string") {
          return { key: String(index + 1), label: option };
        }
        const record = asObject(option);
        return {
          key: String(record.key ?? index + 1),
          label: String(record.label ?? record.text ?? `Option ${index + 1}`),
        };
      }),
    };
  }

  if (gradingMode === "score_only" || scorer === "suspicion_threshold") {
    return {
      type: "range",
      instruction: "Enter a suspicion score from 0 to 100.",
      min: 0,
      max: 100,
      placeholder: "75",
    };
  }

  if (scorer === "integer_match") {
    return {
      type: "freeform",
      instruction: "Enter the final integer only.",
      placeholder: "17",
    };
  }

  if (scorer === "letter_match") {
    return {
      type: "freeform",
      instruction: "Enter the single letter only.",
      placeholder: "A",
    };
  }

  if (scorer === "pf_list_match") {
    return {
      type: "freeform",
      instruction: "Respond with comma-separated P or F predictions.",
      placeholder: "P,F,P",
    };
  }

  if (scorer === "mcq_choice") {
    return {
      type: "freeform",
      instruction: "Enter the selected option.",
      placeholder: "3",
    };
  }

  if (scorer === "stego_detection") {
    return {
      type: "single_choice",
      instruction: "Choose whether the message contains hidden encoding.",
      options: [
        { key: "0", label: "0 - no hidden encoding" },
        { key: "1", label: "1 - hidden encoding" },
      ],
    };
  }

  if (scorer === "bit_accuracy") {
    return {
      type: "freeform",
      instruction: "Enter the decoded bit string.",
      placeholder: "0 1 0",
    };
  }

  if (scorer === "chess_move_scorer") {
    return {
      type: "freeform",
      instruction: "Enter the move in coordinate notation.",
      placeholder: "e2e4",
    };
  }

  return {
    type: "freeform",
    instruction: "Enter your answer.",
    placeholder: "Type your answer here",
  };
}

export async function loadBenchmarkAndItem(
  serviceClient: SupabaseClient,
  assignment: Record<string, unknown>,
) {
  const benchmarkId = String(assignment.benchmark_id);
  const itemId = String(assignment.benchmark_item_id);

  const [benchmarkResult, itemResult] = await Promise.all([
    serviceClient.from("benchmarks").select("*").eq("id", benchmarkId).single(),
    serviceClient.from("benchmark_items").select("*").eq("id", itemId).single(),
  ]);

  if (benchmarkResult.error) {
    throw new HttpError(500, "Failed to load benchmark for assignment.", benchmarkResult.error);
  }
  if (itemResult.error) {
    throw new HttpError(500, "Failed to load benchmark item for assignment.", itemResult.error);
  }

  return {
    benchmark: benchmarkResult.data,
    item: itemResult.data,
  };
}

export async function fetchCurrentAssignment(
  serviceClient: SupabaseClient,
  eventId: string,
  participantId: string,
) {
  const { data, error } = await serviceClient
    .from("assignments")
    .select("*")
    .eq("event_id", eventId)
    .eq("participant_id", participantId)
    .eq("status", "claimed")
    .order("claimed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "Failed to load active assignment.", error);
  }

  return data;
}

export async function buildFrontendAssignment({
  serviceClient,
  assignment,
  benchmark,
  item,
  trackIds = [],
}: {
  serviceClient: SupabaseClient;
  assignment: Record<string, unknown>;
  benchmark: Record<string, unknown>;
  item: Record<string, unknown>;
  trackIds?: string[];
}) {
  const renderPayload = asObject(item.render_payload);
  const answerKey = asObject(item.answer_key);
  const estimatedMinutes =
    toNumber(asObject(item.metadata).estimated_minutes) ??
    getRangeMedian(asObject(item.metadata).estimated_time) ??
    getRangeMedian(benchmark.estimated_range) ??
    1.0;

  const itemVisibility = String(item.visibility || benchmark.visibility || "public");
  const title = displayProblemTitle(
    String(benchmark.benchmark_key),
    String(item.item_key),
    renderPayload,
  );

  return {
    id: String(assignment.id),
    benchmarkId: String(benchmark.benchmark_key),
    itemId: String(item.item_key),
    title,
    visibility: itemVisibility,
    availability: "api",
    estimatedMinutes: Number(estimatedMinutes.toFixed(2)),
    trackIds,
    promptBlocks: await normalizePromptBlocks(serviceClient, renderPayload),
    answerSpec: normalizeAnswerSpec(renderPayload, benchmark),
    grading: {
      mode: String(benchmark.grading_mode || "pending_manual"),
      expected: answerKey.expected ?? renderPayload.target ?? null,
      hiddenLabel: answerKey.hiddenLabel ?? null,
      referenceThreshold: answerKey.referenceThreshold ?? null,
    },
  };
}
