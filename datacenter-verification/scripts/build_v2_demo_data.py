"""Build public v2 demo data from the catalogue and deterministic evaluator."""

from __future__ import annotations

import json
import math
import os
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[1]
CATALOG_DIR = ROOT / "catalog"
DATA_DIR = ROOT / "data"
SEED = 20260512
ROW_COUNT = int(os.environ.get("DCV_ROW_COUNT", "8400"))
POLICY_GPU_HOURS = 512 * 24


@dataclass(frozen=True)
class Site:
    site_id: str
    name: str
    operator_type: str
    operator_aim: str
    capacity: int
    topology: int
    homogeneous: float
    partitioning: float
    rack_design_kw: float
    baseline_it_mw: float
    telemetry_stack: str
    trust_tier: str
    blind_spots: list[str]


SITES = [
    Site("frontier_lab", "Frontier Training Lab", "self_managed_training_lab", "frontier model development", 8192, 6144, 0.94, 0.02, 6200, 3.4, "slurm_dcgm_ufm_bms_ml_logs", "operator_signed", []),
    Site("cloud_ultra", "Cloud UltraCluster Region", "cloud_provider", "multi-tenant accelerator rental", 4096, 3072, 0.88, 0.08, 3300, 1.8, "cloud_api_billing_dcgm_efa", "provider_signed", ["guest runtime redaction"]),
    Site("national_hpc", "National HPC Center", "research_hpc", "scientific computing and AI allocations", 2048, 1536, 0.82, 0.03, 1800, 1.0, "slurm_dcgm_infiniband_bms", "auditor_reconciled", ["HPC false positives"]),
    Site("rental_cloud", "AI Rental Cloud", "specialized_cloud", "short-term GPU rentals", 1536, 1024, 0.76, 0.16, 1350, 0.76, "cloud_api_dcgm_partial_runtime", "operator_signed", ["account fragmentation", "partial runtime semantics"]),
    Site("enterprise_inference", "Enterprise Inference Campus", "enterprise_operator", "serving and embedding workloads", 768, 384, 0.64, 0.62, 620, 0.42, "kubernetes_dcgm_power", "operator_signed", ["partitioned accelerators", "serving-heavy"]),
    Site("confidential_pool", "Confidential Compute Pool", "cloud_provider", "privacy-preserving training and inference", 2048, 1536, 0.86, 0.1, 1700, 0.95, "cloud_api_cc_mode_power", "provider_signed", ["performance counters suppressed"]),
    Site("storage_ai", "Storage/ETL AI Datacenter", "enterprise_operator", "data pipelines and analytics", 512, 256, 0.54, 0.24, 520, 0.5, "storage_logs_power_partial_gpu", "operator_signed", ["storage false positives"]),
    Site("below_threshold", "Below-Threshold Colocation Site", "colo_customer", "small inference and experimentation", 256, 128, 0.58, 0.35, 220, 0.2, "basic_power_inventory", "limited", ["sparse telemetry"]),
    Site("commissioning_site", "New Commissioning Site", "hyperscale_builder", "capacity ramp-up", 3072, 2048, 0.8, 0.12, 2600, 0.7, "inventory_power_partial", "change_controlled", ["inventory changing", "partial commissioning"]),
    Site("offledger_watch", "Off-Ledger Watch Site", "unknown_or_mixed", "uncertain capacity use", 1024, 768, 0.72, 0.12, 900, 0.6, "partial_inventory_external_power", "low_confidence", ["external capacity conflict", "weak scheduler visibility"]),
]


SCENARIOS = {
    "idle_low_activity": {"training": False, "evasion": False, "weight": 8},
    "small_jobs": {"training": False, "evasion": False, "weight": 7},
    "reserved_unused": {"training": False, "evasion": False, "weight": 5},
    "hpc_mpi": {"training": False, "evasion": False, "weight": 7},
    "batch_inference": {"training": False, "evasion": False, "weight": 7},
    "model_parallel_inference": {"training": False, "evasion": False, "weight": 5},
    "storage_rebuild": {"training": False, "evasion": False, "weight": 4},
    "hardware_burn_in": {"training": False, "evasion": False, "weight": 4},
    "benchmark": {"training": False, "evasion": False, "weight": 4},
    "pretraining_standard": {"training": True, "evasion": False, "weight": 8},
    "fine_tune_large": {"training": True, "evasion": False, "weight": 5},
    "training_no_semantic_logs": {"training": True, "evasion": False, "weight": 5},
    "low_fabric_high_checkpoint_training": {"training": True, "evasion": False, "weight": 4},
    "underclocked_training": {"training": True, "evasion": False, "weight": 3},
    "fragmented_linked_training": {"training": True, "evasion": False, "weight": 3},
    "evasion_hidden_scheduler": {"training": True, "evasion": True, "evasion_type": "allocation_zero_but_activity_high", "weight": 4},
    "evasion_suppressed_counters": {"training": True, "evasion": True, "evasion_type": "counter_suppression", "weight": 4},
    "evasion_fabric_scheduler_mismatch": {"training": True, "evasion": True, "evasion_type": "fabric_high_scheduler_low", "weight": 3},
    "evasion_cloud_scheduler_mismatch": {"training": True, "evasion": True, "evasion_type": "cloud_scheduler_mismatch", "weight": 3},
    "evasion_external_capacity_conflict": {"training": False, "evasion": True, "evasion_type": "external_capacity_conflict", "weight": 2},
    "evasion_active_probe_hidden_load": {"training": True, "evasion": True, "evasion_type": "active_probe_hidden_load", "weight": 2},
}


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return min(high, max(low, value))


