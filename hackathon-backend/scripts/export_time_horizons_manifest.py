#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCORER_DEFAULTS = {
    "integer_match": {"grading_mode": "instant_exact", "frontend_mode": "direct"},
    "letter_match": {"grading_mode": "instant_exact", "frontend_mode": "direct"},
    "causal_compound_match": {"grading_mode": "instant_exact", "frontend_mode": "direct"},
    "pf_list_match": {"grading_mode": "instant_exact", "frontend_mode": "direct"},
    "stego_detection": {"grading_mode": "instant_exact", "frontend_mode": "direct"},
    "mcq_choice": {"grading_mode": "instant_exact", "frontend_mode": "direct"},
    "bit_accuracy": {"grading_mode": "instant_exact", "frontend_mode": "direct"},
    "scheming_benchmark": {"grading_mode": "instant_exact", "frontend_mode": "direct"},
    "chess_move_scorer": {"grading_mode": "instant_exact", "frontend_mode": "direct"},
    "answer_key_model_graded": {"grading_mode": "async_llm", "frontend_mode": "direct"},
    "model_graded_qa": {"grading_mode": "async_llm", "frontend_mode": "direct"},
    "suspicion_threshold": {"grading_mode": "score_only", "frontend_mode": "direct"},
    "encoding_execution": {"grading_mode": "execution_like", "frontend_mode": "backend_worker"},
    "strategy_execution": {"grading_mode": "execution_like", "frontend_mode": "backend_worker"},
    "codeforces_exec": {"grading_mode": "execution_like", "frontend_mode": "backend_worker"},
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export a normalized manifest from one or more time-horizons task_data trees."
    )
    parser.add_argument(
        "--source",
        action="append",
        required=True,
        help="Path to a task_data directory or a parent directory that contains task folders.",
    )
    parser.add_argument(
        "--overrides",
        help="Optional JSON file keyed by benchmark id for manual overrides.",
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Destination JSON file for the normalized manifest.",
    )
    parser.add_argument(
        "--include-items",
        action="store_true",
        help="Include normalized benchmark items in the output.",
    )
    parser.add_argument(
        "--problem-config",
        help=(
            "Optional configs/hackathon_problems.json file. When provided, only those "
            "benchmarks and listed problem ids are exported, preserving the config order."
        ),
    )
    return parser.parse_args()


def load_json(path: Path) -> Any:
    return json.loads(path.read_text())


def maybe_load_json(path: Path) -> Any | None:
    if path.exists():
      return load_json(path)
    return None


def detect_task_dirs(source: Path) -> list[Path]:
    if (source / "meta.json").exists() and (source / "dataset.json").exists():
        return [source]

    direct_children = [
        child
        for child in source.iterdir()
        if child.is_dir() and (child / "meta.json").exists() and (child / "dataset.json").exists()
    ]
    return sorted(direct_children)


def choose_time_files(task_dir: Path) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    estimated = maybe_load_json(task_dir / "time_horizons_estimated.json")
    real = maybe_load_json(task_dir / "time_horizons_real.json")

    if real is None:
        combined = maybe_load_json(task_dir / "time_horizons.json")
        if combined is not None:
            if estimated is None:
                estimated = combined
            else:
                real = combined

    return estimated, real


def summarize_item_times(time_map: dict[str, Any] | None) -> dict[str, Any] | None:
    if not time_map:
        return None

    medians: list[float] = []
    lowers: list[float] = []
    uppers: list[float] = []

    for value in time_map.values():
        if isinstance(value, dict):
            if isinstance(value.get("median"), (int, float)):
                medians.append(float(value["median"]))
            if isinstance(value.get("lower"), (int, float)):
                lowers.append(float(value["lower"]))
            if isinstance(value.get("upper"), (int, float)):
                uppers.append(float(value["upper"]))
        elif isinstance(value, (int, float)):
            medians.append(float(value))

    if not medians and not lowers and not uppers:
        return None

    lower = min(lowers or medians)
    median = sum(medians) / len(medians) if medians else None
    upper = max(uppers or medians)

    summary = {
        "min": round(lower, 6),
        "max": round(upper, 6),
        "unit": "minutes",
    }
    if median is not None:
        summary["median"] = round(median, 6)
        summary["total_hours_from_medians"] = round(sum(medians) / 60.0, 6)
    return summary


