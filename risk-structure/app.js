(function () {
  "use strict";

  var STORAGE_KEY = "riskStructureResponses";
  var CURRENT_YEAR = 2026;
  var MAX_YEAR = 2100;

  var riskDefinitions = [
    { key: "newPandemic", label: "New pandemic" },
    { key: "lossControlAI", label: "Loss of control to AI" },
    { key: "aiMisuse", label: "AI Misuse" },
    { key: "climateChange", label: "Climate change" },
    { key: "nuclearWar", label: "Nuclear war" },
    { key: "otherHighestRisk", label: "Other highest risk" }
  ];

  var bestBetLabels = {
    "aligning AI": "aligning AI",
    "pausing AI development/training": "pausing AI development/training",
    "slowing down AI development/training": "slowing down AI development/training",
    "technical AI safety to control AI": "technical AI safety to control AI",
    "technical AI safety to understand and predict AI": "technical AI safety to understand and predict AI",
    "other technical AI safety ways": "other technical AI safety ways",
    "winning the race and having AI solve AI alignment": "winning the race and having AI solve AI alignment",
    other: "other"
  };

  var form = document.getElementById("risk-form");
  var results = document.getElementById("results");
  var errorBox = document.getElementById("form-error");
  var submitButton = document.getElementById("submit-button");
  var anotherButton = document.getElementById("another-response");
  var endpoint = ((window.RISK_STRUCTURE_CONFIG || {}).endpoint || "").trim();

  initialize();

  function initialize() {
    populateYearSelects();
    bindSliders();
    bindBestBetOther();
    form.addEventListener("submit", handleSubmit);
    anotherButton.addEventListener("click", showFormAgain);
    window.addEventListener("resize", debounce(redrawTimeline, 150));
  }

  function populateYearSelects() {
    ["p10-year", "p50-year", "custom-year"].forEach(function (id) {
      var select = document.getElementById(id);
      select.innerHTML = '<option value="" selected disabled>Select year</option>';
      for (var year = CURRENT_YEAR; year <= MAX_YEAR; year += 1) {
        var option = document.createElement("option");
        option.value = String(year);
        option.textContent = String(year);
        select.appendChild(option);
      }
    });
  }

  function bindSliders() {
    Array.prototype.forEach.call(document.querySelectorAll('input[type="range"][data-output]'), function (slider) {
      var output = document.getElementById(slider.dataset.output);
      var sync = function () {
        output.textContent = slider.value;
      };
      slider.addEventListener("input", sync);
      sync();
    });
  }

  function bindBestBetOther() {
    var otherInput = document.getElementById("best-bet-other");
    var otherRadio = document.querySelector('input[name="bestBet"][value="other"]');
    var syncRequired = function () {
      otherInput.required = otherRadio.checked;
    };

    Array.prototype.forEach.call(document.querySelectorAll('input[name="bestBet"]'), function (radio) {
      radio.addEventListener("change", syncRequired);
    });

    otherInput.addEventListener("focus", function () {
      otherRadio.checked = true;
      syncRequired();
    });
    syncRequired();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    errorBox.textContent = "";
    clearOptionalCustomProbabilityValidity();

    if (!form.reportValidity()) {
      errorBox.textContent = "Please fill in every required field.";
      return;
    }

    if (!validateOptionalCustomProbability()) {
      return;
    }

    var record = collectRecord();
    submitButton.disabled = true;
    submitButton.textContent = "Submitting...";

    try {
      var remoteStats = null;
      var statusText = "";

      if (endpoint) {
        var response = await fetch(endpoint, {
          method: "POST",
          body: JSON.stringify({ action: "submit", submission: record })
        });
        var data = await response.json();
        if (!data.success) {
          throw new Error(data.error || "Submission was not accepted.");
        }
        remoteStats = data.stats || null;
        statusText = "Response saved. Statistics exclude the background questions.";
      } else {
        saveLocalRecord(record);
        statusText = "Saved in this browser for testing. Add the storage endpoint for shared results.";
      }

      var stats = remoteStats || computeStats(endpoint ? loadLocalRecords().concat([record]) : loadLocalRecords());
      showResults(stats, statusText);
      form.reset();
      document.getElementById("best-bet-other").required = false;
      bindSliders();
    } catch (error) {
      saveLocalRecord(record);
      showResults(
        computeStats(loadLocalRecords()),
        "Saved in this browser. Shared storage could not be reached."
      );
      console.error(error);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Submit";
    }
  }

  function clearOptionalCustomProbabilityValidity() {
    document.getElementById("custom-probability").setCustomValidity("");
    document.getElementById("custom-year").setCustomValidity("");
  }

  function validateOptionalCustomProbability() {
    var probabilityInput = document.getElementById("custom-probability");
    var yearSelect = document.getElementById("custom-year");
    var hasProbability = probabilityInput.value.trim() !== "";
    var hasYear = yearSelect.value !== "";
    var message = "Fill in both the optional probability and year, or leave both blank.";

    probabilityInput.setCustomValidity("");
    yearSelect.setCustomValidity("");

    if (hasProbability === hasYear) {
      return true;
    }

    if (!hasProbability) {
      probabilityInput.setCustomValidity(message);
    } else {
      yearSelect.setCustomValidity(message);
    }
    errorBox.textContent = message;
    form.reportValidity();
    return false;
  }

  function collectRecord() {
    var formData = new FormData(form);
    var bestBet = String(formData.get("bestBet") || "");
    var aiTimeline = {
      p10Year: toNumber(formData.get("p10Year")),
      p50Year: toNumber(formData.get("p50Year"))
    };
    var customProbability = toNumber(formData.get("customProbability"));
    var customYear = toNumber(formData.get("customYear"));

    if (customProbability !== null || customYear !== null) {
      aiTimeline.customProbability = customProbability;
      aiTimeline.customYear = customYear;
    }

    var record = {
      id: createId(),
      submittedAt: new Date().toISOString(),
      formVersion: "2026-05-21",
      start: {
        year: String(formData.get("startYear") || ""),
        month: String(formData.get("startMonth") || "")
      },
      role: String(formData.get("role") || ""),
      organization: String(formData.get("organization") || "").trim(),
      perceivedRisks: {
        newPandemic: toNumber(formData.get("newPandemic")),
        lossControlAI: toNumber(formData.get("lossControlAI")),
        aiMisuse: toNumber(formData.get("aiMisuse")),
        climateChange: toNumber(formData.get("climateChange")),
        nuclearWar: toNumber(formData.get("nuclearWar")),
        otherHighestRisk: {
          label: String(formData.get("otherRiskLabel") || "").trim(),
          score: toNumber(formData.get("otherHighestRisk"))
        }
      },
      aiTimeline: aiTimeline,
      importanceLowerRisk: toNumber(formData.get("importanceLowerRisk")),
      bestBet: {
        option: bestBet,
        otherText: bestBet === "other" ? String(formData.get("bestBetOther") || "").trim() : ""
      },
      optimismAvoidRisks: toNumber(formData.get("optimismAvoidRisks"))
    };

    return record;
  }

  function showFormAgain() {
    results.hidden = true;
    form.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showResults(stats, statusText) {
    form.hidden = true;
    results.hidden = false;
    document.getElementById("result-status").textContent = statusText;
    renderStats(stats);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderStats(stats) {
    window.__riskStructureLastStats = stats;
    document.getElementById("response-count").textContent = String(stats.count || 0);
    renderTimelineSummary(stats);
    renderRiskBars(stats);
    renderBestBetBars(stats);
    renderOutlookStats(stats);
    redrawTimeline();
  }

  function renderTimelineSummary(stats) {
    var container = document.getElementById("timeline-summary");
    var items = [
      { label: "Median 10% year", value: formatYear(stats.timeline.medianP10Year) },
      { label: "Median 50% year", value: formatYear(stats.timeline.medianP50Year) },
      { label: "Median custom point", value: formatCustomMedian(stats.timeline) }
    ];

    container.innerHTML = "";
    items.forEach(function (item) {
      var node = document.createElement("div");
      node.className = "summary-item";
      node.innerHTML = "<span></span><strong></strong>";
      node.querySelector("span").textContent = item.label;
      node.querySelector("strong").textContent = item.value;
      container.appendChild(node);
    });
  }

  function renderRiskBars(stats) {
    var container = document.getElementById("risk-bars");
    container.innerHTML = "";
    riskDefinitions.forEach(function (definition) {
      var value = Math.round((stats.riskAverages[definition.key] || 0) * 10) / 10;
      container.appendChild(createBarRow(definition.label, value, 100));
    });
  }

  function renderBestBetBars(stats) {
    var container = document.getElementById("best-bet-bars");
    container.innerHTML = "";
    var entries = Object.keys(bestBetLabels).map(function (key) {
      return { label: bestBetLabels[key], count: stats.bestBetCounts[key] || 0 };
    }).filter(function (entry) {
      return entry.count > 0;
    }).sort(function (a, b) {
      return b.count - a.count;
    });

    if (!entries.length) {
      container.innerHTML = '<p class="empty-results">No responses yet.</p>';
      return;
    }

    entries.forEach(function (entry) {
      container.appendChild(createBarRow(entry.label, entry.count, Math.max(1, stats.count), true));
    });
  }

  function renderOutlookStats(stats) {
    var container = document.getElementById("outlook-stats");
    container.innerHTML = "";
    container.appendChild(createBarRow("Importance of contributing", roundOne(stats.averageImportance), 100));
    container.appendChild(createBarRow("Optimism", roundOne(stats.averageOptimism), 100));
  }

  function createBarRow(label, value, max, countMode) {
    var row = document.createElement("div");
    row.className = "bar-row";

    var labelNode = document.createElement("div");
    labelNode.className = "bar-label";
    labelNode.textContent = label;

    var track = document.createElement("div");
    track.className = "bar-track";
    var fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = String(Math.max(0, Math.min(100, (value / max) * 100))) + "%";
    track.appendChild(fill);

    var valueNode = document.createElement("div");
    valueNode.className = "bar-value";
    valueNode.textContent = countMode ? String(value) : String(value);

    row.appendChild(labelNode);
    row.appendChild(track);
    row.appendChild(valueNode);
    return row;
  }

  function redrawTimeline() {
    var stats = window.__riskStructureLastStats;
    if (!stats) return;
    drawTimeline(stats.timeline);
  }

  function drawTimeline(timeline) {
    var canvas = document.getElementById("timeline-chart");
    var ratio = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var width = Math.max(320, Math.round(rect.width));
    var height = Math.max(260, Math.round(rect.height || 300));
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    var ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    var padding = { top: 28, right: 28, bottom: 46, left: 54 };
    var chartWidth = width - padding.left - padding.right;
    var chartHeight = height - padding.top - padding.bottom;
    var minYear = timeline.minYear || CURRENT_YEAR;
    var maxYear = timeline.maxYear || CURRENT_YEAR + 20;
    if (maxYear <= minYear) maxYear = minYear + 1;

    var xFor = function (year) {
      return padding.left + ((year - minYear) / (maxYear - minYear)) * chartWidth;
    };
    var yFor = function (probability) {
      return padding.top + (1 - probability / 100) * chartHeight;
    };

    ctx.strokeStyle = "#dadce0";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#5f6368";
    ctx.font = "12px Arial, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    [0, 25, 50, 75, 100].forEach(function (tick) {
      var y = yFor(tick);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
      ctx.fillText(String(tick) + "%", padding.left - 8, y);
    });

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    getYearTicks(minYear, maxYear).forEach(function (year) {
      var x = xFor(year);
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, height - padding.bottom);
      ctx.stroke();
      ctx.fillText(String(year), x, height - padding.bottom + 12);
    });

    ctx.strokeStyle = "#3c4043";
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, height - padding.bottom);
    ctx.lineTo(width - padding.right, height - padding.bottom);
    ctx.stroke();

    if (!timeline.series.length) {
      ctx.fillStyle = "#5f6368";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("No timeline data yet.", width / 2, height / 2);
      return;
    }

    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(95, 99, 104, 0.26)";
    timeline.series.forEach(function (series) {
      drawLine(ctx, series.points, xFor, yFor);
    });

    if (timeline.averageSeries.length) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#673ab7";
      drawLine(ctx, timeline.averageSeries, xFor, yFor);
    }
  }

  function drawLine(ctx, points, xFor, yFor) {
    if (!points.length) return;
    ctx.beginPath();
    points.forEach(function (point, index) {
      var x = xFor(point.year);
      var y = yFor(point.probability);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function computeStats(records) {
    var cleanRecords = records.filter(isUsableRecord);
    var stats = {
      count: cleanRecords.length,
      riskAverages: {},
      timeline: computeTimeline(cleanRecords),
      bestBetCounts: {},
      averageImportance: average(cleanRecords.map(function (record) { return record.importanceLowerRisk; })),
      averageOptimism: average(cleanRecords.map(function (record) { return record.optimismAvoidRisks; }))
    };

    riskDefinitions.forEach(function (definition) {
      stats.riskAverages[definition.key] = average(cleanRecords.map(function (record) {
        if (definition.key === "otherHighestRisk") {
          return record.perceivedRisks.otherHighestRisk.score;
        }
        return record.perceivedRisks[definition.key];
      }));
    });

    Object.keys(bestBetLabels).forEach(function (key) {
      stats.bestBetCounts[key] = 0;
    });
    cleanRecords.forEach(function (record) {
      var key = record.bestBet.option || "other";
      if (!Object.prototype.hasOwnProperty.call(stats.bestBetCounts, key)) {
        stats.bestBetCounts[key] = 0;
      }
      stats.bestBetCounts[key] += 1;
    });

    return stats;
  }

  function computeTimeline(records) {
    var series = records.map(recordToTimelineSeries).filter(function (entry) {
      return entry.points.length >= 2;
    });

    var allYears = [];
    records.forEach(function (record) {
      var timeline = record.aiTimeline || {};
      [timeline.p10Year, timeline.p50Year, timeline.customYear].forEach(function (year) {
        if (isFiniteNumber(year)) allYears.push(year);
      });
    });

    var minYear = allYears.length ? Math.min.apply(null, allYears.concat([CURRENT_YEAR])) : CURRENT_YEAR;
    var maxYear = allYears.length ? Math.max.apply(null, allYears) : CURRENT_YEAR + 20;
    var sampleYears = uniqueSorted(allYears.concat([minYear, maxYear]));
    var averageSeries = [];

    sampleYears.forEach(function (year) {
      var values = series.map(function (entry) {
        return interpolate(entry.points, year);
      }).filter(isFiniteNumber);
      if (values.length) {
        averageSeries.push({ year: year, probability: average(values) });
      }
    });

    return {
      minYear: minYear,
      maxYear: maxYear,
      medianP10Year: median(records.map(function (record) { return record.aiTimeline.p10Year; })),
      medianP50Year: median(records.map(function (record) { return record.aiTimeline.p50Year; })),
      medianCustomProbability: median(records.map(function (record) { return record.aiTimeline.customProbability; })),
      medianCustomYear: median(records.map(function (record) { return record.aiTimeline.customYear; })),
      series: series,
      averageSeries: averageSeries
    };
  }

  function recordToTimelineSeries(record) {
    var timeline = record.aiTimeline || {};
    var points = [
      { year: timeline.p10Year, probability: 10 },
      { year: timeline.p50Year, probability: 50 },
      { year: timeline.customYear, probability: timeline.customProbability }
    ].filter(function (point) {
      return isFiniteNumber(point.year) && isFiniteNumber(point.probability);
    }).sort(function (a, b) {
      if (a.year === b.year) return a.probability - b.probability;
      return a.year - b.year;
    });

    return { id: record.id, points: points };
  }

  function interpolate(points, year) {
    if (!points.length || year < points[0].year || year > points[points.length - 1].year) {
      return null;
    }
    for (var index = 0; index < points.length - 1; index += 1) {
      var left = points[index];
      var right = points[index + 1];
      if (year === left.year) return left.probability;
      if (year === right.year) return right.probability;
      if (year > left.year && year < right.year) {
        if (right.year === left.year) return (left.probability + right.probability) / 2;
        var t = (year - left.year) / (right.year - left.year);
        return left.probability + t * (right.probability - left.probability);
      }
    }
    return points.length === 1 && points[0].year === year ? points[0].probability : null;
  }

  function saveLocalRecord(record) {
    var records = loadLocalRecords();
    records.push(record);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  function loadLocalRecords() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (error) {
      return [];
    }
  }

  function isUsableRecord(record) {
    return record && record.perceivedRisks && record.aiTimeline && record.bestBet;
  }

  function toNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    var number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function average(values) {
    var valid = values.filter(isFiniteNumber);
    if (!valid.length) return 0;
    return valid.reduce(function (sum, value) { return sum + value; }, 0) / valid.length;
  }

  function median(values) {
    var valid = values.filter(isFiniteNumber).sort(function (a, b) { return a - b; });
    if (!valid.length) return null;
    var middle = Math.floor(valid.length / 2);
    if (valid.length % 2) return valid[middle];
    return (valid[middle - 1] + valid[middle]) / 2;
  }

  function roundOne(value) {
    return Math.round((value || 0) * 10) / 10;
  }

  function uniqueSorted(values) {
    return Array.from(new Set(values.filter(isFiniteNumber))).sort(function (a, b) { return a - b; });
  }

  function getYearTicks(minYear, maxYear) {
    var span = Math.max(1, maxYear - minYear);
    var step = span <= 12 ? 2 : span <= 30 ? 5 : 10;
    var ticks = [];
    var start = Math.ceil(minYear / step) * step;
    ticks.push(minYear);
    for (var year = start; year < maxYear; year += step) {
      if (year > minYear) ticks.push(year);
    }
    ticks.push(maxYear);
    return uniqueSorted(ticks);
  }

  function formatYear(year) {
    return isFiniteNumber(year) ? String(Math.round(year)) : "n/a";
  }

  function formatCustomMedian(timeline) {
    if (!isFiniteNumber(timeline.medianCustomProbability) || !isFiniteNumber(timeline.medianCustomYear)) {
      return "n/a";
    }
    return String(Math.round(timeline.medianCustomProbability)) + "% in " + String(Math.round(timeline.medianCustomYear));
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "rs-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }

  function debounce(callback, delay) {
    var timeout = null;
    return function () {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(callback, delay);
    };
  }
})();
