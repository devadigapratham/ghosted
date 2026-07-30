# Architecture

## Shape

Ghosted has no server. Each user's data lives in their own browser profile and,
optionally, in a spreadsheet they own, reached with an OAuth client they created.

There is nothing to sign into because there is nothing to sign into to. That one
decision determines most of what follows, including the cost of running it.

## Components

```
┌─────────────────────────── the user's browser ───────────────────────────┐
│                                                                          │
│  Handshake tab                        Extension                          │
│  ┌────────────────────┐               ┌──────────────────────────────┐   │
│  │ urlwatch.js        │  MAIN world   │ background.js  (worker)      │   │
│  │  patches pushState │──────────────▶│  • owns the OAuth token      │   │
│  ├────────────────────┤   DOM event   │  • all Sheets API calls      │   │
│  │ content.js         │──────────────▶│  • retry queue + backoff     │   │
│  │  • detect submit   │  sendMessage  │  • dedupe cache              │   │
│  │  • scrape job      │               │  • daily follow-up alarm     │   │
│  │  • work-auth scan  │◀──────────────│  • badge, notifications      │   │
│  │  • confirm overlay │               └───────┬──────────────────────┘   │
│  └────────────────────┘                       │                          │
│    isolated world,                            │ chrome.storage.local     │
│    never holds a token                        ▼                          │
│                                        ┌──────────────────┐              │
│  app/ (dashboard, own tab)             │ applications[]   │ ← source of  │
│  ┌────────────────────┐  sendMessage   │ queue[]          │   truth      │
│  │ views, charts,     │◀──────────────▶│ loggedJobs{}     │              │
│  │ table, settings    │                └──────────────────┘              │
│  └────────────────────┘                       │                          │
└───────────────────────────────────────────────┼──────────────────────────┘
                                                │ HTTPS, the user's token
                                                ▼
                                   ┌────────────────────────────┐
                                   │ Google Sheets API          │
                                   │ the user's own spreadsheet │
                                   │ (optional mirror)          │
                                   └────────────────────────────┘
```

`shared/utils.js` loads in all three contexts — content script, worker,
dashboard — and holds every pure function: schema, date parsing, the
work-authorization classifier, sanitization, CSV/TSV, stats. It performs no I/O,
which is why the unit tests need no browser and no network.

## Trust boundaries

1. **Page ↔ content script.** `content.js` runs in the isolated world, so page
   scripts cannot reach it. `urlwatch.js` is the only code in the MAIN world and
   passes no data: it dispatches a bare DOM event, and the listener reads
   `location.href` itself.
2. **Content script ↔ worker.** Only the worker touches OAuth tokens. Code
   running on a third-party page never holds a credential, which is why saving
   goes through `sendMessage` rather than calling the Sheets API directly.
3. **Extension ↔ Google.** The only scope requested is `spreadsheets`. Without a
   Drive scope the extension cannot enumerate or read any other file.

Scraped text is sanitized before it is written anywhere. A leading `=`, `+`, `-`
or `@` gets an apostrophe, so a hostile job title cannot inject a formula into a
sheet or into a CSV opened in Excel.

## Per-user isolation

"No login" is not the same claim as "no auth".

| Concern | Mechanism |
|---|---|
| Whose data is this | The user's own browser profile. Chrome scopes extension storage per profile and per OS account. |
| Can one user read another's | No shared store exists. There is no query that could return another person's row. |
| Who authorizes sheet writes | The user, to Google, via `chrome.identity`. The token is issued to their account for their spreadsheet. |
| Where credentials live | The browser's token cache, held only by the service worker. Never in the repo, never on a server, never in a content script. |
| Blast radius of a bug | One spreadsheet. Not a table containing many people's immigration status. |

A conventional accounts system would replace a structural property — no shared
store to leak — with an invariant that has to hold on every query indefinitely.

## Cost at scale

| Component | Cost at 100k users | Why |
|---|---|---|
| Extension runtime | $0 | Executes on the user's machine. |
| Local storage | $0 | ~600 bytes/row, capped at 2000 rows (~1.2 MB), inside Chrome's ~10 MB budget. |
| Landing page, hosted dashboard | $0 | Static assets, ~200 KB total. Vercel's free tier allows 100 GB/month. |
| Sheets mirror | $0 | Requests go from the user's browser to Google with the user's token. No traffic transits project infrastructure. |
| Database | $0 | There is none. |

**The one real ceiling** is Google's Sheets API quota, which is per Cloud
project at roughly 300 requests/minute. Because each user currently creates
their own Cloud project, each user gets their own quota. The setup friction is
also what makes the quota scale linearly.

A single shared OAuth client — the arrangement a Web Store release would use —
puts every install on one project's quota. At 100k users averaging ~5
applications/day, roughly 500k daily writes concentrated in a 12-hour window is
about 700 requests/minute, over the ceiling. That path needs a quota increase
plus OAuth verification, since the `spreadsheets` scope is classified sensitive
and is capped at 100 users until verified.

The local-first core has no equivalent ceiling; it issues no API calls.

## If accounts are ever added

Cross-device sync with logins requires an auth provider and a database. Free
tiers do not survive 100k users, so the realistic floor is roughly $25–100+
per month, growing with signups.

The data is unusually sensitive — who requires visa sponsorship, which employers
rejected them, immigration status by implication. Storing it for others makes the
operator a data controller: privacy policy, a lawful basis under GDPR, export and
deletion on request, breach notification.

Three options, cheapest first:

1. **Stay local-first.** Cross-device today is export/import, or connecting a
   sheet — which is already cross-device sync, with Google operating the server
   and the user owning the data.
2. **End-to-end encrypted sync.** A blob store holding ciphertext; the key is
   derived from a passphrase that never leaves the device. Much smaller
   liability, but key recovery is a hard UX problem.
3. **Accounts and Postgres.** Standard and well understood; the most expensive on
   every axis above. Justified only by features that genuinely require a server —
   shared boards, or sponsorship data aggregated across users.

Option 3 has one strong argument: aggregate sponsorship reporting ("of 4,000
people who applied here, 12 report sponsorship") needs other users' data by
definition. That is a different product from a personal tracker and belongs
behind an explicit, anonymized opt-in rather than arriving as a side effect of
adding login.

## Storage seam

`app/` reaches storage through one narrow interface instead of calling `chrome.*`
inline:

```
getRows()      setStatus(row, status)   deleteRow(row)
getSettings()  saveSettings(patch)      importRows(rows)
```

Two implementations sit behind it: the extension (worker messages →
`chrome.storage` → optional Sheets) and the web build (`localStorage` plus file
import). An authenticated `FetchSource` would be a third, and no view or chart
code above the seam would change.