def infer_priority(item_count: int, visibility: str, grading_mode: str) -> str:
    if visibility == "private":
        return "launch"
    if grading_mode == "agentic_external_env":
        return "special_case"
    if item_count <= 200:
        return "launch"
    if item_count <= 2000:
        return "sample_first"
    return "follow_up"


def normalize_answer_key(item: dict[str, Any], scorer_type: str, grading_mode: str) -> dict[str, Any]:
    target = item.get("target")
    key: dict[str, Any] = {"expected": target}

    if scorer_type == "suspicion_threshold":
        key["hiddenLabel"] = item.get("label")
        key["referenceThreshold"] = item.get("reference_threshold")

    if grading_mode in {"async_llm", "execution_like", "agentic_external_env"}:
        key["expected"] = target

    return key


def title_case_phrase(value: str) -> str:
    acronym_words = {"api", "cli", "csv", "json", "pr", "ssn", "url", "yaml"}
    words = re.sub(r"[_-]+", " ", value).split()
    small_words = {"a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"}
    titled: list[str] = []
    for index, word in enumerate(words):
        lower = word.lower()
        if lower in acronym_words:
            titled.append(lower.upper())
        elif index > 0 and lower in small_words:
            titled.append(lower)
        else:
            titled.append(word[:1].upper() + word[1:])
    return " ".join(titled)


def compact_text(value: str, max_words: int = 7) -> str:
    cleaned = re.sub(r"[`*_#>]+", "", value)
    cleaned = re.sub(r"^(I('| wi)ll|I propose|Create|Add|Implement|Allow)\s+", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" :;,.")
    words = cleaned.split()
    return " ".join(words[:max_words])


def extract_regex(pattern: str, text: str) -> str | None:
    match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE | re.DOTALL)
    if not match:
        return None
    return re.sub(r"\s+", " ", match.group(1)).strip()


def extract_question(text: str) -> str | None:
    question = extract_regex(r"QUESTION:\s*(.*?)(?:\n\nOPTIONS:|\Z)", text)
    return question.strip() if question else None


def infer_stego_strategy_title(item_key: str, text: str, action: str) -> str:
    bit_match = re.search(r"_n(\d+)_", item_key)
    bits = bit_match.group(1) if bit_match else None
    bit_phrase = f"{bits} Bit" if bits == "1" else f"{bits} Bits" if bits else "Bits"

    lower = text.lower()
    if "final sentence" in lower and ("therefore" in lower or "thus" in lower):
        mechanism = "Final Sentence"
    elif "immediately preceding" in lower or "sentence immediately before" in lower:
        mechanism = "Pre-Final Sentence"
    elif "first word" in lower:
        mechanism = "First Word"
    elif "acrostic" in lower:
        mechanism = "Acrostic"
    elif "punctuation" in lower:
        mechanism = "Punctuation"
    elif "paragraph" in lower:
        mechanism = "Paragraph Pattern"
    else:
        mechanism = "Strategy"
    return f"{action} {bit_phrase}: {mechanism}"


def infer_shade_task_title(item_key: str, text: str) -> str:
    prefix = item_key.split("__", 1)[0]
    if prefix:
        return f"SHADE: {title_case_phrase(prefix)}"

    user = extract_regex(r"USER:\s*(.*?)(?:\n|$)", text)
    if user:
        return f"SHADE: {compact_text(user, 5)}"
    return "SHADE Monitoring Review"


def infer_vibe_topic(item_key: str) -> str | None:
    match = re.match(r"^PR\d+_([^_]+)_(?:honest|cached_[^_]+_[^_]+)_[^_]+_\d+_(.+)$", item_key)
    if not match:
        match = re.match(r"^PR\d+_honest_cache_([^_]+)_\d+_\d+_(.+)$", item_key)
    if not match:
        return None
    app, feature = match.groups()
    return f"{title_case_phrase(app)}: {title_case_phrase(feature)}"


def infer_solver_review_topic(plan: str) -> str:
    for pattern in [
        r"\b(?:for|on)\s+(?:this|the|a|an)?\s*([^,.]+?)\s+task\b",
        r"\bto\s+(predict|detect|classify)\s+([^,.]+)",
        r"\bfor\s+([^,.]+?)\s+using\b",
    ]:
        match = re.search(pattern, plan, re.IGNORECASE)
        if match:
            phrase = " ".join(part for part in match.groups() if part)
            return compact_text(phrase, 5)
    return compact_text(plan, 5)


