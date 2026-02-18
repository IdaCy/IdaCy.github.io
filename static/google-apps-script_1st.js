// ==============================================
// LUNCH LOTTERY - ROTATING TWO-SHEET SYSTEM - SHEET 1
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

// Handle GET requests (read participants or pairings)
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
    if (data.length < 2) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: true, pairings: [], lotteryRun: null }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Row 1: headers, Row 2: metadata (lotteryRun date)
    const lotteryRun = data[1] && data[1][0] ? data[1][0] : null;

    // Parse pairings from rows 3+
    const pairings = [];
    let currentPair = [];
    for (let i = 2; i < data.length; i++) {
      if (data[i][0]) {
        const person = {
          name: data[i][0],
          email: data[i][1],
          slack: data[i][2],
          pairGroup: data[i][3]
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

  // Default: get participants
  const sheet = ss.getSheetByName('Participants') || ss.getActiveSheet();
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
    .createTextOutput(JSON.stringify({ success: true, participants: participants }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Handle POST requests
function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const data = JSON.parse(e.postData.contents);

  // Action: Add participant
  if (data.action === 'addParticipant') {
    let sheet = ss.getSheetByName('Participants');
    if (!sheet) {
      sheet = ss.getActiveSheet();
      sheet.setName('Participants');
      sheet.getRange(1, 1, 1, 4).setValues([['Name', 'Email', 'Slack', 'SignupDate']]);
    }

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
      .createTextOutput(JSON.stringify({ success: true, message: 'Participant added' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Action: Run lottery and save pairings
  if (data.action === 'runLottery') {
    let participantsSheet = ss.getSheetByName('Participants');
    if (!participantsSheet) {
      participantsSheet = ss.getActiveSheet();
    }

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

    // Header row
    pairingsSheet.getRange(1, 1, 1, 4).setValues([['Name', 'Email', 'Slack', 'PairGroup']]);

    // Metadata row (lottery run date)
    pairingsSheet.getRange(2, 1).setValue(new Date().toISOString());

    // Pairings data
    let row = 3;
    for (let i = 0; i < pairings.length; i++) {
      const pair = pairings[i];
      for (let j = 0; j < pair.length; j++) {
        pairingsSheet.getRange(row, 1, 1, 4).setValues([[pair[j].name, pair[j].email, pair[j].slack, i + 1]]);
        row++;
      }
    }

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, pairings: pairings }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Action: Clear all participants (for new week)
  if (data.action === 'clearAll') {
    let sheet = ss.getSheetByName('Participants');
    if (!sheet) {
      sheet = ss.getActiveSheet();
    }

    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.deleteRows(2, lastRow - 1);
    }

    // Also clear pairings
    const pairingsSheet = ss.getSheetByName('Pairings');
    if (pairingsSheet) {
      pairingsSheet.clear();
    }

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, message: 'All cleared' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Action: Check if lottery was already run
  if (data.action === 'checkLotteryRun') {
    const pairingsSheet = ss.getSheetByName('Pairings');
    if (!pairingsSheet) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: true, lotteryRun: null }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const data = pairingsSheet.getDataRange().getValues();
    const lotteryRun = data[1] && data[1][0] ? data[1][0] : null;

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, lotteryRun: lotteryRun }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ success: false, error: 'Unknown action' }))
    .setMimeType(ContentService.MimeType.JSON);
}
