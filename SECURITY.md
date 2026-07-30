# Security

## Reporting

Open an issue at <https://github.com/devadigapratham/ghosted/issues>. There is no
server and no user database, so the blast radius of any bug is one person's own
browser profile and their own spreadsheet.

## Threat model

Ghosted holds sensitive data: which employers rejected you, and by implication
your visa or immigration status. It runs code on pages controlled by other
people. Two things follow.

**Untrusted inputs.** Anything read from a job page or an imported file is
attacker-controlled and treated that way:

- Scraped text is sanitized before it is written anywhere. A leading `=`, `+`,
  `-` or `@` is prefixed with an apostrophe, so a hostile job title cannot inject
  a formula into a spreadsheet or into a CSV opened in Excel.
- `Job URL` is only kept when it parses as `http` or `https`. This is checked on
  import and again when a link is rendered. The check inspects the parsed
  protocol rather than pattern-matching the string, because the URL parser strips
  tabs and newlines first, so `java<TAB>script:alert(1)` would defeat a regex.
- The description window fed to the work-authorization classifier is bounded, so
  a very long posting cannot make the scan expensive.
- Worker message payloads are narrowed to the schema before storage, status
  values are checked against a fixed list, and A1 row references must be
  integers in range.
- The UI is built with `createElement` and `textContent`. There is no
  `innerHTML`, `eval`, `document.write`, or `new Function` anywhere.

**Credential isolation.** OAuth tokens are held only by the service worker.
Content scripts run on third-party pages and never see a token, which is why
saving goes through `sendMessage` instead of calling the Sheets API directly.
The only scope requested is `spreadsheets`; without a Drive scope the extension
cannot enumerate or read any other file.

## Boundaries

| Boundary | Control |
|---|---|
| Page → content script | Isolated world. `urlwatch.js` is the only MAIN-world code and passes no data; it dispatches a bare event and the listener reads `location.href` itself. |
| Content script → worker | Only the worker touches tokens. Payloads are narrowed to the schema on arrival. |
| Web page → extension | No `externally_connectable` and no `web_accessible_resources`, so pages cannot message the extension or load its files. |
| Extension → Google | Hardcoded API origin, `spreadsheets` scope only, spreadsheet id re-validated before it reaches a request URL. |
| Hosted build | Static files, no backend. Content-Security-Policy restricts everything to same-origin, with `object-src 'none'` and `base-uri 'none'`. |

## Permissions, and why each is needed

| Permission | Reason |
|---|---|
| `storage` | The local application log and settings. |
| `identity` | Google sign-in for the optional Sheets mirror. |
| `alarms` | The retry queue and the daily follow-up check. |
| `notifications` | The follow-up reminder. |
| `contextMenus` | Right-click to log a job. |
| `activeTab` | Lets the popup read the current tab's URL, only when you click the icon. |
| `scripting` | Injects the content script into the current tab when you press "Log this job" on a site the manifest does not match. Scoped by `activeTab`, so it only ever reaches the one tab you invoked it on, and only on that click. |
| `host_permissions: sheets.googleapis.com` | The Sheets mirror, if you connect one. |
| `host_permissions: raw.githubusercontent.com` | One daily fetch of the repo's public `manifest.json` to compare version numbers, so a folder install can tell you it is out of date. No request body and no identifiers; switch it off under Settings → Updates. |
| `content_scripts.matches` | The job boards listed in the README. The content script reads those pages to find job details; it does not modify them beyond its own button and overlay, and does not run anywhere else. |

## Known limitations

- **Local data is not encrypted at rest.** It sits in `chrome.storage.local`, or
  in `localStorage` for the hosted build. Anyone with access to your unlocked
  machine and browser profile can read it. Encrypting it would need a passphrase
  on every launch, which is the wrong trade for this data.
- **The pinned key means every install shares one extension ID.** That is
  deliberate, so a single OAuth client works across machines. Two different forks
  installed at once would collide.
- **Selectors for boards other than Handshake are lightly exercised.** The
  failure mode is a blank field flagged in the overlay, not incorrect data.
- **On-demand injection reaches whatever tab you invoke it on.** Pressing "Log
  this job" on an unmatched site injects the content script there under
  `activeTab`. That is a deliberate trade: a button you press, rather than
  standing permission to read every site you visit.
- **The update check is a network call.** It is anonymous and to a public file,
  but it does reveal to GitHub that someone somewhere runs this extension. Turn
  it off if that matters to you.
