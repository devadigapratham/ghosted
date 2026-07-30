# Manual test plan

For the parts that need a real browser and a real Handshake page. Pure logic is
covered by `npm test` (334 tests) and the dashboard by the browser suite
(50 tests, `npm run serve` then `/test/browser.html`). Run both before working
through this.

Before starting: extension loaded. Most of this needs no Google account —
applications are saved locally either way. The ones that need a connected sheet
say so: 11, 24, 28, 30, 34.

Worker logs are at `chrome://extensions` → the card → **service worker**.
Content script logs show up in the normal page DevTools console.

Suggested order — cheapest and most reversible first: 4 (manual triggers), 18
(local mode), 17 (dashboard), 6 (sponsorship), 12 (other boards), 19 (import),
23 (export), 32 (formula injection), 26 (offline queue), 27 (duplicates), then 1,
3 and 13 which need real applications, and 28 last since it revokes access.

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

Mentioning a résumé is not the same as attaching one.

1. Open an apply modal that has a résumé step but don't attach anything.
   Trigger the overlay. Expect **Résumé upload? = No**.
2. Attach or select a résumé, then trigger it. Expect **Yes**.
3. Open a job with no résumé step at all. Expect the field **blank**.

## 6. Sponsorship detection (international students)

The most consequential feature, and the one most likely to misread a real
posting.

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
2. Point Settings at it and hit Connect. Expect "added the new columns", headers
   P1:V1 filled in, and the existing data row untouched.
3. Hit Connect again. Expect plain "headers verified" and no further writes.

## 12. Other boards and other sites

1. Open a posting on Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable,
   LinkedIn and Indeed in turn. Expect the floating button on each, and the
   overlay to name the board (e.g. "Greenhouse · 4099887").
2. Expect **Source** to record the board name.
3. Open a company's own careers page, one not in the registry. Expect no floating
   button, but **＋ Log this job** in the toolbar popup (or ⌘/Ctrl+Shift+L) to
   still open the overlay, with Source set to the hostname.
4. Press the popup button twice on the same page. Expect one overlay, not two —
   the content script guards against being injected twice.
5. Open a **search or list** page: LinkedIn `/jobs/search/`, a Greenhouse board
   index, `/careers`. Expect **no** floating button. Logging a list page would
   save a row with the search path as its id.

## 13. Applying through LinkedIn

1. Find a LinkedIn posting with **Easy Apply** and complete it. Expect the overlay
   when "Your application was sent to …" appears. This exact wording used to go
   undetected.
2. Find one with **Apply on company website** and click through. Expect the
   overlay on the LinkedIn tab, Notes set to "External application".
3. Now finish that application on the destination site (Greenhouse, Workday) and
   let it confirm. Expect the overlay to warn that you already logged this role
   **from a different site**, rather than silently writing a second row.
4. Save anyway. Expect two rows, deliberately, with different Source values.

## 14. Cover letter and résumé evidence

The point is that mentioning something is not attaching it.

1. Open an apply modal with a cover-letter step and leave it empty. Expect
   **Cover Letter = No**.
2. Type a few sentences into it. Expect **Yes**.
3. Open a job with no cover-letter step at all. Expect the field **blank**.
4. Repeat all three for résumé upload.

## 15. Update check

1. Settings → Updates → **Check now**. Expect "Up to date (x.y.z)".
2. Temporarily lower `version` in your local `manifest.json`, reload the
   extension, and check again. Expect "Version x.y.z is available", a banner
   across the top of the dashboard, and one desktop notification. Clicking it
   opens the repo.
3. Check again. Expect no second notification for the same version.
4. Untick the setting and check that the daily alarm stops notifying. **Check
   now** should still work, since it's explicit.
5. Go offline and check. Expect a readable error, not a hang.

## 16. Demo mode

1. Open `/app?demo=1` on the hosted build. Expect a banner saying nothing is
   saved, ~26 sample applications, and the Import button hidden.
2. Change a status and delete a row. Expect both to work.
3. Reload. Expect the sample data back exactly as before, and your own data in
   `/app` untouched.

## 17. The dashboard

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

## 18. Local mode, no Google account

The default path. Run this with the sheet fields left blank.

1. Fresh install, no sheet configured. Log a job. Expect a plain "✓ Saved"
   toast, no auth prompt, and no error.
2. Dashboard → **All jobs**. Expect the row listed with its date, position,
   company and sponsorship verdict.
3. Change its Status dropdown to "Rejected". Expect the dashboard numbers to
   update without a reload.
4. Delete a row with the ✕ button. Expect it gone from the table and the totals.
5. Popup with no sheet configured: expect stats to still work.

## 19. Import

1. Export a CSV, delete a row, then import that CSV back. Expect the deleted row
   to return and the rest to be reported as already present.
2. Import the same file twice. Expect the second run to add 0 and skip all.
3. Set a status by hand, then re-import a CSV containing that row with a
   different status. Expect your value to survive — import never overwrites.
4. Import a sheet with the columns rearranged and lowercased headers. Expect it
   to load anyway.
5. Import a file with no recognizable headers. Expect a clear error and no rows
   added.
6. Import a JSON backup. Expect the same behaviour as CSV.

