var SHEET_NAME = "Risk Structure Responses";

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

  if (action === "stats") {
    return jsonResponse({
      success: true,
      stats: computeStats(readRecords())
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
    if (!raw) return;
    try {
      records.push(normalizeRecord(JSON.parse(raw)));
    } catch (error) {
      // Skip malformed historical rows rather than exposing partial data.
    }
  });

  return records;
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

  return {
    id: String(record.id || Utilities.getUuid()),
    submittedAt: String(record.submittedAt || new Date().toISOString()),
    formVersion: String(record.formVersion || "2026-05-21"),
    start: {
      year: String(start.year || ""),
      month: String(start.month || "")
    },
    role: String(record.role || record.capacity || ""),
    organization: String(record.organization || ""),
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
      option: String(bestBet.option || ""),
      otherText: String(bestBet.otherText || "")
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
    var key = record.bestBet.option || "other";
    if (!Object.prototype.hasOwnProperty.call(stats.bestBetCounts, key)) {
      stats.bestBetCounts[key] = 0;
    }
    stats.bestBetCounts[key] += 1;
  });

  return stats;
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
