(function () {
  "use strict";

  var CURRENT_YEAR = 2026;
  var endpoint = ((window.RISK_STRUCTURE_CONFIG || {}).endpoint || "").trim();
  var state = {
    breakdown: null,
    selectedGroup: null,
    hasTooltipValues: false
  };

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

  var groupType = document.getElementById("group-type");
  var groupValue = document.getElementById("group-value");
  var groupValueLabel = document.getElementById("group-value-label");
  var loadStatus = document.getElementById("load-status");
  var results = document.getElementById("results");
  var tooltip = null;

  initialize();

  function initialize() {
    tooltip = createTooltip();
    groupType.addEventListener("change", handleGroupTypeChange);
    groupValue.addEventListener("change", renderSelectedGroup);
    document.addEventListener("mouseover", handleTooltipEnter);
    document.addEventListener("focusin", handleTooltipEnter);
    document.addEventListener("mousemove", handleTooltipMove);
    document.addEventListener("mouseout", handleTooltipLeave);
    document.addEventListener("focusout", handleTooltipLeave);
    window.addEventListener("resize", debounce(redrawTimeline, 150));
    loadBreakdown();
  }

  async function loadBreakdown() {
    if (!endpoint) {
      loadStatus.textContent = "No storage endpoint is configured.";
      return;
    }

    try {
      var response = await fetch(endpoint + "?action=breakdownStats");
      var data = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Statistics could not be loaded.");
      }
      state.breakdown = data.breakdown;
      state.hasTooltipValues = breakdownHasValueLists(state.breakdown);
      loadStatus.textContent = state.hasTooltipValues
        ? "Statistics loaded."
        : "Statistics loaded, but hover tooltips need the latest Apps Script redeploy.";
      handleGroupTypeChange();
    } catch (error) {
      console.error(error);
      loadStatus.textContent = "Could not load broken-down statistics. Redeploy the Apps Script with the latest google-apps-script.js if this is the first time using this page.";
    }
  }

  function handleGroupTypeChange() {
    var type = groupType.value;
    groupValue.innerHTML = "";

    if (!state.breakdown) return;

    if (type === "all") {
      groupValueLabel.hidden = true;
      state.selectedGroup = state.breakdown.all;
      renderStatsGroup(state.selectedGroup);
      return;
    }

    var groups = state.breakdown[type] || [];
    groupValueLabel.hidden = false;

    if (!groups.length) {
      var emptyOption = document.createElement("option");
      emptyOption.textContent = "No groups yet";
      emptyOption.value = "";
      groupValue.appendChild(emptyOption);
      state.selectedGroup = null;
      renderEmptyGroup(type);
      return;
    }

    groups.forEach(function (group) {
      var option = document.createElement("option");
      option.value = group.value;
      option.textContent = group.label + " (" + group.count + ")";
      groupValue.appendChild(option);
    });

    renderSelectedGroup();
  }

  function renderSelectedGroup() {
    var type = groupType.value;
    if (!state.breakdown) return;
    if (type === "all") {
      renderStatsGroup(state.breakdown.all);
      return;
    }

    var groups = state.breakdown[type] || [];
    var selected = groups.filter(function (group) {
      return group.value === groupValue.value;
    })[0] || groups[0] || null;

    state.selectedGroup = selected;
    if (selected) {
      renderStatsGroup(selected);
    } else {
      renderEmptyGroup(type);
    }
  }

  function renderStatsGroup(group) {
    results.hidden = false;
    document.getElementById("selected-group-title").textContent = group.label || "Results";
    renderStats(group.stats);
  }

  function renderEmptyGroup(type) {
    results.hidden = false;
    document.getElementById("selected-group-title").textContent = "No " + type + " results";
    renderStats(emptyStats());
  }

  function renderStats(stats) {
    window.__riskBreakdownLastStats = stats;
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
      setTooltip(node, tooltipForTimelineSummary(stats, item.label));
      container.appendChild(node);
    });
  }

  function renderRiskBars(stats) {
    var container = document.getElementById("risk-bars");
    container.innerHTML = "";
    riskDefinitions.forEach(function (definition) {
      var value = roundOne((stats.riskAverages || {})[definition.key] || 0);
      container.appendChild(createBarRow(
        definition.label,
        value,
        100,
        false,
        makeValuesTooltip("Individual values for " + definition.label, getNestedList(stats, ["valueLists", "risks", definition.key]))
      ));
      if (definition.key === "otherHighestRisk" && stats.otherRiskLabels && stats.otherRiskLabels.length) {
        container.appendChild(createOtherRiskLabels(stats.otherRiskLabels));
      }
    });
  }

  function createOtherRiskLabels(labels) {
    var node = document.createElement("p");
    node.className = "other-risk-labels";
    node.textContent = "Other entries: " + labels.join(", ");
    setTooltip(node, makeValuesTooltip("Other highest risk text entries", labels));
    return node;
  }

  function renderBestBetBars(stats) {
    var container = document.getElementById("best-bet-bars");
    container.innerHTML = "";
    var counts = stats.bestBetCounts || {};
    var entries = Object.keys(bestBetLabels).map(function (key) {
      return { key: key, label: bestBetLabels[key], count: counts[key] || 0 };
    }).filter(function (entry) {
      return entry.count > 0;
    }).sort(function (a, b) {
      return b.count - a.count;
    });

    if (!entries.length) {
      container.innerHTML = '<p class="empty-results">No responses in this view.</p>';
      return;
    }

    entries.forEach(function (entry) {
      container.appendChild(createBarRow(
        entry.label,
        entry.count,
        Math.max(1, stats.count),
        true,
        tooltipForBestBet(stats, entry.key, entry.label, entry.count)
      ));
    });
  }

  function renderOutlookStats(stats) {
    var container = document.getElementById("outlook-stats");
    container.innerHTML = "";
    container.appendChild(createBarRow(
      "Importance of contributing",
      roundOne(stats.averageImportance),
      100,
      false,
      makeValuesTooltip("Individual values for importance of contributing", getNestedList(stats, ["valueLists", "importanceLowerRisk"]))
    ));
    container.appendChild(createBarRow(
      "Optimism",
      roundOne(stats.averageOptimism),
      100,
      false,
      makeValuesTooltip("Individual values for optimism", getNestedList(stats, ["valueLists", "optimismAvoidRisks"]))
    ));
  }

  function createBarRow(label, value, max, countMode, tooltipText) {
    var row = document.createElement("div");
    row.className = "bar-row";
    setTooltip(row, tooltipText);

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
    var stats = window.__riskBreakdownLastStats;
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
    setTooltip(canvas, makeLinesTooltip(
      "Individual timeline responses",
      getNestedList(window.__riskBreakdownLastStats || {}, ["valueLists", "timeline", "responseLines"])
    ));
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
      ctx.fillText("No timeline data in this view.", width / 2, height / 2);
      return;
    }

    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(95, 99, 104, 0.26)";
    timeline.series.forEach(function (series) {
      drawLine(ctx, series.points, xFor, yFor);
    });

    if (timeline.averageSeries.length) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#0f766e";
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

  function emptyStats() {
    return {
      count: 0,
      riskAverages: {},
      timeline: {
        minYear: CURRENT_YEAR,
        maxYear: CURRENT_YEAR + 20,
        medianP10Year: null,
        medianP50Year: null,
        medianCustomProbability: null,
        medianCustomYear: null,
        series: [],
        averageSeries: []
      },
      bestBetCounts: {},
      otherRiskLabels: [],
      valueLists: emptyValueLists(),
      averageImportance: 0,
      averageOptimism: 0
    };
  }

  function emptyValueLists() {
    return {
      risks: {},
      timeline: {
        p10Years: [],
        p50Years: [],
        customPoints: [],
        responseLines: []
      },
      bestBetTopChoices: [],
      bestBetRanks: {},
      importanceLowerRisk: [],
      optimismAvoidRisks: []
    };
  }

  function tooltipForTimelineSummary(stats, label) {
    if (label === "Median 10% year") {
      return makeValuesTooltip("Individual 10% years", getNestedList(stats, ["valueLists", "timeline", "p10Years"]));
    }
    if (label === "Median 50% year") {
      return makeValuesTooltip("Individual 50% years", getNestedList(stats, ["valueLists", "timeline", "p50Years"]));
    }
    return makeValuesTooltip(
      "Individual custom probability points",
      getNestedList(stats, ["valueLists", "timeline", "customPoints"]),
      formatTextValue
    );
  }

  function tooltipForBestBet(stats, key, label, count) {
    var ranks = getNestedList(stats, ["valueLists", "bestBetRanks", key]);
    var rankText = ranks.length
      ? "Ranks received for " + label + ":\n" + ranks.map(formatNumberValue).join(", ")
      : "Ranks received for " + label + ":\nNo individual values in this view.";

    return "Top-choice count for " + label + ": " + String(count) + "\n" + rankText;
  }

  function makeValuesTooltip(title, values, formatter) {
    var format = formatter || formatNumberValue;
    var list = Array.isArray(values) ? values.filter(function (value) {
      return value !== null && value !== undefined && value !== "";
    }) : [];

    if (!state.hasTooltipValues) {
      return title + ":\nIndividual values are not available from the current Apps Script deployment. Redeploy the latest google-apps-script.js.";
    }

    if (!list.length) {
      return title + ":\nNo individual values in this view.";
    }

    return title + ":\n" + list.map(format).join(", ");
  }

  function makeLinesTooltip(title, values) {
    var list = Array.isArray(values) ? values.filter(function (value) {
      return value !== null && value !== undefined && value !== "";
    }) : [];

    if (!state.hasTooltipValues) {
      return title + ":\nIndividual values are not available from the current Apps Script deployment. Redeploy the latest google-apps-script.js.";
    }

    if (!list.length) {
      return title + ":\nNo individual values in this view.";
    }

    return title + ":\n" + list.map(formatTextValue).join("\n");
  }

  function setTooltip(node, text) {
    if (!node || !text) return;
    node.dataset.tooltip = text;
    if (!node.hasAttribute("tabindex")) node.tabIndex = 0;
  }

  function createTooltip() {
    var node = document.createElement("div");
    node.className = "stat-tooltip";
    node.hidden = true;
    document.body.appendChild(node);
    return node;
  }

  function handleTooltipEnter(event) {
    var target = closestTooltipTarget(event.target);
    if (!target) return;

    tooltip.textContent = target.dataset.tooltip;
    tooltip.hidden = false;
    positionTooltip(event);
  }

  function handleTooltipMove(event) {
    if (!tooltip || tooltip.hidden) return;
    positionTooltip(event);
  }

  function handleTooltipLeave(event) {
    var target = closestTooltipTarget(event.target);
    if (!target) return;
    if (event.relatedTarget && target.contains(event.relatedTarget)) return;
    tooltip.hidden = true;
  }

  function closestTooltipTarget(target) {
    if (!target || typeof target.closest !== "function") return null;
    return target.closest("[data-tooltip]");
  }

  function positionTooltip(event) {
    var x = typeof event.clientX === "number" && event.clientX ? event.clientX : window.innerWidth / 2;
    var y = typeof event.clientY === "number" && event.clientY ? event.clientY : 80;
    var margin = 14;
    var left = x + margin;
    var top = y + margin;

    tooltip.style.left = String(left) + "px";
    tooltip.style.top = String(top) + "px";

    var rect = tooltip.getBoundingClientRect();
    if (rect.right > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (rect.bottom > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - rect.height - margin);
    }

    tooltip.style.left = String(left) + "px";
    tooltip.style.top = String(top) + "px";
  }

  function getNestedList(source, path) {
    var value = path.reduce(function (current, key) {
      return current && current[key] !== undefined ? current[key] : null;
    }, source);

    return Array.isArray(value) ? value : [];
  }

  function breakdownHasValueLists(breakdown) {
    return !!(breakdown && breakdown.all && breakdown.all.stats && breakdown.all.stats.valueLists);
  }

  function formatNumberValue(value) {
    return isFiniteNumber(value) ? String(roundOne(value)) : String(value);
  }

  function formatTextValue(value) {
    return String(value);
  }

  function roundOne(value) {
    return Math.round((value || 0) * 10) / 10;
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
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
    return Array.from(new Set(ticks.filter(isFiniteNumber))).sort(function (a, b) {
      return a - b;
    });
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

  function debounce(callback, delay) {
    var timeout = null;
    return function () {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(callback, delay);
    };
  }
})();
