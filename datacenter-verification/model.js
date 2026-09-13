/*
 * Staged evidence model, draft14 section "rules".
 * Direct port of xx_claude/newmodel.py from the research repo.
 *
 * Every constant below appears either in newmodel.py or in Appendix F of
 * draft14.md. The provenance tier from Appendix F is noted on each line.
 * Nothing here is tuned, fitted, or invented for the demo.
 */
(function () {
  "use strict";

  // ---- policy and prior -------------------------------------------------
  var T = 1.0e25;      // T_sys, EU AI Act Article 51 (tier 1, source_backed)
  var L0 = -2.0;       // l_0 prior in bits, set per cluster by the registry
  var MARGIN = 0.10;   // capacity uncertainty margin (tier 1, mechanism_inferred)
  var ETA = 0.40;      // sustained-efficiency fraction (tier 2, source_informed)
  var WSC = 5.11;      // w_sc, logistic matched to the equivalent probit

  // ---- pathway weights and warning bands, in bits -----------------------
  var wF = 2.5, wC = 2.2, wN = 0.85;   // tier 2, fixed by the six axiom lines in B
  var BW = 1.0, BM = 2.0, BH = 3.0;    // tier 2, same feasible set

  // ---- severity ladder for stage C (tier 3, calibration_default) --------
  var SEV = { info: 0.05, low: 0.15, medium: 0.35, high: 0.60, critical: 0.85 };

  // ---- gate levels, all as they appear in newmodel.py -------------------
  var GATE_ACTIVITY_F = 0.55;        // activity gate feeding alpha_F
  var GATE_ACTIVITY_C = 0.50;        // activity gate feeding alpha_C
  var GATE_OVERLAP = 0.50;           // more overlapping than not
  var GATE_DURATION_F = 1800;        // seconds, excludes short transients
  var GATE_BURSTS = 2;               // one write is an export, two is a cadence
  var GATE_SERVING_COV = 0.80;       // K_serving enters alpha_N twice
  var GATE_SERVING_SCORE = 0.70;     // serving benign explanation
  var GATE_STORAGE_OVERLAP = 0.80;   // storage-operation benign explanation
  var GATE_BYTES = 0.70;             // bytes explained
  var GATE_BENCH_REG = 0.90;         // benchmark regularity
  var BENCH_CAP_SECONDS = 7200;      // benchmark duration cap
  var GATE_HPC = 0.60;               // HPC/MPI cadence
  var GATE_HPC_ACTIVITY = 0.50;
  var GATE_HPC_OVERLAP = 0.50;
  var COV_STRONG = 0.75;             // K_ops and K_suppressor sufficiency
  var COV_ATTRIBUTION = 0.80;
  var ATTRIBUTION_ACTIVITY = 0.70;
  var ATTRIBUTION_DURATION = 600;    // seconds
  var ATTRIBUTION_OVERLAP = 0.05;
  var BENIGN_ATTRIBUTION = 0.80;
  var UNIT_EXPLANATION = 0.70;
  var D_REVIEW = 0.5;                // D >= 0.5 routes to integrity review
  var B_DEMOTE = 0.5;                // an explanation over half the pathway demotes it
  var PI_SCALE_TIP = 0.5;            // pi_scale at or above even odds keeps a weak candidate
  var LOG_CLAMP = 3.0;               // decades clamped either side
  var TINY = 1e-30;                  // guard inside the pi_ref logarithm

  var LAMBDA_SPAN = wF + wC + wN;    // most the three pathways can ever be worth

  // ---- helpers ----------------------------------------------------------
  function num(value, fallback) {
    if (fallback === undefined) fallback = 0.0;
    if (value === null || value === undefined) return fallback;
    if (typeof value === "boolean") return value ? 1.0 : 0.0;
    if (typeof value === "string" && value.trim() === "") return fallback;
    var f = Number(value);
    if (f !== f) return fallback;
    return f;
  }

  function clamp01(x) {
    return Math.max(0.0, Math.min(1.0, x));
  }

  function psi(z) {
    return 2 * z - 1;
  }

  function g(z, t) {
    if (!(t > 0)) return 0.0;
    return Math.min(1.0, Math.max(0.0, z / t));
  }

  function sig(x) {
    var p = Math.pow(2, x);
    return p / (1 + p);
  }

  function flag(signals, key, fallback) {
    if (!(key in signals)) return fallback;
    var value = signals[key];
    if (value === null || value === undefined) return false;
    return !!value;
  }

  function secs(window) {
    if (!window || !window.start || !window.end) return 0.0;
    var a = Date.parse(window.start);
    var b = Date.parse(window.end);
    if (a !== a || b !== b) return 0.0;
    return (b - a) / 1000;
  }

  function sumCounts(records) {
    var total = 0.0;
    if (!records) return total;
    for (var i = 0; i < records.length; i += 1) total += num(records[i].count);
    return total;
  }

  function maxRate(records) {
    var best = 0.0;
    if (!records || !records.length) return best;
    for (var i = 0; i < records.length; i += 1) {
      var v = num(records[i].peak_rate);
      if (i === 0 || v > best) best = v;
    }
    return best;
  }

  // ---- the model --------------------------------------------------------
  function evaluate(site) {
    var s = site.normalized_signals || {};
    var cv = site.coverage || {};
    var raw = site.raw_features || {};
    var C = function (key) {
      return clamp01(num(cv[key], 0.0));   // a coverage key that is absent is 0
    };

    var dur = secs(site.audit_window || {});
    var cnt = sumCounts(raw.accelerator_count_by_family_sku);
    var rate = maxRate(raw.advertised_peak_rate_by_precision);
    var adj = num(s.capacity_adjustment_factor, 1.0);

    // ---- stage A, capacity
    var B = cnt * rate * dur * adj;
    var hidden = flag(s, "hidden_or_unmonitored_capacity_possible", false);
    var units = flag(s, "capacity_unit_normalized", true);
    var sigmaScope = hidden ? 0.0 : 1.0;
    var cstar = C("capacity") * sigmaScope * C("clock_alignment");
    var admissible = units && rate > 0 && cnt > 0 && dur > 0 && adj >= 0 && sigmaScope > 0;
    var mu = cstar > 0 ? B / (cstar * T) : Infinity;
    var ruleOutLevel = 1 / (1 + MARGIN);
    var ruled = admissible && mu < ruleOutLevel;

    var O = num(s.achieved_operations, 0.0);
    var oNorm = flag(s, "achieved_operations_unit_normalized", true);
    var A = clamp01(num(s.activity_score));
    var piSc;
    var scaleCertificate;
    if (ruled) {
      piSc = 0.0;
      scaleCertificate = "ruled_out";
    } else if (O >= T && oNorm && C("achieved_ops") >= COV_STRONG) {
      piSc = 1.0;
      scaleCertificate = "achieved_operations_certificate";
    } else {
      var Ch = Math.max(ETA * A * B, O);
      var r = Ch <= 0 ? -LOG_CLAMP : Math.max(-LOG_CLAMP, Math.min(LOG_CLAMP, Math.log10(Ch / T)));
      piSc = sig(WSC * r);
      scaleCertificate = "estimated";
    }

    // ---- witness coherence chi
    var wit = [];
    var witDetail = [];
    if (O > 0 && oNorm && B > 0) {
      wit.push(B * (1 + MARGIN) / O);
      witDetail.push({ name: "capacity bound against achieved operations", value: wit[wit.length - 1] });
    }
    var pc = num(s.participant_count);
    if (pc > 0 && cnt > 0) {
      wit.push(cnt * (1 + MARGIN) / pc);
      witDetail.push({ name: "inventory against fabric participant count", value: wit[wit.length - 1] });
    }
    var allocated = raw.allocated_accelerator_count_by_sku || [];
    for (var ai = 0; ai < allocated.length; ai += 1) {
      var v = num(allocated[ai].count);
      if (v > 0 && cnt > 0) {
        wit.push(cnt * (1 + MARGIN) / v);
        witDetail.push({ name: "inventory against allocated accelerator count", value: wit[wit.length - 1] });
      }
    }
    var chi = null;
    for (var wi = 0; wi < wit.length; wi += 1) {
      if (chi === null || wit[wi] < chi) chi = wit[wi];
    }
    var chiFail = chi !== null && chi < 1.0;

    // ---- stage C, benign explanations feeding b
    var serv = num(s.serving_counterevidence_score);
    var servov = num(s.serving_activity_overlap_fraction);
    var eServ = g(serv, GATE_SERVING_SCORE) * g(servov, GATE_OVERLAP) * C("serving");

    var stov = num(s.storage_operation_overlap_fraction);
    var stby = num(s.bytes_explained_fraction);
    var eSt = g(stov, GATE_STORAGE_OVERLAP) * g(stby, GATE_BYTES) * C("storage_operations");

    var breg = num(s.benchmark_regularity_score);
    var bdur = num(s.benchmark_duration_seconds, dur);
    var eBm = g(breg, GATE_BENCH_REG) * (bdur > 0 && bdur <= BENCH_CAP_SECONDS ? 1.0 : 0.0) * C("benchmark_hpc");

    var hpc = num(s.hpc_mpi_score);
    var hov = num(s.hpc_overlap_fraction);
    var eHpc = g(hpc, GATE_HPC) * g(A, GATE_HPC_ACTIVITY) * g(hov, GATE_HPC_OVERLAP) * C("benchmark_hpc");

    var bF = Math.min(1.0, Math.max(eServ, eBm, eHpc));
    var bC = Math.min(1.0, eSt);

    // ---- stage B, evidence in bits
    var F = num(s.collective_cadence_score);
    var rAF = num(s.activity_fabric_overlap_fraction);
    var adur = num(s.activity_duration_seconds, dur);
    var Ck = num(s.checkpoint_periodicity_score);
    var rAC = num(s.checkpoint_activity_adjacency_fraction);
    var nb = num(s.checkpoint_burst_count);
    var N = num(s.non_serving_score);

    var aF = C("fabric") * g(A, GATE_ACTIVITY_F) * g(rAF, GATE_OVERLAP) * g(adur, GATE_DURATION_F);
    var aC = C("storage") * g(A, GATE_ACTIVITY_C) * g(rAC, GATE_OVERLAP) * g(nb, GATE_BURSTS);
    var aN = C("serving") * g(C("serving"), GATE_SERVING_COV) * g(A, GATE_ACTIVITY_F);

    var LF = aF * (1 - bF) * wF * psi(F);
    var LC = aC * (1 - bC) * wC * psi(Ck);
    var LN = aN * wN * psi(N);
    var Lam = LF + LC + LN;
    var Lcov = C("fabric") * wF + C("storage") * wC + C("serving") * wN;

    // ---- stage C, discrepancies feeding D
    var Dprod = 1.0;
    var ratio = B > 0 ? O / B : 0.0;
    var disc = [];
    if (
      oNorm &&
      ratio > 1 + MARGIN &&
      C("capacity") >= COV_STRONG &&
      num(s.unit_mismatch_or_hidden_capacity_explanation_score) < UNIT_EXPLANATION
    ) {
      disc.push({
        name: "achieved_operations_above_capacity_bound",
        t: Math.min(1.0, (ratio - (1 + MARGIN)) / (1 + MARGIN)),
        c: C("capacity"),
        severity: "critical"
      });
    }
    if (
      A >= ATTRIBUTION_ACTIVITY &&
      adur >= ATTRIBUTION_DURATION &&
      num(s.attribution_overlap_fraction, 1.0) <= ATTRIBUTION_OVERLAP &&
      C("attribution") >= COV_ATTRIBUTION &&
      num(s.benign_attribution_explanation_overlap_fraction) < BENIGN_ATTRIBUTION
    ) {
      disc.push({
        name: "activity_without_attribution",
        t: 1.0,
        c: C("attribution"),
        severity: "high"
      });
    }
    var conflicts = [
      "physical_timeline_conflict",
      "health_throttle_conflict",
      "topology_route_conflict",
      "power_activity_conflict"
    ];
    for (var ci = 0; ci < conflicts.length; ci += 1) {
      if (flag(s, conflicts[ci], false)) {
        disc.push({ name: conflicts[ci], t: 1.0, c: 1.0, severity: "high" });
      }
    }
    for (var di = 0; di < disc.length; di += 1) {
      var d = disc[di];
      d.s = d.t * d.c * SEV[d.severity];
      Dprod *= 1 - d.t * d.c * SEV[d.severity];
    }
    var D = 1 - Dprod;

    // ---- the one number
    var piRefScale = ruled
      ? 0.0
      : sig(WSC * Math.max(-LOG_CLAMP, Math.min(LOG_CLAMP, Math.log10(Math.max(ETA * B, TINY) / T))));
    var piRef = piRefScale * sig(L0);
    var piIdentity = sig(L0 + Lam);
    var pi = (1 - D) * piSc * piIdentity + D * piRef;

    // ---- routing
    var Ksup = Math.min(C("serving"), C("storage_operations"), C("benchmark_hpc"));
    var route;
    if (flag(s, "decision_blocking_missingness", false) || !admissible) {
      route = "inconclusive_due_to_missingness";
    } else if (chiFail || D >= D_REVIEW) {
      route = "integrity_review_required";
    } else if (ruled) {
      route = "capacity_ruled_out_for_scope";
    } else if (Lcov < BW) {
      route = "inconclusive_due_to_missingness";
    } else if (Ksup < COV_STRONG && Lam >= BW) {
      route = "weak_training_like_candidate";
    } else if (Lam >= BH) {
      route = "high_training_like_warning";
    } else if (Lam >= BM) {
      route = "medium_training_like_warning";
    } else if (Lam >= BW) {
      route = "weak_training_like_candidate";
    } else if (Math.max(bF, bC) > B_DEMOTE) {
      route = "candidate_explained_or_demoted";
    } else if (piSc >= PI_SCALE_TIP) {
      route = "weak_training_like_candidate";
    } else {
      route = "no_training_like_candidate_detected_in_covered_live_segment";
    }

    return {
      route: route,
      // stage A
      cnt: cnt, rate: rate, dur: dur, adj: adj, B: B,
      sigmaScope: sigmaScope, cstar: cstar, mu: mu,
      ruleOutLevel: ruleOutLevel, ruled: ruled, admissible: admissible,
      units: units, hidden: hidden,
      O: O, oNorm: oNorm, A: A,
      piSc: piSc, scaleCertificate: scaleCertificate,
      // stage B
      F: F, Ck: Ck, N: N,
      aF: aF, aC: aC, aN: aN,
      psiF: psi(F), psiC: psi(Ck), psiN: psi(N),
      bF: bF, bC: bC,
      LF: LF, LC: LC, LN: LN, Lam: Lam, Lcov: Lcov,
      Ksup: Ksup,
      // stage C
      eServ: eServ, eSt: eSt, eBm: eBm, eHpc: eHpc,
      chi: chi, chiFail: chiFail, witnesses: witDetail,
      disc: disc, D: D,
      // the one number
      piIdentity: piIdentity, piRef: piRef, pi: pi
    };
  }

  window.DCVModel = {
    evaluate: evaluate,
    constants: {
      T: T, L0: L0, MARGIN: MARGIN, ETA: ETA, WSC: WSC,
      wF: wF, wC: wC, wN: wN,
      BW: BW, BM: BM, BH: BH,
      SEV: SEV,
      LAMBDA_SPAN: LAMBDA_SPAN,
      COV_STRONG: COV_STRONG,
      D_REVIEW: D_REVIEW,
      GATE_DURATION_F: GATE_DURATION_F,
      BENCH_CAP_SECONDS: BENCH_CAP_SECONDS,
      ATTRIBUTION_DURATION: ATTRIBUTION_DURATION
    },
    helpers: { num: num, clamp01: clamp01, psi: psi, g: g, sig: sig, secs: secs }
  };
})();
