# Manual test plan

For the parts that need a real browser. The pure logic is covered by
`npm test`.

Before starting: extension loaded. Most of this needs no Google account —
applications are saved locally either way. The ones that need a connected sheet
say so: 11, 15, 19, 21, 25.

Worker logs are at `chrome://extensions` → the card → **service worker**.
Content script logs show up in the normal page DevTools console.

Suggested order — cheapest and most reversible first: 4 (manual triggers), 13
(local mode), 12 (dashboard), 6 (sponsorship), 14 (export), 23 (formula
injection), 17 (offline queue), 18 (duplicates), then 1 and 3 which need real
applications, and 19 last since it revokes access.

## 1. Native apply

1. Open a job with a normal **Apply** button and finish the application.
2. Expect: when "Application submitted" appears, the overlay opens pre-filled.
   Date Applied is today, Status is "Applied", Latest word is "Application
   submitted YYYY-MM-DD". If the modal had a cover-letter step, that dropdown
   is "Yes".
3. Fill Role, press **Enter**. Expect a "✓ Saved" toast ("✓ Saved to Google
   Sheet" if you've connected one) and a correctly ordered row.
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

## 6. Sponsorship detection (international students)

The feature that matters most, and the one most likely to be wrong on a real
posting. Worth spending ten minutes on.

1. With "I need visa sponsorship" on, open a job whose description says it won't
   sponsor. Expect a red **⚠ No sponsorship** badge above the floating button.
   Click it — expect the matched sentence in the tooltip, and the badge to
   dismiss.
2. Trigger the overlay on that job. Expect a red banner quoting the sentence,
   and **Sponsorship = No sponsorship** in the form.
3. Open a job requiring citizenship or a clearance. Expect **Citizens/PR only**.
4. Open a job that explicitly sponsors. Expect a green **✓ Sponsors visas**
   badge and a blue banner.
5. Open a job that says nothing about it. Expect a grey **? Sponsorship
   unclear** badge and no banner. Unclear must never read as good news.
6. Turn off "I need visa sponsorship" in Options. Expect the badge and banners
   to stop appearing, while the Sponsorship column still gets filled in.
7. Turn off "Show the sponsorship badge" but leave sponsorship needed on. Expect
   no badge, but the overlay banner still appears.

If a verdict is wrong, copy the sentence from the posting into a new case in
`test/utils.test.js` and adjust `WORK_AUTH_RULES` in `shared/utils.js` until it
passes.

## 7. Deadline and job type

1. Open a job with an "Apply by" date. Expect **Deadline** filled with that date
   in YYYY-MM-DD, and the year to be right — a bare "Aug 15" in December means
   next year, not this one.
2. Open an internship and a full-time posting. Expect **Job Type** to be
   "Internship" and "Full-time" respectively.
3. Open a job with no deadline. Expect Deadline blank, not a guess.

## 8. Stats and follow-ups

Works against the local log or a sheet — whichever is authoritative.

1. With a few rows logged, open the popup. Expect the four tiles (Applied,
   This week, Interviews, Ghosted) and a line reading "N% heard back · N still
   open".
2. Change a row's Status to "Rejected" (in the sheet if connected, otherwise via
   Options → Your applications), reopen the popup. Expect the response rate to
   move.
3. Backdate a row's Date Applied by more than the ghost threshold, leaving
   Status at Applied. Expect the Ghosted tile to count it.
4. Backdate a row's Follow-up On to yesterday. Expect the popup nudge, and
   within a day the desktop notification.
5. Set that row's Status to Rejected. Expect it to drop out of the follow-up
   count — closed applications don't get chased.

## 9. Company repeat warning

1. Log two jobs at the same company.
2. On the second, expect the overlay to say "This is application #2 to
   <company>".

## 10. Keyboard shortcut

1. On a job page press ⌘/Ctrl+Shift+L. Expect the overlay.
2. Check `chrome://extensions/shortcuts` if it doesn't fire — another extension
   may already own that combination.

## 11. Schema migration (needs a sheet)

1. Make a tab with only the original 15 headers (A–O) and a data row.
2. Point Options at it and hit Connect. Expect "added the new columns", headers
   P1:U1 filled in, and the existing data row untouched.
3. Hit Connect again. Expect plain "headers verified" and no further writes.

## 12. The dashboard

Open it from the popup → **Open dashboard**, or right-click the icon → Options.

1. With nothing logged, expect the "Nothing logged yet" empty state and no
   count pills in the sidebar.
2. With rows logged, expect five KPI tiles, and the numbers to agree with the
   popup's.
3. **Applications per week**: the axis labels must be legible (this chart is
   generated at its container's pixel width — if it looks blurry or shrunken,
   the sizing regressed). Hover a column, expect a tooltip naming the week and
   count. Resize the window and expect it to redraw crisply, not stretch.
4. **Where they stand**: one bar per status, all the same colour, each labelled
   with its count.
5. **Sponsorship**: blocker rows in red, others gray, each with a glyph (✕ / ? /
   ✓) as well as the colour. Check it in both light and dark.
