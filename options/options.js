const U = globalThis.GHOSTED;
const $ = (id) => document.getElementById(id);

const CHECKBOXES = ["autoCapture", "remindersEnabled", "needsSponsorship", "showSponsorshipChip"];
const NUMBERS = ["followUpDays", "ghostAfterDays"];
const TABLE_LIMIT = 200;

const ask = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);

let applications = [];

async function loadSettings() {
  const s = await chrome.storage.sync.get(U.DEFAULT_SETTINGS);
  $("sheetUrl").value = s.spreadsheetId;
  $("sheetName").value = s.sheetName;
  $("roleOptions").value = s.roleOptions.join(", ");
  for (const id of CHECKBOXES) $(id).checked = Boolean(s[id]);
  for (const id of NUMBERS) $(id).value = s[id];
}

// Keeps a blank or nonsense number from silently disabling reminders.
function readNumber(id) {
  const el = $(id);
  const n = parseInt(el.value, 10);
  if (!Number.isFinite(n) || n < Number(el.min || 1)) return U.DEFAULT_SETTINGS[id];
  return Math.min(n, Number(el.max || 365));
}

async function saveSettings() {
  const rawSheet = $("sheetUrl").value.trim();
  const spreadsheetId = U.parseSpreadsheetId(rawSheet);
  if (rawSheet && !spreadsheetId) {
    setStatus("saveStatus", "Couldn't parse a spreadsheet ID from that value", "err");
    return false;
  }

  const roleOptions = $("roleOptions")
    .value.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const next = {
    spreadsheetId,
    sheetName: $("sheetName").value.trim() || "Sheet1",
    roleOptions: roleOptions.length ? roleOptions : U.DEFAULT_SETTINGS.roleOptions,
  };
  for (const id of CHECKBOXES) next[id] = $(id).checked;
  for (const id of NUMBERS) next[id] = readNumber(id);

  await chrome.storage.sync.set(next);

  if (spreadsheetId) $("sheetUrl").value = spreadsheetId;
  for (const id of NUMBERS) $(id).value = next[id];
  setStatus("saveStatus", "Saved ✓", "ok");
  return true;
}

function setStatus(id, text, kind) {
  const el = $(id);
  el.textContent = text;
  el.className = "status" + (kind ? ` ${kind}` : "");
}

function showHeaderResult(resp) {
  const warn = $("headerWarning");
  warn.hidden = true;

  if (!resp) {
    setStatus("connectStatus", "No response from background worker", "err");
  } else if (!resp.ok) {
    setStatus("connectStatus", resp.error || "Failed", "err");
  } else if (resp.header === "written") {
    setStatus("connectStatus", "Connected ✓ — header row written to empty tab", "ok");
  } else if (resp.header === "upgraded") {
    setStatus("connectStatus", "Connected ✓ — added the new columns", "ok");
    warn.hidden = false;
    warn.className = "note";
    warn.textContent = `Added to your header row: ${(resp.added || []).join(", ")}. Existing rows are untouched.`;
  } else if (resp.header === "mismatch") {
    setStatus("connectStatus", "Connected, but headers don't match", "err");
    warn.hidden = false;
    warn.className = "warning";
    warn.textContent =
      "⚠ The tab's header row doesn't match the expected schema. Nothing was overwritten. " +
      `Expected: ${U.COLUMNS.join(" | ")}. Found: ${(resp.existing || []).join(" | ") || "(empty cells)"}. ` +
      "Fix the sheet headers (or point at a different tab) so appended rows line up.";
  } else {
    setStatus("connectStatus", "Connected ✓ — sheet headers verified", "ok");
  }
}

async function refreshQueue() {
  const resp = await ask({ type: "getQueue" });
  $("queueCount").textContent = resp?.count ?? "?";

  const err = $("queueError");
  if (resp?.lastError) {
    err.hidden = false;
    err.textContent = `Last error: ${resp.lastError}`;
  } else {
    err.hidden = true;
  }
}

function statusSelect(app) {
  const sel = document.createElement("select");
  for (const opt of U.STATUS_OPTIONS) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    sel.appendChild(o);
  }
  sel.value = U.STATUS_OPTIONS.includes(app.Status) ? app.Status : "Applied";
  sel.addEventListener("change", async () => {
    await ask({ type: "updateApplication", id: app.id, changes: { Status: sel.value } });
    app.Status = sel.value;
  });
  return sel;
}

