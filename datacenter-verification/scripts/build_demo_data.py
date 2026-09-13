#!/usr/bin/env python3
"""Build the browser-demo dataset for the draft14 staged evidence model.

Reads the v0.3 sweep fixtures from the research repo, samples a fixed number of
instances per scenario family, trims each record down to the fields the model
actually reads, runs the reference implementation (xx_claude/newmodel.py) on the
trimmed record, and writes data/demo-data.json plus a data/demo-data.js twin.

The reference implementation is never modified. Its source is read, the single
return statement is swapped for a locals() capture so the per-pathway
intermediates can be recorded, and the result is executed in a private
namespace. Every row is then also scored by the unmodified module and the two
are asserted equal, so the captured intermediates cannot silently drift from the
validated model.

Usage:
    python3 scripts/build_demo_data.py [--research-repo PATH] [--per-family N]
"""

import argparse
import importlib.util
import json
import math
import os
import sys

DEFAULT_RESEARCH_REPO = "/Users/idacy/Develop/datacenter-verification"
SWEEP_RELPATH = "xx_claude/results/sweep_v0_3_20260613_01"
NEWMODEL_RELPATH = "xx_claude/newmodel.py"

ORIGINAL_RETURN = (
    "    return dict(route=route,chi=chi,Lam=Lam,Lcov=Lcov,mu=mu,pi=pi,pi_sc=pi_sc,D=D)"
)
CAPTURE_RETURN = "    return {k: v for k, v in locals().items() if not callable(v)}"

# fields of raw_features the model reads: two for the capacity bound, one for
# the witness-coherence check chi
RAW_KEEP = {
    "accelerator_count_by_family_sku": "count",
    "advertised_peak_rate_by_precision": "peak_rate",
    "allocated_accelerator_count_by_sku": "count",
}

# normalized_signals keys read by the model, in the order they are used
SIGNAL_KEYS = [
    "capacity_adjustment_factor",
    "capacity_unit_normalized",
    "hidden_or_unmonitored_capacity_possible",
    "achieved_operations",
    "achieved_operations_unit_normalized",
    "activity_score",
    "activity_duration_seconds",
    "participant_count",
    "collective_cadence_score",
    "activity_fabric_overlap_fraction",
    "checkpoint_periodicity_score",
    "checkpoint_activity_adjacency_fraction",
    "checkpoint_burst_count",
    "non_serving_score",
    "serving_counterevidence_score",
    "serving_activity_overlap_fraction",
    "storage_operation_overlap_fraction",
    "bytes_explained_fraction",
    "benchmark_regularity_score",
    "benchmark_duration_seconds",
    "hpc_mpi_score",
    "hpc_overlap_fraction",
    "attribution_overlap_fraction",
    "benign_attribution_explanation_overlap_fraction",
    "unit_mismatch_or_hidden_capacity_explanation_score",
    "decision_blocking_missingness",
    "physical_timeline_conflict",
    "health_throttle_conflict",
    "topology_route_conflict",
    "power_activity_conflict",
]

COVERAGE_KEYS = [
    "capacity",
    "clock_alignment",
    "achieved_ops",
    "activity",
    "fabric",
    "storage",
    "serving",
    "storage_operations",
    "benchmark_hpc",
    "attribution",
    "identity_shape",
    "scope_mapping",
]

# reference fields carried into the browser, all produced by newmodel.py
REFERENCE_KEYS = [
    "route",
    "Lam",
    "Lcov",
    "mu",
    "pi",
    "pi_sc",
    "pi_ref",
    "D",
    "chi",
    "B",
    "cstar",
    "cnt",
    "rate",
    "dur",
    "admissible",
    "ruled",
    "chi_fail",
    "LF",
    "LC",
    "LN",
    "aF",
    "aC",
    "aN",
    "bF",
    "bC",
    "e_serv",
    "e_st",
    "e_bm",
    "e_hpc",
    "A",
    "F",
    "Ck",
    "N",
    "O",
    "Ksup",
]

