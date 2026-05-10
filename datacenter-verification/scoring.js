const LABEL_NAMES = [
  "No training likely",
  "Training possible",
  "Elevated training probability",
  "Training likely happening",
  "Highest warning / definite",
];

const FALSE_POSITIVE_RUNTIME_MARKERS = [
  "inference",
  "hpc",
  "mpi",
  "nccl",
  "benchmark",
  "burn_in",
  "storage",
  "etl",
  "synthetic_data",
];

const FALSE_POSITIVE_DECLARED_CLASSES = new Set([
  "inference",
  "hpc",
  "benchmark",
  "burn_in",
  "data",
  "reserved",
  "none",
]);

function clamp(value, min = 0, max = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
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

function labelName(label) {
  return LABEL_NAMES[label] || "Unknown";
}

function labelColor(label) {
  return ["#217a57", "#6b7a31", "#bf7a16", "#c85f23", "#bd3d3a"][label] || "#64706b";
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

function deriveFeatureState(features) {
  const out = { ...features };
  const capacity = asNumber(out.o1_normalized_h100e_capacity);
  const allocation = asNumber(out.o2_max_concurrent_normalized_gpus);
  const duration = asNumber(out.o2_allocation_duration_hours);
  const gpuHoursRatio = (allocation * duration) / (512 * 24);
  if (Number.isFinite(gpuHoursRatio)) {
    out.o2_gpu_hours_policy_ratio = gpuHoursRatio;
    out.policy_compute_ratio = gpuHoursRatio;
  }
  out.o2_concurrency_fraction_domain = capacity > 0 ? clamp(allocation / capacity) : 0;
  out.o10_world_size = Math.round(allocation);
  out.o10_same_image_gpu_count = Math.round(allocation);
  out.capacity_possible = capacity >= 512 && asNumber(out.o1_largest_contiguous_domain_gpus, capacity) >= 512;
  out.o14_min_critical_coverage = clamp(out.o14_min_critical_coverage, 0, 1);
  out.o14_gap_fraction_critical = clamp(out.o14_gap_fraction_critical, 0, 1);
  return out;
}

function evidenceFlags(inputFeatures) {
  const row = deriveFeatureState(inputFeatures);
  const capacity = asBool(row.capacity_possible);
  const externalConflict = asNumber(row.o17_external_capacity_conflict_score) >= 0.5;
  const allocationGpus = asNumber(row.o2_max_concurrent_normalized_gpus);
  const allocationHours = asNumber(row.o2_allocation_duration_hours);
  const gpuHoursRatio = asNumber(row.o2_gpu_hours_policy_ratio);
  const policyRatio = asNumber(row.policy_compute_ratio);
  const gpuUtil = asNumber(row.o4_gpu_util_p95);
  const gpuDuty = asNumber(row.o4_gpu_util_duty_gt_70);
  const tensor = asNumber(row.o4_sm_tensor_active_p95);
  const fabricFootprint = asNumber(row.o7_synchronized_fabric_footprint);
  const fabricPeriodicity = asNumber(row.o7_collective_periodicity_score);
  const fabricUtil = asNumber(row.o7_scaleout_port_util_p95);
  const rackPower = asNumber(row.o8_rack_power_fraction_p95);
  const checkpoint = asNumber(row.o11_checkpoint_periodicity_score);
  const checkpointTb = asNumber(row.o11_checkpoint_write_tb_per_event);
  const storagePattern = asNumber(row.o11_read_write_training_pattern_score);
  const signedLogs = asBool(row.o12_signed_ml_logs_present);
  const declaredParams = asNumber(row.o12_declared_parameter_count_b);
  const trainingTokens = asNumber(row.o12_training_tokens_b);
  const optimizerState = asBool(row.o12_optimizer_state_present);
  const minCoverage = asNumber(row.o14_min_critical_coverage, 1);
  const gapFraction = asNumber(row.o14_gap_fraction_critical);
  const ccFraction = asNumber(row.o13_confidential_compute_mode_fraction);
  const counterResets = asNumber(row.o14_counter_reset_count);
  const runtime = String(row.o10_runtime_framework_class || "").toLowerCase();
  const declaredClass = String(row.o2_declared_workload_class || "").toLowerCase();
  const o4Missing = String(row.o4_missing_reason || "");

  const allocation =
    allocationGpus >= 512 ||
    gpuHoursRatio >= 1 ||
    policyRatio >= 1 ||
    (allocationGpus >= 256 && allocationHours >= 12);
  const gpuActivity = gpuUtil >= 70 || gpuDuty >= 0.45 || tensor >= 60;
  const fabricSync = fabricFootprint >= 256 || fabricPeriodicity >= 0.55 || fabricUtil >= 0.65;
  const physicalSupport = rackPower >= 0.55;
  const storageSemantic = checkpoint >= 0.55 || checkpointTb >= 0.25 || storagePattern >= 0.6;
  const runtimeSemantic =
    runtime.includes("training") ||
    runtime.includes("fine_tune") ||
    runtime.includes("pytorch_distributed");
  const mlSemantic = signedLogs || declaredParams >= 50 || trainingTokens >= 100 || optimizerState;
  const integrity =
    gapFraction > 0.05 ||
    minCoverage < 0.8 ||
    ccFraction > 0.5 ||
    counterResets > 0 ||
    asBool(row.o15_unapproved_physical_change_near_window) ||
    o4Missing === "counter_disabled_by_cc_mode";
  const falsePositivePattern =
    FALSE_POSITIVE_RUNTIME_MARKERS.some((marker) => runtime.includes(marker)) ||
    FALSE_POSITIVE_DECLARED_CLASSES.has(declaredClass);
  const reservedWithoutActivity =
    allocationGpus >= 512 &&
    gpuUtil < 30 &&
    fabricFootprint < 64 &&
    fabricPeriodicity < 0.2 &&
    !storageSemantic &&
    !mlSemantic;

  return {
    row,
    capacity,
    externalConflict,
    allocation,
    gpuActivity,
    fabricSync,
    physicalSupport,
    storageSemantic,
    runtimeSemantic,
    mlSemantic,
    signedLogs,
    integrity,
    falsePositivePattern,
    reservedWithoutActivity,
    strongCoverage: minCoverage >= 0.9 && gapFraction <= 0.05,
    policyScale: policyRatio >= 1 || gpuHoursRatio >= 1 || allocationGpus >= 512,
  };
}

function predictRuleLabel(features) {
  const flags = evidenceFlags(features);
  const primaryCount = Number(flags.allocation) + Number(flags.gpuActivity) + Number(flags.fabricSync);
  const semanticCount = Number(flags.runtimeSemantic) + Number(flags.storageSemantic) + Number(flags.mlSemantic);

  if (!flags.capacity && !flags.externalConflict) {
    return flags.strongCoverage ? 0 : 1;
  }
  if (flags.signedLogs && flags.policyScale && primaryCount >= 2) {
    return 4;
  }
  if (
    flags.allocation &&
    flags.gpuActivity &&
    flags.fabricSync &&
    flags.physicalSupport &&
    semanticCount >= 2 &&
    flags.policyScale
  ) {
    return 4;
  }
  if (flags.reservedWithoutActivity) {
    return 1;
  }
  if (flags.falsePositivePattern && (flags.gpuActivity || flags.fabricSync || flags.physicalSupport)) {
    return 2;
  }
  if (flags.integrity && !flags.mlSemantic && (primaryCount >= 1 || flags.physicalSupport)) {
    return 2;
  }
  if (primaryCount >= 2 && (flags.physicalSupport || semanticCount >= 1)) {
    return 3;
  }
  if (primaryCount >= 1 || flags.physicalSupport || semanticCount >= 1) {
    return 2;
  }
  return flags.capacity ? 1 : 0;
}

function probabilitiesForLabel(label) {
  const confidenceByLabel = [0.86, 0.74, 0.68, 0.78, 0.84];
  const confidence = confidenceByLabel[label] || 0.72;
  const probabilities = new Array(5).fill((1 - confidence) / 4);
  probabilities[label] = confidence;
  return probabilities;
}

function topEvidenceForFeatures(features) {
  const row = deriveFeatureState(features);
  const evidence = [];
  const capacity = asBool(row.capacity_possible);
  const externalConflict = asNumber(row.o17_external_capacity_conflict_score);
  const allocationGpus = asNumber(row.o2_max_concurrent_normalized_gpus);
  const allocationHours = asNumber(row.o2_allocation_duration_hours);
  const gpuHoursRatio = asNumber(row.o2_gpu_hours_policy_ratio);
  const gpuUtil = asNumber(row.o4_gpu_util_p95);
  const gpuDuty = asNumber(row.o4_gpu_util_duty_gt_70);
  const tensor = asNumber(row.o4_sm_tensor_active_p95);
  const fabricFootprint = asNumber(row.o7_synchronized_fabric_footprint);
  const fabricPeriodicity = asNumber(row.o7_collective_periodicity_score);
  const fabricUtil = asNumber(row.o7_scaleout_port_util_p95);
  const rackPower = asNumber(row.o8_rack_power_fraction_p95);
  const checkpoint = asNumber(row.o11_checkpoint_periodicity_score);
  const signedLogs = asBool(row.o12_signed_ml_logs_present);
  const minCoverage = asNumber(row.o14_min_critical_coverage, 1);
  const gapFraction = asNumber(row.o14_gap_fraction_critical);
  const ccFraction = asNumber(row.o13_confidential_compute_mode_fraction);
  const runtime = String(row.o10_runtime_framework_class || "");
  const declaredClass = String(row.o2_declared_workload_class || "").toLowerCase();
  const reservedWithoutActivity =
    (declaredClass === "reserved" || asBool(row.o2_reservation_exclusive_flag)) &&
    allocationGpus >= 512 &&
    gpuUtil < 30 &&
    gpuDuty < 0.15 &&
    tensor < 20 &&
    fabricFootprint < 64 &&
    fabricPeriodicity < 0.2 &&
    fabricUtil < 0.25 &&
    checkpoint < 0.2 &&
    !signedLogs;

  if (!capacity && externalConflict < 0.5) evidence.push("capacity below policy threshold");
  if (externalConflict >= 0.5) evidence.push("external capacity conflict");
  if (allocationGpus >= 512 || gpuHoursRatio >= 1) evidence.push("large allocation");
  else if (allocationGpus >= 128) evidence.push("moderate allocation");
  if (allocationHours >= 24) evidence.push("long allocation duration");
  if (reservedWithoutActivity) evidence.push("reserved capacity without activity");
  if (gpuUtil >= 70 || gpuDuty >= 0.45 || tensor >= 60) evidence.push("high GPU activity");
  if (fabricFootprint >= 512 || fabricPeriodicity >= 0.6) evidence.push("synchronized scale-out fabric");
  if (rackPower >= 0.6) evidence.push("power corroboration");
  if (runtime.includes("training") || runtime.includes("fine_tune")) evidence.push("training runtime metadata");
  if (checkpoint >= 0.55) evidence.push("checkpoint cadence");
  if (signedLogs) evidence.push("signed ML logs");
  if (minCoverage < 0.8 || gapFraction > 0.05) evidence.push("low critical coverage");
  if (ccFraction > 0.5 || row.o4_missing_reason === "counter_disabled_by_cc_mode") {
    evidence.push("counter disabled by confidential-compute mode");
  }
  return evidence.length ? evidence.slice(0, 8) : ["no strong positive evidence"];
}

function normalizeEvidenceForFeatures(items, features) {
  const row = deriveFeatureState(features);
  const gpuUtil = asNumber(row.o4_gpu_util_p95);
  const gpuDuty = asNumber(row.o4_gpu_util_duty_gt_70);
  const tensor = asNumber(row.o4_sm_tensor_active_p95);
  const fabricFootprint = asNumber(row.o7_synchronized_fabric_footprint);
  const fabricPeriodicity = asNumber(row.o7_collective_periodicity_score);
  const fabricUtil = asNumber(row.o7_scaleout_port_util_p95);
  const rackPower = asNumber(row.o8_rack_power_fraction_p95);
  const checkpoint = asNumber(row.o11_checkpoint_periodicity_score);
  const signedLogs = asBool(row.o12_signed_ml_logs_present);
  const runtime = String(row.o10_runtime_framework_class || "");
  const allocationGpus = asNumber(row.o2_max_concurrent_normalized_gpus);
  const declaredClass = String(row.o2_declared_workload_class || "").toLowerCase();
  const reservedWithoutActivity =
    (declaredClass === "reserved" || asBool(row.o2_reservation_exclusive_flag)) &&
    allocationGpus >= 512 &&
    gpuUtil < 30 &&
    gpuDuty < 0.15 &&
    tensor < 20 &&
    fabricFootprint < 64 &&
    fabricPeriodicity < 0.2 &&
    fabricUtil < 0.25 &&
    checkpoint < 0.2 &&
    !signedLogs;

  const keep = [];
  for (const item of items) {
    if (item === "high GPU activity" && gpuUtil < 70 && gpuDuty < 0.45 && tensor < 60) continue;
    if (item === "synchronized scale-out fabric" && fabricFootprint < 512 && fabricPeriodicity < 0.6 && fabricUtil < 0.65) continue;
    if (item === "power corroboration" && rackPower < 0.6) continue;
    if (item === "checkpoint cadence" && checkpoint < 0.55) continue;
    if (item === "signed ML logs" && !signedLogs) continue;
    if (item === "training runtime metadata" && !runtime.includes("training") && !runtime.includes("fine_tune")) continue;
    keep.push(item);
  }
  if (reservedWithoutActivity && !keep.includes("reserved capacity without activity")) {
    keep.push("reserved capacity without activity");
  }
  return keep.length ? keep.slice(0, 8) : ["no strong positive evidence"];
}

function criticalMissingLayers(features) {
  const row = deriveFeatureState(features);
  const layers = [
    ["O1", "o1_coverage_fraction", "o1_missing_reason"],
    ["O2", "o2_coverage_fraction", "o2_missing_reason"],
    ["O4", "o4_coverage_fraction", "o4_missing_reason"],
    ["O7", "o7_coverage_fraction", "o7_missing_reason"],
    ["O8", "o8_coverage_fraction", "o8_missing_reason"],
    ["O14", "o14_coverage_fraction", "o14_missing_reason"],
  ];
  const out = [];
  for (const [observable, coverageKey, reasonKey] of layers) {
    const coverage = asNumber(row[coverageKey], coverageKey === "o14_coverage_fraction" ? row.o14_min_critical_coverage : 1);
    const reason = String(row[reasonKey] || "observed");
    if (coverage < 0.8 || !["observed", ""].includes(reason)) {
      out.push(`${observable}: ${reason}, coverage ${coverage.toFixed(2)}`);
    }
  }
  if (!out.length && asNumber(row.o14_min_critical_coverage, 1) < 0.8) {
    out.push(`O14: critical coverage ${asNumber(row.o14_min_critical_coverage).toFixed(2)}`);
  }
  return out;
}

function scoreFeatures(inputFeatures) {
  const features = deriveFeatureState(inputFeatures);
  const label = predictRuleLabel(features);
  const probabilities = probabilitiesForLabel(label);
  const pLarge = probabilities[3] + probabilities[4];
  const severity = probabilities.reduce((sum, probability, index) => sum + probability * index, 0);
  const coverage = asNumber(features.o14_min_critical_coverage, 1);
  const negative = probabilities[0] * coverage;
  const flags = evidenceFlags(features);
  return {
    mode: "Rule sandbox",
    label,
    labelName: labelName(label),
    probabilities,
    pLarge,
    severity,
    negativeCertificationConfidence: negative,
    capacityPossible: asBool(features.capacity_possible),
    integrityWarning: flags.integrity,
    criticalMissingLayers: criticalMissingLayers(features),
    topEvidence: topEvidenceForFeatures(features),
    features,
  };
}

function replayResult(row) {
  return {
    mode: "Calibrated model replay",
    label: Number(row.predicted_label),
    labelName: labelName(Number(row.predicted_label)),
    probabilities: row.p_labels || [0, 0, 0, 0, 0],
    pLarge: asNumber(row.p_large_training),
    severity: asNumber(row.severity_score),
    negativeCertificationConfidence: asNumber(row.negative_certification_confidence),
    capacityPossible: asBool(row.features?.capacity_possible),
    integrityWarning: asBool(row.integrity_warning),
    criticalMissingLayers: splitSemicolon(row.critical_missing_layers),
    topEvidence: normalizeEvidenceForFeatures(splitSemicolon(row.top_evidence), row.features || {}),
    features: deriveFeatureState(row.features || {}),
  };
}

function splitSemicolon(value) {
  if (!value) return [];
  return String(value)
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

window.DCVScoring = {
  asBool,
  asNumber,
  clamp,
  deriveFeatureState,
  formatNumber,
  formatPercent,
  labelColor,
  labelName,
  replayResult,
  scoreFeatures,
};
