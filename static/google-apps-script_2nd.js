// ==============================================
// LUNCH LOTTERY - ROTATING TWO-SHEET SYSTEM - SHEET 2
// ==============================================
//
// Sheets needed in Google Spreadsheet:
// - Participants_A (Name, Email, Slack, SignupDate)
// - Participants_B (Name, Email, Slack, SignupDate)
// - Pairings (Name, Email, Slack, PairGroup) + Row 2 has lottery date
// - Config (Key, Value) - tracks which sheet is active
//
// Flow:
// Week 1: Signups → Sheet A → Monday lottery → Display A pairings → Signups → Sheet B
// Week 2: Signups → Sheet B → Monday lottery → Display B pairings → Clear A → Signups → Sheet A
// (repeats)
// ==============================================

// Get or create Config sheet and return current active signup sheet
function getActiveSheet(ss) {
  let config = ss.getSheetByName('Config');
  if (!config) {
    config = ss.insertSheet('Config');
    config.getRange(1, 1, 1, 2).setValues([['Key', 'Value']]);
    config.getRange(2, 1, 1, 2).setValues([['activeSignupSheet', 'A']]);
    config.getRange(3, 1, 1, 2).setValues([['lastLotteryRun', '']]);
  }

  const data = config.getDataRange().getValues();
  let activeSheet = 'A';
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'activeSignupSheet') {
      activeSheet = data[i][1] || 'A';
      break;
    }
  }
  return activeSheet;
}

// Set which sheet is active for signups
function setActiveSheet(ss, sheetLetter) {
  const config = ss.getSheetByName('Config');
  const data = config.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'activeSignupSheet') {
      config.getRange(i + 1, 2).setValue(sheetLetter);
      return;
    }
  }
}

// Get last lottery run date
function getLastLotteryRun(ss) {
  const config = ss.getSheetByName('Config');
  if (!config) return null;

  const data = config.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'lastLotteryRun') {
      return data[i][1] || null;
    }
  }
  return null;
}

// Set last lottery run date
function setLastLotteryRun(ss, date) {
  const config = ss.getSheetByName('Config');
  const data = config.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'lastLotteryRun') {
      config.getRange(i + 1, 2).setValue(date);
      return;
    }
  }
}

// Ensure participant sheets exist
function ensureParticipantSheets(ss) {
  if (!ss.getSheetByName('Participants_A')) {
    const sheet = ss.insertSheet('Participants_A');
    sheet.getRange(1, 1, 1, 4).setValues([['Name', 'Email', 'Slack', 'SignupDate']]);
  }
  if (!ss.getSheetByName('Participants_B')) {
    const sheet = ss.insertSheet('Participants_B');
    sheet.getRange(1, 1, 1, 4).setValues([['Name', 'Email', 'Slack', 'SignupDate']]);
  }
}

