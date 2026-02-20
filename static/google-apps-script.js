// ==============================================
// LUNCH LOTTERY - ROTATING TWO-SHEET SYSTEM
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

// Resend API configuration
const RESEND_API_KEY = 're_cHrhtr6h_842nvqobQmbMgrXTuoVUzTXJ';
const FROM_EMAIL = 'lottery@lunchlottery.org';

// Lunch jokes for emails
const LUNCH_JOKES = [
  "Why did the lunch break up with breakfast? It needed more time to ketchup!",
  "Lettuce celebrate - it's Taco Tuesday vibes!",
  "This pairing is sub-lime!",
  "You've bean selected for a great lunch date!",
  "Olive you both - have a great meal!",
  "This is nacho average lunch pairing!",
  "Peas enjoy your lunch together!",
  "You're one in a melon - great pairing!",
  "Time to taco 'bout life over lunch!",
  "This match is a big dill!"
];

// Get next Tuesday at 12:00
function getNextTuesday() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  let daysUntilTuesday = (2 - dayOfWeek + 7) % 7;
  if (daysUntilTuesday === 0) daysUntilTuesday = 7; // If today is Tuesday, get next Tuesday

  const tuesday = new Date(now);
  tuesday.setDate(now.getDate() + daysUntilTuesday);
  tuesday.setHours(12, 0, 0, 0);
  return tuesday;
}

// Generate .ics calendar invite content
function generateCalendarInvite(toName, partnerName, lunchDate) {
  const startDate = lunchDate;
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 hour later

  // Format dates for ICS (YYYYMMDDTHHmmss)
  function formatICSDate(date) {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  }

  const uid = 'lunch-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9) + '@lunchlottery.org';

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lunch Lottery//lunchlottery.org//EN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTAMP:' + formatICSDate(new Date()),
    'DTSTART:' + formatICSDate(startDate),
    'DTEND:' + formatICSDate(endDate),
    'SUMMARY:Lunch: ' + toName + ' & ' + partnerName,
    'DESCRIPTION:Lunch Lottery pairing! Reach out on Slack to decide where to meet.',
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  return icsContent;
}

// Send email via Resend API with calendar invite
function sendResendEmail(toEmail, toName, partnerName, partnerSlack) {
  const joke = LUNCH_JOKES[Math.floor(Math.random() * LUNCH_JOKES.length)];
  const lunchDate = getNextTuesday();
  const lunchDateFormatted = lunchDate.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const htmlContent = `
    <p>Hi ${toName} - It's Lunch Lottery day! You're lunching with ${partnerName}. Reach out to them now: ${partnerSlack}.</p>
    <p>Enjoy,<br>Your Lunch Lottery bot</p>
  `;

  const calendarContent = generateCalendarInvite(toName, partnerName, lunchDate);
  const calendarBase64 = Utilities.base64Encode(calendarContent);

  const payload = {
    from: FROM_EMAIL,
    to: toEmail,
    subject: "Lunch Lottery - You're paired up! " + toName + ' & ' + partnerName,
    html: htmlContent,
    attachments: [
      {
        filename: 'lunch-invite.ics',
        content: calendarBase64
      }
    ]
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + RESEND_API_KEY
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch('https://api.resend.com/emails', options);
    const result = JSON.parse(response.getContentText());
    Logger.log('Email sent to ' + toEmail + ': ' + JSON.stringify(result));
    return { success: true, result: result };
  } catch (error) {
    Logger.log('Failed to send email to ' + toEmail + ': ' + error);
    return { success: false, error: error.toString() };
  }
}

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

    // Send emails via Resend
    const emailResults = [];
    for (let i = 0; i < pairings.length; i++) {
      const pair = pairings[i];
      if (pair.length === 2) {
        emailResults.push(sendResendEmail(pair[0].email, pair[0].name, pair[1].name, pair[1].slack));
        emailResults.push(sendResendEmail(pair[1].email, pair[1].name, pair[0].name, pair[0].slack));
      } else if (pair.length === 3) {
        emailResults.push(sendResendEmail(pair[0].email, pair[0].name, pair[1].name + ' and ' + pair[2].name, pair[1].slack + ' & ' + pair[2].slack));
        emailResults.push(sendResendEmail(pair[1].email, pair[1].name, pair[0].name + ' and ' + pair[2].name, pair[0].slack + ' & ' + pair[2].slack));
        emailResults.push(sendResendEmail(pair[2].email, pair[2].name, pair[0].name + ' and ' + pair[1].name, pair[0].slack + ' & ' + pair[1].slack));
      }
    }

    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        pairings: pairings,
        previousSheet: activeSheetLetter,
        newActiveSheet: newActiveSheet,
        emailsSent: emailResults.length
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
