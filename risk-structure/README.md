# Risk Structure form

This subfolder is intentionally standalone. No site navigation links to it, and the page itself does not link back to other pages.

## Storage setup

The static page can be opened directly for local testing. In that mode, submissions are stored in browser `localStorage`.

For shared results and durable complete records:

1. Create a Google Sheet that will hold the responses.
2. In the sheet, go to Extensions -> Apps Script.
3. Delete the starter `Code.gs` contents.
4. Paste the complete contents of `google-apps-script.js`.
5. Click Save.
6. Click Deploy -> New deployment.
7. Select type: Web app.
8. Set Execute as: Me.
9. Set Who has access: Anyone.
10. Click Deploy and authorize the script if Google asks.
11. Copy the Web app URL. It should end in `/exec`.
12. In `config.js`, replace the empty string in `endpoint: ""` with that `/exec` URL.
13. Commit and push the updated `config.js` with the page.

The Apps Script stores both flattened columns and the complete raw JSON record for every submission. The public stats response excludes the background questions.

The unlinked `../risk-structure-breakdown/` page uses the same Apps Script deployment and requires the latest `google-apps-script.js`, including the `breakdownStats` action. If that page shows a redeploy warning, paste the latest script into Apps Script and create a new web app deployment version.