## 20. Undo delete

1. Delete a row from All jobs. Expect it to vanish, the totals to update, and an
   undo bar to appear naming the row.
2. Click **Undo**. Expect the row back.
3. Delete another and wait ~8 seconds. Expect the bar to disappear on its own,
   with the row still deleted.
4. On a fresh reload, expect no undo bar visible.

## 21. Keyboard shortcuts

1. Press <kbd>?</kbd>. Expect the shortcut list; <kbd>?</kbd> or Esc closes it.
2. <kbd>/</kbd> focuses search. Typing "g" into the box must type a letter, not
   navigate.
3. <kbd>g</kbd> then <kbd>j</kbd> goes to All jobs; <kbd>g</kbd> <kbd>a</kbd> to
   Needs attention.
4. <kbd>r</kbd> reloads the data.

## 22. Hosted dashboard

1. `npm run serve`, open `http://localhost:8731/`. Expect the landing page.
2. Open `/app/app.html`. Expect the dashboard, the badge reading "stored in this
   browser", and Settings to hide the Sheets, Capture and Follow-ups sections.
3. Import a CSV exported from the extension. Expect the dashboard to populate.
4. Change a status, reload the page. Expect it to persist.
5. Confirm the extension's own copy is untouched — the two stores are separate.

## 23. Export

1. **Download CSV** with a few rows logged. Expect a `ghosted-YYYY-MM-DD.csv`
   file whose first line is the 22 column headers.
2. Open it in Sheets or Excel. Expect columns to line up, a value containing a
   comma (a "Seattle, WA" location) to stay in one cell, and a Notes value of
   `=1+2` to display as text rather than computing to 3.
3. **Copy for spreadsheet**, then paste into a blank Google Sheet. Expect it to
   split across columns without an import dialog.
4. Both buttons with nothing logged. Expect "Nothing to export yet", not an
   empty file.
5. Confirm no `id`, `savedAt` or `synced` column appears in either export.

## 24. Nothing is lost when the sheet fails (needs a sheet)

Verifies that saving locally first actually protects the row.

1. Connect a sheet, then break it — change the tab name in Options to one that
   doesn't exist.
2. Log a job. Expect "✓ Saved — sheet sync will retry", the badge to appear, and
   the row to be present in Options → Your applications.
3. Fix the tab name, hit **Retry now**. Expect the row to reach the sheet and
   the badge to clear, with no duplicate in the local log.

## 25. Delete-all guard

1. Click **Delete all local applications** once. Expect the button to change to
   "Click again to permanently delete" and nothing to be deleted.
2. Wait six seconds. Expect it to reset itself.
3. Click twice in quick succession. Expect the log to be cleared.

## 26. Offline queue

1. Open the overlay, then go offline (DevTools → Network → Offline, or turn off
   Wi-Fi).
2. Press Enter. Expect: "Saved offline — will retry" toast, badge shows **1**,
   options page shows 1 row waiting.
3. Go back online. Within ~2 minutes, or immediately via popup → "Retry queued
   rows now", the row appears and the badge clears.

## 27. Duplicates

1. Log a job, then trigger **Log this job** on the same job again.
2. Expect the amber "You already logged this job on YYYY-MM-DD" banner, and the
   button now reads **Save anyway**.
3. Esc → no row. Save anyway → duplicate row appended.

## 28. Token expiry and re-auth (needs a sheet)

1. Revoke access at <https://myaccount.google.com/permissions>, or just wait an
   hour for the access token to expire.
2. Log a job. For a plain expiry the save should go through silently — the
   stale token is dropped and refreshed on the 401. For a full revocation a
   consent window opens, and the row saves after you approve.
3. Dismiss the consent window instead. Expect the row to be queued, not lost.

## 29. Missing optional fields

1. Find a job with no salary and no industry listed.
2. Trigger a log. Expect both blank (not guessed), highlighted amber with
   "couldn't auto-detect", and focus on the first missing field. Saving writes
   the blanks as-is.

## 30. Sheet verification (needs a sheet)

1. Point Settings at an **empty** tab → Connect. Expect "header row written" and
   A1:V1 filled in.
2. Point at a tab with a **different** header → Connect. Expect the mismatch
   warning listing expected vs. found, and no change to the sheet.

## 31. School subdomain

1. Use your school's subdomain (`myschool.joinhandshake.com`) rather than
   `app.joinhandshake.com`.
2. Expect the floating button to appear and everything above to work.

## 32. Formula injection

1. Log a job with Notes set to `=1+2`.
2. Expect the cell to read `=1+2` as literal text (stored as `'=1+2`), not `3`.

## 33. Posted-date sanity

1. Find a job whose posted date shows as a bare month and day ("Jul 5") rather
   than a relative "3 days ago".
2. Expect the current year, not 2001. This is the case `npm test` covers, worth
   one real-page confirmation.

## 34. Quota and permission errors (needs a sheet)

Hard to trigger for real. To simulate: point the options page at a sheet you
can't edit, save a row, and expect it to queue with the badge showing and the
error visible on the options page. Restore the real ID and hit "Retry now" —
the row should save, which also exercises the
retry-after-reconfiguration path.
