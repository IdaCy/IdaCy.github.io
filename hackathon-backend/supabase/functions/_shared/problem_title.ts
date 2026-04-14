function asText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(asText).filter(Boolean).join("\n");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return asText(record.text ?? record.input ?? "");
  }
  return "";
}

function textFromRenderPayload(renderPayload: Record<string, unknown>): string {
  return asText(renderPayload.input ?? renderPayload.promptBlocks ?? renderPayload.prompt ?? "");
}

function titleCasePhrase(value: string): string {
  const acronyms = new Set(["api", "cli", "csv", "json", "pr", "ssn", "url", "yaml"]);
  const smallWords = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);
  return value
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (acronyms.has(lower)) {
        return lower.toUpperCase();
      }
      if (index > 0 && smallWords.has(lower)) {
        return lower;
      }
      return word.slice(0, 1).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function compactText(value: string, maxWords = 7): string {
  const cleaned = value
    .replace(/[`*_#>]+/g, "")
    .replace(/^(I('| wi)ll|I propose|Create|Add|Implement|Allow)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[ :;,.]+|[ :;,.]+$/g, "");
  return cleaned.split(/\s+/).filter(Boolean).slice(0, maxWords).join(" ");
}

function extract(pattern: RegExp, text: string): string | null {
  const match = text.match(pattern);
  return match ? match[1].replace(/\s+/g, " ").trim() : null;
}

function inferStegoStrategyTitle(itemKey: string, text: string, action: string): string {
  const bits = itemKey.match(/_n(\d+)_/)?.[1] || "";
  const bitPhrase = bits === "1" ? "1 Bit" : bits ? `${bits} Bits` : "Bits";
  const lower = text.toLowerCase();
  let mechanism = "Strategy";
  if (lower.includes("final sentence") && (lower.includes("therefore") || lower.includes("thus"))) {
    mechanism = "Final Sentence";
  } else if (lower.includes("immediately preceding") || lower.includes("sentence immediately before")) {
    mechanism = "Pre-Final Sentence";
  } else if (lower.includes("first word")) {
    mechanism = "First Word";
  } else if (lower.includes("acrostic")) {
    mechanism = "Acrostic";
  } else if (lower.includes("punctuation")) {
    mechanism = "Punctuation";
  } else if (lower.includes("paragraph")) {
    mechanism = "Paragraph Pattern";
  }
  return `${action} ${bitPhrase}: ${mechanism}`;
}

function inferVibeTopic(itemKey: string): string | null {
  const match =
    itemKey.match(/^PR\d+_([^_]+)_(?:honest|cached_[^_]+_[^_]+)_[^_]+_\d+_(.+)$/) ||
    itemKey.match(/^PR\d+_honest_cache_([^_]+)_\d+_\d+_(.+)$/);
  if (!match) {
    return null;
  }
  return `${titleCasePhrase(match[1])}: ${titleCasePhrase(match[2])}`;
}

function inferSolverReviewTopic(plan: string): string {
  const patterns = [
    /\b(?:for|on)\s+(?:this|the|a|an)?\s*([^,.]+?)\s+task\b/i,
    /\bto\s+(predict|detect|classify)\s+([^,.]+)/i,
    /\bfor\s+([^,.]+?)\s+using\b/i,
  ];
  for (const pattern of patterns) {
    const match = plan.match(pattern);
    if (match) {
      return compactText(match.slice(1).filter(Boolean).join(" "), 5);
    }
  }
  return compactText(plan, 5);
}

function inferFromContent(benchmarkKey: string, itemKey: string, text: string): string {
  if (benchmarkKey === "chess_puzzles") {
    const mate = extract(/This is a mate-in-(\d+) puzzle/i, text);
    const side = extract(/\n\n(White|Black) to move\./i, text);
    if (mate && side) {
      return `${side} Mate in ${mate}`;
    }
  }

  if (benchmarkKey === "test_case_prediction") {
    const fnName = extract(/def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/, text);
    const testCount = extract(/Below are\s+(\d+)\s+test cases?/i, text);
    if (fnName && testCount) {
      return `${fnName} (${testCount} ${testCount === "1" ? "Test" : "Tests"})`;
    }
  }

  if (benchmarkKey === "monitor_training_poisoning") {
    const domain = extract(/Domain:\s*([^\n]+)/i, text);
    return domain ? `${titleCasePhrase(domain)} Poisoning` : "Monitor Training Poisoning";
  }

  if (benchmarkKey === "sally_anne") {
    const question = extract(/QUESTION:\s*(.*?)(?:\n\nOPTIONS:|$)/is, text);
    if (question?.toLowerCase().includes("think")) {
      const thinker = extract(/Where does\s+([A-Za-z]+)\s+think/i, question);
      return thinker ? `${thinker} Belief Tracking` : "Belief Tracking";
    }
    return "Object Location Tracking";
  }

  if (benchmarkKey === "causal_reasoning") {
    const cp = itemKey.match(/^cp(\d+)_/)?.[1] || "?";
    const domain = extract(/^In\s+([^,]+),/i, text);
    return `${domain ? titleCasePhrase(domain) : "Causal"} CP${cp} Diagnosis`;
  }

  if (benchmarkKey === "stego_decode") {
    return inferStegoStrategyTitle(itemKey, text, "Decode");
  }

  if (benchmarkKey === "stego_encode") {
    return inferStegoStrategyTitle(itemKey, text, "Encode");
  }

  if (benchmarkKey === "stego_monitor") {
    const heading = extract(/signs of steganographic encoding:\s*(?:#+\s*)?([^\n]+)/i, text);
    return heading ? `Stego Check: ${compactText(heading, 5)}` : "Math Solution Stego Check";
  }

  if (benchmarkKey === "gsm1k") {
    const sentence = extract(/^(.*?[.?!])(?:\s|$)/s, text) || text;
    return `Word Problem: ${compactText(sentence, 6)}`;
  }

  if (benchmarkKey === "ctrl_alt_deceit_sandbag") {
    const plan = extract(/Plan:\s*(.*?)(?:\n\nCode:|\nCode:|$)/is, text);
    return plan ? `Solver Review: ${inferSolverReviewTopic(plan)}` : "Solver Underperformance Review";
  }

  if (benchmarkKey === "vibe_coding_sabotage") {
    const topic = inferVibeTopic(itemKey);
    if (topic) {
      return `PR Review: ${topic}`;
    }
    const task = extract(/Task:\s*([^\n]+)/i, text);
    return task ? `PR Review: ${compactText(task, 6)}` : "PR Sabotage Review";
  }

  if (benchmarkKey === "shade_monitor_action_only" || benchmarkKey === "shade_monitor_cot_action") {
    return `SHADE: ${titleCasePhrase(itemKey.split("__", 1)[0] || "Monitoring Review")}`;
  }

  return inferFromItemKey(benchmarkKey, itemKey);
}

function inferFromItemKey(benchmarkKey: string, itemKey: string): string {
  if (benchmarkKey === "n_hop_lookup") {
    const hop = itemKey.match(/^hop(\d+)_/)?.[1];
    return hop ? `${hop}-Hop Lookup` : "Lookup Chain";
  }
  if (benchmarkKey === "hash") {
    const fnName = itemKey.match(/^hash_hash_(.*?)__/)?.[1] || "hash";
    const length = itemKey.match(/len(\d+)_/)?.[1];
    const chain = itemKey.match(/chain(\d+)_/)?.[1];
    return [titleCasePhrase(`hash ${fnName}`), length ? `Len ${length}` : "", chain ? `Chain ${chain}` : ""]
      .filter(Boolean)
      .join(" ");
  }
  if (benchmarkKey === "vibe_coding_sabotage") {
    const topic = inferVibeTopic(itemKey);
    return topic ? `PR Review: ${topic}` : "PR Sabotage Review";
  }
  if (benchmarkKey === "shade_monitor_action_only" || benchmarkKey === "shade_monitor_cot_action") {
    return `SHADE: ${titleCasePhrase(itemKey.split("__", 1)[0] || "Monitoring Review")}`;
  }
  if (benchmarkKey === "ctrl_alt_deceit_sandbag") {
    return "Solver Underperformance Review";
  }
  return itemKey;
}

function isRawTitle(title: string, itemKey: string): boolean {
  return !title || title === itemKey || title.includes("__transcripts_") || /^sandbag_\d+$/.test(title);
}

export function displayProblemTitle(
  benchmarkKey: string,
  itemKey: string,
  renderPayload: Record<string, unknown>,
): string {
  const title = String(renderPayload.title || "");
  if (!isRawTitle(title, itemKey)) {
    return title;
  }
  const text = textFromRenderPayload(renderPayload);
  return text ? inferFromContent(benchmarkKey, itemKey, text) : inferFromItemKey(benchmarkKey, itemKey);
}
