(function () {
const {
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
} = window.DCVScoring;

const { DatacenterScene } = window;

const DATA_URL = "./data/demo-data.json";
const CONFIG_URL = "./config.js";
const LIVE_INFERENCE_DEBOUNCE_MS = 250;
const LIVE_INFERENCE_TIMEOUT_MS = 6000;
const KNOWN_METADATA_ONLY_FEATURES = new Set([
  "capacity_evidence_only",
  "integrity_evidence_only",
  "physical_evidence_only",
]);
const WINDOW_LABELS = new Map([
  [900, "15 min"],
  [3600, "1 hour"],
  [21600, "6 hours"],
  [86400, "1 day"],
]);

const controlDefs = [
  {
    key: "o1_normalized_h100e_capacity",
    label: "H100e-equiv capacity",
    help: "Hardware-normalized accelerator capacity. This is a capacity gate, not evidence that a run is active.",
    type: "range",
    min: 0,
    max: 4096,
    step: 64,
    format: (value) => formatNumber(value, 0),
  },
  {
    key: "o2_max_concurrent_normalized_gpus",
    label: "Allocated GPUs",
    help: "Maximum concurrent H100e-equivalent GPUs allocated in the selected window.",
    type: "range",
    min: 0,
    max: 2600,
    step: 16,
    format: (value) => formatNumber(value, 0),
  },
  {
    key: "o2_allocation_duration_hours",
    label: "Allocation duration",
    help: "Allocation or linked-job duration in hours. It is interpreted together with allocated GPUs.",
    type: "range",
    min: 0,
    max: 420,
    step: 1,
    format: (value) => `${formatNumber(value, 0)} h`,
  },
  {
    key: "o4_gpu_util_p95",
    label: "GPU utilization p95",
    help: "P95 GPU busy/utilization percent. High utilization is activity evidence, not training semantics by itself.",
    type: "range",
    min: 0,
    max: 100,
    step: 1,
    format: (value) => `${formatNumber(value, 0)}%`,
  },
  {
    key: "o4_sm_tensor_active_p95",
    label: "Tensor activity p95",
    help: "P95 tensor-core or tensor-pipe activity. High values support training-like compute activity.",
    type: "range",
    min: 0,
    max: 100,
    step: 1,
    format: (value) => `${formatNumber(value, 0)}%`,
  },
  {
    key: "o7_synchronized_fabric_footprint",
    label: "Fabric footprint",
    help: "Approximate size of synchronized scale-out fabric behavior. Large values support one coordinated distributed job.",
    type: "range",
    min: 0,
    max: 2400,
    step: 16,
    format: (value) => formatNumber(value, 0),
  },
  {
    key: "o7_collective_periodicity_score",
    label: "Collective periodicity",
    help: "0-1 score for periodic collective communication such as all-reduce bursts.",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    format: (value) => formatNumber(value, 2),
  },
  {
    key: "o8_rack_power_fraction_p95",
    label: "Rack power p95",
    help: "P95 rack or facility power fraction. Power corroborates activity but does not identify workload semantics alone.",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    format: (value) => formatPercent(value),
  },
  {
    key: "o11_checkpoint_periodicity_score",
    label: "Checkpoint cadence",
    help: "0-1 score for periodic checkpoint or training-storage cadence.",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    format: (value) => formatNumber(value, 2),
  },
  {
    key: "o14_min_critical_coverage",
    label: "Critical coverage",
    help: "Minimum coverage across critical monitoring layers. Low coverage weakens no-run claims.",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    format: (value) => formatPercent(value),
  },
  {
    key: "o14_gap_fraction_critical",
    label: "Telemetry gap fraction",
    help: "Fraction of critical telemetry missing in the window. Gaps are integrity evidence, not no-activity evidence.",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    format: (value) => formatPercent(value),
  },
  {
    key: "o13_confidential_compute_mode_fraction",
    label: "Confidential-compute share",
    help: "Share of monitored devices/time in confidential-compute mode, which can legitimately suppress counters.",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    format: (value) => formatPercent(value),
  },
  {
    key: "o12_signed_ml_logs_present",
    label: "Signed ML logs",
    help: "Authenticated ML-layer logs or declarations. This is high-value semantic evidence when present.",
    type: "checkbox",
    format: (value) => (asBool(value) ? "present" : "absent"),
  },
  {
    key: "o10_runtime_framework_class",
    label: "Runtime class",
    help: "Host/container runtime class. Training runtimes are semantic evidence; inference/HPC/benchmark runtimes are false-positive context.",
    type: "select",
    optionsKey: "o10_runtime_framework_class",
  },
  {
    key: "o2_declared_workload_class",
    label: "Declared class",
    help: "Self-declared scheduler/allocation workload class. Unsigned declarations are weak evidence and need corroboration.",
    type: "select",
    optionsKey: "o2_declared_workload_class",
  },
  {
    key: "o4_missing_reason",
    label: "GPU telemetry availability",
    help: "Whether GPU telemetry was observed, gapped, or suppressed by confidential-compute mode.",
    type: "select",
    optionsKey: "o4_missing_reason",
  },
];

const dom = {};
let dataset = null;
let scene = null;
let activeRow = null;
let activeFeatures = {};
let sandboxDirty = false;
let inferenceApiUrl = "";
let editRevision = 0;
let liveInference = {
  timer: null,
  controller: null,
  pending: false,
  revision: 0,
  result: null,
  error: "",
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindDom();
  await loadRuntimeConfig();
  scene = new DatacenterScene(dom.sceneRoot);
  dataset = window.DCVDemoData;
  if (!dataset) {
    const response = await fetch(DATA_URL);
    dataset = await response.json();
  }
  if (dom.datasetEyebrow) {
    dom.datasetEyebrow.textContent = dataset.metadata.scale
      ? `Synthetic ${dataset.metadata.scale}`
      : "Synthetic dataset";
  }
  dom.datasetStatus.textContent = `${formatNumber(dataset.metadata.row_count)} synthetic windows`;
  populateSelectors();
  populateQuickPicks();
  buildControls();
  const initialRowId = dataset.example_rows["4"] || dataset.rows[0].feature_row_id;
  setActiveRowById(initialRowId, { syncSelectors: true });
}

function bindDom() {
  const ids = [
    "dataset-status",
    "dataset-eyebrow",
    "scene-root",
    "hud-gpus",
    "hud-fabric",
    "hud-power",
    "hud-coverage",
    "site-select",
    "scenario-select",
    "window-select",
    "row-select",
    "context-status",
    "filter-status",
    "api-status",
    "reset-row",
    "state-banner",
    "result-mode",
    "mode-detail",
    "result-label",
    "risk-fill",
    "p-large",
    "severity-score",
    "negative-confidence",
    "integrity-status",
    "capacity-status",
    "probability-bars",
    "policy-ratio",
    "controls-root",
    "evidence-list",
    "missing-list",
  ];
  for (const id of ids) {
    dom[toCamel(id)] = document.getElementById(id);
  }
}

function toCamel(id) {
  return id.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function populateSelectors() {
  setOptions(
    dom.siteSelect,
    [["all", "All sites"], ...dataset.sites.map((site) => [site.site_id, siteOptionLabel(site)])]
  );

  syncScenarioOptions();
  syncWindowOptions();

  dom.siteSelect.addEventListener("change", () => {
    syncScenarioOptions();
    syncWindowOptions();
    renderRowOptions({ resetExisting: true });
  });
  dom.scenarioSelect.addEventListener("change", () => {
    syncWindowOptions();
    renderRowOptions({ resetExisting: true });
  });
  dom.windowSelect.addEventListener("change", () => renderRowOptions({ resetExisting: true }));
  dom.rowSelect.addEventListener("change", () => {
    if (dom.rowSelect.value) setActiveRowById(dom.rowSelect.value);
  });
}

function syncScenarioOptions() {
  const previous = dom.scenarioSelect.value || "all";
  const rows = rowsMatching({
    site: dom.siteSelect.value,
    scenario: "all",
    windowLength: "all",
  });
  const available = new Set(rows.map((row) => scenarioKey(row)));
  const scenarios = dataset.scenarios.filter((item) => available.has(scenarioSummaryKey(item)));
  setOptions(
    dom.scenarioSelect,
    [["all", "All scenario families"], ...scenarios.map((item) => [scenarioSummaryKey(item), scenarioOptionLabel(item)])]
  );
  dom.scenarioSelect.value = previous === "all" || available.has(previous) ? previous : "all";
}

function syncWindowOptions() {
  const previous = dom.windowSelect.value || "all";
  const rows = rowsMatching({
    site: dom.siteSelect.value,
    scenario: dom.scenarioSelect.value,
    windowLength: "all",
  });
  const windows = [...new Set(rows.map((row) => row.window_length_seconds))].sort((a, b) => a - b);
  setOptions(
    dom.windowSelect,
    [["all", "All windows"], ...windows.map((window) => [String(window), WINDOW_LABELS.get(window) || `${window}s`])]
  );
  dom.windowSelect.value = previous === "all" || windows.includes(Number(previous)) ? previous : "all";
}

function populateQuickPicks() {
  document.querySelectorAll("[data-example-label]").forEach((button) => {
    button.addEventListener("click", () => {
      const rowId = dataset.example_rows[button.dataset.exampleLabel];
      setActiveRowById(rowId, { syncSelectors: true });
    });
  });
  dom.resetRow.addEventListener("click", () => setActiveRow(activeRow, { resetFeatures: true }));
}

function renderRowOptions(options = {}) {
  const rows = filteredRows();
  renderContextStatus(rows);
  updateFilterStatus(rows.length, Math.min(rows.length, 700));
  if (!rows.length) {
    setOptions(dom.rowSelect, [["", "No matching datapoints"]]);
    dom.rowSelect.disabled = true;
    setControlsDisabled(true);
    dom.resetRow.disabled = true;
    activeRow = null;
    sandboxDirty = false;
    renderEmptyState();
    return;
  }
  dom.rowSelect.disabled = false;
  setControlsDisabled(false);
  dom.resetRow.disabled = false;
  const limitedRows = rows.slice(0, 700);
  setOptions(
    dom.rowSelect,
    limitedRows.map((row) => [
      row.feature_row_id,
      rowOptionLabel(row),
    ])
  );
  if (!limitedRows.some((row) => row.feature_row_id === activeRow?.feature_row_id)) {
    setActiveRow(limitedRows[0] || dataset.rows[0], { resetFeatures: true });
  } else if (options.resetExisting) {
    setActiveRow(activeRow, { resetFeatures: true });
  } else {
    dom.rowSelect.value = activeRow.feature_row_id;
  }
}

function filteredRows() {
  return rowsMatching({
    site: dom.siteSelect.value,
    scenario: dom.scenarioSelect.value,
    windowLength: dom.windowSelect.value,
  });
}

function rowsMatching({ site = "all", scenario = "all", windowLength = "all" } = {}) {
  return dataset.rows.filter((row) => {
    if (site !== "all" && row.site_id !== site) return false;
    if (scenario !== "all" && scenarioKey(row) !== scenario) return false;
    if (windowLength !== "all" && String(row.window_length_seconds) !== windowLength) return false;
    return true;
  });
}

function setActiveRowById(rowId, options = {}) {
  const row = dataset.rows.find((candidate) => candidate.feature_row_id === rowId);
  if (!row) return;
  if (options.syncSelectors) {
    dom.siteSelect.value = row.site_id;
    syncScenarioOptions();
    dom.scenarioSelect.value = scenarioKey(row);
    syncWindowOptions();
    dom.windowSelect.value = String(row.window_length_seconds);
    renderRowOptions();
  }
  setActiveRow(row, { resetFeatures: true });
}

function setActiveRow(row, options = {}) {
  if (!row) {
    renderEmptyState();
    return;
  }
  activeRow = row;
  if (options.resetFeatures) {
    clearLiveInference();
    activeFeatures = deriveFeatureState(clone(row.features));
    sandboxDirty = false;
    editRevision += 1;
    syncControls();
  }
  dom.rowSelect.value = row.feature_row_id;
  renderDashboard();
}

function buildControls() {
  dom.controlsRoot.innerHTML = "";
  for (const def of controlDefs) {
    const row = document.createElement("label");
    row.className = "control-row";
    row.dataset.controlKey = def.key;
    if (def.help) row.title = def.help;
    const name = document.createElement("span");
    name.textContent = def.label;
    if (def.help) name.title = def.help;
    const value = document.createElement("strong");
    value.className = "control-value";
    value.dataset.valueFor = def.key;

    let input;
    if (def.type === "select") {
      input = document.createElement("select");
      const values = dataset.categorical_values[def.optionsKey] || [];
      setOptions(input, values.map((option) => [option, pretty(option)]));
    } else {
      input = document.createElement("input");
      input.type = def.type;
      if (def.type === "range") {
        input.min = def.min;
        input.max = def.max;
        input.step = def.step;
      }
    }
    input.dataset.key = def.key;
    if (def.help) input.title = def.help;
    input.addEventListener("input", () => handleControlEdit(def, input));
    input.addEventListener("change", () => handleControlEdit(def, input));

    row.append(name, input, value);
    dom.controlsRoot.append(row);
  }
}

async function loadRuntimeConfig() {
  window.DCV_CONFIG = window.DCV_CONFIG || {};
  try {
    const response = await fetch(CONFIG_URL, { cache: "no-store" });
    if (response.ok) {
      const source = await response.text();
      Function(source)();
    }
  } catch (_) {
    // Missing config.js is the normal static/offline mode.
  }
  const configured = String(window.DCV_CONFIG?.inferenceApiUrl || "").trim();
  inferenceApiUrl = configured.replace(/\/+$/, "");
  updateApiStatus(inferenceApiUrl ? "configured" : "not-configured");
}

function handleControlEdit(def, input) {
  applyControlValue(def, input);
  sandboxDirty = true;
  editRevision += 1;
  liveInference.result = null;
  liveInference.error = "";
  scheduleLiveInference();
  renderDashboard();
}

function syncControls() {
  for (const def of controlDefs) {
    const input = dom.controlsRoot.querySelector(`[data-key="${def.key}"]`);
    const value = activeFeatures[def.key];
    if (!input) continue;
    if (def.type === "checkbox") input.checked = asBool(value);
    else input.value = value ?? "";
    updateControlValue(def);
  }
}

function applyControlValue(def, input) {
  if (def.type === "checkbox") activeFeatures[def.key] = input.checked;
  else if (def.type === "range") activeFeatures[def.key] = Number(input.value);
  else activeFeatures[def.key] = input.value;
  applyCoherentSideEffects(def.key);
  updateCoverageFields(def.key);
  activeFeatures = deriveFeatureState(activeFeatures);
  syncDerivedControlValues();
}

function syncDerivedControlValues() {
  for (const def of controlDefs) {
    const input = dom.controlsRoot.querySelector(`[data-key="${def.key}"]`);
    const value = activeFeatures[def.key];
    if (input) {
      if (def.type === "checkbox") input.checked = asBool(value);
      else input.value = value ?? "";
    }
    updateControlValue(def);
  }
}

function updateControlValue(def) {
  const output = dom.controlsRoot.querySelector(`[data-value-for="${def.key}"]`);
  if (!output) return;
  const value = activeFeatures[def.key];
  output.textContent = def.format ? def.format(value) : pretty(value);
}

function updateCoverageFields(changedKey) {
  if (changedKey === "o14_min_critical_coverage") {
    const coverage = asNumber(activeFeatures.o14_min_critical_coverage, 1);
    setCriticalCoverageFields(coverage);
  }
  if (changedKey === "o4_missing_reason") {
    const reason = activeFeatures.o4_missing_reason;
    activeFeatures.o4_coverage_fraction = reason === "observed"
      ? asNumber(activeFeatures.o14_min_critical_coverage, 1)
      : 0.2;
    if (reason === "observed") {
      if (
        asNumber(activeFeatures.o13_confidential_compute_mode_fraction) >= 0.75 &&
        asNumber(activeFeatures.o14_gap_fraction_critical) >= 0.45 &&
        asNumber(activeFeatures.o14_min_critical_coverage, 1) <= 0.35
      ) {
        activeFeatures.o13_confidential_compute_mode_fraction = 0;
        activeFeatures.o14_gap_fraction_critical = 0.01;
        activeFeatures.o14_min_critical_coverage = 0.98;
        setCriticalCoverageFields(0.98);
      }
    }
    if (reason === "collector_gap") {
      activeFeatures.o14_gap_fraction_critical = Math.max(asNumber(activeFeatures.o14_gap_fraction_critical), 0.12);
      activeFeatures.o14_min_critical_coverage = Math.min(asNumber(activeFeatures.o14_min_critical_coverage, 1), 0.8);
      setCriticalCoverageFields(asNumber(activeFeatures.o14_min_critical_coverage, 1));
      activeFeatures.o4_coverage_fraction = 0.2;
    }
    if (reason === "counter_disabled_by_cc_mode") {
      activeFeatures.o13_confidential_compute_mode_fraction = Math.max(
        asNumber(activeFeatures.o13_confidential_compute_mode_fraction),
        0.75
      );
      activeFeatures.o14_gap_fraction_critical = Math.max(asNumber(activeFeatures.o14_gap_fraction_critical), 0.45);
      activeFeatures.o14_min_critical_coverage = Math.min(asNumber(activeFeatures.o14_min_critical_coverage, 1), 0.35);
      setCriticalCoverageFields(asNumber(activeFeatures.o14_min_critical_coverage, 1));
      activeFeatures.o4_coverage_fraction = 0.2;
    }
  }
}

function setCriticalCoverageFields(coverageValue) {
  const coverage = clamp(coverageValue);
  activeFeatures.o1_coverage_fraction = coverage;
  activeFeatures.o2_coverage_fraction = coverage;
  activeFeatures.o4_coverage_fraction = activeFeatures.o4_missing_reason === "observed" ? coverage : Math.min(coverage, 0.2);
  activeFeatures.o7_coverage_fraction = coverage;
  activeFeatures.o8_coverage_fraction = coverage;
  activeFeatures.o14_coverage_fraction = coverage;
}

function renderDashboard() {
  if (!activeRow) {
    renderEmptyState();
    return;
  }
  const replay = replayResult(activeRow);
  const display = currentDisplayResult(replay);
  const result = display.result;
  const features = display.features;

  renderStateBanner(result, display);
  dom.resetRow.disabled = false;
  dom.resultMode.textContent = display.modeText;
  dom.modeDetail.textContent = display.detailText;
  dom.resultLabel.textContent = `L${result.label}: ${labelName(result.label)}`;
  dom.resultLabel.style.color = labelColor(result.label);
  dom.riskFill.style.width = formatPercent(result.pLarge, 1);
  dom.riskFill.style.backgroundColor = labelColor(result.label);
  dom.pLarge.textContent = formatPercent(result.pLarge, 1);
  dom.severityScore.textContent = result.severity.toFixed(2);
  dom.negativeConfidence.textContent = formatPercent(result.negativeCertificationConfidence, 1);
  dom.integrityStatus.textContent = result.integrityWarning ? "Warning" : "Clear";
  dom.integrityStatus.style.color = result.integrityWarning ? "var(--integrity)" : "var(--ok)";
  dom.capacityStatus.textContent = result.capacityPossible ? "Possible" : "Below threshold";
  dom.capacityStatus.style.color = result.capacityPossible ? "var(--warn)" : "var(--ok)";
  dom.policyRatio.textContent = `Policy ratio ${asNumber(features.policy_compute_ratio).toFixed(2)}`;

  renderProbabilityBars(result.probabilities);
  renderList(dom.evidenceList, result.topEvidence, false);
  renderList(dom.missingList, result.criticalMissingLayers.length ? result.criticalMissingLayers : ["none flagged"], true);
  updateHud(features);
  scene.update(features, result);
}

function currentDisplayResult(replay) {
  if (!sandboxDirty) {
    return {
      result: replay,
      features: replay.features,
      modeText: "calibrated model replay",
      detailText: `Selected datapoint replays the trained model export. ${sourceRowSummary(activeRow)}.`,
      bannerPrefix: `Source datapoint: ${sourceRowSummary(activeRow)}`,
    };
  }

  if (liveInference.result && liveInference.revision === editRevision) {
    return {
      result: liveInference.result,
      features: liveInference.result.features,
      modeText: "live model inference",
      detailText: `Edited controls scored by the live sklearn API. Source datapoint: ${sourceRowSummary(activeRow)}.`,
      bannerPrefix: `Live sklearn inference from ${sourceRowSummary(activeRow)}`,
    };
  }

  const fallback = scoreFeatures(activeFeatures);
  let modeText = "offline rule sandbox";
  let detailText = `No inference API URL configured; manual edits use browser rules. Source datapoint: ${sourceRowSummary(activeRow)}.`;
  let bannerPrefix = `Offline rule sandbox from ${sourceRowSummary(activeRow)}`;
  if (inferenceApiUrl) {
    modeText = "rule fallback";
    if (liveInference.pending) {
      detailText = `Waiting for live sklearn API; showing browser rule fallback. Source datapoint: ${sourceRowSummary(activeRow)}.`;
      bannerPrefix = `Rule fallback while live inference is pending from ${sourceRowSummary(activeRow)}`;
    } else if (liveInference.error) {
      detailText = `Live API unavailable; showing browser rule fallback. ${liveInference.error}`;
      bannerPrefix = `Rule fallback after API error from ${sourceRowSummary(activeRow)}`;
    } else {
      detailText = `Live API configured; showing browser rule fallback until the response returns. Source datapoint: ${sourceRowSummary(activeRow)}.`;
      bannerPrefix = `Rule fallback from ${sourceRowSummary(activeRow)}`;
    }
  }
  return {
    result: fallback,
    features: fallback.features,
    modeText,
    detailText,
    bannerPrefix,
  };
}

function renderProbabilityBars(probabilities) {
  dom.probabilityBars.innerHTML = "";
  probabilities.forEach((probability, label) => {
    const row = document.createElement("div");
    row.className = "prob-row";
    const name = document.createElement("span");
    name.textContent = `L${label} ${shortLabel(label)}`;
    const track = document.createElement("div");
    track.className = "prob-track";
    const fill = document.createElement("div");
    fill.className = "prob-fill";
    fill.style.width = formatPercent(probability, 1);
    fill.style.backgroundColor = labelColor(label);
    track.append(fill);
    const value = document.createElement("strong");
    value.textContent = formatPercent(probability, 1);
    row.append(name, track, value);
    dom.probabilityBars.append(row);
  });
}

function renderList(root, items, warnings) {
  root.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    if (warnings && item !== "none flagged") li.className = "warning";
    root.append(li);
  }
}

function updateHud(features) {
  dom.hudGpus.textContent = formatNumber(asNumber(features.o2_max_concurrent_normalized_gpus), 0);
  dom.hudFabric.textContent = formatPercent(fabricSignal(features), 0);
  dom.hudPower.textContent = formatPercent(asNumber(features.o8_rack_power_fraction_p95), 0);
  dom.hudCoverage.textContent = formatPercent(asNumber(features.o14_min_critical_coverage, 1), 0);
}

function updateHudEmpty() {
  dom.hudGpus.textContent = "n/a";
  dom.hudFabric.textContent = "n/a";
  dom.hudPower.textContent = "n/a";
  dom.hudCoverage.textContent = "n/a";
}

function renderEmptyState() {
  const features = emptyFeatureState();
  dom.stateBanner.textContent = "";
  dom.stateBanner.className = "state-banner";
  dom.resultMode.textContent = "No matching datapoint";
  dom.modeDetail.textContent = `No synthetic row exists for ${filterSummary()}. Evidence inputs are disabled and are not being scored.`;
  dom.resultLabel.textContent = "No matching datapoint";
  dom.resultLabel.style.color = "var(--muted)";
  dom.riskFill.style.width = "0%";
  dom.riskFill.style.backgroundColor = "var(--muted)";
  dom.pLarge.textContent = "n/a";
  dom.severityScore.textContent = "n/a";
  dom.negativeConfidence.textContent = "n/a";
  dom.integrityStatus.textContent = "n/a";
  dom.integrityStatus.style.color = "var(--muted)";
  dom.capacityStatus.textContent = "n/a";
  dom.capacityStatus.style.color = "var(--muted)";
  dom.policyRatio.textContent = "Policy ratio n/a";
  dom.probabilityBars.innerHTML = "";
  const emptyProbabilities = document.createElement("p");
  emptyProbabilities.className = "empty-panel-text";
  emptyProbabilities.textContent = "No label probabilities without a matching datapoint.";
  dom.probabilityBars.append(emptyProbabilities);
  renderList(dom.evidenceList, ["no datapoint selected"], false);
  renderList(dom.missingList, ["no datapoint selected"], true);
  updateHudEmpty();
  scene.update(features, {
    label: 0,
    integrityWarning: false,
  });
}

function renderStateBanner(result, display = {}) {
  if (!activeRow) {
    dom.stateBanner.textContent = "";
    dom.stateBanner.className = "state-banner";
    return;
  }
  const warnings = result.consistencyWarnings || [];
  dom.stateBanner.className = warnings.length ? "state-banner warning" : "state-banner";
  if (sandboxDirty) {
    const parts = [display.bannerPrefix || `Edited sandbox from ${sourceRowSummary(activeRow)}`];
    if (warnings.length) {
      parts.push(`Inconsistent inputs: ${warnings.join("; ")}`);
    }
    dom.stateBanner.textContent = parts.join(". ");
  } else {
    dom.stateBanner.textContent = `Source datapoint: ${sourceRowSummary(activeRow)}`;
  }
}

function renderContextStatus(rows = filteredRows()) {
  if (!dom.contextStatus || !dataset) return;
  const site = dom.siteSelect.value;
  const scenario = dom.scenarioSelect.value;
  const parts = [];
  if (site !== "all") {
    const siteMeta = dataset.sites.find((item) => item.site_id === site);
    if (siteMeta) {
      parts.push(
        `${site}: ${pretty(siteMeta.site_type)}, ${formatNumber(siteMeta.normalized_h100e_capacity)} H100e, largest domain ${formatNumber(siteMeta.largest_contiguous_domain_gpus)}`
      );
    }
  }
  if (scenario !== "all") {
    const scenarioMeta = dataset.scenarios.find((item) => scenarioSummaryKey(item) === scenario);
    if (scenarioMeta) {
      parts.push(`${pretty(scenario)}: ${labelDistributionText(scenarioMeta.label_distribution)}`);
    }
  }
  if (!parts.length) {
    parts.push("Filters select existing synthetic datapoints; evidence edits use live inference when configured, otherwise the rule sandbox.");
  }
  dom.contextStatus.textContent = `${parts.join(" | ")} | ${formatNumber(rows.length)} matching rows`;
}

function updateApiStatus(state, detail = "") {
  if (!dom.apiStatus) return;
  const labels = {
    "not-configured": "API: not configured",
    configured: "API: configured",
    pending: "API: checking",
    available: "API: available",
    unavailable: "API: unavailable; rule fallback",
  };
  dom.apiStatus.textContent = detail || labels[state] || "API: unknown";
  dom.apiStatus.className = `api-status api-${state}`;
}

function clearLiveInference() {
  if (liveInference.timer) {
    clearTimeout(liveInference.timer);
  }
  if (liveInference.controller) {
    liveInference.controller.abort();
  }
  liveInference = {
    timer: null,
    controller: null,
    pending: false,
    revision: editRevision,
    result: null,
    error: "",
  };
  updateApiStatus(inferenceApiUrl ? "configured" : "not-configured");
}

function scheduleLiveInference() {
  if (liveInference.timer) {
    clearTimeout(liveInference.timer);
  }
  if (liveInference.controller) {
    liveInference.controller.abort();
  }
  liveInference.result = null;
  liveInference.error = "";
  liveInference.revision = editRevision;

  if (!inferenceApiUrl) {
    liveInference.pending = false;
    updateApiStatus("not-configured");
    return;
  }

  liveInference.pending = true;
  updateApiStatus("pending");
  const revision = editRevision;
  liveInference.timer = setTimeout(() => {
    requestLiveInference(revision);
  }, LIVE_INFERENCE_DEBOUNCE_MS);
}

async function requestLiveInference(revision) {
  if (!activeRow || !inferenceApiUrl || revision !== editRevision) return;
  const controller = new AbortController();
  liveInference.controller = controller;
  const timeout = setTimeout(() => controller.abort(), LIVE_INFERENCE_TIMEOUT_MS);
  try {
    const response = await fetch(`${inferenceApiUrl}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(liveInferencePayload()),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (revision !== editRevision) return;
    liveInference.pending = false;
    liveInference.error = "";
    liveInference.result = resultFromApi(payload);
    liveInference.revision = revision;
    updateApiStatus("available");
    renderDashboard();
  } catch (error) {
    if (revision !== editRevision) return;
    liveInference.pending = false;
    liveInference.result = null;
    liveInference.error = error?.name === "AbortError" ? "Request timed out or was cancelled." : String(error?.message || error);
    updateApiStatus("unavailable");
    renderDashboard();
  } finally {
    clearTimeout(timeout);
    if (liveInference.controller === controller) {
      liveInference.controller = null;
    }
  }
}

function liveInferencePayload() {
  return {
    feature_row_id: activeRow?.feature_row_id || null,
    features: liveInferenceFeatures(),
    context: {
      scope_type: activeRow?.scope_type || activeFeatures.scope_type || "topology_domain",
      window_length_seconds: activeRow?.window_length_seconds || activeFeatures.window_length_seconds || 3600,
    },
    derive: true,
    return_completed_features: true,
  };
}

function liveInferenceFeatures() {
  const features = clone(activeFeatures);
  for (const key of KNOWN_METADATA_ONLY_FEATURES) {
    delete features[key];
  }
  return features;
}

function resultFromApi(payload) {
  const probabilities = Array.isArray(payload.probabilities)
    ? payload.probabilities.map((value) => clamp(value))
    : [0, 0, 0, 0, 0].map((_, label) => clamp(payload.probability_by_label?.[String(label)]));
  const label = Number(payload.predicted_label);
  const completed = payload.completed_features && typeof payload.completed_features === "object"
    ? payload.completed_features
    : {};
  return {
    mode: "Live model inference",
    label,
    labelName: labelName(label),
    probabilities,
    pLarge: asNumber(payload.p_large_training),
    severity: asNumber(payload.severity_score),
    negativeCertificationConfidence: asNumber(payload.negative_certification_confidence),
    capacityPossible: asBool(payload.capacity_possible),
    integrityWarning: asBool(payload.integrity_warning),
    criticalMissingLayers: asStringArray(payload.critical_missing_layers),
    topEvidence: asStringArray(payload.top_evidence),
    consistencyWarnings: userFacingApiWarnings(payload.input_warnings),
    features: displayFeaturesFromApi(completed),
  };
}

function displayFeaturesFromApi(completed) {
  const features = { ...activeFeatures, ...completed };
  for (const def of controlDefs) {
    if (Object.prototype.hasOwnProperty.call(activeFeatures, def.key)) {
      features[def.key] = activeFeatures[def.key];
    }
  }
  return deriveFeatureState(features);
}

function userFacingApiWarnings(value) {
  return asStringArray(value).filter((warning) => {
    const lower = warning.toLowerCase();
    if (lower.startsWith("derived fields updated from edited inputs:")) return false;
    if (lower.includes("metadata-only and was not sent to the model")) return false;
    for (const key of KNOWN_METADATA_ONLY_FEATURES) {
      if (lower.includes("kept only as metadata") && lower.includes(key)) return false;
    }
    return true;
  });
}

function asStringArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (!value) return [];
  return String(value)
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function updateFilterStatus(totalRows, shownRows) {
  if (!dom.filterStatus) return;
  if (totalRows === 0) {
    dom.filterStatus.textContent = `No datapoints match ${filterSummary()}. The scenario filter does not create new datapoints.`;
  } else if (totalRows > shownRows) {
    dom.filterStatus.textContent = `Showing first ${formatNumber(shownRows)} of ${formatNumber(totalRows)} matching datapoints.`;
  } else {
    dom.filterStatus.textContent = `${formatNumber(totalRows)} matching datapoints.`;
  }
}

function setControlsDisabled(disabled) {
  dom.controlsRoot.querySelectorAll("input, select").forEach((input) => {
    input.disabled = disabled;
  });
}

function applyCoherentSideEffects(changedKey) {
  if (changedKey === "o1_normalized_h100e_capacity") {
    const capacity = Math.max(0, asNumber(activeFeatures.o1_normalized_h100e_capacity));
    const partitioned = clamp(asNumber(activeFeatures.o1_non_partitioned_fraction, 1), 0.1, 1);
    activeFeatures.o1_largest_contiguous_domain_gpus = Math.round(capacity * partitioned);
  }

  if (changedKey === "o2_max_concurrent_normalized_gpus") {
    const allocation = Math.max(0, asNumber(activeFeatures.o2_max_concurrent_normalized_gpus));
    activeFeatures.o10_world_size = Math.round(allocation);
    activeFeatures.o10_same_image_gpu_count = Math.round(allocation);
    activeFeatures.o7_synchronized_fabric_footprint = Math.min(
      asNumber(activeFeatures.o7_synchronized_fabric_footprint),
      allocation
    );
    if (allocation < 1) {
      activeFeatures.o4_gpu_util_p95 = 0;
      activeFeatures.o4_gpu_util_duty_gt_70 = 0;
      activeFeatures.o4_gpu_util_p50 = 0;
      activeFeatures.o4_sm_tensor_active_p95 = 0;
      activeFeatures.o4_hbm_bandwidth_active_p95 = 0;
      activeFeatures.o4_hbm_used_fraction_p50 = 0;
      activeFeatures.o7_synchronized_fabric_footprint = 0;
      activeFeatures.o7_collective_periodicity_score = 0;
      activeFeatures.o7_scaleout_port_util_p95 = 0;
      activeFeatures.o11_checkpoint_periodicity_score = 0;
      activeFeatures.o11_checkpoint_write_tb_per_event = 0;
      activeFeatures.o11_read_write_training_pattern_score = 0;
      activeFeatures.o8_rack_power_fraction_p95 = Math.min(asNumber(activeFeatures.o8_rack_power_fraction_p95), 0.25);
    }
  }

  if (changedKey === "o4_gpu_util_p95") {
    const util = clamp(asNumber(activeFeatures.o4_gpu_util_p95) / 100);
    activeFeatures.o4_gpu_util_duty_gt_70 = util >= 0.7
      ? Math.max(asNumber(activeFeatures.o4_gpu_util_duty_gt_70), 0.5)
      : Math.min(asNumber(activeFeatures.o4_gpu_util_duty_gt_70), util / 1.4);
    if (util < 0.3) {
      activeFeatures.o4_gpu_util_p50 = Math.min(asNumber(activeFeatures.o4_gpu_util_p50), util * 100);
      activeFeatures.o4_sm_tensor_active_p95 = Math.min(asNumber(activeFeatures.o4_sm_tensor_active_p95), util * 60);
      activeFeatures.o4_hbm_bandwidth_active_p95 = Math.min(asNumber(activeFeatures.o4_hbm_bandwidth_active_p95), util);
    }
  }

  if (changedKey === "o7_synchronized_fabric_footprint" || changedKey === "o7_collective_periodicity_score") {
    const capacity = Math.max(1, asNumber(activeFeatures.o1_normalized_h100e_capacity, 1));
    const footprint = Math.max(0, asNumber(activeFeatures.o7_synchronized_fabric_footprint));
    const periodicity = clamp(asNumber(activeFeatures.o7_collective_periodicity_score));
    if (changedKey === "o7_synchronized_fabric_footprint" && footprint < 64) {
      activeFeatures.o7_collective_periodicity_score = Math.min(periodicity, footprint / capacity);
      activeFeatures.o7_scaleout_port_util_p95 = Math.min(asNumber(activeFeatures.o7_scaleout_port_util_p95), footprint / capacity);
    }
    if (changedKey === "o7_collective_periodicity_score" && periodicity < 0.2) {
      activeFeatures.o7_synchronized_fabric_footprint = Math.min(footprint, Math.round(capacity * periodicity));
      activeFeatures.o7_scaleout_port_util_p95 = Math.min(asNumber(activeFeatures.o7_scaleout_port_util_p95), periodicity + 0.05);
    }
  }

  if (changedKey === "o8_rack_power_fraction_p95") {
    const power = clamp(asNumber(activeFeatures.o8_rack_power_fraction_p95));
    activeFeatures.o4_gpu_power_fraction_p95 = Math.min(asNumber(activeFeatures.o4_gpu_power_fraction_p95), Math.max(power, 0.18));
    activeFeatures.o9_cooling_flow_duty = Math.min(asNumber(activeFeatures.o9_cooling_flow_duty), Math.max(power, 0.12));
  }

  if (changedKey === "o11_checkpoint_periodicity_score") {
    const checkpoint = clamp(asNumber(activeFeatures.o11_checkpoint_periodicity_score));
    if (checkpoint < 0.1) {
      activeFeatures.o11_checkpoint_write_tb_per_event = 0;
      activeFeatures.o11_read_write_training_pattern_score = 0;
    }
  }
}

function fabricSignal(features) {
  const capacity = Math.max(1, asNumber(features.o1_normalized_h100e_capacity, 1));
  return Math.max(
    clamp(asNumber(features.o7_collective_periodicity_score)),
    clamp(asNumber(features.o7_synchronized_fabric_footprint) / capacity)
  );
}

function emptyFeatureState() {
  return deriveFeatureState({
    o1_normalized_h100e_capacity: 1,
    o1_largest_contiguous_domain_gpus: 0,
    o1_non_partitioned_fraction: 1,
    o2_max_concurrent_normalized_gpus: 0,
    o2_allocation_duration_hours: 0,
    o4_gpu_util_p95: 0,
    o4_sm_tensor_active_p95: 0,
    o4_missing_reason: "observed",
    o7_synchronized_fabric_footprint: 0,
    o7_collective_periodicity_score: 0,
    o8_rack_power_fraction_p95: 0,
    o11_checkpoint_periodicity_score: 0,
    o12_signed_ml_logs_present: false,
    o13_confidential_compute_mode_fraction: 0,
    o14_min_critical_coverage: 1,
    o14_gap_fraction_critical: 0,
    capacity_possible: false,
  });
}

function siteOptionLabel(site) {
  return `${site.site_id} - ${pretty(site.site_type)}, ${formatNumber(site.normalized_h100e_capacity)} H100e`;
}

function scenarioOptionLabel(item) {
  return pretty(scenarioSummaryKey(item));
}

function rowOptionLabel(row) {
  const predicted = Number(row.predicted_label);
  const truth = Number(row.label_0_to_4);
  const label = predicted === truth ? `model L${predicted}` : `truth L${truth}, model L${predicted}`;
  return `${row.site_id} | ${scenarioDisplay(row)} | ${label} | ${WINDOW_LABELS.get(row.window_length_seconds)}`;
}

function sourceRowSummary(row) {
  if (!row) return "none";
  const predicted = Number(row.predicted_label);
  const truth = Number(row.label_0_to_4);
  const label = predicted === truth ? `model L${predicted}` : `truth L${truth}, model L${predicted}`;
  return `${row.site_id} / ${scenarioDisplay(row)} / ${WINDOW_LABELS.get(row.window_length_seconds)} / ${label}`;
}

function scenarioKey(row) {
  return row.scenario_family || row.latent_workload_class || "unknown";
}

function scenarioSummaryKey(item) {
  return item.scenario_family || item.scenario || "unknown";
}

function scenarioDisplay(row) {
  const family = pretty(scenarioKey(row));
  return row.scenario_variant ? `${family} (${pretty(row.scenario_variant)})` : family;
}

function labelDistributionText(distribution = {}) {
  return Object.entries(distribution)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([label, count]) => `L${label} ${formatNumber(count)}`)
    .join(", ");
}

function filterSummary() {
  const site = dom.siteSelect.value === "all" ? "all sites" : dom.siteSelect.value;
  const scenario = dom.scenarioSelect.value === "all" ? "all scenario families" : pretty(dom.scenarioSelect.value);
  const windowLength = dom.windowSelect.value === "all"
    ? "all windows"
    : WINDOW_LABELS.get(Number(dom.windowSelect.value)) || `${dom.windowSelect.value}s`;
  return `${site}, ${scenario}, ${windowLength}`;
}

function setOptions(select, options) {
  select.innerHTML = "";
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
}

function pretty(value) {
  if (value == null || value === "") return "none";
  return String(value).replaceAll("_", " ");
}

function shortLabel(label) {
  return ["No run", "Possible", "Elevated", "Likely", "Highest"][label] || "Unknown";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
})();