def ramp(value: float, low: float, high: float) -> float:
    if high <= low:
        return 0.0
    return clamp((value - low) / (high - low))


def jitter(rng: random.Random, value: float, amount: float, low: float = 0.0, high: float | None = None) -> float:
    out = value + rng.uniform(-amount, amount)
    if high is None:
        return max(low, out)
    return min(high, max(low, out))


def choose_scenario(rng: random.Random) -> str:
    names = list(SCENARIOS)
    weights = [SCENARIOS[name]["weight"] for name in names]
    return rng.choices(names, weights=weights, k=1)[0]


def base_features(site: Site, rng: random.Random) -> dict[str, Any]:
    return {
        "o1_accelerator_count": site.capacity,
        "o1_normalized_training_compute_capacity": site.capacity,
        "o1_homogeneous_high_end_accelerator_fraction": jitter(rng, site.homogeneous, 0.04, 0, 1),
        "o1_largest_low_latency_topology_footprint": site.topology,
        "o1_partitioning_fraction": jitter(rng, site.partitioning, 0.04, 0, 1),
        "o1_inventory_delta_rate": 0,
        "o2_allocated_accelerator_count": 0,
        "o2_allocation_duration": 0,
        "o2_allocated_compute_hours": 0,
        "o2_concurrency_fraction": 0,
        "o2_topology_contiguity": 0,
        "o2_declared_workload_class": "none",
        "o2_reservation_priority_preemption_pattern": "unknown",
        "o3_batch_provisioning_event_size": 0,
        "o3_capacity_reservation_block_duration": 0,
        "o3_training_instance_type_fraction": 0,
        "o3_billing_continuity_diurnal_index": 0.8,
        "o3_egress_inter_region_movement": 0,
        "o4_gpu_busy_percent": rng.uniform(0, 8),
        "o4_sm_tensor_core_active_percent": rng.uniform(0, 5),
        "o4_hbm_memory_used": rng.uniform(0.02, 0.12),
        "o4_hbm_dram_bandwidth_active": rng.uniform(0, 8),
        "o4_gpu_power_draw_or_fraction": rng.uniform(0.04, 0.15),
        "o4_per_process_gpu_memory_accounting": 0,
        "o4_gpu_health_error_counts": 0,
        "o5_kernel_family_name_hash_sequence": "none",
        "o5_achieved_tensor_throughput_ratio": 0,
        "o5_profiler_availability_state": "available",
        "o6_nvlink_nvswitch_link_utilization": rng.uniform(0, 5),
        "o6_nvlink_nvswitch_correlation_periodicity": 0,
        "o6_local_fabric_link_error_events": 0,
        "o7_scaleout_port_utilization": rng.uniform(0, 5),
        "o7_synchronized_fabric_footprint": 0,
        "o7_collective_periodicity_step_cadence": 0,
        "o7_rdma_congestion_retry_drops": 0,
        "o7_job_to_port_mapping_coverage": 0.92,
        "o8_rack_it_power_kw": site.baseline_it_mw * 1000 * rng.uniform(0.55, 0.9),
        "o8_facility_it_power_mw": site.baseline_it_mw * rng.uniform(0.7, 1.0),
        "o8_power_continuity_cv_diurnal_ratio": rng.uniform(0.25, 0.8),
        "o8_power_to_telemetry_consistency": 0.1,
        "o9_gpu_hbm_temperature_celsius": rng.uniform(28, 45),
        "o9_liquid_cooling_delta_t_celsius": rng.uniform(1, 5),
        "o9_cooling_flow_fan_speed": rng.uniform(15, 45),
        "o10_distributed_world_size_rank_count": 0,
        "o10_runtime_framework_class": "none",
        "o10_rendezvous_rank_mapping_stability": 0,
        "o10_container_vm_image_digest_recurrence": 0,
        "o11_initial_data_staging_volume": 0,
        "o11_checkpoint_write_size": 0,
        "o11_checkpoint_period": 0,
        "o11_read_write_operation_pattern": 0,
        "o12_declared_model_parameter_count": 0,
        "o12_training_tokens_examples": 0,
        "o12_step_count_and_step_time": 0,
        "o12_loss_optimizer_checkpoint_metadata": "absent",
        "o13_attestation_validity": "valid",
        "o13_confidential_compute_security_mode": "off",
        "o13_telemetry_collector_measurement": "valid",
        "o14_telemetry_coverage_fraction_by_layer": 0.96,
        "o14_telemetry_gap_fraction_missed_scrapes": 0.01,
        "o14_clock_drift_synchronization_error": rng.uniform(0, 10),
        "o14_counter_reset_config_change_count": 0,
        "o15_rack_door_badge_maintenance_events": 0,
        "o15_firmware_bmc_change_events": 0,
        "o16_probe_throughput_ratio": 1.0,
        "o16_probe_latency_inflation": 1.0,
        "o16_vram_residency_free_memory_test": 0.85,
        "o17_external_it_power_capacity_estimate": site.baseline_it_mw,
        "o17_construction_commissioning_timeline": "commissioned",
        "o17_chip_shipment_procurement_indicators": site.capacity,
    }


