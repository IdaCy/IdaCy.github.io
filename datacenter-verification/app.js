/*
 * Browser demo for the staged evidence model, draft14.
 * All scoring lives in model.js. This file only selects rows, renders, and
 * writes user edits back into the record the model reads.
 */
(function () {
  "use strict";

  var Model = window.DCVModel;
  var K = Model.constants;
  var DATA = window.DCVDemoData;

  var SPAN = K.LAMBDA_SPAN;          // wF + wC + wN, the widest Lambda can be
  var BANDS = [K.BW, K.BM, K.BH];

  var ROUTE_TEXT = {
    capacity_ruled_out_for_scope:
      "The capacity upper bound is conservatively too small to have carried a threshold-scale run in this segment, at the coverage that was delivered. The audit stops here.",
    high_training_like_warning:
      "Three bits or more of identity evidence. Capacity is live, activity is present, and independently covered pathways agree.",
    medium_training_like_warning:
      "Between two and three bits. A core identity-shape pathway aligns with accelerator activity inside a live capacity segment.",
    weak_training_like_candidate:
      "Consistent with training-like work, but the bit total, the suppressor coverage, or both leave the claim incomplete.",
    candidate_explained_or_demoted:
      "A benign explanation with the coverage to apply accounts for the bytes, so the pathway it covers is discounted rather than the site being cleared.",
    no_training_like_candidate_detected_in_covered_live_segment:
      "Nothing in the covered live segment reaches a candidate. This is a statement about what was covered, not about the site.",
    inconclusive_due_to_missingness:
      "The delivered telemetry cannot carry a claim in either direction. Either an input the capacity bound needs is missing, a blocking flag is set, or Lambda_cov is under one bit.",
    integrity_review_required:
      "The record cannot be read at face value. Either a witness contradicts the reported capacity, or the discrepancy mass reached the review level."
  };

  var ROUTE_CLASS = {
    high_training_like_warning: "route-high",
    medium_training_like_warning: "route-medium",
    integrity_review_required: "route-integrity",
    capacity_ruled_out_for_scope: "route-clear",
    no_training_like_candidate_detected_in_covered_live_segment: "route-clear"
  };

  // ---- control specification -------------------------------------------
  // slot says where the value lives in the record the model reads
  var GROUPS = [
    {
      title: "Stage A, capacity and scale",
      open: true,
      controls: [
        { slot: "count", label: "Accelerator count", type: "log", min: 0, max: 7, step: 0.02 },
        { slot: "rate", label: "Advertised peak rate, ops/s", type: "log", min: 0, max: 18, step: 0.02 },
        { slot: "signal", key: "capacity_adjustment_factor", label: "Capacity adjustment factor", type: "range", min: 0, max: 1, step: 0.01, fallback: 1 },
        { slot: "window", label: "Audit window length, s", type: "log", min: 0, max: 8, step: 0.02 },
        { slot: "signal", key: "achieved_operations", label: "Achieved operations O", type: "log", min: 0, max: 27, step: 0.02, fallback: 0 },
        { slot: "signal", key: "activity_score", label: "Activity score A", type: "range", min: 0, max: 1, step: 0.01, fallback: 0 },
        { slot: "coverage", key: "capacity", label: "Coverage, capacity" },
        { slot: "coverage", key: "clock_alignment", label: "Coverage, clock alignment" },
        { slot: "coverage", key: "achieved_ops", label: "Coverage, achieved ops" },
        { slot: "signal", key: "hidden_or_unmonitored_capacity_possible", label: "Hidden or unmonitored capacity", type: "bool", fallback: false },
        { slot: "signal", key: "capacity_unit_normalized", label: "Capacity units normalized", type: "bool", fallback: true },
        { slot: "signal", key: "achieved_operations_unit_normalized", label: "Achieved ops units normalized", type: "bool", fallback: true }
      ]
    },
    {
      title: "Stage B, identity pathways",
      open: true,
      controls: [
        { slot: "signal", key: "collective_cadence_score", label: "Fabric cadence F", type: "range", min: 0, max: 1, step: 0.01, fallback: 0 },
        { slot: "signal", key: "activity_fabric_overlap_fraction", label: "Overlap rho_AF", type: "range", min: 0, max: 1, step: 0.01, fallback: 0 },
        { slot: "signal", key: "activity_duration_seconds", label: "Activity duration, s", type: "log", min: 0, max: 7, step: 0.02, fallbackFromWindow: true },
        { slot: "signal", key: "checkpoint_periodicity_score", label: "Checkpoint score C", type: "range", min: 0, max: 1, step: 0.01, fallback: 0 },
        { slot: "signal", key: "checkpoint_activity_adjacency_fraction", label: "Adjacency rho_AC", type: "range", min: 0, max: 1, step: 0.01, fallback: 0 },
        { slot: "signal", key: "checkpoint_burst_count", label: "Checkpoint burst count", type: "range", min: 0, max: 12, step: 1, fallback: 0 },
        { slot: "signal", key: "non_serving_score", label: "Non-serving score N", type: "range", min: 0, max: 1, step: 0.01, fallback: 0 },
        { slot: "coverage", key: "fabric", label: "Coverage, fabric K_F" },
        { slot: "coverage", key: "storage", label: "Coverage, storage K_C" },
        { slot: "coverage", key: "serving", label: "Coverage, serving K_N" }
      ]
    },
    {
      title: "Stage C, benign explanations",
      open: false,
      controls: [
        { slot: "signal", key: "serving_counterevidence_score", label: "Serving counterevidence", type: "range", min: 0, max: 1, step: 0.01, fallback: 0 },
        { slot: "signal", key: "serving_activity_overlap_fraction", label: "Serving activity overlap", type: "range", min: 0, max: 1, step: 0.01, fallback: 0 },
        { slot: "signal", key: "storage_operation_overlap_fraction", label: "Storage operation overlap", type: "range", min: 0, max: 1, step: 0.01, fallback: 0 },
        { slot: "signal", key: "bytes_explained_fraction", label: "Bytes explained", type: "range", min: 0, max: 1, step: 0.01, fallback: 0 },
        { slot: "signal", key: "benchmark_regularity_score", label: "Benchmark regularity", type: "range", min: 0, max: 1, step: 0.01, fallback: 0 },
        { slot: "signal", key: "benchmark_duration_seconds", label: "Benchmark duration, s", type: "log", min: 0, max: 7, step: 0.02, fallbackFromWindow: true },
        { slot: "signal", key: "hpc_mpi_score", label: "HPC or MPI cadence", type: "range", min: 0, max: 1, step: 0.01, fallback: 0 },
        { slot: "signal", key: "hpc_overlap_fraction", label: "HPC activity overlap", type: "range", min: 0, max: 1, step: 0.01, fallback: 0 },
        { slot: "coverage", key: "storage_operations", label: "Coverage, storage ops" },
        { slot: "coverage", key: "benchmark_hpc", label: "Coverage, benchmark and HPC" }
      ]
    },
    {
      title: "Stage C, discrepancies and witnesses",
      open: false,
      controls: [
        { slot: "signal", key: "unit_mismatch_or_hidden_capacity_explanation_score", label: "Unit mismatch explanation", type: "range", min: 0, max: 1, step: 0.01, fallback: 0 },
        { slot: "signal", key: "attribution_overlap_fraction", label: "Attribution overlap", type: "range", min: 0, max: 1, step: 0.01, fallback: 1 },
        { slot: "signal", key: "benign_attribution_explanation_overlap_fraction", label: "Benign attribution overlap", type: "range", min: 0, max: 1, step: 0.01, fallback: 0 },
        { slot: "coverage", key: "attribution", label: "Coverage, attribution" },
        { slot: "signal", key: "participant_count", label: "Fabric participant count", type: "log", min: 0, max: 7, step: 0.02, fallback: 0 },
        { slot: "allocated", label: "Allocated accelerator count", type: "log", min: 0, max: 7, step: 0.02 },
        { slot: "signal", key: "physical_timeline_conflict", label: "Physical timeline conflict", type: "bool", fallback: false },
        { slot: "signal", key: "health_throttle_conflict", label: "Health or throttle conflict", type: "bool", fallback: false },
        { slot: "signal", key: "topology_route_conflict", label: "Topology or route conflict", type: "bool", fallback: false },
        { slot: "signal", key: "power_activity_conflict", label: "Power against activity conflict", type: "bool", fallback: false },
        { slot: "signal", key: "decision_blocking_missingness", label: "Decision-blocking missingness", type: "bool", fallback: false }
      ]
    },
    {
      title: "Coverage channels the model does not read",
      open: false,
      note: "Delivered by the generator and shown for completeness. No stage reads them, so moving them changes nothing.",
      controls: [
        { slot: "coverage", key: "identity_shape", label: "Coverage, identity shape" },
        { slot: "coverage", key: "scope_mapping", label: "Coverage, scope mapping" }
      ]
    }
  ];

  // ---- state ------------------------------------------------------------
  var state = {
    families: [],
    rowsByFamily: {},
    family: null,
    rowId: null,
    row: null,
    site: null,
    edited: false
  };

  var el = {};
  var scene = null;
  var controlNodes = [];

  function $(id) {
    return document.getElementById(id);
  }

  // ---- formatting -------------------------------------------------------
  function sci(value, digits) {
    if (value === null || value === undefined) return "-";
    if (!isFinite(value)) return "infinite";
    if (value === 0) return "0";
    if (Math.abs(value) >= 1e5 || Math.abs(value) < 1e-3) {
      return value.toExponential(digits === undefined ? 2 : digits);
    }
    return value.toFixed(digits === undefined ? 2 : digits);
  }

  function fx(value, digits) {
    if (value === null || value === undefined) return "-";
    if (!isFinite(value)) return "infinite";
    return value.toFixed(digits === undefined ? 3 : digits);
  }

  function bits(value) {
    return (value >= 0 ? "+" : "") + value.toFixed(2);
  }

  function pct(value) {
    return Math.round(value * 100) + "%";
  }

  function seconds(value) {
    if (value >= 86400) return (value / 86400).toFixed(2) + " d";
    if (value >= 3600) return (value / 3600).toFixed(2) + " h";
    return Math.round(value) + " s";
  }

  // ---- record access ----------------------------------------------------
  function deepCopy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function siteFromRow(row) {
    return {
      audit_window: deepCopy(row.audit_window),
      coverage: deepCopy(row.coverage),
      normalized_signals: deepCopy(row.normalized_signals),
      raw_features: deepCopy(row.raw_features)
    };
  }

  function windowSeconds(site) {
    return Model.helpers.secs(site.audit_window);
  }

  function readControl(spec, site) {
    var raw = site.raw_features || {};
    if (spec.slot === "count") {
      var list = raw.accelerator_count_by_family_sku || [];
      var total = 0;
      for (var i = 0; i < list.length; i += 1) total += Model.helpers.num(list[i].count);
      return { value: total, present: list.length > 0 };
    }
    if (spec.slot === "rate") {
      var rates = raw.advertised_peak_rate_by_precision || [];
      var best = 0;
      for (var j = 0; j < rates.length; j += 1) {
        var v = Model.helpers.num(rates[j].peak_rate);
        if (j === 0 || v > best) best = v;
      }
      return { value: best, present: rates.length > 0 };
    }
    if (spec.slot === "allocated") {
      var alloc = raw.allocated_accelerator_count_by_sku || [];
      var sum = 0;
      for (var a = 0; a < alloc.length; a += 1) sum += Model.helpers.num(alloc[a].count);
      return { value: sum, present: alloc.length > 0 };
    }
    if (spec.slot === "window") {
      return { value: windowSeconds(site), present: true };
    }
    if (spec.slot === "coverage") {
      var present = Object.prototype.hasOwnProperty.call(site.coverage, spec.key);
      return { value: present ? Model.helpers.num(site.coverage[spec.key], 0) : 0, present: present };
    }
    var signals = site.normalized_signals;
    var has = Object.prototype.hasOwnProperty.call(signals, spec.key);
    if (spec.type === "bool") {
      var effective = has ? !!signals[spec.key] : spec.fallback;
      if (has && (signals[spec.key] === null || signals[spec.key] === undefined)) effective = false;
      return { value: effective, present: has };
    }
    var fallback = spec.fallbackFromWindow ? windowSeconds(site) : spec.fallback;
    return { value: Model.helpers.num(has ? signals[spec.key] : undefined, fallback), present: has };
  }

  function writeControl(spec, site, value) {
    var raw = site.raw_features;
    if (spec.slot === "count") {
      raw.accelerator_count_by_family_sku = [{ count: value }];
      return;
    }
    if (spec.slot === "rate") {
      raw.advertised_peak_rate_by_precision = [{ peak_rate: value }];
      return;
    }
    if (spec.slot === "allocated") {
      raw.allocated_accelerator_count_by_sku = value > 0 ? [{ count: value }] : [];
      return;
    }
    if (spec.slot === "window") {
      var start = Date.parse(site.audit_window.start);
      var end = new Date(start + value * 1000);
      site.audit_window.end = end.toISOString().replace(/\.\d{3}Z$/, "Z");
      return;
    }
    if (spec.slot === "coverage") {
      site.coverage[spec.key] = value;
      return;
    }
    site.normalized_signals[spec.key] = value;
  }

  // ---- parity self-check ------------------------------------------------
  function runParity() {
    var rows = DATA.rows;
    var matched = 0;
    var mismatches = [];
    var worst = 0;
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      var got = Model.evaluate(row);
      var ref = row.reference;
      var dev = Math.abs(got.Lam - ref.Lam);
      if (dev > worst) worst = dev;
      var tol = 1e-9 * Math.max(1, Math.abs(ref.Lam));
      if (got.route === ref.route && dev <= tol) {
        matched += 1;
      } else if (mismatches.length < 20) {
        mismatches.push({ id: row.id, route: got.route, referenceRoute: ref.route, Lam: got.Lam, referenceLam: ref.Lam });
      }
    }
    var badge = el.parityBadge;
    badge.textContent = "parity: " + matched + "/" + rows.length + " rows match reference";
    badge.title =
      "Every shipped row was rescored in this browser and compared against the Python reference output stored at build time. " +
      "Largest Lambda deviation seen: " + worst.toExponential(2) + " bits.";
    if (matched === rows.length) {
      badge.className = "parity-badge pass";
    } else {
      badge.className = "parity-badge fail";
      badge.textContent += ", " + (rows.length - matched) + " MISMATCHED";
      var detail = document.createElement("p");
      detail.className = "edit-notice";
      detail.textContent =
        "Parity failure. " + (rows.length - matched) + " of " + rows.length +
        " rows disagree with the reference implementation. First offenders: " +
        mismatches.map(function (m) {
          return m.id + " got " + m.route + " Lambda " + m.Lam.toFixed(6) +
            ", reference " + m.referenceRoute + " Lambda " + m.referenceLam.toFixed(6);
        }).join(" | ");
      el.filterStatus.parentNode.insertBefore(detail, el.filterStatus.nextSibling);
      if (window.console) window.console.error("DCV parity failure", mismatches);
    }
  }

  // ---- rendering --------------------------------------------------------
  function pos(value) {
    var clamped = Math.max(-SPAN, Math.min(SPAN, value));
    return 50 + (50 * clamped) / SPAN;
  }

  function renderBands(node, strongAtZero) {
    node.innerHTML = "";
    for (var i = 0; i < BANDS.length; i += 1) {
      var signs = [1, -1];
      for (var s = 0; s < signs.length; s += 1) {
        var mark = document.createElement("i");
        mark.style.left = pos(BANDS[i] * signs[s]) + "%";
        if (BANDS[i] === K.BH) mark.className = "strong";
        node.appendChild(mark);
      }
    }
    if (strongAtZero) {
      var zero = document.createElement("i");
      zero.className = "strong";
      zero.style.left = "50%";
      node.appendChild(zero);
    }
  }

  function renderAxis(node) {
    node.innerHTML = "";
    var marks = [-K.BH, -K.BM, -K.BW, 0, K.BW, K.BM, K.BH];
    for (var i = 0; i < marks.length; i += 1) {
      var tick = document.createElement("i");
      tick.style.left = pos(marks[i]) + "%";
      tick.textContent = marks[i] === 0 ? "0" : (marks[i] > 0 ? "+" : "") + marks[i];
      node.appendChild(tick);
    }
  }

  function renderBits(result) {
    var stack = el.bitsStack;
    stack.innerHTML = "";
    var parts = [
      { key: "seg-f", value: result.LF },
      { key: "seg-c", value: result.LC },
      { key: "seg-n", value: result.LN }
    ];
    var right = 0;
    var left = 0;
    for (var i = 0; i < parts.length; i += 1) {
      var value = parts[i].value;
      if (!value) continue;
      var from;
      var to;
      if (value > 0) {
        from = right;
        right += value;
        to = right;
      } else {
        to = left;
        left += value;
        from = left;
      }
      var seg = document.createElement("i");
      seg.className = parts[i].key;
      var a = pos(from);
      var b = pos(to);
      seg.style.left = Math.min(a, b) + "%";
      seg.style.width = Math.abs(b - a) + "%";
      seg.title = parts[i].key + " " + bits(value) + " bits";
      stack.appendChild(seg);
    }
    el.bitsMarker.style.left = pos(result.Lam) + "%";
    el.bitsValue.textContent = bits(result.Lam);
    el.stageBTotal.textContent = "Lambda " + bits(result.Lam) + " bits";

    var ceilingFrom = pos(0);
    var ceilingTo = pos(result.Lcov);
    el.ceilingFill.style.left = Math.min(ceilingFrom, ceilingTo) + "%";
    el.ceilingFill.style.width = Math.abs(ceilingTo - ceilingFrom) + "%";
    el.ceilingValue.textContent = result.Lcov.toFixed(2);
  }

  function row(cells, cls) {
    var tr = document.createElement("tr");
    for (var i = 0; i < cells.length; i += 1) {
      var td = document.createElement("td");
      td.textContent = cells[i];
      if (cls && i > 0) td.className = cls;
      tr.appendChild(td);
    }
    return tr;
  }

  function note(text, cls) {
    var li = document.createElement("li");
    li.textContent = text;
    if (cls) li.className = cls;
    return li;
  }

  function fill(node, items) {
    node.innerHTML = "";
    for (var i = 0; i < items.length; i += 1) node.appendChild(items[i]);
  }

  function renderStageA(result) {
    el.aBound.textContent = sci(result.B) + " ops";
    el.aCstar.textContent = fx(result.cstar, 4);
    el.aMu.textContent = isFinite(result.mu) ? sci(result.mu, 3) : "infinite";
    el.aPiScale.textContent = fx(result.piSc, 4);

    var level = result.ruleOutLevel;
    var box = el.aRuleout;
    box.className = "ruleout " + (result.ruled ? "met" : "unmet");
    if (!result.admissible) {
      box.className = "ruleout unmet";
      box.textContent =
        "Rule-out condition not testable. mu < 1/1.1 = " + level.toFixed(4) +
        " requires an admissible bound, and this record is not admissible.";
    } else {
      box.textContent =
        "Rule-out condition mu < 1/1.1 = " + level.toFixed(4) + " is " +
        (result.ruled ? "MET" : "NOT met") + ". mu = " +
        (isFinite(result.mu) ? result.mu.toPrecision(4) : "infinite") + ".";
    }

    var needed = result.B / K.T * (1 + K.MARGIN);
    var items = [];
    items.push(note(
      "Bound: " + sci(result.cnt, 0) + " accelerators times " + sci(result.rate) +
      " ops/s times " + seconds(result.dur) + " times adjustment " + fx(result.adj, 2) +
      " = " + sci(result.B) + " operations, against T_sys = " + sci(K.T, 0) + ".",
      "quiet"
    ));
    items.push(note(
      "c* = coverage capacity " + fx(Model.helpers.num(state.site.coverage.capacity, 0), 3) +
      " times scope completeness " + fx(result.sigmaScope, 2) +
      " times clock alignment " + fx(Model.helpers.num(state.site.coverage.clock_alignment, 0), 3) +
      " = " + fx(result.cstar, 4) + ".",
      "quiet"
    ));
    items.push(note(
      "A rule-out at this bound would need c* above 1.1 times bound over T_sys = " +
      (needed > 1 ? needed.toPrecision(4) + ", which is over 1, so no coverage can carry it" : needed.toPrecision(4)) + ".",
      needed > 1 ? "bad" : "good"
    ));
    if (!result.admissible) {
      var why = [];
      if (!result.units) why.push("capacity units are not normalized");
      if (!(result.rate > 0)) why.push("no advertised peak rate");
      if (!(result.cnt > 0)) why.push("no accelerator inventory");
      if (!(result.dur > 0)) why.push("audit window has no duration");
      if (result.hidden) why.push("hidden or unmonitored capacity is possible, so scope completeness is 0");
      items.push(note("Not admissible for a negative claim: " + why.join(", ") + ".", "bad"));
    }
    if (result.scaleCertificate === "achieved_operations_certificate") {
      items.push(note(
        "pi_scale = 1 by certificate. Achieved operations " + sci(result.O) +
        " are at or above T_sys, the units are normalized, and achieved-ops coverage is at least " +
        K.COV_STRONG + ".",
        "fired"
      ));
    } else if (result.scaleCertificate === "ruled_out") {
      items.push(note("pi_scale = 0 by the rule-out.", "good"));
    } else {
      items.push(note(
        "pi_scale estimated from C hat = max(eta times A times bound, O) = " +
        sci(Math.max(K.ETA * result.A * result.B, result.O)) + " operations, at eta = " + K.ETA + ".",
        "quiet"
      ));
    }
    fill(el.aNotes, items);

    el.stageAFlag.textContent = result.ruled ? "ruled out" : (result.admissible ? "not ruled out" : "not admissible");
  }

  function renderStageB(result) {
    renderBits(result);

    var body = el.pathwayBody;
    body.innerHTML = "";
    body.appendChild(row(["Fabric F", fx(result.aF), fx(result.psiF), fx(result.bF), K.wF.toFixed(2), bits(result.LF)]));
    body.appendChild(row(["Checkpoint C", fx(result.aC), fx(result.psiC), fx(result.bC), K.wC.toFixed(2), bits(result.LC)]));
    body.appendChild(row(["Non-serving N", fx(result.aN), fx(result.psiN), "n/a", K.wN.toFixed(2), bits(result.LN)]));

    var items = [];
    items.push(note(
      "Lambda_cov = " + result.Lcov.toFixed(2) + " bits is the most the delivered telemetry could ever be worth, " +
      "computed from coverage alone before any value is read.",
      "quiet"
    ));
    if (result.Lcov < K.BW) {
      items.push(note("Under one bit of evidence capacity, so no claim is reachable and the segment is inconclusive for missingness.", "bad"));
    } else if (result.Lcov < K.BH) {
      items.push(note("Under three bits of evidence capacity, so a high warning was out of reach before any value was read.", "fired"));
    } else {
      items.push(note("At or above three bits of evidence capacity, so every band is reachable on these channels.", "good"));
    }
    if (result.Ksup < K.COV_STRONG) {
      items.push(note(
        "Suppressor coverage K_sup = " + fx(result.Ksup) + " is under " + K.COV_STRONG +
        ", so a bit total at or above one bit can only be a weak candidate.",
        "fired"
      ));
    }
    if (result.aF === 0 && result.aC === 0 && result.aN === 0) {
      items.push(note("No pathway can speak about this segment, so the evidence sum is exactly zero. Missing telemetry moves nothing in either direction.", "quiet"));
    }
    fill(el.bNotes, items);
  }

  function renderStageC(result) {
    el.dFill.style.width = Math.min(100, result.D * 100) + "%";
    el.dFill.className = result.D >= K.D_REVIEW ? "review" : "";
    el.cD.textContent = fx(result.D, 4);
    el.stageCFlag.textContent = result.D >= K.D_REVIEW
      ? "at or above the review level"
      : (result.D > 0 ? "some discrepancy mass" : "no discrepancy fired");

    var explanations = [
      { name: "serving", value: result.eServ, into: "b_F" },
      { name: "storage operation", value: result.eSt, into: "b_C" },
      { name: "benchmark", value: result.eBm, into: "b_F" },
      { name: "HPC or MPI", value: result.eHpc, into: "b_F" }
    ];
    var items = [];
    for (var i = 0; i < explanations.length; i += 1) {
      var e = explanations[i];
      var strongest =
        (e.into === "b_F" && e.value === result.bF && result.bF > 0) ||
        (e.into === "b_C" && e.value === result.bC && result.bC > 0);
      items.push(note(
        e.name + " explanation strength " + fx(e.value) + " into " + e.into +
        (strongest ? ", and it is the strongest one covering that pathway" : ""),
        e.value > 0 ? (strongest ? "fired" : "quiet") : "quiet"
      ));
    }
    items.push(note(
      "b_F = " + fx(result.bF) + " and b_C = " + fx(result.bC) +
      ". An explanation lowers only the pathway whose bytes it covers.",
      "quiet"
    ));
    fill(el.cExplanations, items);

    var disc = [];
    if (!result.disc.length) {
      disc.push(note("No discrepancy rule triggered, so D = 0 and the record is read at face value.", "good"));
    } else {
      for (var d = 0; d < result.disc.length; d += 1) {
        var rule = result.disc[d];
        disc.push(note(
          rule.name + ": t = " + fx(rule.t) + ", coverage = " + fx(rule.c) +
          ", severity " + rule.severity + " at " + K.SEV[rule.severity] +
          ", contributing s = " + fx(rule.s),
          "bad"
        ));
      }
      disc.push(note("D = 1 minus the product of (1 - s) over triggered rules = " + fx(result.D, 4) + ".", "quiet"));
    }
    fill(el.cDiscrepancies, disc);

    var witness = [];
    if (!result.witnesses.length) {
      witness.push(note("No independent witness is available for this segment, so chi is undefined and the coherence check cannot fire.", "quiet"));
    } else {
      for (var w = 0; w < result.witnesses.length; w += 1) {
        witness.push(note(
          result.witnesses[w].name + ": ratio " + fx(result.witnesses[w].value, 3),
          result.witnesses[w].value < 1 ? "bad" : "quiet"
        ));
      }
      witness.push(note(
        "chi = " + fx(result.chi, 3) + ", " +
        (result.chiFail
          ? "under 1, so a witness outside the operator contradicts the reported capacity and the segment routes to integrity review"
          : "at or above 1, so no witness contradicts the reported capacity"),
        result.chiFail ? "bad" : "good"
      ));
    }
    fill(el.cWitness, witness);
  }

  function probRow(label, value, title) {
    var wrap = document.createElement("div");
    wrap.className = "prob-row";
    wrap.title = title || "";
    var name = document.createElement("span");
    name.textContent = label;
    var track = document.createElement("div");
    track.className = "prob-track";
    var fillNode = document.createElement("div");
    fillNode.className = "prob-fill";
    fillNode.style.width = Math.max(0, Math.min(100, value * 100)) + "%";
    track.appendChild(fillNode);
    var strong = document.createElement("strong");
    strong.textContent = value.toFixed(4);
    wrap.appendChild(name);
    wrap.appendChild(track);
    wrap.appendChild(strong);
    return wrap;
  }

  function renderProbabilities(result) {
    var node = el.probabilityBars;
    node.innerHTML = "";
    node.appendChild(probRow("pi_scale", result.piSc, "Stage A. The probability the compute threshold was crossed."));
    node.appendChild(probRow("pi_identity", result.piIdentity, "Stage B. sigma(l_0 + Lambda), with l_0 = " + K.L0 + " bits from the registry."));
    node.appendChild(probRow("D", result.D, "Stage C. How much of the record cannot be read at face value."));
    node.appendChild(probRow("pi_ref", result.piRef, "What stays believable when the record cannot be read at face value: the prior odds with the scale factor recomputed from the capacity bound alone at full activity."));
    node.appendChild(probRow("pi", result.pi, "The one number. (1 - D) times pi_scale times pi_identity, plus D times pi_ref."));
  }

  function renderVerdict(result) {
    el.routeLabel.textContent = result.route;
    el.routeLabel.className = ROUTE_CLASS[result.route] || "";
    el.routeDetail.textContent = ROUTE_TEXT[result.route] || "";

    var expected = (state.row.expected && state.row.expected.final_route_set) || [];
    el.labelFamily.textContent = state.row.family;
    el.labelExpected.textContent = expected.length ? expected.join(", ") : "none recorded";
    if (state.edited) {
      el.labelAgree.textContent = "inputs edited";
      el.labelAgree.className = "";
    } else {
      var agrees = expected.indexOf(result.route) >= 0;
      el.labelAgree.textContent = agrees ? "model matches label" : "model differs from label";
      el.labelAgree.className = agrees ? "agree" : "disagree";
    }

    el.editNotice.textContent = state.edited
      ? "Inputs have been edited away from the shipped instance, so the generator's expected route no longer describes this record. Press reset edits to go back."
      : "";
  }

  function sceneInputs(result) {
    return {
      activity: Model.helpers.clamp01(result.A),
      fabric: Model.helpers.clamp01(result.aF * Math.max(0, result.F)),
      allocation: Model.helpers.clamp01(isFinite(result.mu) ? result.mu : 1),
      power: Model.helpers.clamp01(result.piSc),
      coverage: Model.helpers.clamp01(result.Lcov / SPAN),
      storage: Model.helpers.clamp01(result.aC * Math.max(0, result.Ck)),
      integrity: result.route === "integrity_review_required",
      integrityStrength: Model.helpers.clamp01(Math.max(result.D, result.chiFail ? 1 : 0))
    };
  }

  function renderHud(result) {
    el.hudActivity.textContent = pct(result.A);
    el.hudFabric.textContent = pct(Model.helpers.clamp01(result.aF * Math.max(0, result.F)));
    el.hudScale.textContent = pct(result.piSc);
    el.hudCoverage.textContent = pct(result.Lcov / SPAN);
  }

  function render() {
    var result = Model.evaluate(state.site);
    renderVerdict(result);
    renderStageA(result);
    renderStageB(result);
    renderStageC(result);
    renderProbabilities(result);
    renderHud(result);
    syncControls();
    if (scene) scene.update(sceneInputs(result));
  }

  // ---- controls ---------------------------------------------------------
  function logToValue(spec, position) {
    if (position <= spec.min) return 0;
    return Math.pow(10, position);
  }

  function valueToLog(spec, value) {
    if (!(value > 0)) return spec.min;
    return Math.max(spec.min, Math.min(spec.max, Math.log10(value)));
  }

  function displayValue(spec, value) {
    if (spec.type === "bool") return value ? "true" : "false";
    if (spec.type === "log") return sci(value, 2);
    if (spec.step === 1) return String(Math.round(value));
    return Number(value).toFixed(2);
  }

  function buildControls() {
    var root = el.controlsRoot;
    root.innerHTML = "";
    controlNodes = [];
    for (var g = 0; g < GROUPS.length; g += 1) {
      var group = GROUPS[g];
      var details = document.createElement("details");
      details.className = "control-group";
      if (group.open) details.open = true;
      var summary = document.createElement("summary");
      summary.textContent = group.title;
      details.appendChild(summary);
      var body = document.createElement("div");
      body.className = "control-group-body";
      if (group.note) {
        var p = document.createElement("p");
        p.className = "control-note";
        p.textContent = group.note;
        body.appendChild(p);
      }
      for (var c = 0; c < group.controls.length; c += 1) {
        body.appendChild(buildControl(group.controls[c]));
      }
      details.appendChild(body);
      root.appendChild(details);
    }
  }

  function buildControl(spec) {
    if (spec.slot === "coverage" && spec.type === undefined) {
      spec.type = "range";
      spec.min = 0;
      spec.max = 1;
      spec.step = 0.01;
    }
    var wrap = document.createElement("div");
    wrap.className = "control-row";
    var label = document.createElement("span");
    label.textContent = spec.label;
    wrap.appendChild(label);

    var input;
    if (spec.type === "bool") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.addEventListener("change", function () {
        writeControl(spec, state.site, input.checked);
        state.edited = true;
        render();
      });
    } else {
      input = document.createElement("input");
      input.type = "range";
      input.min = spec.min;
      input.max = spec.max;
      input.step = spec.step;
      input.addEventListener("input", function () {
        var position = Number(input.value);
        var value = spec.type === "log" ? logToValue(spec, position) : position;
        writeControl(spec, state.site, value);
        state.edited = true;
        render();
      });
    }
    wrap.appendChild(input);

    var readout = document.createElement("span");
    readout.className = "control-value";
    wrap.appendChild(readout);

    controlNodes.push({ spec: spec, wrap: wrap, input: input, readout: readout });
    return wrap;
  }

  function syncControls() {
    for (var i = 0; i < controlNodes.length; i += 1) {
      var node = controlNodes[i];
      var read = readControl(node.spec, state.site);
      if (node.spec.type === "bool") {
        node.input.checked = !!read.value;
      } else if (document.activeElement !== node.input) {
        node.input.value = node.spec.type === "log"
          ? valueToLog(node.spec, read.value)
          : Math.max(node.spec.min, Math.min(node.spec.max, read.value));
      }
      node.readout.textContent = displayValue(node.spec, read.value);
      node.wrap.className = "control-row" + (read.present ? "" : " absent");
    }
  }

  // ---- selection --------------------------------------------------------
  function populateFamilies() {
    el.familySelect.innerHTML = "";
    for (var i = 0; i < state.families.length; i += 1) {
      var option = document.createElement("option");
      option.value = state.families[i];
      option.textContent = state.families[i] + " (" + state.rowsByFamily[state.families[i]].length + ")";
      el.familySelect.appendChild(option);
    }
  }

  function populateRows() {
    var rows = state.rowsByFamily[state.family];
    el.rowSelect.innerHTML = "";
    for (var i = 0; i < rows.length; i += 1) {
      var option = document.createElement("option");
      option.value = rows[i].id;
      var expected = (rows[i].expected && rows[i].expected.final_route_set) || [];
      var agrees = expected.indexOf(rows[i].reference.route) >= 0;
      option.textContent = (i + 1) + ". " + rows[i].reference.route + (agrees ? "" : "  [differs from label]");
      el.rowSelect.appendChild(option);
    }
  }

  function selectRow(rowId) {
    var rows = state.rowsByFamily[state.family];
    var chosen = rows[0];
    for (var i = 0; i < rows.length; i += 1) {
      if (rows[i].id === rowId) chosen = rows[i];
    }
    state.row = chosen;
    state.rowId = chosen.id;
    state.site = siteFromRow(chosen);
    state.edited = false;
    el.rowSelect.value = chosen.id;
    var agreeCount = 0;
    for (var j = 0; j < rows.length; j += 1) {
      var expected = (rows[j].expected && rows[j].expected.final_route_set) || [];
      if (expected.indexOf(rows[j].reference.route) >= 0) agreeCount += 1;
    }
    el.filterStatus.textContent =
      "Instance " + chosen.id + ". In this family the model's route is inside the generator's expected set for " +
      agreeCount + " of " + rows.length + " shipped instances.";
    render();
  }

  function selectFamily(family, rowId) {
    state.family = family;
    el.familySelect.value = family;
    populateRows();
    selectRow(rowId || state.rowsByFamily[family][0].id);
  }

  function jumpToRoute(route) {
    for (var f = 0; f < state.families.length; f += 1) {
      var rows = state.rowsByFamily[state.families[f]];
      for (var i = 0; i < rows.length; i += 1) {
        if (rows[i].reference.route === route) {
          selectFamily(state.families[f], rows[i].id);
          return;
        }
      }
    }
  }

  // ---- boot -------------------------------------------------------------
  function boot() {
    el = {
      parityBadge: $("parity-badge"),
      datasetStatus: $("dataset-status"),
      familySelect: $("family-select"),
      rowSelect: $("row-select"),
      filterStatus: $("filter-status"),
      resetRow: $("reset-row"),
      routeLabel: $("route-label"),
      routeDetail: $("route-detail"),
      labelFamily: $("label-family"),
      labelExpected: $("label-expected"),
      labelAgree: $("label-agree"),
      editNotice: $("edit-notice"),
      stageAFlag: $("stage-a-flag"),
      aBound: $("a-bound"),
      aCstar: $("a-cstar"),
      aMu: $("a-mu"),
      aPiScale: $("a-piscale"),
      aRuleout: $("a-ruleout"),
      aNotes: $("a-notes"),
      stageBTotal: $("stage-b-total"),
      bitsBands: $("bits-bands"),
      ceilingBands: $("ceiling-bands"),
      bitsStack: $("bits-stack"),
      bitsMarker: $("bits-marker"),
      bitsValue: $("bits-value"),
      bitsAxis: $("bits-axis"),
      ceilingFill: $("ceiling-fill"),
      ceilingValue: $("ceiling-value"),
      pathwayBody: $("pathway-body"),
      bNotes: $("b-notes"),
      stageCFlag: $("stage-c-flag"),
      dFill: $("d-fill"),
      cD: $("c-d"),
      cExplanations: $("c-explanations"),
      cDiscrepancies: $("c-discrepancies"),
      cWitness: $("c-witness"),
      probabilityBars: $("probability-bars"),
      controlsRoot: $("controls-root"),
      hudActivity: $("hud-activity"),
      hudFabric: $("hud-fabric"),
      hudScale: $("hud-scale"),
      hudCoverage: $("hud-coverage")
    };

    if (!DATA || !DATA.rows || !DATA.rows.length) {
      el.datasetStatus.textContent = "Dataset failed to load";
      el.parityBadge.textContent = "parity: no data";
      el.parityBadge.className = "parity-badge fail";
      return;
    }

    for (var i = 0; i < DATA.rows.length; i += 1) {
      var r = DATA.rows[i];
      if (!state.rowsByFamily[r.family]) {
        state.rowsByFamily[r.family] = [];
        state.families.push(r.family);
      }
      state.rowsByFamily[r.family].push(r);
    }

    el.datasetStatus.textContent =
      DATA.rows.length + " instances, " + state.families.length + " families";

    renderBands(el.bitsBands, false);
    renderBands(el.ceilingBands, false);
    renderAxis(el.bitsAxis);
    buildControls();
    populateFamilies();

    el.familySelect.addEventListener("change", function () {
      selectFamily(el.familySelect.value);
    });
    el.rowSelect.addEventListener("change", function () {
      selectRow(el.rowSelect.value);
    });
    el.resetRow.addEventListener("click", function () {
      selectRow(state.rowId);
    });
    var buttons = document.querySelectorAll("[data-route]");
    for (var b = 0; b < buttons.length; b += 1) {
      (function (button) {
        button.addEventListener("click", function () {
          jumpToRoute(button.getAttribute("data-route"));
        });
      })(buttons[b]);
    }

    selectFamily(state.families[0]);

    if (window.DatacenterScene && window.THREE) {
      try {
        scene = new window.DatacenterScene($("scene-root"));
        render();
      } catch (error) {
        if (window.console) window.console.warn("3D scene unavailable", error);
      }
    }

    runParity();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