def infer_problem_title(item: dict[str, Any], benchmark_key: str) -> str:
    item_key = str(item.get("id") or item.get("instance_id") or item.get("item_id"))
    text = str(item.get("input") or "")

    if benchmark_key == "chess_puzzles":
        mate = extract_regex(r"This is a mate-in-(\d+) puzzle", text)
        side = extract_regex(r"\n\n(White|Black) to move\.", text)
        if mate and side:
            return f"{side} Mate in {mate}"
        if mate:
            return f"Mate in {mate}"

    if benchmark_key == "test_case_prediction":
        fn_name = extract_regex(r"def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(", text)
        test_count = extract_regex(r"Below are\s+(\d+)\s+test cases?", text)
        if fn_name and test_count:
            suffix = "Test" if test_count == "1" else "Tests"
            return f"{fn_name} ({test_count} {suffix})"
        if fn_name:
            return f"{fn_name} Test Prediction"

    if benchmark_key in {"strategic_scheming_numeric", "strategic_scheming_open_ended"}:
        first_sentence = extract_regex(r"^(.*?[.?!])(?:\s|$)", text) or text
        lower = first_sentence.lower()
        if "probability" in lower or "chance" in lower or "%" in lower:
            topic = "Probability"
        elif "monitor" in lower or "filter" in lower:
            topic = "Monitor Blind Spot"
        elif "token" in lower or "resource" in lower:
            topic = "Resource Tradeoff"
        elif "act" in lower or "attempt" in lower or "strike" in lower:
            topic = "Timing Choice"
        else:
            topic = "Strategic Choice"
        return f"{topic}: {compact_text(first_sentence, 6)}"

    if benchmark_key == "monitor_training_poisoning":
        domain = extract_regex(r"Domain:\s*([^\n]+)", text)
        if domain:
            return f"{title_case_phrase(domain)} Poisoning"
        family = item_key.split("_", 2)[1] if "_" in item_key else "monitor"
        return f"{title_case_phrase(family)} Poisoning"

    if benchmark_key == "sally_anne":
        question = extract_question(text)
        if question and "think" in question.lower():
            thinker = extract_regex(r"Where does\s+([A-Za-z]+)\s+think", question)
            return f"{thinker} Belief Tracking" if thinker else "Belief Tracking"
        return "Object Location Tracking"

    if benchmark_key == "n_hop_lookup":
        hop = extract_regex(r"^hop(\d+)_", item_key)
        chain = extract_regex(r"follow the chain:\s*(.*?)\.\s*What is", text)
        if hop and chain:
            return f"{hop}-Hop Lookup: {chain.replace(' -> ', ' to ')}"
        if hop:
            return f"{hop}-Hop Lookup"

    if benchmark_key == "causal_reasoning":
        cp = extract_regex(r"^cp(\d+)_", item_key)
        domain = extract_regex(r"^In\s+([^,]+),", text)
        domain_title = title_case_phrase(domain) if domain else "Causal"
        return f"{domain_title} CP{cp or '?'} Diagnosis"

    if benchmark_key == "stego_decode":
        return infer_stego_strategy_title(item_key, text, "Decode")

    if benchmark_key == "stego_encode":
        return infer_stego_strategy_title(item_key, text, "Encode")

    if benchmark_key == "stego_monitor":
        heading = extract_regex(r"signs of steganographic encoding:\s*(?:#+\s*)?([^\n]+)", text)
        return f"Stego Check: {compact_text(heading, 5)}" if heading else "Math Solution Stego Check"

    if benchmark_key == "gsm1k":
        first_sentence = extract_regex(r"^(.*?[.?!])(?:\s|$)", text) or text
        return f"Word Problem: {compact_text(first_sentence, 6)}"

    if benchmark_key == "hash":
        fn_name = extract_regex(r"def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(", text)
        chain = extract_regex(r"chain(\d+)_", item_key)
        length = extract_regex(r"len(\d+)_", item_key)
        parts = [title_case_phrase(fn_name or "hash")]
        if length:
            parts.append(f"Len {length}")
        if chain:
            parts.append(f"Chain {chain}")
        return " ".join(parts)

    if benchmark_key == "ctrl_alt_deceit_sandbag":
        plan = extract_regex(r"Plan:\s*(.*?)(?:\n\nCode:|\nCode:|\Z)", text)
        if plan:
            return f"Solver Review: {infer_solver_review_topic(plan)}"
        return "Solver Underperformance Review"

    if benchmark_key == "vibe_coding_sabotage":
        topic = infer_vibe_topic(item_key)
        if topic:
            return f"PR Review: {topic}"
        task = extract_regex(r"Task:\s*([^\n]+)", text)
        if task:
            return f"PR Review: {compact_text(task, 6)}"
        return "PR Sabotage Review"

    if benchmark_key in {"shade_monitor_action_only", "shade_monitor_cot_action"}:
        return infer_shade_task_title(item_key, text)

    return item_key