def set_activity_from_allocation(features: dict[str, Any], site: Site, rng: random.Random, intensity: float, fabric: float, semantic: str) -> None:
    allocation = features["o2_allocated_accelerator_count"]
    duration = features["o2_allocation_duration"]
    concurrency = allocation / max(1, site.capacity)
    features["o2_allocated_compute_hours"] = round(allocation * duration, 3)
    features["o2_concurrency_fraction"] = round(clamp(concurrency), 4)
    features["o4_gpu_busy_percent"] = round(jitter(rng, 25 + intensity * 72, 8, 0, 100), 3)
    features["o4_sm_tensor_core_active_percent"] = round(jitter(rng, 15 + intensity * 80, 10, 0, 100), 3)
    features["o4_hbm_memory_used"] = round(jitter(rng, 0.18 + intensity * 0.72, 0.08, 0, 1), 4)
    features["o4_hbm_dram_bandwidth_active"] = round(jitter(rng, 18 + intensity * 72, 10, 0, 100), 3)
    features["o4_gpu_power_draw_or_fraction"] = round(jitter(rng, 0.18 + intensity * 0.74, 0.07, 0, 1), 4)
    features["o4_per_process_gpu_memory_accounting"] = round(allocation * features["o4_hbm_memory_used"], 3)
    features["o5_achieved_tensor_throughput_ratio"] = round(jitter(rng, intensity * 0.9, 0.1, 0, 1.2), 4)
    features["o6_nvlink_nvswitch_link_utilization"] = round(jitter(rng, fabric * 85, 9, 0, 100), 3)
    features["o6_nvlink_nvswitch_correlation_periodicity"] = round(jitter(rng, fabric * 0.9, 0.12, 0, 1), 4)
    features["o7_scaleout_port_utilization"] = round(jitter(rng, fabric * 88, 8, 0, 100), 3)
    features["o7_synchronized_fabric_footprint"] = round(min(allocation, max(0, allocation * fabric * rng.uniform(0.72, 1.05))), 3)
    features["o7_collective_periodicity_step_cadence"] = round(rng.uniform(4, 55) if fabric > 0.45 else rng.uniform(90, 600), 3)
    features["o7_rdma_congestion_retry_drops"] = round(max(0, (fabric - 0.45) * allocation * rng.uniform(0.01, 0.08)), 3)
    features["o7_job_to_port_mapping_coverage"] = round(jitter(rng, 0.9, 0.08, 0, 1), 4)
    rack_power = site.baseline_it_mw * 1000 + site.rack_design_kw * concurrency * features["o4_gpu_power_draw_or_fraction"]
    features["o8_rack_it_power_kw"] = round(jitter(rng, rack_power, site.rack_design_kw * 0.04, 0), 3)
    features["o8_facility_it_power_mw"] = round(max(features["o8_rack_it_power_kw"] / 1000, site.baseline_it_mw * 0.8), 4)
    features["o8_power_continuity_cv_diurnal_ratio"] = round(jitter(rng, 0.12 if duration > 24 else 0.35, 0.08, 0), 4)
    expected_power = site.baseline_it_mw * 1000 + site.rack_design_kw * concurrency * features["o4_gpu_power_draw_or_fraction"]
    features["o8_power_to_telemetry_consistency"] = round(abs(features["o8_rack_it_power_kw"] - expected_power) / max(1, site.rack_design_kw), 4)
    features["o9_gpu_hbm_temperature_celsius"] = round(jitter(rng, 42 + features["o4_gpu_power_draw_or_fraction"] * 38, 4, 25, 95), 3)
    features["o9_liquid_cooling_delta_t_celsius"] = round(jitter(rng, 2 + concurrency * intensity * 15, 2, 0), 3)
    features["o9_cooling_flow_fan_speed"] = round(jitter(rng, 25 + features["o4_gpu_power_draw_or_fraction"] * 70, 8, 0, 100), 3)
    features["o10_distributed_world_size_rank_count"] = round(allocation if fabric > 0.35 else max(1, allocation * rng.uniform(0.1, 0.6)))
    features["o10_rendezvous_rank_mapping_stability"] = round(jitter(rng, 0.85 if fabric > 0.45 else 0.45, 0.12, 0, 1), 4)
    features["o10_container_vm_image_digest_recurrence"] = round(allocation * rng.uniform(0.6, 1.0))
    features["o10_runtime_framework_class"] = semantic


