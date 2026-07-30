const U = globalThis.GHOSTED;
const $ = (id) => document.getElementById(id);

const CHECKBOXES = ["autoCapture", "remindersEnabled", "needsSponsorship", "showSponsorshipChip"];
const NUMBERS = ["followUpDays", "ghostAfterDays"];

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
  const resp = await chrome.runtime.sendMessage({ type: "getQueue" }).catch(() => null);
  $("queueCount").textContent = resp?.count ?? "?";

  const err = $("queueError");
  if (resp?.lastError) {
    err.hidden = false;
    err.textContent = `Last error: ${resp.lastError}`;
  } else {
    err.hidden = true;
  }
}

$("saveBtn").addEventListener("click", saveSettings);

$("connectBtn").addEventListener("click", async () => {
  if (!(await saveSettings())) return;
  setStatus("connectStatus", "Connecting…");
  const resp = await chrome.runtime
    .sendMessage({ type: "connectGoogle" })
    .catch((e) => ({ ok: false, error: e.message }));
  showHeaderResult(resp);
});

$("retryBtn").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "retryQueue" }).catch(() => null);
  refreshQueue();
});

loadSettings();
refreshQueue();