def normalize_item(
    item: dict[str, Any],
    benchmark_key: str,
    scorer_type: str,
    grading_mode: str,
    time_map: dict[str, Any] | None,
    visibility: str,
) -> dict[str, Any]:
    item_key = str(item.get("id") or item.get("instance_id") or item.get("item_id"))
    timing = time_map.get(item_key) if isinstance(time_map, dict) else None
    if timing is None and isinstance(item.get("estimated_time_minutes"), (int, float)):
        timing = {
            "median": item["estimated_time_minutes"],
            "lower": item["estimated_time_minutes"],
            "upper": item["estimated_time_minutes"],
        }

    render_payload = {
        "title": infer_problem_title(item, benchmark_key),
        "input": item.get("input"),
        "metadata": item.get("metadata", {}),
    }
    if "options" in item:
        render_payload["options"] = item["options"]
    if "images" in item:
        render_payload["images"] = item["images"]

    return {
        "benchmark_key": benchmark_key,
        "item_key": item_key,
        "visibility": visibility,
        "render_payload": render_payload,
        "answer_key": normalize_answer_key(item, scorer_type, grading_mode),
        "metadata": {
            "source_id": item.get("id"),
            "source_metadata": item.get("metadata", {}),
            "inferred_title": render_payload["title"],
            "estimated_time": timing,
            "estimated_minutes": item.get("estimated_time_minutes"),
        },
    }


def summarize_problem_config_times(items: list[dict[str, Any]]) -> dict[str, Any] | None:
    medians = [
        float(item["estimated_time_minutes"])
        for item in items
        if isinstance(item.get("estimated_time_minutes"), (int, float))
    ]
    if not medians:
        return None
    return {
        "min": round(min(medians), 6),
        "max": round(max(medians), 6),
        "median": round(sum(medians) / len(medians), 6),
        "unit": "minutes",
        "total_hours_from_medians": round(sum(medians) / 60.0, 6),
    }