SIG_DIGITS = 9


def load_reference(research_repo):
    """Return (evaluate, evaluate_verbose) from the unmodified reference file."""
    path = os.path.join(research_repo, NEWMODEL_RELPATH)
    spec = importlib.util.spec_from_file_location("newmodel_reference", path)
    module = importlib.util.module_from_spec(spec)
    module.__name__ = "newmodel_reference"
    spec.loader.exec_module(module)

    source = open(path, encoding="utf-8").read()
    if ORIGINAL_RETURN not in source:
        raise SystemExit(
            "newmodel.py return statement changed shape, the capture patch needs updating"
        )
    patched = source.replace(ORIGINAL_RETURN, CAPTURE_RETURN)
    namespace = {"__name__": "newmodel_verbose"}
    exec(compile(patched, "newmodel_verbose", "exec"), namespace)
    return module.evaluate, namespace["evaluate"]


def round_sig(value, digits=SIG_DIGITS):
    if not isinstance(value, float) or value == 0.0 or not math.isfinite(value):
        return value
    exponent = math.floor(math.log10(abs(value)))
    return round(value, -(exponent - digits + 1))


def trim(site):
    """Keep only what the model reads, rounded so the browser sees identical inputs."""
    window = site.get("audit_window") or {}
    signals_in = site.get("normalized_signals") or {}
    coverage_in = site.get("coverage") or {}
    raw_in = site.get("raw_features") or {}

    signals = {}
    for key in SIGNAL_KEYS:
        if key not in signals_in:
            continue
        value = signals_in[key]
        signals[key] = round_sig(value) if isinstance(value, float) else value

    coverage = {}
    for key in COVERAGE_KEYS:
        if key in coverage_in:
            value = coverage_in[key]
            coverage[key] = round_sig(value) if isinstance(value, float) else value

    raw = {}
    for key, field in RAW_KEEP.items():
        records = raw_in.get(key)
        if not records:
            continue
        kept = []
        for record in records:
            value = record.get(field)
            kept.append({field: round_sig(value) if isinstance(value, float) else value})
        raw[key] = kept

    return {
        "audit_window": {"start": window.get("start"), "end": window.get("end")},
        "coverage": coverage,
        "normalized_signals": signals,
        "raw_features": raw,
    }


def num(value, default=0.0):
    try:
        f = float(value)
        return default if f != f else f
    except (TypeError, ValueError):
        return default


def discrepancy_names(site, local):
    """Names for the triggered discrepancy rules, in newmodel.py's own order."""
    signals = site.get("normalized_signals") or {}
    coverage = site.get("coverage") or {}

    def cov(key):
        return max(0.0, min(1.0, num(coverage.get(key), 0.0)))

    names = []
    ratio = (local["O"] / local["B"]) if local["B"] > 0 else 0.0
    if (
        local["o_norm"]
        and ratio > 1.10
        and cov("capacity") >= 0.75
        and num(signals.get("unit_mismatch_or_hidden_capacity_explanation_score")) < 0.70
    ):
        names.append("achieved_operations_above_capacity_bound")
    if (
        local["A"] >= 0.70
        and local["adur"] >= 600
        and num(signals.get("attribution_overlap_fraction"), 1.0) <= 0.05
        and cov("attribution") >= 0.80
        and num(signals.get("benign_attribution_explanation_overlap_fraction")) < 0.80
    ):
        names.append("activity_without_attribution")
    for key in (
        "physical_timeline_conflict",
        "health_throttle_conflict",
        "topology_route_conflict",
        "power_activity_conflict",
    ):
        if bool(signals.get(key)):
            names.append(key)
    return names


def jsonable(value):
    """Reference outputs are stored at full double precision.

    Inputs are rounded so the browser and this script see the same numbers, but
    rounding the outputs too would put a floor under how tight the in-page
    parity check could be.
    """
    if isinstance(value, float):
        if math.isinf(value) or value != value:
            return None
        return value
    return value


