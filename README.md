# Ghosted 👻

Logs every job you apply to on Handshake into a Google Sheet, so you know
exactly who ghosted you.

Apply to something on [Handshake](https://joinhandshake.com) and a small
confirmation box pops up with the job details already filled in. Add the two or
three things it can't know (which role bucket, whether you had a connection
there), hit Enter, and it appends a row to your sheet.

## What it does beyond logging

**Tells you about sponsorship before you apply.** If you need a visa, the only
thing that matters on a posting is whether the employer will sponsor one — and
it's always buried in three paragraphs of boilerplate at the bottom. Ghosted
reads the description and puts a badge on the job page: *Sponsors visas*, *No
sponsorship*, *Citizens/PR only*, or *Sponsorship unclear*. Click the badge and
it shows you the exact sentence it matched, so you can judge for yourself. The
answer also lands in the sheet, so you can filter by it later.

It errs toward warning you. A posting that says nothing is "unclear", never a
yes. A clearance or ITAR requirement outranks a cheerful "we sponsor H-1B" blurb
elsewhere on the page, because the restriction is the part that will actually
stop you.

Not applicable to you? Turn off "I need visa sponsorship" in Options and the
warnings disappear. The column still gets filled in.

**Chases your follow-ups.** Every row gets a Follow-up On date (two weeks out by
default). Once a day it counts what's gone quiet and tells you, so applications
don't rot silently in a spreadsheet you stopped opening.

**Shows you the damage.** The popup has running totals: applied, this week,
interviews, ghosted, and what share of applications ever got a reply. Silence
past 21 days counts as ghosted, which is configurable if you're more patient
than that.

**Catches the deadline.** "Apply by" dates get scraped and stored, so a rolling
list of postings has actual dates on it.

## The sheet

One row per application, columns A–U:

`Position | Company | Industry | Role | Location | Date Posted | Date Applied | Connections? | Cover Letter | Résumé upload? | Résumé Form? | Salary Range | Notes | Status | Latest word | Job Type | Sponsorship | Deadline | Follow-up On | Job URL | Job ID`

The first time you connect, it reads row 1 of your tab. Empty tab, and it writes
the header for you. Existing headers that don't match, and it tells you what's
different and refuses to touch anything.

If you have a sheet from an earlier version with just the original 15 columns,
hit **Connect Google & verify sheet** once. It appends the six new headers and
leaves every existing row alone. New columns are only ever added at the end, so
old rows stay lined up.

## Setup

You need a Google Cloud OAuth client to talk to the Sheets API. It's free and
takes about five minutes, but there's no way around it — Google won't hand out
sheet access without one.

### 1. Load the extension

`chrome://extensions` → turn on **Developer mode** (top right) → **Load
unpacked** → pick this folder.

The extension ID is pinned in `manifest.json`, so it's always:

```
lkfokghblcgjphlkjlfpfgcdhpbfdldp
```

That matters because the OAuth client is tied to the ID. Pinning it means you
can move this folder, reinstall, or clone it on another machine without redoing
step 2. If you loaded the extension before this ID was pinned, hit the reload
(↻) icon on the card and check that the ID now matches the string above.

### 2. Make the Google Cloud project

1. Go to <https://console.cloud.google.com/> and sign in with the account that
   owns the spreadsheet.
2. Project dropdown in the top bar → **New Project**. Name it whatever
   ("Ghosted" works). Create it, then make sure it's the selected project.
3. **APIs & Services → Library**, search for **Google Sheets API**, open it,
   click **Enable**.
4. **APIs & Services → OAuth consent screen**. Pick **External** → Create.
   Fill in the app name and your email where required, then save through the
   rest of the screens.
   - On the **Test users** screen, add your own Google address. Skip this and
     sign-in gets blocked, because the app is in "Testing" status.
5. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Chrome Extension**
   - Item ID: `lkfokghblcgjphlkjlfpfgcdhpbfdldp`
   - Create. Copy the **Client ID** it shows you (ends in
     `.apps.googleusercontent.com`).

### 3. Paste the client ID in

In `manifest.json`, replace the placeholder:

```json
"oauth2": {
  "client_id": "1234567890-abcdefg.apps.googleusercontent.com",
  "scopes": ["https://www.googleapis.com/auth/spreadsheets"]
}
```

Then go back to `chrome://extensions` and hit reload (↻) on the card. The
manifest is only read at load time, so skipping the reload means the old
placeholder is still live.

### 4. Point it at your sheet

Click the ghost in the toolbar → **⚙ Options**.

1. Paste your spreadsheet URL (the ID gets parsed out of it) and the tab name,
   e.g. `Sheet1` or `Applications`.
2. Edit the **Role dropdown options** to whatever buckets you actually use.
3. Under **Work authorization**, leave "I need visa sponsorship" on if you do.
   That's what turns on the badge and the pre-apply warnings. Turn it off if
   you don't need sponsorship and you'd rather not see them.
4. Under **Follow-ups**, set how many days of silence before it nudges you
   (default 14) and how many before it calls an application ghosted (default 21).
5. Click **Connect Google & verify sheet**. A Google window opens — approve the
   Sheets permission. You'll see an "unverified app" warning, which is expected
   for a personal OAuth client; continue past it.

The status line then says one of:

- **headers verified** — done, go apply to something.
- **header row written** — the tab was empty, so it wrote the header for you.
- **added the new columns** — your sheet was from an older version; the newer
  headers got appended and existing rows were left alone.
- **headers don't match** — it lists expected vs. found. Fix the sheet by hand;
  nothing was overwritten.

### 5. Check the scraping before you trust it

