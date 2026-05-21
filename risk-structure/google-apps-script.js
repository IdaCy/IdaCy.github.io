var SHEET_NAME = "Risk Structure Responses";
var SCHEMA_VERSION = "risk-structure-2026-05-21-partial-ranking";

var HEADERS = [
  "Timestamp",
  "Submission ID",
  "Start year",
  "Start month",
  "Role",
  "Organization",
  "New pandemic",
  "Loss of control to AI",
  "AI Misuse",
  "Climate change",
  "Nuclear war",
  "Other highest risk label",
  "Other highest risk score",
  "AI 10% year",
  "AI 50% year",
  "Custom AI probability",
  "Custom AI probability year",
  "Importance lowering risk",
  "Best bet",
  "Best bet other",
  "Optimism avoiding large risks",
  "Raw JSON"
];

var RISK_DEFINITIONS = [
  { key: "newPandemic", label: "New pandemic" },
  { key: "lossControlAI", label: "Loss of control to AI" },
  { key: "aiMisuse", label: "AI Misuse" },
  { key: "climateChange", label: "Climate change" },
  { key: "nuclearWar", label: "Nuclear war" },
  { key: "otherHighestRisk", label: "Other highest risk" }
];

var BEST_BET_KEYS = [
  "aligning AI",
  "pausing AI development/training",
  "slowing down AI development/training",
  "technical AI safety to control AI",
  "technical AI safety to understand and predict AI",
  "other technical AI safety ways",
  "winning the race and having AI solve AI alignment",
  "other"
];

function doGet(e) {
  var action = e && e.parameter && e.parameter.action ? e.parameter.action : "stats";

  if (action === "capabilities") {
    return jsonResponse({
      success: true,
      schemaVersion: SCHEMA_VERSION,
      storesCompleteRecords: true,
      supportsOtherHighestRiskLabel: true,
      supportsBestBetRanking: true,
      supportsPartialBestBetRanking: true,
      storesBlankOrganizationAsNotFilled: true,
      supportsTooltipValueLists: true
    });
  }

  if (action === "stats") {
    return jsonResponse({
      success: true,
      schemaVersion: SCHEMA_VERSION,
      stats: computeStats(readRecords())
    });
  }

  if (action === "breakdownStats") {
    return jsonResponse({
      success: true,
      schemaVersion: SCHEMA_VERSION,
      breakdown: computeBreakdownStats(readRecords())
    });
  }

  return jsonResponse({
    success: false,
    error: "Unknown action"
  });
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents || "{}");

    if (payload.action !== "submit") {
      return jsonResponse({
        success: false,
        error: "Unknown action"
      });
    }

    var record = normalizeRecord(payload.submission || {});
    appendRecord(record);

    return jsonResponse({
      success: true,
      schemaVersion: SCHEMA_VERSION,
      stats: computeStats(readRecords())
    });
  } catch (error) {
    return jsonResponse({
      success: false,
      error: String(error && error.message ? error.message : error)
    });
  }
}

function appendRecord(record) {
  var sheet = getSheet();
  sheet.appendRow([
    record.submittedAt,
    record.id,
    record.start.year,
    record.start.month,
    record.role,
    record.organization,
    record.perceivedRisks.newPandemic,
    record.perceivedRisks.lossControlAI,
    record.perceivedRisks.aiMisuse,
    record.perceivedRisks.climateChange,
    record.perceivedRisks.nuclearWar,
    record.perceivedRisks.otherHighestRisk.label,
    record.perceivedRisks.otherHighestRisk.score,
    record.aiTimeline.p10Year,
    record.aiTimeline.p50Year,
    record.aiTimeline.customProbability,
    record.aiTimeline.customYear,
    record.importanceLowerRisk,
    record.bestBet.option,
    record.bestBet.otherText,
    record.optimismAvoidRisks,
    JSON.stringify(record)
  ]);
}

