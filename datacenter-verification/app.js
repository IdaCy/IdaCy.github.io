(function () {
const {
  asBool,
  asNumber,
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
const WINDOW_LABELS = new Map([
  [900, "15 min"],
  [3600, "1 hour"],
  [21600, "6 hours"],
  [86400, "1 day"],
]);

const controlDefs = [
  {
    key: "o1_normalized_h100e_capacity",
    label: "H100e capacity",
    type: "range",
    min: 0,
    max: 4096,
    step: 64,
    format: (value) => formatNumber(value, 0),
  },
  {
    key: "o2_max_concurrent_normalized_gpus",
    label: "Allocated GPUs",
    type: "range",
    min: 0,
    max: 2600,
    step: 16,
    format: (value) => formatNumber(value, 0),
  },
  {
    key: "o2_allocation_duration_hours",
    label: "Allocation duration",
    type: "range",
    min: 0,
    max: 420,
    step: 1,
    format: (value) => `${formatNumber(value, 0)} h`,
  },
  {
    key: "o4_gpu_util_p95",
    label: "GPU utilization p95",
    type: "range",
    min: 0,
    max: 100,
    step: 1,
    format: (value) => `${formatNumber(value, 0)}%`,
  },
  {
    key: "o4_sm_tensor_active_p95",
    label: "Tensor activity p95",
    type: "range",
    min: 0,
    max: 100,
    step: 1,
    format: (value) => `${formatNumber(value, 0)}%`,
  },
  {
    key: "o7_synchronized_fabric_footprint",
    label: "Fabric footprint",
    type: "range",
    min: 0,
    max: 2400,
    step: 16,
    format: (value) => formatNumber(value, 0),
  },
  {
    key: "o7_collective_periodicity_score",
    label: "Collective periodicity",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    format: (value) => formatNumber(value, 2),
  },
  {
    key: "o8_rack_power_fraction_p95",
    label: "Rack power p95",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    format: (value) => formatPercent(value),
  },
  {
    key: "o11_checkpoint_periodicity_score",
    label: "Checkpoint cadence",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    format: (value) => formatNumber(value, 2),
  },
  {
    key: "o14_min_critical_coverage",
    label: "Critical coverage",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    format: (value) => formatPercent(value),
  },
  {
    key: "o14_gap_fraction_critical",
    label: "Telemetry gap fraction",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    format: (value) => formatPercent(value),
  },
  {
    key: "o13_confidential_compute_mode_fraction",
    label: "Confidential-compute share",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    format: (value) => formatPercent(value),
  },
  {
    key: "o12_signed_ml_logs_present",
    label: "Signed ML logs",
    type: "checkbox",
    format: (value) => (asBool(value) ? "present" : "absent"),
  },
  {
    key: "o10_runtime_framework_class",
    label: "Runtime class",
    type: "select",
    optionsKey: "o10_runtime_framework_class",
  },
  {
    key: "o2_declared_workload_class",
    label: "Declared class",
    type: "select",
    optionsKey: "o2_declared_workload_class",
  },
  {
    key: "o4_missing_reason",
    label: "GPU telemetry state",
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

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindDom();
  scene = new DatacenterScene(dom.sceneRoot);
  dataset = window.DCVDemoData;
  if (!dataset) {
    const response = await fetch(DATA_URL);
    dataset = await response.json();
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
    "scene-root",
    "hud-gpus",
    "hud-fabric",
    "hud-power",
    "hud-coverage",
    "site-select",
    "scenario-select",
    "window-select",
    "row-select",
    "reset-row",
    "result-mode",
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
  const sites = dataset.sites.map((site) => site.site_id);
  setOptions(dom.siteSelect, [["all", "All sites"], ...sites.map((site) => [site, site])]);

  const scenarios = dataset.scenarios.map((item) => item.scenario);
  setOptions(dom.scenarioSelect, [["all", "All scenarios"], ...scenarios.map((scenario) => [scenario, pretty(scenario)])]);

  const windows = [...new Set(dataset.rows.map((row) => row.window_length_seconds))].sort((a, b) => a - b);
  setOptions(dom.windowSelect, [["all", "All windows"], ...windows.map((window) => [String(window), WINDOW_LABELS.get(window) || `${window}s`])]);

  dom.siteSelect.addEventListener("change", () => renderRowOptions());
  dom.scenarioSelect.addEventListener("change", () => renderRowOptions());
  dom.windowSelect.addEventListener("change", () => renderRowOptions());
  dom.rowSelect.addEventListener("change", () => setActiveRowById(dom.rowSelect.value));
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

function renderRowOptions() {
  const rows = filteredRows();
  const limitedRows = rows.slice(0, 700);
  setOptions(
    dom.rowSelect,
    limitedRows.map((row) => [
      row.feature_row_id,
      `${row.site_id} | ${pretty(row.latent_workload_class)} | L${row.label_0_to_4} | ${WINDOW_LABELS.get(row.window_length_seconds)}`,
    ])
  );
  if (!limitedRows.some((row) => row.feature_row_id === activeRow?.feature_row_id)) {
    setActiveRow(limitedRows[0] || dataset.rows[0], { resetFeatures: true });
  } else {
    dom.rowSelect.value = activeRow.feature_row_id;
  }
}

function filteredRows() {
  const site = dom.siteSelect.value;
  const scenario = dom.scenarioSelect.value;
  const windowLength = dom.windowSelect.value;
  return dataset.rows.filter((row) => {
    if (site !== "all" && row.site_id !== site) return false;
    if (scenario !== "all" && row.latent_workload_class !== scenario) return false;
    if (windowLength !== "all" && String(row.window_length_seconds) !== windowLength) return false;
    return true;
  });
}

function setActiveRowById(rowId, options = {}) {
  const row = dataset.rows.find((candidate) => candidate.feature_row_id === rowId);
  if (!row) return;
  if (options.syncSelectors) {
    dom.siteSelect.value = row.site_id;
    dom.scenarioSelect.value = row.latent_workload_class;
    dom.windowSelect.value = String(row.window_length_seconds);
    renderRowOptions();
  }
  setActiveRow(row, { resetFeatures: true });
}

function setActiveRow(row, options = {}) {
  activeRow = row;
  if (options.resetFeatures) {
    activeFeatures = deriveFeatureState(clone(row.features));
    sandboxDirty = false;
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
    const name = document.createElement("span");
    name.textContent = def.label;
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
    input.addEventListener("input", () => {
      applyControlValue(def, input);
      sandboxDirty = true;
      renderDashboard();
    });
    input.addEventListener("change", () => {
      applyControlValue(def, input);
      sandboxDirty = true;
      renderDashboard();
    });

    row.append(name, input, value);
    dom.controlsRoot.append(row);
  }
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
  activeFeatures = deriveFeatureState(activeFeatures);
  updateCoverageFields(def.key);
  syncDerivedControlValues();
}

function syncDerivedControlValues() {
  for (const def of controlDefs) {
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
    activeFeatures.o1_coverage_fraction = Math.min(asNumber(activeFeatures.o1_coverage_fraction, 1), coverage);
    activeFeatures.o2_coverage_fraction = Math.min(asNumber(activeFeatures.o2_coverage_fraction, 1), coverage);
    activeFeatures.o4_coverage_fraction = Math.min(asNumber(activeFeatures.o4_coverage_fraction, 1), coverage);
    activeFeatures.o7_coverage_fraction = Math.min(asNumber(activeFeatures.o7_coverage_fraction, 1), coverage);
    activeFeatures.o8_coverage_fraction = Math.min(asNumber(activeFeatures.o8_coverage_fraction, 1), coverage);
    activeFeatures.o14_coverage_fraction = coverage;
  }
  if (changedKey === "o4_missing_reason") {
    activeFeatures.o4_coverage_fraction = activeFeatures.o4_missing_reason === "observed" ? 1 : 0.2;
    if (activeFeatures.o4_missing_reason === "counter_disabled_by_cc_mode") {
      activeFeatures.o13_confidential_compute_mode_fraction = Math.max(
        asNumber(activeFeatures.o13_confidential_compute_mode_fraction),
        0.75
      );
      activeFeatures.o14_gap_fraction_critical = Math.max(asNumber(activeFeatures.o14_gap_fraction_critical), 0.45);
      activeFeatures.o14_min_critical_coverage = Math.min(asNumber(activeFeatures.o14_min_critical_coverage, 1), 0.35);
    }
  }
}

function renderDashboard() {
  const replay = replayResult(activeRow);
  const result = sandboxDirty ? scoreFeatures(activeFeatures) : replay;
  const features = sandboxDirty ? result.features : replay.features;

  dom.resultMode.textContent = sandboxDirty ? "Rule sandbox" : "Calibrated model replay";
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
  dom.hudFabric.textContent = formatPercent(asNumber(features.o7_collective_periodicity_score), 0);
  dom.hudPower.textContent = formatPercent(asNumber(features.o8_rack_power_fraction_p95), 0);
  dom.hudCoverage.textContent = formatPercent(asNumber(features.o14_min_critical_coverage, 1), 0);
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
