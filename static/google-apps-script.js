// Handle GET requests (read participants)
function doGet(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = sheet.getDataRange().getValues();

  // Skip header row
  const participants = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) { // If name exists
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

// Handle POST requests (add participant or run lottery)
function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = JSON.parse(e.postData.contents);

  // Action: Add participant
  if (data.action === 'addParticipant') {
    // Check for duplicates
    const existing = sheet.getDataRange().getValues();
    for (let i = 1; i < existing.length; i++) {
      if (existing[i][0].toLowerCase() === data.name.toLowerCase()) {
        return ContentService
          .createTextOutput(JSON.stringify({ success: false, error: 'Name already signed up' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      if (existing[i][1].toLowerCase() === data.email.toLowerCase()) {
        return ContentService
          .createTextOutput(JSON.stringify({ success: false, error: 'Email already signed up' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    // Add new participant
    sheet.appendRow([data.name, data.email, data.slack, new Date().toISOString()]);

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, message: 'Participant added' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Action: Clear all participants (for new week)
  if (data.action === 'clearAll') {
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.deleteRows(2, lastRow - 1);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, message: 'All participants cleared' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Action: Run lottery and return pairings
  if (data.action === 'runLottery') {
    const existing = sheet.getDataRange().getValues();
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
      [participants[i], participants[j]] = [participants[j], participants[i]];
    }

    // Create pairs
    const pairings = [];
    for (let i = 0; i < participants.length; i += 2) {
      if (i + 1 < participants.length) {
        pairings.push([participants[i], participants[i + 1]]);
      } else {
        // Odd person joins last pair
        if (pairings.length > 0) {
          pairings[pairings.length - 1].push(participants[i]);
        }
      }
    }

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, pairings: pairings }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ success: false, error: 'Unknown action' }))
    .setMimeType(ContentService.MimeType.JSON);
}