Worth doing once, and it costs nothing. Open any Handshake job page and click
the floating **＋ Log this job** button. The overlay opens with everything it
managed to scrape. Press **Esc** and nothing is saved anywhere.

Anything highlighted amber is a selector that needs fixing for your school's
Handshake. See "When Handshake changes" below. Try it on three or four
different jobs — one remote, one with no salary listed — before relying on
automatic capture.

## Daily use

**Automatic.** Apply to a job. When the confirmation appears (or you click an
external-apply link), the overlay pops up pre-filled. Fill in Role,
Connections?, Résumé Form?, Notes. Enter saves, Esc skips. Amber fields are
ones it couldn't scrape.

**Manual.** The floating **＋ Log this job** button on any job page,
**⌘/Ctrl+Shift+L**, the right-click menu, or the toolbar popup.

**Keeping it current.** Status is a dropdown — Applied, Online assessment,
Phone screen, Interviewing, Final round, Offer, Rejected, Withdrawn, Ghosted.
Editing it later in the sheet is what makes the stats mean anything, since
"never heard back" is inferred from a row still sitting at Applied.

**Offline.** Rows that fail to save go into a queue in local storage and retry
on their own with backoff (1, 2, 4 … up to an hour). The toolbar badge shows
how many are waiting. You can force a retry from the popup or the options page.
A row you filled in never gets thrown away, even if the save fails.

**Duplicates.** Every logged job ID is remembered for a year. Log the same job
twice and the overlay warns you, with the button changing to "Save anyway". It
also tells you when you're applying to a company for the second or third time,
which is useful right before you write a cover letter about how this is your
dream company.

## When Handshake changes

Everything Handshake-specific is in `content/selectors.js` — job title,
company, location, salary, posted date, deadline, description, the success-toast
wording, the external-apply link text. Each field is an ordered list, most
reliable first. `content/content.js` also checks for `application/ld+json`
JobPosting data before it touches a CSS selector at all.

The sponsorship phrase lists are the exception: they live in `shared/utils.js`
as `WORK_AUTH_RULES`, because they're employer boilerplate rather than anything
to do with Handshake's markup. Add a phrasing you've run into and add a case to
`test/utils.test.js` alongside it.

If a field stops scraping:

1. Open a job page, right-click the value that's missing, **Inspect**.
2. Look for a `data-hook` or `data-testid` on or near the element and add it to
   the **front** of the matching list in `selectors.js`.
3. Reload the extension, then re-test with the ＋ button.

Nothing else should need touching.

## Layout

```
manifest.json          MV3 manifest (paste your OAuth client ID here)
background.js          service worker: OAuth, Sheets calls, retry queue, badge
shared/utils.js        schema, date parsing, sanitization — used by both sides
content/urlwatch.js    MAIN-world script, hooks pushState for SPA navigation
content/selectors.js   every Handshake selector, all in one place
content/content.js     detection, scraping, the confirmation overlay
options/               sheet config, Google connect, role options
popup/                 toolbar popup: manual log, queue status
icons/                 generated, don't hand-edit
tools/make-icons.js    regenerates icons/ (npm run icons)
test/utils.test.js     unit tests (npm test)
```

## Tests

```sh
npm test
```

158 tests over the pure logic in `shared/utils.js`: date normalization,
sponsorship classification, formula escaping, spreadsheet ID parsing, column
ordering, dedupe pruning, stats. No dependencies, no network, no browser.

Everything that needs a real browser — scraping, submission detection, OAuth,
the retry queue — is in [TESTPLAN.md](TESTPLAN.md) as a manual checklist.

## Icons

`icons/*.png` are generated, not drawn. Edit the constants at the top of
`tools/make-icons.js` and run `npm run icons`. It rasterizes the ghost into a
supersampled buffer and writes PNGs using only `node:zlib`.

## Privacy

- OAuth tokens live in the service worker. Content scripts never see one.
- The only scope requested is `spreadsheets`. No Drive access, so it can't see
  any of your other files.
- Job descriptions are scanned in the page for sponsorship language and thrown
  away. Only the verdict is stored, and only in your own sheet. Nothing is sent
  anywhere except Google Sheets.
- Scraped text is trimmed, and a leading `=` `+` `-` `@` gets an apostrophe
  before it's written, so a job title can't inject a formula into your sheet.

## Any university

Nothing here is school-specific. The content scripts match
`https://*.joinhandshake.com/*`, which covers `app.joinhandshake.com` and every
school subdomain, plus `joinhandshake.co.uk` and `joinhandshake.de`. The
scraping targets Handshake's own DOM, which is the same everywhere.

## If you fork this

The friction point is OAuth. `chrome.identity.getAuthToken` needs a client
whose Item ID matches the installed extension.

Because the public key is pinned in `manifest.json`, every unpacked install of
this repo gets the same ID, so one OAuth client works across your machines. A
fork that wants its own identity should generate a new key:

```sh
openssl genrsa -out key.pem 2048
openssl rsa -in key.pem -pubout -outform DER | openssl base64 -A
```

Put that base64 string in the manifest's `key` field. `key.pem` itself is
gitignored and only needed if you ever pack a `.crx` — the `key` field alone is
what fixes the ID.

Publishing to the Chrome Web Store would give everyone the same ID for free,
but the `spreadsheets` scope counts as sensitive, so the consent screen needs
Google's verification before it can serve more than 100 users. Until then it's
test-users-only with an unverified-app warning.

Don't commit a real spreadsheet ID. Your config lives in `chrome.storage.sync`,
never in the repo.

MIT licensed. See [LICENSE](LICENSE).
