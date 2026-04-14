#!/usr/bin/env python3

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build seed SQL for the hackathon Supabase schema from manifest, event config, and optional invites."
    )
    parser.add_argument("--manifest", required=True, help="Normalized manifest JSON from export_time_horizons_manifest.py")
    parser.add_argument("--event-config", required=True, help="Event configuration JSON")
    parser.add_argument("--invites-csv", help="Optional invite CSV")
    parser.add_argument(
        "--assignments-per-item",
        type=int,
        help="Number of independent assignment slots to seed per benchmark item. Defaults to event.default_assignments_per_item or 5.",
    )
    parser.add_argument("--output", required=True, help="Output SQL file")
    return parser.parse_args()


def load_json(path: Path) -> Any:
    return json.loads(path.read_text())


def sql_quote(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (dict, list)):
        text = json.dumps(value, separators=(",", ":"), ensure_ascii=False)
        return "'" + text.replace("'", "''") + "'::jsonb"
    text = str(value)
    return "'" + text.replace("'", "''") + "'"


def load_invites(path: Path | None) -> list[dict[str, Any]]:
    if not path:
      return []
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        rows = []
        for row in reader:
            rows.append({
                "email": (row.get("email") or "").strip().lower(),
                "role": (row.get("role") or "participant").strip() or "participant",
                "allow_private_tracks": str(row.get("allow_private_tracks") or "").strip().lower() in {"1", "true", "yes"},
                "team": (row.get("team") or "").strip() or None,
                "affiliation": (row.get("affiliation") or "").strip() or None,
                "status": (row.get("status") or "invited").strip() or "invited",
            })
        return rows


def assignment_slots_for_benchmark(
    benchmark_key: str,
    event: dict[str, Any],
    tracks: list[dict[str, Any]],
    cli_default: int | None,
) -> int:
    default_slots = cli_default or int(event.get("default_assignments_per_item") or 5)
    slots = default_slots
    for track in tracks:
        if benchmark_key not in track.get("benchmark_keys", []):
            continue
        track_slots = track.get("assignments_per_item")
        if isinstance(track_slots, int) and track_slots > 0:
            slots = track_slots
    return max(1, slots)


