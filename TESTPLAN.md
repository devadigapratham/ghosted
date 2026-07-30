# Manual test plan

For the parts that need a real browser. The pure logic is covered by
`npm test`.

Before starting: extension loaded, OAuth client configured, options page shows
"Connected ✓", and a test spreadsheet with the header row.

Worker logs are at `chrome://extensions` → the card → **service worker**.
Content script logs show up in the normal page DevTools console.

Suggested order — cheapest and most reversible first: 4, 9, 11, 5, 6, then 1
and 3 (which need real applications), and 7 last since it revokes access.

## 1. Native apply

1. Open a job with a normal **Apply** button and finish the application.
2. Expect: when "Application submitted" appears, the overlay opens pre-filled.
   Date Applied is today, Status is "Applied", Latest word is "Application
   submitted YYYY-MM-DD". If the modal had a cover-letter step, that dropdown
   is "Yes".
3. Fill Role, press **Enter**. Expect a "✓ Saved to Google Sheet" toast and a
   correctly ordered row.
4. On a different job, press **Esc** instead. Expect: overlay closes, nothing
   written.

## 2. Split view

1. Apply from the search results split view (preview in the right pane) rather
   than a full job page.
2. Expect: same as test 1. The job ID comes off the selected card.

## 3. External application

1. Open a job whose button is **Apply externally** and click it.
2. Expect: the external site opens normally, and about a second later the
   overlay appears on the Handshake tab with Notes pre-set to "External
   application".

## 4. Manual triggers

1. On a job page, click the floating **＋ Log this job** button. Expect the
   overlay with scraped data.
2. Same via right-click → "Log this job to Google Sheet".
3. Same via the toolbar popup button.

Test 3 is the one that catches a missing `activeTab` permission — without it
the popup can't read the tab URL and reports "Open a Handshake page first" on a
valid job page.

## 5. Résumé upload detection

The point here is that mentioning a résumé isn't the same as attaching one.

1. Open an apply modal that has a résumé step but don't attach anything.
   Trigger the overlay. Expect **Résumé upload? = No**.
2. Attach or select a résumé, then trigger it. Expect **Yes**.
3. Open a job with no résumé step at all. Expect the field **blank**.

## 6. Offline queue

1. Open the overlay, then go offline (DevTools → Network → Offline, or turn off
   Wi-Fi).
2. Press Enter. Expect: "Saved offline — will retry" toast, badge shows **1**,
   options page shows 1 row waiting.
3. Go back online. Within ~2 minutes, or immediately via popup → "Retry queued
   rows now", the row appears and the badge clears.

## 7. Duplicates

1. Log a job, then trigger **Log this job** on the same job again.
2. Expect the amber "You already logged this job on YYYY-MM-DD" banner, and the
   button now reads **Save anyway**.
3. Esc → no row. Save anyway → duplicate row appended.

## 8. Token expiry and re-auth

1. Revoke access at <https://myaccount.google.com/permissions>, or just wait an
   hour for the access token to expire.
2. Log a job. For a plain expiry the save should go through silently — the
   stale token is dropped and refreshed on the 401. For a full revocation a
   consent window opens, and the row saves after you approve.
3. Dismiss the consent window instead. Expect the row to be queued, not lost.

## 9. Missing optional fields

1. Find a job with no salary and no industry listed.
2. Trigger a log. Expect both blank (not guessed), highlighted amber with
   "couldn't auto-detect", and focus on the first missing field. Saving writes
   the blanks as-is.

## 10. Sheet verification

1. Point the options page at an **empty** tab → Connect. Expect "header row
   written" and A1:O1 filled in.
2. Point at a tab with a **different** header → Connect. Expect the mismatch
   warning listing expected vs. found, and no change to the sheet.

## 11. School subdomain

1. Use your school's subdomain (`myschool.joinhandshake.com`) rather than
   `app.joinhandshake.com`.
2. Expect the floating button to appear and everything above to work.

## 12. Formula injection

1. Log a job with Notes set to `=1+2`.
2. Expect the cell to read `=1+2` as literal text (stored as `'=1+2`), not `3`.

## 13. Posted-date sanity

1. Find a job whose posted date shows as a bare month and day ("Jul 5") rather
   than a relative "3 days ago".
2. Expect the current year, not 2001. This is the case `npm test` covers, worth
   one real-page confirmation.

## 14. Quota and permission errors

Hard to trigger for real. To simulate: point the options page at a sheet you
can't edit, save a row, and expect it to queue with the badge showing and the
error visible on the options page. Restore the real ID and hit "Retry now" —
the row should save, which also exercises the
retry-after-reconfiguration path.
