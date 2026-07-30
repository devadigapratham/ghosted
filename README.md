# Handshake → Google Sheets Job Application Tracker

A Chrome extension (Manifest V3) that logs every job you apply to on
[Handshake](https://joinhandshake.com) into a Google Sheet. When you submit an
application (or click an external-apply link), it scrapes the job details,
shows a quick confirmation popup for the manual fields, and appends one row to
your sheet via the Google Sheets API.

## Sheet schema

Rows are appended in this exact column order (A–O):

`Position | Company | Industry | Role | Location | Date Posted | Date Applied | Connections? | Cover Letter | Résumé upload? | Résumé Form? | Salary Range | Notes | Status | Latest word`

On first connect, the extension reads your tab's header row. If the tab is
empty it writes the header for you; if headers exist but don't match, it warns
you in the options page and never overwrites anything.

## Project layout

```
manifest.json          — MV3 manifest (paste your OAuth client ID here)
background.js          — service worker: OAuth, Sheets API, retry queue, badge, context menu
shared/utils.js        — schema, date normalization, sanitization (used by both contexts)
content/urlwatch.js    — MAIN-world script: hooks pushState/replaceState for SPA navigation
content/selectors.js   — ALL Handshake DOM selectors/patterns (edit here when Handshake changes)
content/content.js     — detection, scraping, confirmation overlay, floating button
options/               — options page (sheet config, Google connect, role options, toggles)
popup/                 — toolbar popup (manual log trigger, retry queue status)
icons/                 — generated PNGs (16/32/48/128) — do not hand-edit
tools/make-icons.js    — regenerates icons/ (`npm run icons`), no dependencies
test/utils.test.js     — unit tests for shared/utils.js (`npm test`)
```

---

## One-time setup

### Step 1 — Load the unpacked extension (to get your extension ID)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** (top-left) and select this project folder.
4. The extension card appears. Copy the **ID** shown on the card (a 32-character
   string like `abcdefghijklmnopqrstuvwxyzabcdef`) — you'll need it in Step 2.

> ⚠ The extension ID changes if you move the folder. If you want a stable ID
> across machines, add a `"key"` field to `manifest.json` (Chrome docs:
> "Keep a consistent extension ID").

### Step 2 — Create a Google Cloud project and OAuth client

1. Go to <https://console.cloud.google.com/> and sign in with the Google
   account that owns your tracking spreadsheet.
2. Click the project dropdown (top bar, left of the search box) → **New
   Project**. Name it anything (e.g. "Handshake Tracker") and click **Create**.
   Make sure it's selected.
3. **Enable the Sheets API**: in the left sidebar go to **APIs & Services →
   Library**, search for **Google Sheets API**, open it, click **Enable**.
4. **Configure the consent screen**: **APIs & Services → OAuth consent
   screen**. Choose **External**, click **Create**. Fill in only the required
   fields (app name, your email twice), then **Save and Continue** through the
   remaining screens. On the "Test users" screen, **add your own Google email
   as a test user** — otherwise sign-in will be blocked while the app is in
   "Testing" status.
5. **Create the OAuth client**: **APIs & Services → Credentials → Create
   Credentials → OAuth client ID**.
   - Application type: **Chrome Extension**.
   - Item ID: paste the **extension ID** from Step 1.
   - Click **Create**. A dialog shows your **Client ID** (ends with
     `.apps.googleusercontent.com`). Copy it.

### Step 3 — Paste the client ID into the manifest

Open `manifest.json` and replace the placeholder:

```json
"oauth2": {
  "client_id": "1234567890-xxxxxxxx.apps.googleusercontent.com",
  "scopes": ["https://www.googleapis.com/auth/spreadsheets"]
}
```

Back on `chrome://extensions`, click the **reload** (↻) icon on the extension
card.

### Step 4 — Configure the sheet

1. Click the extension's toolbar icon → **⚙ Options** (or right-click the icon
   → Options).
2. Paste your spreadsheet's **full URL** (the ID is parsed out automatically)
   and the **tab name** (e.g. `Sheet1` or `Applications`).
3. Adjust the **Role dropdown options** and the auto-capture toggle if desired.
4. Click **Connect Google & verify sheet**. A Google sign-in window opens —
   approve the Sheets permission. The status line then reports one of:
   - *headers verified* — you're done;
   - *header row written* — the tab was empty and the schema header was added;
   - *headers don't match* — fix the sheet manually (nothing is overwritten).