function readRecords() {
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  var rawJsonIndex = HEADERS.indexOf("Raw JSON");
  var records = [];

  values.forEach(function (row) {
    var raw = row[rawJsonIndex];
    var rawRecord = {};

    if (!rowHasContent(row)) return;

    if (raw) {
      try {
        rawRecord = JSON.parse(raw);
      } catch (error) {
        rawRecord = {};
      }
    }

    try {
      records.push(normalizeRecord(mergeRowIntoRecord(rawRecord, row)));
    } catch (error) {
      // Skip malformed historical rows rather than exposing partial data.
    }
  });

  return records;
}

function mergeRowIntoRecord(record, row) {
  var merged = record || {};
  var start = merged.start || {};
  var risks = merged.perceivedRisks || {};
  var otherRisk = risks.otherHighestRisk || {};
  var aiTimeline = merged.aiTimeline || {};
  var bestBet = merged.bestBet || {};

  merged.id = rowValueOrExisting(row, "Submission ID", merged.id);
  merged.submittedAt = rowValueOrExisting(row, "Timestamp", merged.submittedAt);
  merged.role = rowValueOrExisting(row, "Role", merged.role || merged.capacity);
  merged.organization = rowValueOrExisting(row, "Organization", merged.organization);
  merged.importanceLowerRisk = rowValueOrExisting(row, "Importance lowering risk", merged.importanceLowerRisk);
  merged.optimismAvoidRisks = rowValueOrExisting(row, "Optimism avoiding large risks", merged.optimismAvoidRisks);

  start.year = rowValueOrExisting(row, "Start year", start.year);
  start.month = rowValueOrExisting(row, "Start month", start.month);
  merged.start = start;

  risks.newPandemic = rowValueOrExisting(row, "New pandemic", risks.newPandemic);
  risks.lossControlAI = rowValueOrExisting(row, "Loss of control to AI", risks.lossControlAI);
  risks.aiMisuse = rowValueOrExisting(row, "AI Misuse", risks.aiMisuse);
  risks.climateChange = rowValueOrExisting(row, "Climate change", risks.climateChange);
  risks.nuclearWar = rowValueOrExisting(row, "Nuclear war", risks.nuclearWar);
  otherRisk.label = rowValueOrExisting(row, "Other highest risk label", otherRisk.label);
  otherRisk.score = rowValueOrExisting(row, "Other highest risk score", otherRisk.score);
  risks.otherHighestRisk = otherRisk;
  merged.perceivedRisks = risks;

  aiTimeline.p10Year = rowValueOrExisting(row, "AI 10% year", aiTimeline.p10Year);
  aiTimeline.p50Year = rowValueOrExisting(row, "AI 50% year", aiTimeline.p50Year);
  aiTimeline.customProbability = rowValueOrExisting(row, "Custom AI probability", aiTimeline.customProbability);
  aiTimeline.customYear = rowValueOrExisting(row, "Custom AI probability year", aiTimeline.customYear);
  merged.aiTimeline = aiTimeline;

  bestBet.option = rowValueOrExisting(row, "Best bet", bestBet.option);
  bestBet.otherText = rowValueOrExisting(row, "Best bet other", bestBet.otherText);
  merged.bestBet = bestBet;

  return merged;
}

function rowValueOrExisting(row, header, existing) {
  var index = HEADERS.indexOf(header);
  if (index === -1) return existing;

  var value = row[index];
  return hasSheetValue(value) ? value : existing;
}

function rowHasContent(row) {
  return row.some(hasSheetValue);
}

function hasSheetValue(value) {
  return value !== "" && value !== null && value !== undefined;
}

function getSheet() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  var firstRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (firstRow[0] !== HEADERS[0] || firstRow[HEADERS.length - 1] !== HEADERS[HEADERS.length - 1]) {
    if (sheet.getLastRow() === 1 && firstRow.join("") === "") {
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
      sheet.setFrozenRows(1);
    } else {
      throw new Error("Storage sheet headers do not match; refusing to overwrite existing data.");
    }
  } else if (firstRow[4] === "Capacity") {
    sheet.getRange(1, 5).setValue("Role");
  }

  return sheet;
}

