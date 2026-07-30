# Manual test plan

Prerequisites: extension loaded unpacked, OAuth client configured, options page
shows "Connected ✓", and a test spreadsheet with the schema header row.

Tip: you can watch the service worker's console via `chrome://extensions` →
the extension card → **service worker** link. The content script logs appear in
the normal page DevTools console.

## 1. Native Handshake apply

1. On Handshake, open a job with a native **Apply** button and complete the
   application in the modal.
2. **Expect**: when the "Application submitted" confirmation appears, the
   overlay opens pre-filled with Position/Company/Location/etc.; Date Applied
   is today; Status is "Applied"; Latest word is "Application submitted
   YYYY-MM-DD". If the modal contained a cover-letter or résumé step, those
   dropdowns are pre-set to "Yes".
3. Fill Role, press **Enter**. **Expect**: "✓ Saved to Google Sheet" toast and
   a correctly ordered new row in the sheet.
4. Press **Esc** instead on another job. **Expect**: overlay closes, nothing
   is written.

## 2. Split view (job list pane)

1. Apply from the search results split view (job preview in the right pane)
   rather than the full job page.
2. **Expect**: same behavior as test 1 — job ID and fields are scraped from
   the active pane.

## 3. External application

1. Open a job whose button is **Apply externally** and click it.
2. **Expect**: the external site opens as normal, and ~1 second later the
   overlay appears on the Handshake tab, pre-filled, with Notes pre-set to
   "External application".

## 4. Manual trigger

1. On any job page, click the floating **＋ Log this job** button.
   **Expect**: overlay opens with scraped data.
2. Repeat via right-click → "Log this job to Google Sheet", and via the
   toolbar popup button. **Expect**: same overlay.

## 5. Offline retry queue

1. Open the overlay on a job, then go offline (DevTools → Network →
   "Offline", or turn off Wi-Fi).
2. Press **Enter** to save. **Expect**: "Saved offline — will retry" toast,
   toolbar badge shows **1**, options page shows 1 queued row.
3. Go back online. Within ~2 minutes (or immediately via popup → "Retry
   queued rows now"), **expect**: the row appears in the sheet, badge clears.

## 6. Duplicate detection

1. Log a job successfully, then trigger **Log this job** on the same job.
2. **Expect**: the overlay shows the amber banner "You already logged this job
   on YYYY-MM-DD" and the button reads **Save anyway**.
3. Esc → no row. Save anyway → duplicate row is appended.

## 7. Token expiry / re-auth

1. Revoke the app's access at <https://myaccount.google.com/permissions>
   (or wait ~1 hour for the access token to expire).
2. Log a job. **Expect**: for a plain expiry, the save succeeds transparently
   (cached token is invalidated and refreshed on the 401). For a full
   revocation, a Google consent window opens; after approving, the row saves.
   If you dismiss the consent window, the row is queued, not lost.

## 8. Job page missing optional fields

1. Find a job with no salary and no industry listed.
2. Trigger a log. **Expect**: Salary Range and Industry are blank (not
   guessed), highlighted amber with "couldn't auto-detect — please fill in",
   and focus lands on the first missing field. Saving writes blanks as-is.

## 9. Sheet verification

1. Point options at an **empty** tab → Connect. **Expect**: "header row
   written", and row A1:O1 contains the schema.
2. Point at a tab with a **different** header → Connect. **Expect**: mismatch
   warning listing expected vs. found; the sheet is not modified.

## 10. School subdomain

1. Use your school's subdomain (e.g. `myschool.joinhandshake.com`) instead of
   `app.joinhandshake.com`.
2. **Expect**: floating button appears on job pages and all flows above work
   (the content script matches `https://*.joinhandshake.com/*`).

## 11. Formula-injection sanitization

1. Log a job and set Notes to `=1+2` before saving.
2. **Expect**: the sheet cell shows the literal text `=1+2` (stored as
   `'=1+2`), not the number 3.

## 12. Quota errors (429)

Hard to trigger manually; to simulate, temporarily change `spreadsheetId` in
options to a sheet you can't edit → save a row → **expect** it to queue and the
badge to appear, with the error visible on the options page. Restore the real
ID, hit "Retry now" → the row saves (this also exercises the
retry-after-reconfiguration path).