def main() -> None:
    args = parse_args()
    manifest = load_json(Path(args.manifest))
    event_config = load_json(Path(args.event_config))
    invites = load_invites(Path(args.invites_csv) if args.invites_csv else None)

    event = event_config["event"]
    tracks = event_config.get("tracks", [])
    benchmarks = manifest.get("benchmarks", [])
    items = manifest.get("items", [])

    deduped_benchmarks: list[dict[str, Any]] = []
    seen_benchmark_keys: set[str] = set()
    for benchmark in benchmarks:
        benchmark_key = benchmark["benchmark_key"]
        if benchmark_key in seen_benchmark_keys:
            continue
        seen_benchmark_keys.add(benchmark_key)
        deduped_benchmarks.append(benchmark)
    benchmarks = deduped_benchmarks

    deduped_items: list[dict[str, Any]] = []
    seen_item_keys: set[tuple[str, str]] = set()
    for item in items:
        item_key = (item["benchmark_key"], item["item_key"])
        if item_key in seen_item_keys:
            continue
        seen_item_keys.add(item_key)
        deduped_items.append(item)
    items = deduped_items

    benchmark_by_key = {benchmark["benchmark_key"]: benchmark for benchmark in benchmarks}

    enabled_benchmark_keys: list[str] = []
    for track in tracks:
        for benchmark_key in track.get("benchmark_keys", []):
            if benchmark_key not in enabled_benchmark_keys:
                enabled_benchmark_keys.append(benchmark_key)

    config_by_benchmark_key: dict[str, dict[str, Any]] = {}
    for track in tracks:
        for benchmark_key in track.get("benchmark_keys", []):
            config_by_benchmark_key.setdefault(benchmark_key, {
                "requires_backend": False,
                "priority_override": benchmark_by_key.get(benchmark_key, {}).get("priority"),
                "notes_override": benchmark_by_key.get(benchmark_key, {}).get("notes"),
                "assignments_per_item": assignment_slots_for_benchmark(
                    benchmark_key,
                    event,
                    tracks,
                    args.assignments_per_item,
                ),
            })
            config_by_benchmark_key[benchmark_key]["requires_backend"] = (
                config_by_benchmark_key[benchmark_key]["requires_backend"] or track.get("requires_backend", False)
            )

    lines: list[str] = []
    lines.append("-- Generated seed SQL for the Time Horizons Hackathon backend")
    lines.append("begin;")
    lines.append("")

    lines.append(
        "insert into public.events (slug, name, subtitle, description, status, starts_at, ends_at, config)"
        f" values ({sql_quote(event['slug'])}, {sql_quote(event['name'])}, {sql_quote(event.get('subtitle'))},"
        f" {sql_quote(event.get('description'))}, {sql_quote(event.get('status', 'planning'))},"
        f" {sql_quote(event.get('starts_at'))}, {sql_quote(event.get('ends_at'))}, {sql_quote(event)})"
        " on conflict (slug) do update set"
        " name = excluded.name,"
        " subtitle = excluded.subtitle,"
        " description = excluded.description,"
        " status = excluded.status,"
        " starts_at = excluded.starts_at,"
        " ends_at = excluded.ends_at,"
        " config = excluded.config;"
    )
    lines.append("")

    for benchmark in benchmarks:
        lines.append(
            "insert into public.benchmarks ("
            "benchmark_key, title, description, domain, contributor, visibility, baseline_status, item_count,"
            " scorer, grading_mode, frontend_mode, estimated_range, real_range, total_estimated_hours,"
            " priority, notes, metadata"
            ") values ("
            f"{sql_quote(benchmark['benchmark_key'])}, {sql_quote(benchmark.get('title'))}, {sql_quote(benchmark.get('description'))},"
            f" {sql_quote(benchmark.get('domain'))}, {sql_quote(benchmark.get('contributor'))}, {sql_quote(benchmark.get('visibility', 'public'))},"
            f" {sql_quote(benchmark.get('baseline_status', 'estimated_only'))}, {sql_quote(benchmark.get('item_count', 0))},"
            f" {sql_quote(benchmark.get('scorer'))}, {sql_quote(benchmark.get('grading_mode'))}, {sql_quote(benchmark.get('frontend_mode'))},"
            f" {sql_quote(benchmark.get('estimated_range'))}, {sql_quote(benchmark.get('real_range'))}, {sql_quote(benchmark.get('total_estimated_hours'))},"
            f" {sql_quote(benchmark.get('priority'))}, {sql_quote(benchmark.get('notes'))}, {sql_quote(benchmark.get('metadata', {}))}"
            ") on conflict (benchmark_key) do update set"
            " title = excluded.title,"
            " description = excluded.description,"
            " domain = excluded.domain,"
            " contributor = excluded.contributor,"
            " visibility = excluded.visibility,"
            " baseline_status = excluded.baseline_status,"
            " item_count = excluded.item_count,"
            " scorer = excluded.scorer,"
            " grading_mode = excluded.grading_mode,"
            " frontend_mode = excluded.frontend_mode,"
            " estimated_range = excluded.estimated_range,"
            " real_range = excluded.real_range,"
            " total_estimated_hours = excluded.total_estimated_hours,"
            " priority = excluded.priority,"
            " notes = excluded.notes,"
            " metadata = excluded.metadata;"
        )
    lines.append("")

    for item in items:
        benchmark_key = item["benchmark_key"]
        lines.append(
            "insert into public.benchmark_items (benchmark_id, item_key, visibility, render_payload, answer_key, metadata)"
            " values ("
            f"(select id from public.benchmarks where benchmark_key = {sql_quote(benchmark_key)}),"
            f" {sql_quote(item['item_key'])}, {sql_quote(item.get('visibility', 'public'))},"
            f" {sql_quote(item.get('render_payload', {}))}, {sql_quote(item.get('answer_key', {}))}, {sql_quote(item.get('metadata', {}))}"
            ") on conflict (benchmark_id, item_key) do update set"
            " visibility = excluded.visibility,"
            " render_payload = excluded.render_payload,"
            " answer_key = excluded.answer_key,"
            " metadata = excluded.metadata;"
        )
    lines.append("")

    for index, track in enumerate(tracks, start=1):
        lines.append(
            "insert into public.event_tracks (event_id, track_key, title, description, requires_backend, benchmark_keys, sort_order, metadata)"
            " values ("
            f"(select id from public.events where slug = {sql_quote(event['slug'])}),"
            f" {sql_quote(track['track_key'])}, {sql_quote(track['title'])}, {sql_quote(track.get('description'))},"
            f" {sql_quote(track.get('requires_backend', False))}, {sql_quote(track.get('benchmark_keys', []))}, {sql_quote(index)}, {sql_quote(track)}"
            ") on conflict (event_id, track_key) do update set"
            " title = excluded.title,"
            " description = excluded.description,"
            " requires_backend = excluded.requires_backend,"
            " benchmark_keys = excluded.benchmark_keys,"
            " sort_order = excluded.sort_order,"
            " metadata = excluded.metadata;"
        )
    lines.append("")

    for benchmark_key in enabled_benchmark_keys:
        benchmark = benchmark_by_key.get(benchmark_key)
        if not benchmark:
            continue
        config = config_by_benchmark_key.get(benchmark_key, {})
        assignments_per_item = assignment_slots_for_benchmark(
            benchmark_key,
            event,
            tracks,
            args.assignments_per_item,
        )
        target_assignments = int(benchmark.get("item_count") or 0) * assignments_per_item
        lines.append(
            "insert into public.event_benchmark_configs ("
            "event_id, benchmark_id, enabled, requires_backend, sampling_strategy, target_assignments,"
            " max_assignments_per_participant, priority_override, notes_override, config"
            ") values ("
            f"(select id from public.events where slug = {sql_quote(event['slug'])}),"
            f" (select id from public.benchmarks where benchmark_key = {sql_quote(benchmark_key)}),"
            " true,"
            f" {sql_quote(config.get('requires_backend', False))},"
            " 'sequential',"
            f" {sql_quote(target_assignments)},"
            " 1,"
            f" {sql_quote(config.get('priority_override'))},"
            f" {sql_quote(config.get('notes_override'))},"
            f" {sql_quote(config)}"
            ") on conflict (event_id, benchmark_id) do update set"
            " enabled = excluded.enabled,"
            " requires_backend = excluded.requires_backend,"
            " sampling_strategy = excluded.sampling_strategy,"
            " target_assignments = excluded.target_assignments,"
            " max_assignments_per_participant = excluded.max_assignments_per_participant,"
            " priority_override = excluded.priority_override,"
            " notes_override = excluded.notes_override,"
            " config = excluded.config;"
        )
    lines.append("")

    for benchmark_key, benchmark in benchmark_by_key.items():
        if benchmark_key in enabled_benchmark_keys:
            continue
        lines.append(
            "insert into public.event_benchmark_configs ("
            "event_id, benchmark_id, enabled, requires_backend, sampling_strategy, target_assignments,"
            " max_assignments_per_participant, priority_override, notes_override, config"
            ") values ("
            f"(select id from public.events where slug = {sql_quote(event['slug'])}),"
            f" (select id from public.benchmarks where benchmark_key = {sql_quote(benchmark_key)}),"
            " false,"
            " false,"
            " 'disabled',"
            " 0,"
            " 1,"
            f" {sql_quote(benchmark.get('priority'))},"
            " 'Disabled for this event.',"
            f" {sql_quote({'disabled_by_event_config': True})}"
            ") on conflict (event_id, benchmark_id) do update set"
            " enabled = false,"
            " requires_backend = false,"
            " sampling_strategy = 'disabled',"
            " target_assignments = 0,"
            " notes_override = excluded.notes_override,"
            " config = excluded.config;"
        )
    lines.append("")

    for item in items:
        benchmark_key = item["benchmark_key"]
        if benchmark_key not in enabled_benchmark_keys:
            continue
        benchmark = benchmark_by_key[benchmark_key]
        assignments_per_item = assignment_slots_for_benchmark(
            benchmark_key,
            event,
            tracks,
            args.assignments_per_item,
        )
        delivery_mode = (
            "signed_payload"
            if benchmark.get("visibility") == "private" or benchmark.get("frontend_mode") in {"backend_only", "backend_or_signed_assets"}
            else "direct"
        )
        for slot in range(1, assignments_per_item + 1):
            lines.append(
                "insert into public.assignments (event_id, benchmark_id, benchmark_item_id, assignment_slot, status, delivery_mode, metadata)"
                " values ("
                f"(select id from public.events where slug = {sql_quote(event['slug'])}),"
                f" (select id from public.benchmarks where benchmark_key = {sql_quote(benchmark_key)}),"
                f" (select bi.id from public.benchmark_items bi join public.benchmarks b on b.id = bi.benchmark_id"
                f" where b.benchmark_key = {sql_quote(benchmark_key)} and bi.item_key = {sql_quote(item['item_key'])}),"
                f" {sql_quote(slot)},"
                " 'queued',"
                f" {sql_quote(delivery_mode)},"
                f" {sql_quote({'seeded_from_manifest': True, 'assignment_slot': slot})}"
                ") on conflict (event_id, benchmark_item_id, assignment_slot) do update set"
                " delivery_mode = excluded.delivery_mode,"
                " metadata = excluded.metadata;"
            )
    lines.append("")

    for invite in invites:
        if not invite["email"]:
            continue
        lines.append(
            "insert into public.event_invites (event_id, email, role, team, affiliation, allow_private_tracks, status, metadata)"
            " values ("
            f"(select id from public.events where slug = {sql_quote(event['slug'])}),"
            f" {sql_quote(invite['email'])}, {sql_quote(invite['role'])}, {sql_quote(invite['team'])},"
            f" {sql_quote(invite['affiliation'])}, {sql_quote(invite['allow_private_tracks'])}, {sql_quote(invite['status'])},"
            f" {sql_quote({'seeded_from_csv': True})}"
            ") on conflict (event_id, email) do update set"
            " role = excluded.role,"
            " team = excluded.team,"
            " affiliation = excluded.affiliation,"
            " allow_private_tracks = excluded.allow_private_tracks,"
            " status = excluded.status,"
            " metadata = excluded.metadata;"
        )

    lines.append("")
    lines.append("commit;")

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