// Handle GET requests
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const action = e.parameter.action || 'getParticipants';

  if (action === 'getPairings') {
    const pairingsSheet = ss.getSheetByName('Pairings');
    if (!pairingsSheet) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: true, pairings: [], lotteryRun: null }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const data = pairingsSheet.getDataRange().getValues();
    if (data.length < 3) { // Need header + date row + at least 1 person
      return ContentService
        .createTextOutput(JSON.stringify({ success: true, pairings: [], lotteryRun: null }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const lotteryRun = data[1] && data[1][0] ? data[1][0] : null;

    // Check if we have PairGroup column (header row)
    const hasPairGroup = data[0] && data[0][3] === 'PairGroup';

    const pairings = [];
    let currentPair = [];

    for (let i = 2; i < data.length; i++) {
      if (data[i][0]) {
        const person = {
          name: data[i][0],
          email: data[i][1],
          slack: data[i][2],
          pairGroup: hasPairGroup ? data[i][3] : Math.floor((i - 2) / 2) + 1
        };

        if (currentPair.length === 0 || currentPair[0].pairGroup === person.pairGroup) {
          currentPair.push(person);
        } else {
          pairings.push(currentPair);
          currentPair = [person];
        }
      }
    }
    if (currentPair.length > 0) {
      pairings.push(currentPair);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, pairings: pairings, lotteryRun: lotteryRun }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'getStatus') {
    ensureParticipantSheets(ss);
    const activeSheet = getActiveSheet(ss);
    const lastRun = getLastLotteryRun(ss);

    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        activeSignupSheet: activeSheet,
        lastLotteryRun: lastRun
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Default: get participants from active signup sheet
  ensureParticipantSheets(ss);
  const activeSheet = getActiveSheet(ss);
  const sheet = ss.getSheetByName('Participants_' + activeSheet);
  const data = sheet.getDataRange().getValues();

  const participants = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      participants.push({
        name: data[i][0],
        email: data[i][1],
        slack: data[i][2],
        signupDate: data[i][3]
      });
    }
  }

  return ContentService
    .createTextOutput(JSON.stringify({ success: true, participants: participants, activeSheet: activeSheet }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Handle POST requests
function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const data = JSON.parse(e.postData.contents);

  // Action: Add participant to active signup sheet
  if (data.action === 'addParticipant') {
    ensureParticipantSheets(ss);
    const activeSheetLetter = getActiveSheet(ss);
    const sheet = ss.getSheetByName('Participants_' + activeSheetLetter);

    const existing = sheet.getDataRange().getValues();
    for (let i = 1; i < existing.length; i++) {
      if (existing[i][0] && existing[i][0].toString().toLowerCase() === data.name.toLowerCase()) {
        return ContentService
          .createTextOutput(JSON.stringify({ success: false, error: 'Name already signed up' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      if (existing[i][1] && existing[i][1].toString().toLowerCase() === data.email.toLowerCase()) {
        return ContentService
          .createTextOutput(JSON.stringify({ success: false, error: 'Email already signed up' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    sheet.appendRow([data.name, data.email, data.slack, new Date().toISOString()]);

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, message: 'Participant added to Sheet ' + activeSheetLetter }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Action: Run lottery on active sheet, then switch to other sheet
  if (data.action === 'runLottery') {
    ensureParticipantSheets(ss);
    const activeSheetLetter = getActiveSheet(ss);
    const participantsSheet = ss.getSheetByName('Participants_' + activeSheetLetter);

    const existing = participantsSheet.getDataRange().getValues();
    const participants = [];

    for (let i = 1; i < existing.length; i++) {
      if (existing[i][0]) {
        participants.push({
          name: existing[i][0],
          email: existing[i][1],
          slack: existing[i][2]
        });
      }
    }

    if (participants.length < 2) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, error: 'Need at least 2 participants' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Shuffle participants
    for (let i = participants.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = participants[i];
      participants[i] = participants[j];
      participants[j] = temp;
    }

    // Create pairs
    const pairings = [];
    for (let i = 0; i < participants.length; i += 2) {
      if (i + 1 < participants.length) {
        pairings.push([participants[i], participants[i + 1]]);
      } else {
        if (pairings.length > 0) {
          pairings[pairings.length - 1].push(participants[i]);
        } else {
          pairings.push([participants[i]]);
        }
      }
    }

    // Save pairings to Pairings sheet
    let pairingsSheet = ss.getSheetByName('Pairings');
    if (!pairingsSheet) {
      pairingsSheet = ss.insertSheet('Pairings');
    } else {
      pairingsSheet.clear();
    }

    pairingsSheet.getRange(1, 1, 1, 4).setValues([['Name', 'Email', 'Slack', 'PairGroup']]);
    pairingsSheet.getRange(2, 1).setValue(new Date().toISOString());

    let row = 3;
    for (let i = 0; i < pairings.length; i++) {
      const pair = pairings[i];
      for (let j = 0; j < pair.length; j++) {
        pairingsSheet.getRange(row, 1, 1, 4).setValues([[pair[j].name, pair[j].email, pair[j].slack, i + 1]]);
        row++;
      }
    }

    // Switch to other sheet for new signups
    const newActiveSheet = activeSheetLetter === 'A' ? 'B' : 'A';
    setActiveSheet(ss, newActiveSheet);
    setLastLotteryRun(ss, new Date().toISOString());

    // Clear the new active sheet (it will collect new signups)
    const newSheet = ss.getSheetByName('Participants_' + newActiveSheet);
    const lastRow = newSheet.getLastRow();
    if (lastRow > 1) {
      newSheet.deleteRows(2, lastRow - 1);
    }

    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        pairings: pairings,
        previousSheet: activeSheetLetter,
        newActiveSheet: newActiveSheet
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Action: Manual clear (admin only)
  if (data.action === 'clearAll') {
    ensureParticipantSheets(ss);

    // Clear both participant sheets
    const sheetA = ss.getSheetByName('Participants_A');
    const sheetB = ss.getSheetByName('Participants_B');

    if (sheetA.getLastRow() > 1) {
      sheetA.deleteRows(2, sheetA.getLastRow() - 1);
    }
    if (sheetB.getLastRow() > 1) {
      sheetB.deleteRows(2, sheetB.getLastRow() - 1);
    }

    // Clear pairings
    const pairingsSheet = ss.getSheetByName('Pairings');
    if (pairingsSheet) {
      pairingsSheet.clear();
    }

    // Reset to sheet A
    setActiveSheet(ss, 'A');
    setLastLotteryRun(ss, '');

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, message: 'All cleared, reset to Sheet A' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ success: false, error: 'Unknown action' }))
    .setMimeType(ContentService.MimeType.JSON);
}
