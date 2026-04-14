#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
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
        "title": item_key,
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
