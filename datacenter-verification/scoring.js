(function () {
const TRAINING_LABEL_NAMES = [
  "No training likely",
  "Training possible",
  "Elevated training probability",
  "Training likely happening",
  "Highest warning / definite",
];

const EVASION_LABEL_NAMES = {
  clear: "Clear",
  watch: "Watch",
  suspicious: "Suspicious",
  likely: "Likely",
};

const TRAINING_RUNTIME_MARKERS = ["pytorch", "jax", "tensorflow", "deepspeed", "megatron"];
const FALSE_POSITIVE_RUNTIME_MARKERS = ["mpi", "vllm", "tensorrt", "etl", "burn", "nccl"];
const FALSE_POSITIVE_DECLARED_CLASSES = new Set(["hpc", "inference", "benchmark", "data", "reserved"]);
const POLICY_GPU_HOURS = 512 * 24;

const BENIGN_EXPLANATIONS = {
  discrepancy_allocation_zero_but_activity_high: ["scheduler blind spot", "mapping error", "manual workload"],
  discrepancy_power_high_visible_telemetry_low: ["non-GPU load", "meter mapping error", "baseline drift"],
  discrepancy_fabric_high_scheduler_low: ["HPC/MPI", "NCCL benchmark", "missing job-port mapping"],
  discrepancy_cloud_scheduler_mismatch: ["unused reservation", "billing delay", "account aggregation mismatch"],
  discrepancy_counts_exceed_capacity: ["wrong denominator", "federation", "stale inventory"],
  discrepancy_critical_telemetry_gap_during_candidate_window: ["planned maintenance", "collector upgrade", "network outage"],
  discrepancy_counter_reset_or_config_change_near_activity: ["planned restart", "firmware update", "counter wrap"],
  discrepancy_confidential_compute_unexplained_counter_absence: ["security policy", "driver issue", "permission change"],
  discrepancy_semantic_declaration_conflicts_with_activity: ["wrong class", "mixed workload", "benchmark"],
  discrepancy_checkpoint_without_training_context: ["backup", "replication", "ETL"],
  discrepancy_external_capacity_conflict: ["public estimate error", "uncommissioned capacity", "non-AI load"],
  discrepancy_active_probe_hidden_load: ["background load", "power cap", "thermal throttle"],
  discrepancy_physical_or_firmware_change_near_gap: ["approved maintenance", "RMA", "scheduled firmware update"],
};

function clamp(value, min = 0, max = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function ramp(value, low, high) {
  if (high <= low) return 0;
  return clamp((asNumber(value) - low) / (high - low));
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asBool(value) {
  if (typeof value === "boolean") return value;
  if (value == null) return false;
  return ["true", "t", "1", "yes", "y"].includes(String(value).toLowerCase());
}

function isOneOf(value, markers) {
  const lower = String(value || "").toLowerCase();
  return markers.some((marker) => lower.includes(marker));
}

function labelName(label) {
  return TRAINING_LABEL_NAMES[label] || "Unknown";
}

function labelColor(label) {
  return ["#217a57", "#6b7a31", "#bf7a16", "#c85f23", "#bd3d3a"][label] || "#64706b";
}

function evasionName(label) {
  return EVASION_LABEL_NAMES[label] || "Unknown";
}

function evasionColor(label) {
  return {
    clear: "#217a57",
    watch: "#6b7a31",
    suspicious: "#bf7a16",
    likely: "#bd3d3a",
  }[label] || "#64706b";
}

function formatPercent(value, digits = 0) {
  return `${(clamp(value) * 100).toFixed(digits)}%`;
}

function formatNumber(value, digits = 0) {
  const number = asNumber(value);
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(number);
}

function formatBytes(value) {
  const number = Math.max(0, asNumber(value));
  if (number >= 1e12) return `${formatNumber(number / 1e12, 2)} TB`;
  if (number >= 1e9) return `${formatNumber(number / 1e9, 1)} GB`;
  if (number >= 1e6) return `${formatNumber(number / 1e6, 1)} MB`;
  return `${formatNumber(number, 0)} B`;
}

function cadenceScore(seconds) {
  const value = asNumber(seconds);
  if (value <= 0) return 0;
  if (value >= 2 && value <= 90) return 1;
  if (value <= 300) return 0.55;
  return 0.2;
}

function siteCapacity(site, features) {
  return asNumber(
    site?.normalized_training_compute_capacity ??
      site?.capacity ??
      features.o1_normalized_training_compute_capacity ??
      features.o1_accelerator_count
  );
}

function siteTopology(site, features) {
  return asNumber(
    site?.largest_low_latency_topology_footprint ??
      site?.topology ??
      features.o1_largest_low_latency_topology_footprint ??
      siteCapacity(site, features)
  );
}

function siteRackDesignKw(site, features) {
  return Math.max(
    1,
    asNumber(
      site?.rack_power_design_kw ??
        site?.rack_design_kw ??
        features.o8_rack_design_kw ??
        Math.max(1000, asNumber(features.o8_rack_it_power_kw))
    )
  );
}

function siteBaselineMw(site, features) {
  return asNumber(site?.baseline_it_mw ?? features.o8_facility_it_power_mw ?? 0);
}

function deriveFeatureState(features = {}, site = null) {
  const out = { ...features };
  const capacity = siteCapacity(site, out);
  const topology = siteTopology(site, out);
  const allocation = Math.max(0, asNumber(out.o2_allocated_accelerator_count));
  const duration = Math.max(0, asNumber(out.o2_allocation_duration));

  out.o1_normalized_training_compute_capacity = capacity;
  out.o1_largest_low_latency_topology_footprint = topology;
  out.o1_partitioning_fraction = clamp(out.o1_partitioning_fraction, 0, 1);
  out.o2_allocated_accelerator_count = allocation;
  out.o2_allocation_duration = duration;
  out.o2_allocated_compute_hours = allocation * duration;
  out.o2_concurrency_fraction = capacity > 0 ? clamp(allocation / capacity, 0, 2) : 0;
  out.o10_distributed_world_size_rank_count = Math.max(
    asNumber(out.o10_distributed_world_size_rank_count),
    Math.round(allocation)
  );
  out.o14_telemetry_coverage_fraction_by_layer = clamp(out.o14_telemetry_coverage_fraction_by_layer, 0, 1);
  out.o14_telemetry_gap_fraction_missed_scrapes = clamp(out.o14_telemetry_gap_fraction_missed_scrapes, 0, 1);
  out.o16_probe_throughput_ratio = Math.max(0, asNumber(out.o16_probe_throughput_ratio, 1));
  out.o16_probe_latency_inflation = Math.max(0, asNumber(out.o16_probe_latency_inflation, 1));
  out.o16_vram_residency_free_memory_test = clamp(out.o16_vram_residency_free_memory_test, 0, 1);
  out.capacity_possible = capacity >= 512 && topology >= 512 && out.o1_partitioning_fraction < 0.75;
  return out;
}

function scoreFeatures(inputFeatures = {}, site = null) {
  const features = deriveFeatureState(inputFeatures, site);
  const capacity = siteCapacity(site, features);
  const topology = siteTopology(site, features);
  const rackDesignKw = siteRackDesignKw(site, features);
  const baselineMw = siteBaselineMw(site, features);
  const runtime = String(features.o10_runtime_framework_class || "");
  const declared = String(features.o2_declared_workload_class || "");
  const policyRatio = asNumber(features.o2_allocated_compute_hours) / POLICY_GPU_HOURS;
  const rackPowerFraction = asNumber(features.o8_rack_it_power_kw) / rackDesignKw;
  const trainingRuntime = isOneOf(runtime, TRAINING_RUNTIME_MARKERS);
  const falsePositiveRuntime = isOneOf(runtime, FALSE_POSITIVE_RUNTIME_MARKERS);
  const falsePositiveDeclared = FALSE_POSITIVE_DECLARED_CLASSES.has(declared.toLowerCase());
  const semanticLogs =
    String(features.o12_loss_optimizer_checkpoint_metadata || "absent") !== "absent" ||
    asNumber(features.o12_declared_model_parameter_count) > 1e10;

  let checkpointScore = 0;
  if (asNumber(features.o11_checkpoint_write_size) > 0) {
    checkpointScore = Math.max(checkpointScore, ramp(Math.log10(asNumber(features.o11_checkpoint_write_size) + 1), 10.5, 12.5));
  }
  if (asNumber(features.o11_checkpoint_period) >= 600 && asNumber(features.o11_checkpoint_period) <= 21600) {
    checkpointScore = Math.max(checkpointScore, 0.75);
  }

  const scores = {
    capacity: features.capacity_possible ? 1 : 0,
    allocation: Math.max(
      ramp(features.o2_allocated_accelerator_count, 64, 512),
      ramp(policyRatio, 0.15, 1),
      ramp(features.o2_allocation_duration, 1, 72)
    ),
    cloud: Math.max(
      ramp(features.o3_batch_provisioning_event_size, 64, 512),
      ramp(features.o3_capacity_reservation_block_duration, 0.25, 7) *
        clamp(features.o3_training_instance_type_fraction)
    ),
    gpu:
      ramp(features.o4_gpu_busy_percent, 25, 85) * 0.35 +
      ramp(features.o4_sm_tensor_core_active_percent, 20, 85) * 0.25 +
      ramp(features.o4_gpu_power_draw_or_fraction, 0.25, 0.85) * 0.25 +
      ramp(features.o4_hbm_memory_used, 0.25, 0.85) * 0.15,
    fabric:
      ramp(features.o7_scaleout_port_utilization, 15, 70) * 0.25 +
      ramp(features.o7_synchronized_fabric_footprint, 64, 512) * 0.35 +
      cadenceScore(features.o7_collective_periodicity_step_cadence) * 0.25 +
      ramp(features.o6_nvlink_nvswitch_link_utilization, 15, 75) * 0.15,
    physical: Math.max(
      ramp(rackPowerFraction, 0.25, 0.75),
      ramp(features.o9_gpu_hbm_temperature_celsius, 45, 78) * 0.7
    ),
    storage: checkpointScore * 0.7 + ramp(features.o11_read_write_operation_pattern, 0.4, 1.1) * 0.3,
    runtime: trainingRuntime ? 0.9 : runtime && !["none", "unknown"].includes(runtime.toLowerCase()) ? 0.2 : 0,
    ml_logs: semanticLogs ? 1 : 0,
    coverage: clamp(features.o14_telemetry_coverage_fraction_by_layer),
  };
  for (const key of Object.keys(scores)) scores[key] = clamp(scores[key]);

  const primary = Math.max(scores.allocation, scores.cloud) * 0.2 + scores.gpu * 0.16 + scores.fabric * 0.24;
  const support = scores.physical * 0.12 + scores.storage * 0.1;
  const semantic = scores.runtime * 0.08 + scores.ml_logs * 0.1;
  let trainingProbability = primary + support + semantic;

  if (falsePositiveRuntime || falsePositiveDeclared) trainingProbability *= 0.62;
  if (!features.capacity_possible && asNumber(features.o17_external_it_power_capacity_estimate) <= baselineMw + 2) {
    trainingProbability = Math.min(trainingProbability, 0.18);
  }
  if (Math.max(scores.allocation, scores.gpu, scores.fabric, scores.storage, scores.runtime, scores.ml_logs) < 0.25) {
    trainingProbability = Math.min(trainingProbability, scores.coverage > 0.8 ? 0.08 : 0.18);
  }
  trainingProbability = clamp(trainingProbability);

  const labelCaps = [];
  let labelCap = 4;
  if (!features.capacity_possible) {
    labelCap = Math.min(labelCap, 1);
    labelCaps.push("capacity_below_threshold");
  }
  if (scores.physical > 0.5 && Math.max(scores.allocation, scores.gpu, scores.fabric, scores.storage, scores.runtime, scores.ml_logs) < 0.35) {
    labelCap = Math.min(labelCap, 2);
    labelCaps.push("physical_only_cap");
  }
  if (Math.max(scores.allocation, scores.gpu, scores.fabric, scores.storage, scores.runtime, scores.ml_logs) < 0.3) {
    labelCap = Math.min(labelCap, 1);
    labelCaps.push("weak_activity_cap");
  }

  let label =
    trainingProbability < 0.12 ? 0 :
    trainingProbability < 0.3 ? 1 :
    trainingProbability < 0.55 ? 2 : 3;
  if (
    trainingProbability >= 0.78 &&
    (scores.ml_logs > 0.8 || (scores.allocation > 0.75 && scores.gpu > 0.65 && scores.fabric > 0.65 && scores.physical > 0.55 && scores.storage > 0.45))
  ) {
    label = 4;
  }
  label = Math.min(label, labelCap);

  const triggered = discrepancyRules(features, scores, {
    capacity,
    topology,
    rackPowerFraction,
    falsePositiveRuntime,
    trainingRuntime,
    semanticLogs,
    baselineMw,
  });
  const evasionProbability = evasionProbabilityFromRules(triggered);
  const evasionLabel = evasionProbability < 0.18 ? "clear" : evasionProbability < 0.45 ? "watch" : evasionProbability < 0.7 ? "suspicious" : "likely";
  const noRunConfidence = clamp((1 - trainingProbability) * scores.coverage * (1 - evasionProbability * 0.75));
  const topEvidence = topTrainingEvidence(scores, { falsePositiveRuntime });
  const criticalMissingLayers = missingLayerWarnings(features, scores, triggered);

  return {
    mode: "Catalog v2 deterministic evaluator",
    label,
    labelName: labelName(label),
    probabilities: probabilitiesFor(trainingProbability, labelCap),
    pLarge: trainingProbability,
    severity: trainingProbability * 4,
    trainingProbability,
    trainingConfidence: clamp(scores.coverage * (1 - evasionProbability * 0.4)),
    evasionProbability,
    evasionLabel,
    evasionLabelName: evasionName(evasionLabel),
    evasionRules: triggered.map((item) => item.rule_id),
    benignExplanations: benignExplanations(triggered.map((item) => item.rule_id)),
    negativeCertificationConfidence: noRunConfidence,
    capacityPossible: !!features.capacity_possible,
    integrityWarning: triggered.length > 0 || scores.coverage < 0.8,
    criticalMissingLayers,
    topEvidence,
    consistencyWarnings: userFacingWarnings(features, scores, triggered, { capacity, topology }),
    labelCapsApplied: labelCaps,
    layerScores: scores,
    features,
  };
}

function discrepancyRules(features, scores, context) {
  const triggered = [];
  const add = (rule_id, severity_weight) => triggered.push({ rule_id, severity_weight });
  const highActivity = scores.gpu > 0.6 || scores.fabric > 0.6 || scores.physical > 0.65;
  const lowAllocation = asNumber(features.o2_allocated_accelerator_count) < 16 || asNumber(features.o2_allocation_duration) <= 0;
  const visibleLow = scores.gpu < 0.25 && scores.fabric < 0.25;

  if (lowAllocation && highActivity && scores.coverage > 0.65) add("discrepancy_allocation_zero_but_activity_high", 1);
  if (context.rackPowerFraction > 0.6 && visibleLow && scores.coverage > 0.7) add("discrepancy_power_high_visible_telemetry_low", 1);
  if (scores.fabric > 0.65 && scores.allocation < 0.25) add("discrepancy_fabric_high_scheduler_low", 1);
  if (scores.cloud > 0.65 && scores.allocation < 0.25) add("discrepancy_cloud_scheduler_mismatch", 0.65);
  if (
    asNumber(features.o2_allocated_accelerator_count) > context.capacity * 1.02 ||
    asNumber(features.o7_synchronized_fabric_footprint) > context.topology * 1.05 ||
    asNumber(features.o10_distributed_world_size_rank_count) > context.capacity * 1.5
  ) {
    add("discrepancy_counts_exceed_capacity", 1);
  }
  if (asNumber(features.o14_telemetry_gap_fraction_missed_scrapes) > 0.12 && highActivity) {
    add("discrepancy_critical_telemetry_gap_during_candidate_window", 1);
  }
  if (asNumber(features.o14_counter_reset_config_change_count) > 0 && highActivity) {
    add("discrepancy_counter_reset_or_config_change_near_activity", 0.65);
  }
  if (
    ["security_blocked", "disabled"].includes(String(features.o5_profiler_availability_state || "")) &&
    String(features.o13_confidential_compute_security_mode || "") !== "on" &&
    highActivity
  ) {
    add("discrepancy_confidential_compute_unexplained_counter_absence", 0.65);
  }
  if (context.falsePositiveRuntime && scores.gpu > 0.65 && scores.fabric > 0.55 && scores.storage > 0.45) {
    add("discrepancy_semantic_declaration_conflicts_with_activity", 0.65);
  }
  if (scores.storage > 0.65 && !context.trainingRuntime && !context.semanticLogs && Math.max(scores.gpu, scores.fabric) > 0.45) {
    add("discrepancy_checkpoint_without_training_context", 0.65);
  }
  const externalConflict =
    asNumber(features.o17_external_it_power_capacity_estimate) > context.baselineMw + 4 ||
    asNumber(features.o17_chip_shipment_procurement_indicators) > context.capacity * 1.8;
  if (externalConflict) add("discrepancy_external_capacity_conflict", 0.65);
  if (
    asNumber(features.o16_probe_throughput_ratio, 1) < 0.6 ||
    asNumber(features.o16_probe_latency_inflation, 1) > 1.7 ||
    asNumber(features.o16_vram_residency_free_memory_test, 1) < 0.4
  ) {
    add("discrepancy_active_probe_hidden_load", 0.65);
  }
  if (
    (asNumber(features.o15_rack_door_badge_maintenance_events) > 0 || asNumber(features.o15_firmware_bmc_change_events) > 0) &&
    (asNumber(features.o14_telemetry_gap_fraction_missed_scrapes) > 0.08 || asNumber(features.o1_inventory_delta_rate) > 0.5)
  ) {
    add("discrepancy_physical_or_firmware_change_near_gap", 0.65);
  }
  return triggered;
}

function evasionProbabilityFromRules(triggered) {
  let probability = 0;
  for (const item of triggered) {
    probability = 1 - (1 - probability) * (1 - item.severity_weight * 0.58);
  }
  return clamp(probability);
}

function topTrainingEvidence(scores, context) {
  const evidence = [];
  if (scores.allocation > 0.5) evidence.push("large scheduler/allocation evidence");
  if (scores.cloud > 0.5) evidence.push("cloud provisioning/reservation evidence");
  if (scores.gpu > 0.5) evidence.push("high GPU activity");
  if (scores.fabric > 0.5) evidence.push("synchronized scale-out fabric");
  if (scores.physical > 0.5) evidence.push("power/thermal corroboration");
  if (scores.storage > 0.5) evidence.push("checkpoint/storage pattern");
  if (scores.runtime > 0.5) evidence.push("training runtime semantics");
  if (scores.ml_logs > 0.5) evidence.push("ML logs/declarations");
  if (context.falsePositiveRuntime) evidence.push("countervailing non-training runtime/declaration");
  return evidence.length ? evidence.slice(0, 8) : ["no strong positive training evidence"];
}

function missingLayerWarnings(features, scores, triggered) {
  const warnings = [];
  if (scores.coverage < 0.8) warnings.push("cross-layer telemetry coverage below 80%");
  if (asNumber(features.o14_telemetry_gap_fraction_missed_scrapes) > 0.08) warnings.push("candidate window has material telemetry gaps");
  if (String(features.o5_profiler_availability_state || "") !== "available") warnings.push("profiler/counter availability is limited");
  if (asNumber(features.o7_job_to_port_mapping_coverage) < 0.5 && scores.fabric > 0.45) warnings.push("weak job-to-port mapping for fabric evidence");
  if (triggered.length) warnings.push("discrepancy rules require reconciliation before no-run certification");
  return warnings;
}

function userFacingWarnings(features, scores, triggered, context) {
  const warnings = [];
  if (asNumber(features.o2_allocated_accelerator_count) > context.capacity * 1.02) {
    warnings.push("allocated accelerators exceed monitored capacity");
  }
  if (asNumber(features.o7_synchronized_fabric_footprint) > context.topology * 1.05) {
    warnings.push("fabric footprint exceeds largest low-latency topology");
  }
  for (const item of triggered) warnings.push(item.rule_id.replace(/^discrepancy_/, "").replaceAll("_", " "));
  if (scores.coverage < 0.8) warnings.push("low telemetry coverage limits confidence");
  return [...new Set(warnings)];
}

function benignExplanations(ruleIds) {
  const out = [];
  for (const ruleId of ruleIds) {
    for (const item of BENIGN_EXPLANATIONS[ruleId] || []) {
      if (!out.includes(item)) out.push(item);
    }
  }
  return out.slice(0, 8);
}

function probabilitiesFor(probability, labelCap = 4) {
  const centers = [0.05, 0.2, 0.42, 0.66, 0.88];
  const weights = centers.map((center, label) => {
    const capPenalty = label > labelCap ? 0.12 : 1;
    return Math.exp(-Math.abs(probability - center) * 7.5) * capPenalty;
  });
  const total = weights.reduce((sum, value) => sum + value, 0) || 1;
  return weights.map((value) => value / total);
}

function replayResult(row, site = null) {
  const featureResult = scoreFeatures(row.features || {}, site);
  const label = Number.isFinite(Number(row.training_label)) ? Number(row.training_label) : featureResult.label;
  const pLarge = Number.isFinite(Number(row.training_probability)) ? Number(row.training_probability) : featureResult.pLarge;
  const evasionProbability = Number.isFinite(Number(row.evasion_probability)) ? Number(row.evasion_probability) : featureResult.evasionProbability;
  const evasionLabel = row.evasion_label || featureResult.evasionLabel;
  const labelCap = Math.max(label, 0);
  return {
    ...featureResult,
    mode: "Catalog v2 generated datapoint",
    label,
    labelName: labelName(label),
    probabilities: probabilitiesFor(pLarge, labelCap),
    pLarge,
    severity: pLarge * 4,
    trainingProbability: pLarge,
    trainingConfidence: asNumber(row.training_confidence, featureResult.trainingConfidence),
    evasionProbability,
    evasionLabel,
    evasionLabelName: evasionName(evasionLabel),
    evasionRules: Array.isArray(row.evasion_rule_ids) ? row.evasion_rule_ids : featureResult.evasionRules,
    benignExplanations: Array.isArray(row.benign_explanations_to_check)
      ? row.benign_explanations_to_check
      : featureResult.benignExplanations,
    negativeCertificationConfidence: asNumber(row.negative_certification_confidence, featureResult.negativeCertificationConfidence),
    capacityPossible: row.capacity_possible ?? featureResult.capacityPossible,
    integrityWarning: row.integrity_warning ?? featureResult.integrityWarning,
    topEvidence: Array.isArray(row.top_training_evidence) ? row.top_training_evidence : featureResult.topEvidence,
    labelCapsApplied: Array.isArray(row.label_caps_applied) ? row.label_caps_applied : featureResult.labelCapsApplied,
    layerScores: row.layer_scores || featureResult.layerScores,
    features: deriveFeatureState(row.features || {}, site),
  };
}

window.DCVScoring = {
  asBool,
  asNumber,
  cadenceScore,
  clamp,
  deriveFeatureState,
  evasionColor,
  evasionName,
  formatBytes,
  formatNumber,
  formatPercent,
  labelColor,
  labelName,
  replayResult,
  scoreFeatures,
};
})();