def apply_scenario(features: dict[str, Any], site: Site, scenario: str, rng: random.Random) -> dict[str, Any]:
    cap = site.capacity
    max_training_alloc = max(32, min(cap, site.topology))
    metadata = SCENARIOS[scenario].copy()

    if scenario == "idle_low_activity":
        pass
    elif scenario == "small_jobs":
        features["o2_allocated_accelerator_count"] = rng.randint(1, min(96, cap))
        features["o2_allocation_duration"] = rng.uniform(0.2, 12)
        features["o2_declared_workload_class"] = rng.choice(["inference", "data", "hpc"])
        set_activity_from_allocation(features, site, rng, 0.25, 0.12, rng.choice(["vllm", "mpi", "etl"]))
    elif scenario == "reserved_unused":
        features["o2_allocated_accelerator_count"] = rng.randint(min(512, cap), max(min(cap, 1200), min(512, cap)))
        features["o2_allocation_duration"] = rng.uniform(12, 96)
        features["o2_reservation_priority_preemption_pattern"] = "reserved"
        features["o2_declared_workload_class"] = "reserved"
        features["o2_allocated_compute_hours"] = features["o2_allocated_accelerator_count"] * features["o2_allocation_duration"]
        features["o2_concurrency_fraction"] = features["o2_allocated_accelerator_count"] / max(1, cap)
    elif scenario in {"hpc_mpi", "benchmark", "batch_inference", "model_parallel_inference", "storage_rebuild", "hardware_burn_in"}:
        alloc = rng.randint(64, max(64, min(max_training_alloc, 1600)))
        features["o2_allocated_accelerator_count"] = alloc
        features["o2_allocation_duration"] = rng.uniform(1, 72)
        semantic = {
            "hpc_mpi": "mpi_hpc",
            "benchmark": "nccl_test",
            "batch_inference": "vllm",
            "model_parallel_inference": "tensorrt",
            "storage_rebuild": "etl",
            "hardware_burn_in": "burn_in",
        }[scenario]
        features["o2_declared_workload_class"] = {
            "hpc_mpi": "hpc",
            "benchmark": "benchmark",
            "batch_inference": "inference",
            "model_parallel_inference": "inference",
            "storage_rebuild": "data",
            "hardware_burn_in": "benchmark",
        }[scenario]
        intensity = 0.78 if scenario != "storage_rebuild" else 0.35
        fabric = 0.78 if scenario in {"hpc_mpi", "benchmark", "model_parallel_inference"} else 0.25
        set_activity_from_allocation(features, site, rng, intensity, fabric, semantic)
        if scenario == "storage_rebuild":
            features["o11_initial_data_staging_volume"] = rng.uniform(1e12, 8e15)
            features["o11_read_write_operation_pattern"] = rng.uniform(0.6, 1.5)
            features["o8_rack_it_power_kw"] *= rng.uniform(1.2, 1.8)
        if scenario == "hardware_burn_in":
            features["o11_read_write_operation_pattern"] = 0
            features["o4_gpu_health_error_counts"] = rng.randint(0, 8)
    else:
        alloc_low = min(max_training_alloc, 384 if site.capacity < 768 else 512)
        alloc_high = max(alloc_low, max_training_alloc)
        alloc = rng.randint(alloc_low, alloc_high)
        duration = rng.uniform(18, 240)
        features["o2_allocated_accelerator_count"] = alloc
        features["o2_allocation_duration"] = duration
        features["o2_declared_workload_class"] = "train"
        features["o2_reservation_priority_preemption_pattern"] = "reserved"
        intensity = 0.82
        fabric = 0.8
        semantic = "pytorch_distributed"
        if scenario == "fine_tune_large":
            intensity, fabric, duration = 0.72, 0.58, rng.uniform(8, 96)
            features["o2_allocation_duration"] = duration
        if scenario == "training_no_semantic_logs":
            semantic = "unknown"
        if scenario == "low_fabric_high_checkpoint_training":
            fabric = 0.25
        if scenario == "underclocked_training":
            intensity = 0.55
        if scenario == "fragmented_linked_training":
            fabric = 0.45
            features["o2_topology_contiguity"] = rng.uniform(0.35, 0.62)
        set_activity_from_allocation(features, site, rng, intensity, fabric, semantic)
        features["o11_initial_data_staging_volume"] = rng.uniform(2e12, 1.2e16)
        features["o11_checkpoint_write_size"] = rng.uniform(8e10, 6e12)
        features["o11_checkpoint_period"] = rng.uniform(900, 14400)
        features["o11_read_write_operation_pattern"] = rng.uniform(0.65, 1.35)
        if scenario not in {"training_no_semantic_logs", "evasion_suppressed_counters"}:
            features["o12_declared_model_parameter_count"] = rng.uniform(1e10, 8e11)
            features["o12_training_tokens_examples"] = rng.uniform(5e10, 5e13)
            features["o12_step_count_and_step_time"] = rng.uniform(5000, 800000)
            features["o12_loss_optimizer_checkpoint_metadata"] = "loss_optimizer_checkpoint_present"

    if scenario == "evasion_hidden_scheduler":
        saved = {k: features[k] for k in list(features)}
        features["o2_allocated_accelerator_count"] = 0
        features["o2_allocation_duration"] = 0
        features["o2_allocated_compute_hours"] = 0
        features["o2_concurrency_fraction"] = 0
        features["o2_declared_workload_class"] = "none"
        features["o3_batch_provisioning_event_size"] = saved["o2_allocated_accelerator_count"]
    elif scenario == "evasion_suppressed_counters":
        features["o13_confidential_compute_security_mode"] = "off"
        features["o5_profiler_availability_state"] = "security_blocked"
        features["o4_sm_tensor_core_active_percent"] = 0
        features["o4_hbm_dram_bandwidth_active"] = 0
        features["o14_telemetry_gap_fraction_missed_scrapes"] = rng.uniform(0.15, 0.45)
        features["o14_telemetry_coverage_fraction_by_layer"] = rng.uniform(0.45, 0.75)
    elif scenario == "evasion_fabric_scheduler_mismatch":
        features["o2_allocated_accelerator_count"] = max(0, features["o2_allocated_accelerator_count"] * rng.uniform(0.05, 0.25))
        features["o2_allocated_compute_hours"] = features["o2_allocated_accelerator_count"] * features["o2_allocation_duration"]
        features["o2_concurrency_fraction"] = features["o2_allocated_accelerator_count"] / max(1, cap)
    elif scenario == "evasion_cloud_scheduler_mismatch":
        features["o3_batch_provisioning_event_size"] = max(features["o2_allocated_accelerator_count"], rng.randint(512, max(512, min(cap, 2400))))
        features["o3_capacity_reservation_block_duration"] = rng.uniform(1, 14)
        features["o3_training_instance_type_fraction"] = rng.uniform(0.75, 1)
        features["o2_allocated_accelerator_count"] *= rng.uniform(0, 0.2)
        features["o2_allocated_compute_hours"] = features["o2_allocated_accelerator_count"] * features["o2_allocation_duration"]
        features["o2_concurrency_fraction"] = features["o2_allocated_accelerator_count"] / max(1, cap)
    elif scenario == "evasion_external_capacity_conflict":
        features["o17_external_it_power_capacity_estimate"] = site.baseline_it_mw + rng.uniform(5, 25)
        features["o17_chip_shipment_procurement_indicators"] = site.capacity + rng.randint(1500, 8000)
        features["o17_construction_commissioning_timeline"] = "conflicting_external_evidence"
        features["o1_inventory_delta_rate"] = rng.uniform(1, 8)
    elif scenario == "evasion_active_probe_hidden_load":
        features["o16_probe_throughput_ratio"] = rng.uniform(0.18, 0.55)
        features["o16_probe_latency_inflation"] = rng.uniform(1.8, 5.5)
        features["o16_vram_residency_free_memory_test"] = rng.uniform(0.05, 0.35)
        features["o14_telemetry_coverage_fraction_by_layer"] = min(features["o14_telemetry_coverage_fraction_by_layer"], rng.uniform(0.35, 0.75))

    if site.site_id == "confidential_pool" and rng.random() < 0.45:
        features["o13_confidential_compute_security_mode"] = "on"
        features["o5_profiler_availability_state"] = "confidential_compute_blocked"
        features["o14_telemetry_coverage_fraction_by_layer"] = min(features["o14_telemetry_coverage_fraction_by_layer"], 0.75)
    if site.site_id == "commissioning_site" and rng.random() < 0.35:
        features["o1_inventory_delta_rate"] = rng.uniform(0.5, 4)
        features["o15_rack_door_badge_maintenance_events"] = rng.randint(1, 8)
    if site.site_id == "offledger_watch" and rng.random() < 0.35:
        features["o17_external_it_power_capacity_estimate"] = max(features["o17_external_it_power_capacity_estimate"], site.baseline_it_mw + rng.uniform(2, 10))

    # Keep formulas coherent after any scenario mutation.
    features["o2_allocated_compute_hours"] = round(max(0, features["o2_allocated_accelerator_count"] * features["o2_allocation_duration"]), 3)
    features["o2_concurrency_fraction"] = round(features["o2_allocated_accelerator_count"] / max(1, site.capacity), 4)
    if features["o2_topology_contiguity"] == 0 and features["o2_allocated_accelerator_count"] > 0:
        features["o2_topology_contiguity"] = round(jitter(rng, min(1, site.topology / max(1, features["o2_allocated_accelerator_count"])) * 0.85, 0.12, 0, 1), 4)
    return metadata