function normalizeRecord(input) {
  var record = input || {};
  var risks = record.perceivedRisks || {};
  var otherRisk = risks.otherHighestRisk || {};
  var aiTimeline = record.aiTimeline || {};
  var start = record.start || {};
  var bestBet = record.bestBet || {};
  var bestBetRanking = normalizeBestBetRanking(bestBet);

  return {
    id: String(record.id || Utilities.getUuid()),
    submittedAt: String(record.submittedAt || new Date().toISOString()),
    formVersion: String(record.formVersion || "2026-05-21"),
    start: {
      year: String(start.year || ""),
      month: String(start.month || "")
    },
    role: String(record.role || record.capacity || ""),
    organization: normalizeStoredOrganization(record.organization),
    perceivedRisks: {
      newPandemic: toNumber(risks.newPandemic),
      lossControlAI: toNumber(risks.lossControlAI),
      aiMisuse: toNumber(risks.aiMisuse),
      climateChange: toNumber(risks.climateChange),
      nuclearWar: toNumber(risks.nuclearWar),
      otherHighestRisk: {
        label: String(otherRisk.label || ""),
        score: toNumber(otherRisk.score)
      }
    },
    aiTimeline: {
      p10Year: toNumber(aiTimeline.p10Year),
      p50Year: toNumber(aiTimeline.p50Year),
      customProbability: toNumber(aiTimeline.customProbability),
      customYear: toNumber(aiTimeline.customYear)
    },
    importanceLowerRisk: toNumber(record.importanceLowerRisk),
    bestBet: {
      option: getTopBestBetOption({ bestBet: { option: String(bestBet.option || ""), ranking: bestBetRanking } }),
      otherText: String(bestBet.otherText || ""),
      ranking: bestBetRanking
    },
    optimismAvoidRisks: toNumber(record.optimismAvoidRisks)
  };
}

function computeStats(records) {
  var cleanRecords = records.filter(function (record) {
    return record && record.perceivedRisks && record.aiTimeline && record.bestBet;
  });

  var stats = {
    count: cleanRecords.length,
    riskAverages: {},
    timeline: computeTimeline(cleanRecords),
    bestBetCounts: {},
    otherRiskLabels: collectOtherRiskLabels(cleanRecords),
    valueLists: collectValueLists(cleanRecords),
    averageImportance: average(cleanRecords.map(function (record) {
      return record.importanceLowerRisk;
    })),
    averageOptimism: average(cleanRecords.map(function (record) {
      return record.optimismAvoidRisks;
    }))
  };

  RISK_DEFINITIONS.forEach(function (definition) {
    stats.riskAverages[definition.key] = average(cleanRecords.map(function (record) {
      if (definition.key === "otherHighestRisk") {
        return record.perceivedRisks.otherHighestRisk.score;
      }
      return record.perceivedRisks[definition.key];
    }));
  });

  BEST_BET_KEYS.forEach(function (key) {
    stats.bestBetCounts[key] = 0;
  });

  cleanRecords.forEach(function (record) {
    var key = getTopBestBetOption(record);
    if (!key) return;
    if (!Object.prototype.hasOwnProperty.call(stats.bestBetCounts, key)) {
      stats.bestBetCounts[key] = 0;
    }
    stats.bestBetCounts[key] += 1;
  });

  return stats;
}