6. **Pipeline**: change a status on a card. Expect the card to move column and
   the dashboard numbers to update. With a sheet connected, check the cell
   actually changed in the sheet.
7. **All jobs**: search, each filter, and clicking a column header to sort both
   ways. Position should link out to the posting.
8. **Deadlines**: overdue entries first and marked.
9. Theme toggle (◐) — flip it, reload, expect the choice to stick.
10. Charts must not rely on colour alone: every bar carries a label and a value,
    and every value also appears in the All jobs table.

## 13. Local mode, no Google account

The default path, and the one most people will use. Do this with the sheet
fields in Options left blank.

1. Fresh install, no sheet configured. Log a job. Expect a plain "✓ Saved"
   toast, no auth prompt, and no error.
2. Dashboard → **All jobs**. Expect the row listed with its date, position,
   company and sponsorship verdict.
3. Change its Status dropdown to "Rejected". Expect the dashboard numbers to
   update without a reload.
4. Delete a row with the ✕ button. Expect it gone from the table and the totals.
5. Popup with no sheet configured: expect stats to still work.

## 14. Export

1. **Download CSV** with a few rows logged. Expect a `ghosted-YYYY-MM-DD.csv`
   file whose first line is the 21 column headers.
2. Open it in Sheets or Excel. Expect columns to line up, a value containing a
   comma (a "Seattle, WA" location) to stay in one cell, and a Notes value of
   `=1+2` to display as text rather than computing to 3.
3. **Copy for spreadsheet**, then paste into a blank Google Sheet. Expect it to
   split across columns without an import dialog.
4. Both buttons with nothing logged. Expect "Nothing to export yet", not an
   empty file.
5. Confirm no `id`, `savedAt` or `synced` column appears in either export.

## 15. Nothing is lost when the sheet fails (needs a sheet)

The point of saving locally first.

1. Connect a sheet, then break it — change the tab name in Options to one that
   doesn't exist.
2. Log a job. Expect "✓ Saved — sheet sync will retry", the badge to appear, and
   the row to be present in Options → Your applications.
3. Fix the tab name, hit **Retry now**. Expect the row to reach the sheet and
   the badge to clear, with no duplicate in the local log.

## 16. Delete-all guard

1. Click **Delete all local applications** once. Expect the button to change to
   "Click again to permanently delete" and nothing to be deleted.
2. Wait six seconds. Expect it to reset itself.
3. Click twice in quick succession. Expect the log to be cleared.

## 17. Offline queue

1. Open the overlay, then go offline (DevTools → Network → Offline, or turn off
   Wi-Fi).
2. Press Enter. Expect: "Saved offline — will retry" toast, badge shows **1**,
   options page shows 1 row waiting.
3. Go back online. Within ~2 minutes, or immediately via popup → "Retry queued
   rows now", the row appears and the badge clears.

## 18. Duplicates

1. Log a job, then trigger **Log this job** on the same job again.
2. Expect the amber "You already logged this job on YYYY-MM-DD" banner, and the
   button now reads **Save anyway**.
3. Esc → no row. Save anyway → duplicate row appended.

## 19. Token expiry and re-auth (needs a sheet)

1. Revoke access at <https://myaccount.google.com/permissions>, or just wait an
   hour for the access token to expire.
2. Log a job. For a plain expiry the save should go through silently — the
   stale token is dropped and refreshed on the 401. For a full revocation a
   consent window opens, and the row saves after you approve.
3. Dismiss the consent window instead. Expect the row to be queued, not lost.

## 20. Missing optional fields

1. Find a job with no salary and no industry listed.
2. Trigger a log. Expect both blank (not guessed), highlighted amber with
   "couldn't auto-detect", and focus on the first missing field. Saving writes
   the blanks as-is.

## 21. Sheet verification (needs a sheet)

1. Point the options page at an **empty** tab → Connect. Expect "header row
   written" and A1:U1 filled in.
2. Point at a tab with a **different** header → Connect. Expect the mismatch
   warning listing expected vs. found, and no change to the sheet.

## 22. School subdomain

1. Use your school's subdomain (`myschool.joinhandshake.com`) rather than
   `app.joinhandshake.com`.
2. Expect the floating button to appear and everything above to work.

## 23. Formula injection

1. Log a job with Notes set to `=1+2`.
2. Expect the cell to read `=1+2` as literal text (stored as `'=1+2`), not `3`.

## 24. Posted-date sanity

1. Find a job whose posted date shows as a bare month and day ("Jul 5") rather
   than a relative "3 days ago".
2. Expect the current year, not 2001. This is the case `npm test` covers, worth
   one real-page confirmation.

## 25. Quota and permission errors (needs a sheet)

Hard to trigger for real. To simulate: point the options page at a sheet you
can't edit, save a row, and expect it to queue with the badge showing and the
error visible on the options page. Restore the real ID and hit "Retry now" —
the row should save, which also exercises the
retry-after-reconfiguration path.