def cadence_score(seconds: float) -> float:
    if seconds <= 0:
        return 0.0
    if 2 <= seconds <= 90:
        return 1.0
    if seconds <= 300:
        return 0.55
    return 0.2


def evaluate(features: dict[str, Any], site: Site) -> dict[str, Any]:
    capacity_possible = (
        features["o1_normalized_training_compute_capacity"] >= 512
        and features["o1_largest_low_latency_topology_footprint"] >= 512
        and features["o1_partitioning_fraction"] < 0.75
    )
    policy_ratio = features["o2_allocated_compute_hours"] / POLICY_GPU_HOURS
    concurrency = features["o2_concurrency_fraction"]
    rack_power_fraction = features["o8_rack_it_power_kw"] / max(1, site.rack_design_kw)
    fabric_cadence = cadence_score(features["o7_collective_periodicity_step_cadence"])
    checkpoint_score = 0.0
    if features["o11_checkpoint_write_size"] > 0:
        checkpoint_score = max(checkpoint_score, ramp(math.log10(features["o11_checkpoint_write_size"] + 1), 10.5, 12.5))
    if 600 <= features["o11_checkpoint_period"] <= 21600:
        checkpoint_score = max(checkpoint_score, 0.75)
    runtime = str(features["o10_runtime_framework_class"])
    declared = str(features["o2_declared_workload_class"])
    training_runtime = any(token in runtime for token in ["pytorch", "jax", "tensorflow", "deepspeed", "megatron"])
    false_positive_runtime = any(token in runtime for token in ["mpi", "vllm", "tensorrt", "etl", "burn", "nccl"])
    semantic_logs = features["o12_loss_optimizer_checkpoint_metadata"] != "absent" or features["o12_declared_model_parameter_count"] > 1e10

    allocation_count_score = ramp(features["o2_allocated_accelerator_count"], 64, 512)
    allocation_duration_score = ramp(features["o2_allocation_duration"], 1, 72)
    allocation_duration_gate = ramp(features["o2_allocation_duration"], 0.05, 1)
    allocation_count_gate = ramp(features["o2_allocated_accelerator_count"], 16, 64)
    gpu_busy_score = ramp(features["o4_gpu_busy_percent"], 25, 85)
    gpu_busy_gate = ramp(features["o4_gpu_busy_percent"], 1, 25)

    scores = {
        "capacity": 1.0 if capacity_possible else 0.0,
        "allocation": max(
            ramp(policy_ratio, 0.15, 1.0),
            allocation_count_score * allocation_duration_gate,
            allocation_duration_score * allocation_count_gate,
        ),
        "cloud": max(ramp(features["o3_batch_provisioning_event_size"], 64, 512), ramp(features["o3_capacity_reservation_block_duration"], 0.25, 7) * features["o3_training_instance_type_fraction"]),
        "gpu": (
            gpu_busy_score * 0.35
            + gpu_busy_gate
            * (
                ramp(features["o4_sm_tensor_core_active_percent"], 20, 85) * 0.25
                + ramp(features["o4_gpu_power_draw_or_fraction"], 0.25, 0.85) * 0.25
                + ramp(features["o4_hbm_memory_used"], 0.25, 0.85) * 0.15
            )
        ),
        "fabric": (ramp(features["o7_scaleout_port_utilization"], 15, 70) * 0.25 + ramp(features["o7_synchronized_fabric_footprint"], 64, 512) * 0.35 + fabric_cadence * 0.25 + ramp(features["o6_nvlink_nvswitch_link_utilization"], 15, 75) * 0.15),
        "physical": max(ramp(rack_power_fraction, 0.25, 0.75), ramp(features["o9_gpu_hbm_temperature_celsius"], 45, 78) * 0.7),
        "storage": checkpoint_score * 0.7 + ramp(features["o11_read_write_operation_pattern"], 0.4, 1.1) * 0.3,
        "runtime": 0.9 if training_runtime else 0.2 if runtime not in {"none", "unknown"} else 0.0,
        "ml_logs": 1.0 if semantic_logs else 0.0,
        "coverage": features["o14_telemetry_coverage_fraction_by_layer"],
    }
    for key in scores:
        scores[key] = clamp(scores[key])

    primary = max(scores["allocation"], scores["cloud"]) * 0.2 + scores["gpu"] * 0.16 + scores["fabric"] * 0.24
    support = scores["physical"] * 0.12 + scores["storage"] * 0.10
    semantic = scores["runtime"] * 0.08 + scores["ml_logs"] * 0.10
    raw_training = primary + support + semantic
    if false_positive_runtime or declared in {"hpc", "inference", "benchmark", "data", "reserved"}:
        raw_training *= 0.62
    if not capacity_possible and features["o17_external_it_power_capacity_estimate"] <= site.baseline_it_mw + 2:
        raw_training = min(raw_training, 0.18)
    if max(scores["allocation"], scores["gpu"], scores["fabric"], scores["storage"], scores["runtime"], scores["ml_logs"]) < 0.25:
        raw_training = min(raw_training, 0.08 if scores["coverage"] > 0.8 else 0.18)
    training_probability = clamp(raw_training)

    label_cap = 4
    caps = []
    if not capacity_possible:
        label_cap = min(label_cap, 1)
        caps.append("capacity_below_threshold")
    if scores["physical"] > 0.5 and max(scores["allocation"], scores["gpu"], scores["fabric"], scores["storage"], scores["runtime"], scores["ml_logs"]) < 0.35:
        label_cap = min(label_cap, 2)
        caps.append("physical_only_cap")
    if max(scores["allocation"], scores["gpu"], scores["fabric"], scores["storage"], scores["runtime"], scores["ml_logs"]) < 0.3:
        label_cap = min(label_cap, 1)
        caps.append("weak_activity_cap")
    label = 0 if training_probability < 0.12 else 1 if training_probability < 0.3 else 2 if training_probability < 0.55 else 3

    triggered = []
    def add(rule: str, severity: float) -> None:
        triggered.append({"rule_id": rule, "severity_weight": severity})

    high_activity = scores["gpu"] > 0.6 or scores["fabric"] > 0.6 or scores["physical"] > 0.65
    low_allocation = features["o2_allocated_accelerator_count"] < 16 or features["o2_allocation_duration"] <= 0
    if low_allocation and high_activity and scores["coverage"] > 0.65:
        add("discrepancy_allocation_zero_but_activity_high", 1.0)
    visible_low = scores["gpu"] < 0.25 and scores["fabric"] < 0.25
    if rack_power_fraction > 0.6 and visible_low and scores["coverage"] > 0.7:
        add("discrepancy_power_high_visible_telemetry_low", 1.0)
    if scores["fabric"] > 0.65 and scores["allocation"] < 0.25:
        add("discrepancy_fabric_high_scheduler_low", 1.0)
    if scores["cloud"] > 0.65 and scores["allocation"] < 0.25:
        add("discrepancy_cloud_scheduler_mismatch", 0.65)
    if (
        features["o2_allocated_accelerator_count"] > site.capacity * 1.02
        or features["o7_synchronized_fabric_footprint"] > site.topology * 1.05
        or features["o10_distributed_world_size_rank_count"] > site.capacity * 1.5
    ):
        add("discrepancy_counts_exceed_capacity", 1.0)
    if features["o14_telemetry_gap_fraction_missed_scrapes"] > 0.12 and high_activity:
        add("discrepancy_critical_telemetry_gap_during_candidate_window", 1.0)
    if features["o14_counter_reset_config_change_count"] > 0 and high_activity:
        add("discrepancy_counter_reset_or_config_change_near_activity", 0.65)
    if features["o5_profiler_availability_state"] in {"security_blocked", "disabled"} and features["o13_confidential_compute_security_mode"] != "on" and high_activity:
        add("discrepancy_confidential_compute_unexplained_counter_absence", 0.65)
    if false_positive_runtime and (scores["gpu"] > 0.65 and scores["fabric"] > 0.55 and scores["storage"] > 0.45):
        add("discrepancy_semantic_declaration_conflicts_with_activity", 0.65)
    if scores["storage"] > 0.65 and not training_runtime and not semantic_logs and max(scores["gpu"], scores["fabric"]) > 0.45:
        add("discrepancy_checkpoint_without_training_context", 0.65)
    external_conflict = features["o17_external_it_power_capacity_estimate"] > site.baseline_it_mw + 4 or features["o17_chip_shipment_procurement_indicators"] > site.capacity * 1.8
    if external_conflict:
        add("discrepancy_external_capacity_conflict", 0.65)
    if features["o16_probe_throughput_ratio"] < 0.6 or features["o16_probe_latency_inflation"] > 1.7 or features["o16_vram_residency_free_memory_test"] < 0.4:
        add("discrepancy_active_probe_hidden_load", 0.65)
    if (features["o15_rack_door_badge_maintenance_events"] > 0 or features["o15_firmware_bmc_change_events"] > 0) and (features["o14_telemetry_gap_fraction_missed_scrapes"] > 0.08 or features["o1_inventory_delta_rate"] > 0.5):
        add("discrepancy_physical_or_firmware_change_near_gap", 0.65)

    evasion_probability = 0.0
    for item in triggered:
        evasion_probability = 1 - (1 - evasion_probability) * (1 - item["severity_weight"] * 0.58)
    evasion_probability = clamp(evasion_probability)
    evasion_label = "clear" if evasion_probability < 0.18 else "watch" if evasion_probability < 0.45 else "suspicious" if evasion_probability < 0.7 else "likely"
    strong_cross_layer = (
        max(scores["allocation"], scores["cloud"]) > 0.75
        and scores["gpu"] > 0.65
        and scores["fabric"] > 0.65
        and scores["physical"] > 0.55
        and scores["storage"] > 0.45
    )
    semantic_confirmed = (
        scores["ml_logs"] > 0.8
        and scores["runtime"] > 0.5
        and max(scores["allocation"], scores["cloud"]) > 0.5
        and scores["gpu"] > 0.5
        and scores["fabric"] > 0.5
    )
    if training_probability >= 0.78 and evasion_probability < 0.45 and (strong_cross_layer or semantic_confirmed):
        label = 4
    label = min(label, label_cap)
    no_run_confidence = clamp((1 - training_probability) * scores["coverage"] * (1 - evasion_probability * 0.75))
    evidence = []
    if scores["allocation"] > 0.5:
        evidence.append("large scheduler/allocation evidence")
    if scores["cloud"] > 0.5:
        evidence.append("cloud provisioning/reservation evidence")
    if scores["gpu"] > 0.5:
        evidence.append("high GPU activity")
    if scores["fabric"] > 0.5:
        evidence.append("synchronized scale-out fabric")
    if scores["physical"] > 0.5:
        evidence.append("power/thermal corroboration")
    if scores["storage"] > 0.5:
        evidence.append("checkpoint/storage pattern")
    if scores["runtime"] > 0.5:
        evidence.append("training runtime semantics")
    if scores["ml_logs"] > 0.5:
        evidence.append("ML logs/declarations")
    if false_positive_runtime:
        evidence.append("countervailing non-training runtime/declaration")
    if not evidence:
        evidence = ["no strong positive training evidence"]

    return {
        "training_probability": round(training_probability, 5),
        "training_label": int(label),
        "training_confidence": round(clamp(scores["coverage"] * (1 - evasion_probability * 0.4)), 5),
        "evasion_probability": round(evasion_probability, 5),
        "evasion_label": evasion_label,
        "evasion_rule_ids": [item["rule_id"] for item in triggered],
        "layer_scores": {k: round(v, 5) for k, v in scores.items()},
        "label_caps_applied": caps,
        "negative_certification_confidence": round(no_run_confidence, 5),
        "top_training_evidence": evidence[:8],
        "benign_explanations_to_check": benign_explanations([item["rule_id"] for item in triggered]),
        "capacity_possible": capacity_possible,
        "integrity_warning": bool(triggered or scores["coverage"] < 0.8),
    }