function collectValueLists(records) {
  var lists = {
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

  RISK_DEFINITIONS.forEach(function (definition) {
    lists.risks[definition.key] = [];
  });

  BEST_BET_KEYS.forEach(function (key) {
    lists.bestBetRanks[key] = [];
  });

  records.forEach(function (record) {
    RISK_DEFINITIONS.forEach(function (definition) {
      var value = definition.key === "otherHighestRisk"
        ? record.perceivedRisks.otherHighestRisk.score
        : record.perceivedRisks[definition.key];
      if (isFiniteNumber(value)) lists.risks[definition.key].push(value);
    });

    appendTimelineValues(lists.timeline, record.aiTimeline || {});
    appendBestBetValues(lists, record.bestBet || {});

    if (isFiniteNumber(record.importanceLowerRisk)) {
      lists.importanceLowerRisk.push(record.importanceLowerRisk);
    }
    if (isFiniteNumber(record.optimismAvoidRisks)) {
      lists.optimismAvoidRisks.push(record.optimismAvoidRisks);
    }
  });

  return lists;
}

function appendTimelineValues(timelineLists, timeline) {
  var responseLine = [];

  if (isFiniteNumber(timeline.p10Year)) {
    timelineLists.p10Years.push(timeline.p10Year);
    responseLine.push("10%: " + String(timeline.p10Year));
  }
  if (isFiniteNumber(timeline.p50Year)) {
    timelineLists.p50Years.push(timeline.p50Year);
    responseLine.push("50%: " + String(timeline.p50Year));
  }
  if (isFiniteNumber(timeline.customProbability) && isFiniteNumber(timeline.customYear)) {
    timelineLists.customPoints.push(String(timeline.customProbability) + "% in " + String(timeline.customYear));
    responseLine.push(String(timeline.customProbability) + "%: " + String(timeline.customYear));
  }

  if (responseLine.length) {
    timelineLists.responseLines.push(responseLine.join(", "));
  }
}

function appendBestBetValues(lists, bestBet) {
  var topChoice = getTopBestBetOption({ bestBet: bestBet });
  var ranking = Array.isArray(bestBet.ranking) ? bestBet.ranking : [];

  if (topChoice) {
    lists.bestBetTopChoices.push(topChoice);
  }

  ranking.forEach(function (entry) {
    var option = String(entry && entry.option ? entry.option : "");
    var rank = toNumber(entry && entry.rank);

    if (!option || !isFiniteNumber(rank)) return;
    if (!lists.bestBetRanks[option]) lists.bestBetRanks[option] = [];
    lists.bestBetRanks[option].push(rank);
  });
}

function normalizeBestBetRanking(bestBet) {
  var source = bestBet && Array.isArray(bestBet.ranking) ? bestBet.ranking : [];
  var entries = [];
  var seen = {};

  source.forEach(function (entry) {
    var option = String(entry && entry.option ? entry.option : "");
    var rank = toNumber(entry && entry.rank);

    if (!option || !isFiniteNumber(rank) || seen[option]) return;
    seen[option] = true;
    entries.push({
      option: option,
      label: getBestBetLabel(option),
      rank: rank
    });
  });

  if (!entries.length) {
    return makeLegacyBestBetRanking(String(bestBet && bestBet.option ? bestBet.option : ""));
  }

  BEST_BET_KEYS.forEach(function (option) {
    if (!seen[option]) {
      entries.push({
        option: option,
        label: getBestBetLabel(option),
        rank: BEST_BET_KEYS.length
      });
    }
  });

  return entries.sort(sortBestBetRanking);
}

function makeLegacyBestBetRanking(selectedOption) {
  var option = String(selectedOption || "");
  var ranking = [];

  if (!option) return ranking;

  if (option && BEST_BET_KEYS.indexOf(option) === -1) {
    ranking.push({
      option: option,
      label: getBestBetLabel(option),
      rank: 1
    });
  }

  BEST_BET_KEYS.forEach(function (key) {
    ranking.push({
      option: key,
      label: getBestBetLabel(key),
      rank: key === option ? 1 : BEST_BET_KEYS.length
    });
  });

  return ranking.sort(sortBestBetRanking);
}

function getTopBestBetOption(record) {
  var bestBet = record && record.bestBet ? record.bestBet : {};
  var bottomRank = BEST_BET_KEYS.length;
  var ranking = Array.isArray(bestBet.ranking) ? bestBet.ranking.filter(function (entry) {
    return entry && entry.option && isFiniteNumber(entry.rank) && entry.rank < bottomRank;
  }).sort(sortBestBetRanking) : [];

  return ranking.length ? String(ranking[0].option) : String(bestBet.option || "");
}

function normalizeStoredOrganization(value) {
  var organization = String(value || "").trim();
  return organization || "Not filled";
}

function sortBestBetRanking(a, b) {
  if (a.rank === b.rank) return bestBetOptionIndex(a.option) - bestBetOptionIndex(b.option);
  return a.rank - b.rank;
}

function bestBetOptionIndex(option) {
  var index = BEST_BET_KEYS.indexOf(option);
  return index === -1 ? BEST_BET_KEYS.length : index;
}

function getBestBetLabel(option) {
  return String(option || "");
}

function collectOtherRiskLabels(records) {
  var seen = {};
  var labels = [];

  records.forEach(function (record) {
    var label = record &&
      record.perceivedRisks &&
      record.perceivedRisks.otherHighestRisk &&
      record.perceivedRisks.otherHighestRisk.label
        ? String(record.perceivedRisks.otherHighestRisk.label).trim()
        : "";
    var key = label.toLowerCase();

    if (label && !seen[key]) {
      seen[key] = true;
      labels.push(label);
    }
  });

  return labels;
}

function computeBreakdownStats(records) {
  var cleanRecords = records.filter(function (record) {
    return record && record.perceivedRisks && record.aiTimeline && record.bestBet;
  });

  return {
    all: makeStatsGroup("all", "All responses", cleanRecords),
    organizations: groupRecords(cleanRecords, function (record) {
      return normalizeOrganization(record.organization);
    }),
    startYears: groupRecords(cleanRecords, function (record) {
      return String(record.start && record.start.year ? record.start.year : "").trim();
    }),
    startMonths: groupRecords(cleanRecords, function (record) {
      return String(record.start && record.start.month ? record.start.month : "").trim();
    }, monthSortIndex)
  };
}

function groupRecords(records, getKey, sortIndex) {
  var grouped = {};
  records.forEach(function (record) {
    var key = getKey(record);
    if (!key) return;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(record);
  });

  return Object.keys(grouped).map(function (key) {
    return makeStatsGroup(key, key, grouped[key]);
  }).sort(function (a, b) {
    if (sortIndex) {
      return sortIndex(a.value) - sortIndex(b.value);
    }
    return a.label.localeCompare(b.label);
  });
}

function makeStatsGroup(value, label, records) {
  return {
    value: value,
    label: label,
    count: records.length,
    stats: computeStats(records)
  };
}

function normalizeOrganization(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function monthSortIndex(value) {
  var months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  var index = months.indexOf(value);
  return index === -1 ? 99 : index;
}

function computeTimeline(records) {
  var currentYear = 2026;
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

  var minYear = allYears.length ? Math.min.apply(null, allYears.concat([currentYear])) : currentYear;
  var maxYear = allYears.length ? Math.max.apply(null, allYears) : currentYear + 20;
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

  return { points: points };
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

  return null;
}

function average(values) {
  var valid = values.filter(isFiniteNumber);
  if (!valid.length) return 0;
  return valid.reduce(function (sum, value) {
    return sum + value;
  }, 0) / valid.length;
}

function median(values) {
  var valid = values.filter(isFiniteNumber).sort(function (a, b) {
    return a - b;
  });
  if (!valid.length) return null;
  var middle = Math.floor(valid.length / 2);
  if (valid.length % 2) return valid[middle];
  return (valid[middle - 1] + valid[middle]) / 2;
}

function uniqueSorted(values) {
  var seen = {};
  return values.filter(isFiniteNumber).filter(function (value) {
    if (seen[value]) return false;
    seen[value] = true;
    return true;
  }).sort(function (a, b) {
    return a - b;
  });
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  var number = Number(value);
  return isFiniteNumber(number) ? number : null;
}

function isFiniteNumber(value) {
  return typeof value === "number" && isFinite(value);
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