---

## Daily use

- **Automatic**: apply to a job on Handshake. When the success confirmation
  appears (or you click an external-apply link), the confirmation overlay pops
  up pre-filled. Fill in Role / Connections? / Résumé Form? / Notes, press
  **Enter** to save or **Esc** to skip. Fields that failed to scrape are
  highlighted in amber.
- **Manual**: use the floating **＋ Log this job** button on any job page, the
  right-click context menu, or the toolbar popup.
- **Offline / errors**: rows that fail to save are queued in
  `chrome.storage.local` and retried automatically with exponential backoff
  (1 → 2 → 4 … capped at 60 minutes). A badge on the toolbar icon shows the
  queue count; you can force a retry from the popup or options page.
- **Duplicates**: each logged Handshake job ID is cached. Logging the same job
  again shows a warning banner in the overlay ("Save anyway").

## Updating selectors when Handshake changes

All DOM selectors and text patterns live in **`content/selectors.js`** — job
title, company, location, salary, posted date, success-toast text, external
apply link text, etc. Each field has an ordered list of strategies (stable
`data-hook`/`data-testid` attributes first, generic fallbacks last), and
`content/content.js` additionally tries `application/ld+json` JobPosting
structured data before touching any CSS selector.

If a field stops scraping:

1. Open a Handshake job page, right-click the value → **Inspect**.
2. Look for a `data-hook` or `data-testid` attribute on or near the element,
   and add it to the **front** of the relevant list in `selectors.js`.
3. Reload the extension and re-test. No other file should need changes.

## Privacy / security notes

- OAuth tokens live only in the background service worker; content scripts
  never see them.
- The only Google scope requested is `spreadsheets` (no Drive access).
- Scraped strings are trimmed and any leading `=` `+` `-` `@` is escaped with
  a `'` before writing, so a malicious job title can't inject a formula into
  your sheet.

## Works with any university

Nothing in the extension is school-specific. The content scripts match
`https://*.joinhandshake.com/*` (which covers `app.joinhandshake.com` and
every school subdomain like `myschool.joinhandshake.com`) plus Handshake's
international domains `joinhandshake.co.uk` and `joinhandshake.de`. The
scraping logic targets Handshake's product DOM, which is the same across
universities.

## Distributing / open-sourcing notes

The one per-user friction point is Google OAuth. `chrome.identity.getAuthToken`
requires an OAuth client whose "Item ID" matches the installed extension's ID,
and unpacked installs get a **different ID on every machine**. Two ways to
distribute:

1. **Developer-style (current default)** — each user follows the README to
   create their own free Google Cloud project + Chrome-extension OAuth client
   and pastes the client ID into `manifest.json`. Client IDs are not secrets,
   but per-user clients mean no shared quota and no verification hassle.
2. **Chrome Web Store (recommended once public)** — publish the extension, which
   gives every install the **same** extension ID. Then the maintainer creates
   one OAuth client for that ID, ships it in `manifest.json`, and users just
   click "Connect Google". Caveats:
   - The `spreadsheets` scope is classified **sensitive**, so the OAuth consent
     screen must go through Google's verification to serve more than 100 users;
     until then it's limited to accounts added as "Test users" and shows an
     "unverified app" warning.
   - If you want a stable extension ID for contributors' unpacked dev installs,
     pin a `"key"` in `manifest.json` (see Chrome docs: "Keep a consistent
     extension ID") so their local builds match the store ID and the shared
     OAuth client works in development too.

Do **not** commit any real spreadsheet IDs; user config lives in
`chrome.storage.sync`, never in the repo.

Licensed under the [MIT License](LICENSE).

## Testing

Unit tests cover the pure logic in `shared/utils.js` — date normalization,
formula-injection escaping, spreadsheet-ID parsing, and column ordering. They
need no dependencies and no network:

```sh
npm test
```

The browser-dependent behavior (scraping, submission detection, OAuth, the
retry queue) is covered by the manual matrix in [TESTPLAN.md](TESTPLAN.md) —
native apply, external apply, offline retry, duplicates, token expiry, missing
fields.

## Regenerating the icons

`icons/*.png` are generated, not hand-drawn. Edit the palette or geometry
constants at the top of `tools/make-icons.js` and run:

```sh
npm run icons
```

The script has no dependencies — it rasterizes the shapes into a supersampled
buffer and writes PNGs using only `node:zlib`.