BENIGN_EXPLANATIONS = {
    "discrepancy_allocation_zero_but_activity_high": ["scheduler blind spot", "mapping error", "manual workload"],
    "discrepancy_power_high_visible_telemetry_low": ["non-GPU load", "meter mapping error", "baseline drift"],
    "discrepancy_fabric_high_scheduler_low": ["HPC/MPI", "NCCL benchmark", "missing job-port mapping"],
    "discrepancy_cloud_scheduler_mismatch": ["unused reservation", "billing delay", "account aggregation mismatch"],
    "discrepancy_counts_exceed_capacity": ["wrong denominator", "federation", "stale inventory"],
    "discrepancy_critical_telemetry_gap_during_candidate_window": ["planned maintenance", "collector upgrade", "network outage"],
    "discrepancy_counter_reset_or_config_change_near_activity": ["planned restart", "firmware update", "counter wrap"],
    "discrepancy_confidential_compute_unexplained_counter_absence": ["security policy", "driver issue", "permission change"],
    "discrepancy_semantic_declaration_conflicts_with_activity": ["wrong class", "mixed workload", "benchmark"],
    "discrepancy_checkpoint_without_training_context": ["backup", "replication", "ETL"],
    "discrepancy_external_capacity_conflict": ["public estimate error", "uncommissioned capacity", "non-AI load"],
    "discrepancy_active_probe_hidden_load": ["background load", "power cap", "thermal throttle"],
    "discrepancy_physical_or_firmware_change_near_gap": ["approved maintenance", "RMA", "scheduled firmware update"],
}