function renderApplications() {
  const tbody = $("appRows");
  tbody.textContent = "";

  $("appCount").textContent = applications.length ? `(${applications.length})` : "";
  $("appEmpty").hidden = applications.length > 0;
  $("appTableWrap").hidden = applications.length === 0;

  const shown = applications.slice(0, TABLE_LIMIT);
  $("appTruncated").hidden = applications.length <= TABLE_LIMIT;
  $("appTruncated").textContent =
    `Showing the ${TABLE_LIMIT} most recent of ${applications.length}. Export to see everything.`;

  for (const app of shown) {
    const tr = document.createElement("tr");

    const cell = (text) => {
      const td = document.createElement("td");
      td.textContent = text || "—";
      return td;
    };

    tr.append(cell(app["Date Applied"]), cell(app.Position), cell(app.Company));

    const sponsor = cell(app.Sponsorship);
    if (U.isSponsorshipBlocker(app.Sponsorship)) sponsor.className = "bad";
    else if (app.Sponsorship === "Sponsors") sponsor.className = "good";
    tr.appendChild(sponsor);

    const statusTd = document.createElement("td");
    statusTd.appendChild(statusSelect(app));
    tr.appendChild(statusTd);

    const delTd = document.createElement("td");
    const del = document.createElement("button");
    del.className = "linkish";
    del.textContent = "✕";
    del.title = "Delete this row from the local log";
    del.addEventListener("click", async () => {
      await ask({ type: "deleteApplication", id: app.id });
      applications = applications.filter((a) => a.id !== app.id);
      renderApplications();
    });
    delTd.appendChild(del);
    tr.appendChild(delTd);

    tbody.appendChild(tr);
  }
}

async function refreshApplications() {
  const resp = await ask({ type: "getApplications" });
  applications = resp?.applications || [];
  renderApplications();

  const note = $("sheetAuthority");
  note.hidden = !resp?.sheetConnected;
  note.textContent =
    "A sheet is connected, so the popup's stats come from it. Status changes made " +
    "here only affect this local log — edit the sheet to change what the stats say.";
}

function download(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // Revoking immediately can cancel the download in some builds.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

$("csvBtn").addEventListener("click", () => {
  if (!applications.length) {
    setStatus("exportStatus", "Nothing to export yet", "err");
    return;
  }
  download(`ghosted-${U.todayISO()}.csv`, U.toCSV(applications), "text/csv;charset=utf-8");
  setStatus("exportStatus", `Exported ${applications.length} row(s) ✓`, "ok");
});

$("tsvBtn").addEventListener("click", async () => {
  if (!applications.length) {
    setStatus("exportStatus", "Nothing to export yet", "err");
    return;
  }
  try {
    await navigator.clipboard.writeText(U.toTSV(applications));
    setStatus("exportStatus", "Copied — paste into any spreadsheet ✓", "ok");
  } catch {
    setStatus("exportStatus", "Clipboard blocked — use Download CSV instead", "err");
  }
});

$("clearBtn").addEventListener("click", async () => {
  // No confirm() here: it blocks the extension page and there's no undo prompt
  // worth trusting, so require a second deliberate click instead.
  const btn = $("clearBtn");
  if (btn.dataset.armed !== "1") {
    btn.dataset.armed = "1";
    btn.textContent = "Click again to permanently delete";
    setStatus("clearStatus", `${applications.length} row(s) will be deleted`, "err");
    setTimeout(() => {
      btn.dataset.armed = "";
      btn.textContent = "Delete all local applications";
      setStatus("clearStatus", "");
    }, 5000);
    return;
  }

  await ask({ type: "clearApplications" });
  btn.dataset.armed = "";
  btn.textContent = "Delete all local applications";
  setStatus("clearStatus", "Local log cleared", "ok");
  refreshApplications();
});

$("saveBtn").addEventListener("click", saveSettings);

$("connectBtn").addEventListener("click", async () => {
  if (!(await saveSettings())) return;
  if (!$("sheetUrl").value.trim()) {
    setStatus("connectStatus", "Add a spreadsheet URL first", "err");
    return;
  }
  setStatus("connectStatus", "Connecting…");
  const resp = await chrome.runtime
    .sendMessage({ type: "connectGoogle" })
    .catch((e) => ({ ok: false, error: e.message }));
  showHeaderResult(resp);
  refreshApplications();
});

$("retryBtn").addEventListener("click", async () => {
  await ask({ type: "retryQueue" });
  refreshQueue();
});

loadSettings();
refreshQueue();
refreshApplications();
