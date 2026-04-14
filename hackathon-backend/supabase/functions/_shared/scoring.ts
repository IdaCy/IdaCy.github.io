function parseIntegerLike(value: string): string | null {
  const matches = value.match(/\d+/g);
  return matches ? matches[matches.length - 1] : null;
}

function normalizePfList(value: string): string {
  return value
    .toUpperCase()
    .split(/[\s,]+/)
    .filter(Boolean)
    .join(",");
}

function normalizeScalar(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeBitString(value: string): string {
  return value
    .replace(/[,\s]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .join(" ");
}

function normalizeMove(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function normalizeMcqChoice(value: string): string {
  const trimmed = value.trim();
  const explicit = trimmed.match(/\b(?:option|choice|answer)?\s*([A-Z]|\d+)\b/i);
  return (explicit ? explicit[1] : trimmed).toUpperCase();
}

export function scoreSubmission({
  scorer,
  gradingMode,
  answerKey,
  rawAnswer,
}: {
  scorer: string;
  gradingMode: string;
  answerKey: Record<string, unknown>;
  rawAnswer: string;
}) {
  const answer = normalizeScalar(rawAnswer);
  const expected = normalizeScalar(answerKey.expected);

  if (gradingMode === "async_llm") {
    return {
      gradingStatus: "pending_llm",
      scoreValue: null,
      explanation: "Queued for fixed grader-model review.",
    };
  }

  if (gradingMode === "execution_like" || gradingMode === "agentic_external_env") {
    return {
      gradingStatus: "pending_manual",
      scoreValue: null,
      explanation: "Requires external or execution-style grading.",
    };
  }

  if (gradingMode === "score_only" || scorer === "suspicion_threshold") {
    const numeric = Number(answer);
    return {
      gradingStatus: "recorded_score",
      scoreValue: Number.isFinite(numeric) ? numeric : null,
      explanation: "Raw human review score recorded.",
    };
  }

  if (scorer === "integer_match") {
    const extracted = parseIntegerLike(answer);
    const isCorrect = extracted === expected;
    return {
      gradingStatus: isCorrect ? "correct" : "incorrect",
      scoreValue: isCorrect ? 1 : 0,
      explanation: `Parsed integer ${extracted ?? "none"}, expected ${expected}.`,
    };
  }

  if (scorer === "pf_list_match") {
    const isCorrect = normalizePfList(answer) === normalizePfList(expected);
    return {
      gradingStatus: isCorrect ? "correct" : "incorrect",
      scoreValue: isCorrect ? 1 : 0,
      explanation: `Expected ${expected}.`,
    };
  }

  if (scorer === "letter_match" || scorer === "mcq_choice") {
    const isCorrect = normalizeMcqChoice(answer) === normalizeMcqChoice(expected);
    return {
      gradingStatus: isCorrect ? "correct" : "incorrect",
      scoreValue: isCorrect ? 1 : 0,
      explanation: `Expected ${expected}.`,
    };
  }

  if (scorer === "bit_accuracy") {
    const isCorrect = normalizeBitString(answer) === normalizeBitString(expected);
    return {
      gradingStatus: isCorrect ? "correct" : "incorrect",
      scoreValue: isCorrect ? 1 : 0,
      explanation: `Expected ${expected}.`,
    };
  }

  if (scorer === "chess_move_scorer") {
    const isCorrect = normalizeMove(answer) === normalizeMove(expected);
    return {
      gradingStatus: isCorrect ? "correct" : "incorrect",
      scoreValue: isCorrect ? 1 : 0,
      explanation: `Expected ${expected}.`,
    };
  }

  if (scorer === "causal_compound_match") {
    const isCorrect = answer.toLowerCase() === expected.toLowerCase();
    return {
      gradingStatus: isCorrect ? "correct" : "incorrect",
      scoreValue: isCorrect ? 1 : 0,
      explanation: `Expected ${expected}.`,
    };
  }

  const numericAnswer = Number(answer);
  const numericExpected = Number(expected);
  if (Number.isFinite(numericAnswer) && Number.isFinite(numericExpected)) {
    const tolerance = Number(answerKey.tolerance ?? 0.011);
    const isCorrect = Math.abs(numericAnswer - numericExpected) <= tolerance;
    return {
      gradingStatus: isCorrect ? "correct" : "incorrect",
      scoreValue: isCorrect ? 1 : 0,
      explanation: `Expected about ${numericExpected}.`,
    };
  }

  const isCorrect = answer.toLowerCase() === expected.toLowerCase();
  return {
    gradingStatus: isCorrect ? "correct" : "incorrect",
    scoreValue: isCorrect ? 1 : 0,
    explanation: `Expected ${expected}.`,
  };
}