def benign_explanations(rule_ids: list[str]) -> list[str]:
    out: list[str] = []
    for rule_id in rule_ids:
        for item in BENIGN_EXPLANATIONS.get(rule_id, []):
            if item not in out:
                out.append(item)
    return out[:8]


def feature_ranges(rows: list[dict[str, Any]]) -> dict[str, Any]:
    keys = sorted(rows[0]["features"])
    ranges: dict[str, Any] = {}
    for key in keys:
        values = [row["features"][key] for row in rows if isinstance(row["features"].get(key), (int, float))]
        if not values:
            continue
        values.sort()
        def q(p: float) -> float:
            return values[min(len(values) - 1, max(0, int(round((len(values) - 1) * p))))]
        ranges[key] = {"min": round(values[0], 5), "p05": round(q(0.05), 5), "median": round(q(0.5), 5), "p95": round(q(0.95), 5), "max": round(values[-1], 5)}
    return ranges


def categorical_values(rows: list[dict[str, Any]]) -> dict[str, list[str]]:
    out: dict[str, set[str]] = {}
    for row in rows:
        for key, value in row["features"].items():
            if isinstance(value, str):
                out.setdefault(key, set()).add(value)
    return {key: sorted(values) for key, values in sorted(out.items())}


def scenario_summary(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for scenario in sorted({row["scenario_family"] for row in rows}):
        subset = [row for row in rows if row["scenario_family"] == scenario]
        out.append(
            {
                "scenario": scenario,
                "rows": len(subset),
                "training_positive_rows": sum(1 for row in subset if row["is_large_training"]),
                "evasion_positive_rows": sum(1 for row in subset if row["is_evasion_attempt"]),
                "mean_training_probability": round(sum(row["training_probability"] for row in subset) / len(subset), 5),
                "mean_evasion_probability": round(sum(row["evasion_probability"] for row in subset) / len(subset), 5),
            }
        )
    return out


def main() -> None:
    rng = random.Random(SEED)
    catalog = yaml.safe_load((CATALOG_DIR / "observable_feature_catalog.v2.yaml").read_text())
    rows = []
    for index in range(ROW_COUNT):
        site = rng.choice(SITES)
        scenario = choose_scenario(rng)
        features = base_features(site, rng)
        latent = apply_scenario(features, site, scenario, rng)
        eval_result = evaluate(features, site)
        row = {
            "feature_row_id": f"v2_{index:05d}",
            "site_id": site.site_id,
            "scenario_family": scenario,
            "scenario_variant": latent.get("evasion_type", "standard"),
            "window_length_seconds": rng.choice([900, 3600, 21600, 86400]),
            "true_workload_class": "large_training" if latent["training"] else scenario,
            "is_large_training": bool(latent["training"]),
            "is_evasion_attempt": bool(latent["evasion"]),
            "evasion_type": latent.get("evasion_type", "none"),
            **eval_result,
            "features": features,
        }
        rows.append(row)
    labels = {
        "training": ["No training likely", "Training possible", "Elevated training probability", "Training likely happening", "Highest warning / definite"],
        "evasion": ["Clear", "Watch", "Suspicious", "Likely"],
    }
    example_rows = {}
    for label in range(5):
        candidate = min(rows, key=lambda row: (abs(row["training_label"] - label), -row["training_probability"]))
        example_rows[str(label)] = candidate["feature_row_id"]
    evasion_examples = {}
    for label in ["clear", "watch", "suspicious", "likely"]:
        candidates = [row for row in rows if row["evasion_label"] == label]
        if candidates:
            evasion_examples[label] = max(candidates, key=lambda row: row["evasion_probability"])["feature_row_id"]
    site_rows = []
    for site in SITES:
        subset = [row for row in rows if row["site_id"] == site.site_id]
        site_rows.append(
            {
                "site_id": site.site_id,
                "name": site.name,
                "operator_type": site.operator_type,
                "operator_aim": site.operator_aim,
                "normalized_training_compute_capacity": site.capacity,
                "largest_low_latency_topology_footprint": site.topology,
                "homogeneous_high_end_accelerator_fraction": site.homogeneous,
                "partitioning_fraction": site.partitioning,
                "rack_power_design_kw": site.rack_design_kw,
                "baseline_it_mw": site.baseline_it_mw,
                "telemetry_stack": site.telemetry_stack,
                "trust_tier": site.trust_tier,
                "blind_spots": site.blind_spots,
                "rows": len(subset),
            }
        )
    data = {
        "metadata": {
            "dataset_id": f"catalog_v2_seed_{SEED}",
            "scale": "v2 catalog-derived deterministic",
            "row_count": len(rows),
            "site_count": len(SITES),
            "catalog_id": catalog["catalog_id"],
            "synthetic_notice": "All sites, workloads, telemetry, and outputs are synthetic and generated from the public v2 catalog rules.",
            "old_model_outputs_used": False,
            "old_model_importances_used": False,
            "generated_from": {
                "catalog": "catalog/",
                "script": "scripts/build_v2_demo_data.py",
            },
        },
        "labels": labels,
        "example_rows": example_rows,
        "evasion_example_rows": evasion_examples,
        "sites": site_rows,
        "scenarios": scenario_summary(rows),
        "categorical_values": categorical_values(rows),
        "feature_ranges": feature_ranges(rows),
        "rows": rows,
    }
    DATA_DIR.mkdir(exist_ok=True)
    json_text = json.dumps(data, separators=(",", ":"), sort_keys=True)
    (DATA_DIR / "demo-data.json").write_text(json_text + "\n", encoding="utf-8")
    (DATA_DIR / "demo-data.js").write_text("window.DCVDemoData = " + json_text + ";\n", encoding="utf-8")
    catalog_json = {
        "features": catalog["observables"],
        "sources": catalog["sources"],
    }
    (DATA_DIR / "catalog.v2.json").write_text(json.dumps(catalog_json, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"rows": len(rows), "sites": len(SITES), "scenarios": len(SCENARIOS)}, indent=2))


if __name__ == "__main__":
    main()
