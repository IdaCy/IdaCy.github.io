(function () {
const {
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
} = window.DCVScoring;

const { DatacenterScene } = window;

const DATA_URL = "./data/demo-data.json";
const WINDOW_LABELS = new Map([
  [900, "15 min"],
  [3600, "1 hour"],
  [21600, "6 hours"],
  [86400, "1 day"],
]);
const POLICY_GPU_HOURS = 512 * 24;

const controlDefs = [
  {
    key: "o1_normalized_training_compute_capacity",
    label: "Training-capable capacity",
    help: "Hardware-normalized accelerator capacity. Capacity is a feasibility gate, not activity evidence.",
    type: "range",
    min: 0,
    max: 8192,
    step: 64,
    format: (value) => formatNumber(value, 0),
  },
  {
    key: "o1_largest_low_latency_topology_footprint",
    label: "Low-latency topology",
    help: "Largest topology footprint where synchronized distributed training is plausible.",
    type: "range",
    min: 0,
    max: 8192,
    step: 64,
    format: (value) => formatNumber(value, 0),
  },
  {
    key: "o1_partitioning_fraction",
    label: "Partitioning fraction",
    help: "Higher partitioning generally weakens a single monolithic training-run interpretation.",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    format: (value) => formatPercent(value, 0),
  },
  {
    key: "o2_allocated_accelerator_count",
    label: "Allocated accelerators",
    help: "Scheduler or control-plane allocation count. Zero allocation does not erase independent activity evidence.",
    type: "range",
    min: 0,
    max: 4096,
    step: 16,
    format: (value) => formatNumber(value, 0),
  },
  {
    key: "o2_allocation_duration",
    label: "Allocation duration",
    help: "Allocation duration in hours. Count times duration is the policy-scale compute anchor.",
    type: "range",
    min: 0,
    max: 240,
    step: 1,
    format: (value) => `${formatNumber(value, 0)} h`,
  },
  {
    key: "o3_batch_provisioning_event_size",
    label: "Cloud batch provisioning",
    help: "Large synchronized provisioning events are primary cloud-side candidate evidence.",
    type: "range",
    min: 0,
    max: 4096,
    step: 16,
    format: (value) => formatNumber(value, 0),
  },
  {
    key: "o4_gpu_busy_percent",
    label: "GPU busy",
    help: "GPU busy percent. High activity supports a run only when cross-layer context aligns.",
    type: "range",
    min: 0,
    max: 100,
    step: 1,
    format: (value) => `${formatNumber(value, 0)}%`,
  },
  {
    key: "o4_sm_tensor_core_active_percent",
    label: "Tensor activity",
    help: "Tensor-core or tensor-pipe activity percent.",
    type: "range",
    min: 0,
    max: 100,
    step: 1,
    format: (value) => `${formatNumber(value, 0)}%`,
  },
  {
    key: "o4_gpu_power_draw_or_fraction",
    label: "GPU power fraction",
    help: "GPU-level power draw as a fraction of expected peak or cap.",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    format: (value) => formatPercent(value, 0),
  },
  {
    key: "o7_synchronized_fabric_footprint",
    label: "Synchronized fabric footprint",
    help: "Approximate number of accelerators participating in synchronized scale-out fabric behavior.",
    type: "range",
    min: 0,
    max: 4096,
    step: 16,
    format: (value) => formatNumber(value, 0),
  },
  {
    key: "o7_scaleout_port_utilization",
    label: "Scale-out port utilization",
    help: "Network-scale utilization. This is one of the highest-value activity features in the catalog.",
    type: "range",
    min: 0,
    max: 100,
    step: 1,
    format: (value) => `${formatNumber(value, 0)}%`,
  },
  {
    key: "o7_collective_periodicity_step_cadence",
    label: "Collective cadence",
    help: "Seconds between periodic collective communication bursts. 2-90 seconds is treated as strong cadence evidence.",
    type: "range",
    min: 0,
    max: 600,
    step: 5,
    format: (value) => (asNumber(value) > 0 ? `${formatNumber(value, 0)} s` : "none"),
  },
  {
    key: "o8_rack_it_power_kw",
    label: "Rack / IT power",
    help: "Mapped rack or IT power in kW. Power corroborates activity but cannot identify training alone.",
    type: "range",
    min: 0,
    max: 12000,
    step: 50,
    format: (value) => `${formatNumber(value, 0)} kW`,
  },
  {
    key: "o11_checkpoint_write_size",
    label: "Checkpoint write size",
    help: "Large periodic checkpoint-like writes support training only with compute/fabric alignment.",
    type: "range",
    min: 0,
    max: 6000000000000,
    step: 50000000000,
    format: formatBytes,
  },
  {
    key: "o11_checkpoint_period",
    label: "Checkpoint period",
    help: "Checkpoint interval in seconds. Values in the 10 minute to 6 hour range support training-like storage cadence.",
    type: "range",
    min: 0,
    max: 21600,
    step: 300,
    format: (value) => (asNumber(value) > 0 ? `${formatNumber(value / 3600, 1)} h` : "none"),
  },
  {
    key: "o14_telemetry_coverage_fraction_by_layer",
    label: "Telemetry coverage",
    help: "Cross-layer telemetry coverage. Low coverage weakens no-run confidence and can raise integrity risk.",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    format: (value) => formatPercent(value, 0),
  },
  {
    key: "o14_telemetry_gap_fraction_missed_scrapes",
    label: "Telemetry gap fraction",
    help: "Fraction of missed scrapes or missing critical telemetry during the candidate window.",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    format: (value) => formatPercent(value, 0),
  },
  {
    key: "o13_confidential_compute_security_mode",
    label: "Confidential-compute mode",
    help: "Declared confidential-compute/security mode can explain unavailable counters when consistent.",
    type: "select",
    optionsKey: "o13_confidential_compute_security_mode",
  },
  {
    key: "o5_profiler_availability_state",
    label: "Profiler availability",
    help: "Blocked or disabled profiler/counter availability raises discrepancy risk when not explained by security mode.",
    type: "select",
    optionsKey: "o5_profiler_availability_state",
  },
  {
    key: "o10_runtime_framework_class",
    label: "Runtime class",
    help: "Training runtimes are semantic evidence; inference/HPC/benchmark runtimes are countervailing context.",
    type: "select",
    optionsKey: "o10_runtime_framework_class",
  },
  {
    key: "o2_declared_workload_class",
    label: "Declared workload class",
    help: "Self-declared workload class is weak evidence and can be adversarial or stale.",
    type: "select",
    optionsKey: "o2_declared_workload_class",
  },
  {
    key: "o12_loss_optimizer_checkpoint_metadata",
    label: "ML metadata",
    help: "Loss, optimizer, checkpoint, or signed ML metadata is strong semantic support when authenticated.",
    type: "select",
    optionsKey: "o12_loss_optimizer_checkpoint_metadata",
  },
  {
    key: "o17_external_it_power_capacity_estimate",
    label: "External IT capacity estimate",
    help: "External power or capacity estimates can reveal inventory discrepancies, not active training by themselves.",
    type: "range",
    min: 0,
    max: 30,
    step: 0.1,
    format: (value) => `${formatNumber(value, 1)} MW`,
  },
  {
    key: "o16_probe_throughput_ratio",
    label: "Active probe throughput ratio",
    help: "Unexpectedly low active-probe throughput during claimed idle can raise weak-trust suspicion.",
    type: "range",
    min: 0,
    max: 1.5,
    step: 0.01,
    format: (value) => formatNumber(value, 2),
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

  dom.datasetEyebrow.textContent = dataset.metadata.catalog_id || "catalog v2";
  dom.datasetStatus.textContent = `${formatNumber(dataset.metadata.row_count)} synthetic windows`;
  if (dom.apiStatus) dom.apiStatus.textContent = "Catalog v2 deterministic evaluator";

  populateSelectors();
  populateQuickPicks();
  buildControls();

  const initialRowId = dataset.example_rows?.["4"] || dataset.rows[0]?.feature_row_id;
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
    "evasion-fill",
    "p-evasion",
    "severity-score",
    "negative-confidence",
    "integrity-status",
    "capacity-status",
    "evasion-status",
    "probability-bars",
    "policy-ratio",
    "controls-root",
    "evidence-list",
    "missing-list",
    "evasion-list",
  ];
  for (const id of ids) dom[toCamel(id)] = document.getElementById(id);
}

function toCamel(id) {
  return id.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function populateSelectors() {
  setOptions(dom.siteSelect, [["all", "All sites"], ...dataset.sites.map((site) => [site.site_id, siteOptionLabel(site)])]);
  syncScenarioOptions();
  syncWindowOptions();
  renderRowOptions({ skipActivation: true });

  dom.siteSelect.addEventListener("change", () => {
    syncScenarioOptions();
    syncWindowOptions();
    renderRowOptions();
  });
  dom.scenarioSelect.addEventListener("change", () => {
    syncWindowOptions();
    renderRowOptions();
  });
  dom.windowSelect.addEventListener("change", () => renderRowOptions());
  dom.rowSelect.addEventListener("change", () => {
    if (dom.rowSelect.value) setActiveRowById(dom.rowSelect.value);
  });
}

function syncScenarioOptions() {
  const previous = dom.scenarioSelect.value || "all";
  const rows = rowsMatching({ site: dom.siteSelect.value, scenario: "all", windowLength: "all" });
  const keys = [...new Set(rows.map((row) => row.scenario_family))].sort();
  const available = new Set(keys);
  setOptions(dom.scenarioSelect, [["all", "All scenario families"], ...keys.map((key) => [key, scenarioOptionLabel(key)])]);
  dom.scenarioSelect.value = previous === "all" || available.has(previous) ? previous : "all";
}

function syncWindowOptions() {
  const previous = dom.windowSelect.value || "all";
  const rows = rowsMatching({ site: dom.siteSelect.value, scenario: dom.scenarioSelect.value, windowLength: "all" });
  const windows = [...new Set(rows.map((row) => row.window_length_seconds))].sort((a, b) => a - b);
  setOptions(dom.windowSelect, [["all", "All windows"], ...windows.map((value) => [String(value), WINDOW_LABELS.get(value) || `${value}s`])]);
  dom.windowSelect.value = previous === "all" || windows.includes(Number(previous)) ? previous : "all";
}

function populateQuickPicks() {
  document.querySelectorAll("[data-example-label]").forEach((button) => {
    button.addEventListener("click", () => {
      const rowId = dataset.example_rows?.[button.dataset.exampleLabel];
      if (rowId) setActiveRowById(rowId, { syncSelectors: true });
    });
  });
  document.querySelectorAll("[data-evasion-label]").forEach((button) => {
    button.addEventListener("click", () => {
      const rowId = dataset.evasion_example_rows?.[button.dataset.evasionLabel];
      if (rowId) setActiveRowById(rowId, { syncSelectors: true });
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

  const limitedRows = rows.slice(0, 700);
  setOptions(dom.rowSelect, limitedRows.map((row) => [row.feature_row_id, rowOptionLabel(row)]));
  dom.rowSelect.disabled = false;
  setControlsDisabled(false);
  dom.resetRow.disabled = false;

  const target = limitedRows.find((row) => row.feature_row_id === activeRow?.feature_row_id) || limitedRows[0];
  dom.rowSelect.value = target.feature_row_id;
  if (!options.skipActivation) setActiveRow(target, { resetFeatures: true });
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
    if (scenario !== "all" && row.scenario_family !== scenario) return false;
    if (windowLength !== "all" && String(row.window_length_seconds) !== String(windowLength)) return false;
    return true;
  });
}

function setActiveRowById(rowId, options = {}) {
  const row = dataset.rows.find((candidate) => candidate.feature_row_id === rowId);
  if (!row) return;
  if (options.syncSelectors) {
    dom.siteSelect.value = row.site_id;
    syncScenarioOptions();
    dom.scenarioSelect.value = row.scenario_family;
    syncWindowOptions();
    dom.windowSelect.value = String(row.window_length_seconds);
    renderRowOptions({ skipActivation: true });
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
    activeFeatures = deriveFeatureState(clone(row.features), activeSite(row));
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
    row.title = def.help || "";

    const name = document.createElement("span");
    name.textContent = def.label;
    const value = document.createElement("strong");
    value.className = "control-value";
    value.dataset.valueFor = def.key;

    let input;
    if (def.type === "select") {
      input = document.createElement("select");
      const values = dataset.categorical_values?.[def.optionsKey] || def.options || [];
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
    input.title = def.help || "";
    input.addEventListener("input", () => handleControlEdit(def, input));
    input.addEventListener("change", () => handleControlEdit(def, input));
    row.append(name, input, value);
    dom.controlsRoot.append(row);
  }
}

function handleControlEdit(def, input) {
  activeFeatures[def.key] = controlInputValue(def, input);
  applyControlSideEffects(def.key);
  activeFeatures = deriveFeatureState(activeFeatures, activeSite());
  sandboxDirty = true;
  syncControls();
  renderDashboard();
}

function controlInputValue(def, input) {
  if (def.type === "range") return Number(input.value);
  return input.value;
}

function applyControlSideEffects(key) {
  if (key === "o13_confidential_compute_security_mode" && activeFeatures[key] === "on") {
    activeFeatures.o5_profiler_availability_state = "confidential_compute_blocked";
    activeFeatures.o14_telemetry_coverage_fraction_by_layer = Math.min(
      asNumber(activeFeatures.o14_telemetry_coverage_fraction_by_layer, 1),
      0.75
    );
  }
  if (key === "o5_profiler_availability_state" && activeFeatures[key] === "available") {
    if (activeFeatures.o13_confidential_compute_security_mode === "on") {
      activeFeatures.o13_confidential_compute_security_mode = "off";
    }
  }
  if (key === "o14_telemetry_gap_fraction_missed_scrapes") {
    const gap = clamp(activeFeatures.o14_telemetry_gap_fraction_missed_scrapes);
    activeFeatures.o14_telemetry_coverage_fraction_by_layer = Math.min(
      asNumber(activeFeatures.o14_telemetry_coverage_fraction_by_layer, 1),
      1 - gap * 0.5
    );
  }
}

function syncControls() {
  for (const def of controlDefs) {
    const input = dom.controlsRoot.querySelector(`[data-key="${def.key}"]`);
    if (!input) continue;
    const value = activeFeatures[def.key];
    if (def.type === "select") {
      ensureSelectOption(input, value);
      input.value = value ?? "";
    } else {
      input.value = clampForControl(def, value);
    }
    updateControlValue(def);
  }
}

function clampForControl(def, value) {
  if (def.type !== "range") return value ?? "";
  return Math.min(asNumber(def.max), Math.max(asNumber(def.min), asNumber(value)));
}

function updateControlValue(def) {
  const output = dom.controlsRoot.querySelector(`[data-value-for="${def.key}"]`);
  if (!output) return;
  const value = activeFeatures[def.key];
  output.textContent = def.format ? def.format(value) : pretty(value);
}

function renderDashboard() {
  if (!activeRow) {
    renderEmptyState();
    return;
  }

  const result = sandboxDirty ? scoreFeatures(activeFeatures, activeSite()) : replayResult(activeRow, activeSite());
  const features = result.features;
  renderStateBanner(result);

  dom.resultMode.textContent = sandboxDirty ? "Catalog v2 rule sandbox" : "Catalog v2 generated datapoint";
  dom.modeDetail.textContent = sandboxDirty
    ? `Manual edits are scored by deterministic catalog rules. Source datapoint: ${sourceRowSummary(activeRow)}.`
    : `Selected row was generated from the public v2 catalog. ${sourceRowSummary(activeRow)}.`;
  dom.resultLabel.textContent = `L${result.label}: ${labelName(result.label)}`;
  dom.resultLabel.style.color = labelColor(result.label);

  dom.riskFill.style.width = formatPercent(result.pLarge, 1);
  dom.riskFill.style.backgroundColor = labelColor(result.label);
  dom.pLarge.textContent = formatPercent(result.pLarge, 1);
  if (dom.evasionFill) {
    dom.evasionFill.style.width = formatPercent(result.evasionProbability, 1);
    dom.evasionFill.style.backgroundColor = evasionColor(result.evasionLabel);
  }
  if (dom.pEvasion) dom.pEvasion.textContent = formatPercent(result.evasionProbability, 1);

  dom.severityScore.textContent = result.severity.toFixed(2);
  dom.negativeConfidence.textContent = formatPercent(result.negativeCertificationConfidence, 1);
  dom.integrityStatus.textContent = result.integrityWarning ? "Warning" : "Clear";
  dom.integrityStatus.style.color = result.integrityWarning ? "var(--integrity)" : "var(--ok)";
  dom.capacityStatus.textContent = result.capacityPossible ? "Possible" : "Below threshold";
  dom.capacityStatus.style.color = result.capacityPossible ? "var(--warn)" : "var(--ok)";
  if (dom.evasionStatus) {
    dom.evasionStatus.textContent = evasionName(result.evasionLabel);
    dom.evasionStatus.style.color = evasionColor(result.evasionLabel);
  }

  dom.policyRatio.textContent = `Policy ratio ${policyRatio(features).toFixed(2)}`;
  renderProbabilityBars(result.probabilities);
  renderList(dom.evidenceList, result.topEvidence, false);
  renderList(dom.missingList, result.criticalMissingLayers.length ? result.criticalMissingLayers : ["none flagged"], true);
  renderList(dom.evasionList, evasionItems(result), result.evasionRules.length > 0);
  updateHud(features);
  scene.update(features, result, activeSite());
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
  if (!root) return;
  root.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    if (warnings && item !== "none flagged" && item !== "no discrepancy rules triggered") li.className = "warning";
    root.append(li);
  }
}

function evasionItems(result) {
  const rules = result.evasionRules?.length
    ? result.evasionRules.map((rule) => pretty(rule.replace(/^discrepancy_/, "")))
    : ["no discrepancy rules triggered"];
  if (result.benignExplanations?.length) {
    rules.push(`Check benign explanations: ${result.benignExplanations.join(", ")}`);
  }
  return rules;
}

function updateHud(features) {
  dom.hudGpus.textContent = formatNumber(asNumber(features.o2_allocated_accelerator_count), 0);
  dom.hudFabric.textContent = formatPercent(fabricSignal(features), 0);
  dom.hudPower.textContent = formatPercent(powerSignal(features, activeSite()), 0);
  dom.hudCoverage.textContent = formatPercent(asNumber(features.o14_telemetry_coverage_fraction_by_layer, 1), 0);
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
  dom.modeDetail.textContent = `No synthetic row exists for ${filterSummary()}. Evidence inputs are disabled.`;
  dom.resultLabel.textContent = "No matching datapoint";
  dom.resultLabel.style.color = "var(--muted)";
  dom.riskFill.style.width = "0%";
  dom.pLarge.textContent = "n/a";
  if (dom.evasionFill) dom.evasionFill.style.width = "0%";
  if (dom.pEvasion) dom.pEvasion.textContent = "n/a";
  dom.severityScore.textContent = "n/a";
  dom.negativeConfidence.textContent = "n/a";
  dom.integrityStatus.textContent = "n/a";
  dom.capacityStatus.textContent = "n/a";
  if (dom.evasionStatus) dom.evasionStatus.textContent = "n/a";
  dom.policyRatio.textContent = "Policy ratio n/a";
  dom.probabilityBars.innerHTML = "";
  renderList(dom.evidenceList, ["no datapoint selected"], false);
  renderList(dom.missingList, ["no datapoint selected"], true);
  renderList(dom.evasionList, ["no datapoint selected"], true);
  updateHudEmpty();
  if (scene) scene.update(features, { label: 0, evasionProbability: 0, integrityWarning: false }, activeSite());
}

function renderStateBanner(result) {
  const warnings = result.consistencyWarnings || [];
  dom.stateBanner.className = warnings.length ? "state-banner warning" : "state-banner";
  if (sandboxDirty) {
    dom.stateBanner.textContent = warnings.length
      ? `Edited sandbox from ${sourceRowSummary(activeRow)}. Check: ${warnings.slice(0, 4).join("; ")}.`
      : `Edited sandbox from ${sourceRowSummary(activeRow)}.`;
  } else {
    dom.stateBanner.textContent = `Source datapoint: ${sourceRowSummary(activeRow)}`;
  }
}

function renderContextStatus(rows = filteredRows()) {
  if (!dom.contextStatus || !dataset) return;
  const parts = [];
  if (dom.siteSelect.value !== "all") {
    const site = dataset.sites.find((item) => item.site_id === dom.siteSelect.value);
    if (site) {
      parts.push(
        `${site.name}: ${pretty(site.operator_type)}, ${formatNumber(site.normalized_training_compute_capacity)} accelerators, ${pretty(site.trust_tier)} trust`
      );
    }
  }
  if (dom.scenarioSelect.value !== "all") {
    parts.push(`${scenarioOptionLabel(dom.scenarioSelect.value)} selected`);
  }
  if (!parts.length) {
    parts.push("Filters select synthetic datapoints; manual edits use the catalog v2 deterministic evaluator.");
  }
  dom.contextStatus.textContent = `${parts.join(" | ")} | ${formatNumber(rows.length)} matching rows`;
}

function updateFilterStatus(total, shown) {
  dom.filterStatus.textContent = total > shown
    ? `Showing first ${formatNumber(shown)} of ${formatNumber(total)} matching rows`
    : `${formatNumber(total)} matching rows`;
}

function setControlsDisabled(disabled) {
  dom.controlsRoot?.querySelectorAll("input, select").forEach((input) => {
    input.disabled = disabled;
  });
}

function setOptions(select, options) {
  const previous = select.value;
  select.innerHTML = "";
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  if (options.some(([value]) => String(value) === String(previous))) {
    select.value = previous;
  }
}

function ensureSelectOption(select, value) {
  if (value == null || [...select.options].some((option) => option.value === String(value))) return;
  const option = document.createElement("option");
  option.value = value;
  option.textContent = pretty(value);
  select.append(option);
}

function siteOptionLabel(site) {
  return `${site.name} (${formatNumber(site.normalized_training_compute_capacity)} accel, ${pretty(site.operator_type)})`;
}

function scenarioOptionLabel(key) {
  const summary = dataset.scenarios?.find((item) => item.scenario === key);
  const base = pretty(key);
  if (!summary) return base;
  const flags = [];
  if (summary.training_positive_rows) flags.push("training");
  if (summary.evasion_positive_rows) flags.push("evasion");
  return `${base} (${formatNumber(summary.rows)} rows${flags.length ? `, ${flags.join("+")}` : ""})`;
}

function rowOptionLabel(row) {
  return `${row.feature_row_id} | L${row.training_label} ${formatPercent(row.training_probability, 0)} | ${evasionName(row.evasion_label)} ${formatPercent(row.evasion_probability, 0)}`;
}

function sourceRowSummary(row) {
  const site = dataset.sites.find((item) => item.site_id === row.site_id);
  return `${site?.name || row.site_id}, ${pretty(row.scenario_family)}, ${WINDOW_LABELS.get(row.window_length_seconds) || `${row.window_length_seconds}s`}`;
}

function activeSite(row = activeRow) {
  const siteId = row?.site_id || dom.siteSelect?.value;
  return dataset?.sites?.find((site) => site.site_id === siteId) || null;
}

function policyRatio(features) {
  return asNumber(features.o2_allocated_compute_hours) / POLICY_GPU_HOURS;
}

function fabricSignal(features) {
  const capacity = Math.max(1, asNumber(features.o1_normalized_training_compute_capacity, 1));
  return Math.max(
    clamp(asNumber(features.o7_synchronized_fabric_footprint) / capacity),
    cadenceScore(features.o7_collective_periodicity_step_cadence) * 0.85,
    clamp(asNumber(features.o7_scaleout_port_utilization) / 100)
  );
}

function powerSignal(features, site) {
  const designKw = Math.max(1, asNumber(site?.rack_power_design_kw, Math.max(1000, asNumber(features.o8_rack_it_power_kw))));
  return clamp(asNumber(features.o8_rack_it_power_kw) / designKw);
}

function shortLabel(label) {
  return ["None", "Possible", "Elevated", "Likely", "Definite"][label] || "Unknown";
}

function filterSummary() {
  const site = dom.siteSelect.value === "all" ? "all sites" : pretty(dom.siteSelect.value);
  const scenario = dom.scenarioSelect.value === "all" ? "all scenarios" : pretty(dom.scenarioSelect.value);
  const windowLength = dom.windowSelect.value === "all" ? "all windows" : WINDOW_LABELS.get(Number(dom.windowSelect.value));
  return `${site}, ${scenario}, ${windowLength}`;
}

function pretty(value) {
  return String(value ?? "unknown")
    .replace(/^o\d+_/, "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function emptyFeatureState() {
  return deriveFeatureState({
    o1_normalized_training_compute_capacity: 1,
    o1_largest_low_latency_topology_footprint: 1,
    o1_partitioning_fraction: 0,
    o2_allocated_accelerator_count: 0,
    o2_allocation_duration: 0,
    o4_gpu_busy_percent: 0,
    o7_synchronized_fabric_footprint: 0,
    o7_collective_periodicity_step_cadence: 0,
    o8_rack_it_power_kw: 0,
    o14_telemetry_coverage_fraction_by_layer: 1,
    o14_telemetry_gap_fraction_missed_scrapes: 0,
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
})();