def normalize_task(
    task_dir: Path,
    overrides: dict[str, Any],
    include_items: bool,
    problem_items: list[dict[str, Any]] | None = None,
    benchmark_key_override: str | None = None,
) -> dict[str, Any]:
    meta = load_json(task_dir / "meta.json")
    dataset = problem_items if problem_items is not None else load_json(task_dir / "dataset.json")
    estimated_map, real_map = choose_time_files(task_dir)

    benchmark_key = benchmark_key_override or meta["name"]
    override = overrides.get(benchmark_key, {})
    scorer_type = meta.get("scorer", {}).get("type", "unknown")
    defaults = SCORER_DEFAULTS.get(
        scorer_type,
        {"grading_mode": "instant_exact", "frontend_mode": "direct"},
    )

    visibility = override.get(
        "visibility",
        "private" if meta.get("private") else "public",
    )
    grading_mode = override.get("grading_mode", defaults["grading_mode"])
    frontend_mode = override.get("frontend_mode", defaults["frontend_mode"])
    estimated_summary = (
        summarize_problem_config_times(dataset)
        if problem_items is not None
        else summarize_item_times(estimated_map)
    )
    real_summary = summarize_item_times(real_map)

    meta_range = meta.get("time_horizons_range")
    if estimated_summary is None and isinstance(meta_range, dict):
        if "estimated" in meta_range:
            estimated_summary = {
                "min": meta_range["estimated"].get("min"),
                "max": meta_range["estimated"].get("max"),
                "unit": meta_range.get("unit", "minutes"),
            }
        elif "min" in meta_range and "max" in meta_range:
            estimated_summary = {
                "min": meta_range.get("min"),
                "max": meta_range.get("max"),
                "unit": meta_range.get("unit", "minutes"),
            }

    if real_summary is None and isinstance(meta_range, dict) and "estimated" not in meta_range:
        if "min" in meta_range and "max" in meta_range:
            real_summary = {
                "min": meta_range.get("min"),
                "max": meta_range.get("max"),
                "unit": meta_range.get("unit", "minutes"),
            }

    benchmark = {
        "benchmark_key": benchmark_key,
        "title": override.get("title", benchmark_key.replace("_", " ").title()),
        "description": override.get("description", meta.get("description", "")),
        "domain": override.get("domain", meta.get("domain", "unknown")),
        "contributor": override.get("contributor", meta.get("contributor", "unknown")),
        "visibility": visibility,
        "baseline_status": "has_real" if real_map else "estimated_only",
        "item_count": len(dataset),
        "scorer": scorer_type,
        "grading_mode": grading_mode,
        "frontend_mode": frontend_mode,
        "estimated_range": estimated_summary,
        "real_range": real_summary,
        "total_estimated_hours": (
            estimated_summary.get("total_hours_from_medians")
            if isinstance(estimated_summary, dict)
            else None
        ),
        "priority": override.get(
            "priority",
            infer_priority(len(dataset), visibility, grading_mode),
        ),
        "notes": override.get("notes", ""),
        "metadata": {
            "source_path": str(task_dir),
            "version": meta.get("version"),
            "solver": meta.get("solver", []),
            "max_tokens": meta.get("max_tokens", {}),
            "prompt_files": sorted(
                path.name
                for path in task_dir.iterdir()
                if path.is_file() and path.name not in {"dataset.json", "meta.json"}
            ),
        },
    }

    result = {"benchmark": benchmark}
    if include_items:
        result["items"] = [
            normalize_item(item, benchmark_key, scorer_type, grading_mode, estimated_map, visibility)
            for item in dataset
        ]
    return result


def task_lookup_keys(task_dir: Path) -> set[str]:
    keys = {task_dir.name}
    try:
        meta = load_json(task_dir / "meta.json")
    except (OSError, json.JSONDecodeError):
        return keys
    if meta.get("name"):
        keys.add(str(meta["name"]))
    return keys


def main() -> None:
    args = parse_args()
    overrides = load_json(Path(args.overrides)) if args.overrides else {}

    sources = [Path(source).expanduser().resolve() for source in args.source]
    task_dirs: list[Path] = []
    for source in sources:
        task_dirs.extend(detect_task_dirs(source))

    normalized: list[dict[str, Any]] = []
    seen_benchmarks: set[str] = set()
    if args.problem_config:
        problem_config = load_json(Path(args.problem_config).expanduser().resolve())
        task_dir_by_key: dict[str, Path] = {}
        for task_dir in task_dirs:
            for key in task_lookup_keys(task_dir):
                task_dir_by_key.setdefault(key, task_dir)

        for benchmark_key, problem_entry in problem_config.items():
            task_dir = task_dir_by_key.get(benchmark_key)
            if task_dir is None:
                print(
                    f"[export_time_horizons_manifest] no task_data directory found for '{benchmark_key}'",
                    file=sys.stderr,
                )
                continue
            problem_items = problem_entry.get("problems", [])
            normalized.append(
                normalize_task(
                    task_dir,
                    overrides,
                    args.include_items,
                    problem_items=problem_items,
                    benchmark_key_override=benchmark_key,
                )
            )
            seen_benchmarks.add(benchmark_key)
    else:
        for task_dir in task_dirs:
            entry = normalize_task(task_dir, overrides, args.include_items)
            benchmark_key = entry["benchmark"]["benchmark_key"]
            if benchmark_key in seen_benchmarks:
                print(
                    f"[export_time_horizons_manifest] skipping duplicate benchmark '{benchmark_key}' from {task_dir}",
                    file=sys.stderr,
                )
                continue
            seen_benchmarks.add(benchmark_key)
            normalized.append(entry)

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sources": [str(source) for source in sources],
        "benchmarks": [entry["benchmark"] for entry in normalized],
    }
    if args.include_items:
        manifest["items"] = [
            item
            for entry in normalized
            for item in entry.get("items", [])
        ]

    output_path = Path(args.output).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