def sample_indices(total, wanted):
    if total <= wanted:
        return list(range(total))
    return sorted({round(i * (total - 1) / (wanted - 1)) for i in range(wanted)})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--research-repo", default=DEFAULT_RESEARCH_REPO)
    parser.add_argument("--per-family", type=int, default=100)
    parser.add_argument(
        "--out-dir",
        default=os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, "data"),
    )
    args = parser.parse_args()

    evaluate, evaluate_verbose = load_reference(args.research_repo)
    sweep = os.path.join(args.research_repo, SWEEP_RELPATH)
    families = sorted(
        name
        for name in os.listdir(sweep)
        if os.path.exists(os.path.join(sweep, name, "sites_all.jsonl"))
    )
    if not families:
        raise SystemExit("no families found under " + sweep)

    rows = []
    family_meta = []
    for family in families:
        path = os.path.join(sweep, family, "sites_all.jsonl")
        with open(path, encoding="utf-8") as handle:
            raw_lines = [json.loads(line) for line in handle if line.strip()]
        sites = [record.get("site", record) for record in raw_lines]
        picks = sample_indices(len(sites), args.per_family)
        for order, index in enumerate(picks):
            site = sites[index]
            trimmed = trim(site)

            canonical = evaluate(trimmed)
            local = evaluate_verbose(trimmed)
            for key, value in canonical.items():
                got = local[key]
                if isinstance(value, float) and isinstance(got, float):
                    if math.isinf(value) and math.isinf(got):
                        continue
                    assert abs(value - got) <= 0.0, (family, index, key, value, got)
                else:
                    assert value == got, (family, index, key, value, got)

            reference = {key: jsonable(local[key]) for key in REFERENCE_KEYS}
            reference["mu_infinite"] = math.isinf(local["mu"])
            reference["discrepancies"] = discrepancy_names(trimmed, local)

            rows.append(
                {
                    "id": "%s#%04d" % (family, index),
                    "family": family,
                    "site_id": site.get("site_id"),
                    "scope": site.get("scope"),
                    "scenario_name": site.get("scenario_name"),
                    "expected": site.get("expected") or {},
                    "audit_window": trimmed["audit_window"],
                    "coverage": trimmed["coverage"],
                    "normalized_signals": trimmed["normalized_signals"],
                    "raw_features": trimmed["raw_features"],
                    "reference": reference,
                }
            )
        family_meta.append(
            {"family": family, "population": len(sites), "sampled": len(picks)}
        )
        print("%-45s population=%5d sampled=%3d" % (family, len(sites), len(picks)))

    agree = sum(
        1
        for row in rows
        if row["reference"]["route"] in (row["expected"].get("final_route_set") or [])
    )
    payload = {
        "schema": "dcv-demo-data/draft14-staged-model",
        "source_sweep": SWEEP_RELPATH,
        "reference_implementation": NEWMODEL_RELPATH,
        "families": family_meta,
        "row_count": len(rows),
        "model_agrees_with_generator": agree,
        "rows": rows,
    }

    out_dir = os.path.abspath(args.out_dir)
    os.makedirs(out_dir, exist_ok=True)
    json_path = os.path.join(out_dir, "demo-data.json")
    js_path = os.path.join(out_dir, "demo-data.js")
    text = json.dumps(payload, separators=(",", ":"), allow_nan=False)
    with open(json_path, "w", encoding="utf-8") as handle:
        handle.write(text)
    with open(js_path, "w", encoding="utf-8") as handle:
        handle.write("window.DCVDemoData = ")
        handle.write(text)
        handle.write(";\n")

    print()
    print("rows              %d" % len(rows))
    print("agrees with label %d (%.1f%%)" % (agree, 100.0 * agree / len(rows)))
    print("json              %.2f MB" % (os.path.getsize(json_path) / 1048576.0))
    print("js                %.2f MB" % (os.path.getsize(js_path) / 1048576.0))


if __name__ == "__main__":
    sys.exit(main())
