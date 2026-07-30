// Background service worker. Owns all Google OAuth tokens and Sheets API
// calls — content scripts never see a token. Also owns the offline retry
// queue, the dedupe cache, the toolbar badge, and the context menu.
importScripts("shared/utils.js");
const U = globalThis.HS2S;

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const RETRY_ALARM = "hs2s-retry";

// ── Settings / storage helpers ──────────────────────────────────────────
function getSettings() {
  return chrome.storage.sync.get(U.DEFAULT_SETTINGS);
}

async function getLocal(key, fallback) {
  const o = await chrome.storage.local.get({ [key]: fallback });
  return o[key];
}

// ── Auth ────────────────────────────────────────────────────────────────
function getToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || "No auth token"));
      } else {
        resolve(token);
      }
    });
  });
}

function removeCachedToken(token) {
  return new Promise((resolve) => chrome.identity.removeCachedAuthToken({ token }, resolve));
}

// Fetch against the Sheets API with automatic 401 → invalidate → retry once.
async function sheetsFetch(url, options = {}, { interactive = false } = {}) {
  let token = await getToken(interactive);
  const doFetch = (t) =>
    fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    });

  let resp = await doFetch(token);
  if (resp.status === 401) {
    await removeCachedToken(token);
    token = await getToken(interactive);
    resp = await doFetch(token);
  }
  return resp;
}

// ── Sheets operations ───────────────────────────────────────────────────
function rangeFor(sheetName, cells) {
  return encodeURIComponent(`'${sheetName.replace(/'/g, "''")}'!${cells}`);
}

async function appendRow(row, { interactive = false } = {}) {
  const settings = await getSettings();
  if (!settings.spreadsheetId) {
    const err = new Error("No spreadsheet configured — open the extension options");
    err.retryable = true; // succeeds once the user configures it
    throw err;
  }
  const url =
    `${SHEETS_BASE}/${settings.spreadsheetId}/values/${rangeFor(settings.sheetName, "A:O")}:append` +
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const resp = await sheetsFetch(
    url,
    { method: "POST", body: JSON.stringify({ majorDimension: "ROWS", values: [U.rowToValues(row)] }) },
    { interactive }
  );

  if (!resp.ok) {
    let detail = "";
    try {
      detail = (await resp.json())?.error?.message || "";
    } catch { /* non-JSON error body */ }
    const err = new Error(`Sheets API ${resp.status}: ${detail || resp.statusText}`);
    // 429 (quota) and 5xx are transient; 4xx config errors still get queued
    // by the caller so the row is never lost, but retry slower.
    err.retryable = resp.status === 429 || resp.status >= 500;
    throw err;
  }
}

// Read the header row; write it if the tab is empty; report a mismatch
// (without overwriting) if headers exist but differ from the schema.
async function verifySheet({ interactive = true } = {}) {
  const settings = await getSettings();
  if (!settings.spreadsheetId) return { ok: false, error: "No spreadsheet configured" };

  const getUrl = `${SHEETS_BASE}/${settings.spreadsheetId}/values/${rangeFor(settings.sheetName, "1:1")}`;
  const resp = await sheetsFetch(getUrl, {}, { interactive });
  if (!resp.ok) {
    const detail = (await resp.json().catch(() => null))?.error?.message || resp.statusText;
    return { ok: false, error: `Sheets API ${resp.status}: ${detail}` };
  }

  const existing = (await resp.json()).values?.[0] || [];
  if (existing.length === 0) {
    const putUrl =
      `${SHEETS_BASE}/${settings.spreadsheetId}/values/${rangeFor(settings.sheetName, "A1:O1")}` +
      `?valueInputOption=RAW`;
    const writeResp = await sheetsFetch(
      putUrl,
      { method: "PUT", body: JSON.stringify({ majorDimension: "ROWS", values: [U.COLUMNS] }) },
      { interactive }
    );
    if (!writeResp.ok) return { ok: false, error: `Failed to write header row (${writeResp.status})` };
    return { ok: true, header: "written" };
  }

  const matches =
    existing.length >= U.COLUMNS.length &&
    U.COLUMNS.every((col, i) => (existing[i] || "").trim() === col);
  return matches ? { ok: true, header: "ok" } : { ok: true, header: "mismatch", existing };
}

// ── Dedupe cache ────────────────────────────────────────────────────────
async function checkDuplicate(jobId) {
  if (!jobId) return { duplicate: false };
  const logged = await getLocal("loggedJobs", {});
  return logged[jobId] ? { duplicate: true, date: logged[jobId] } : { duplicate: false };
}

async function recordLogged(jobId) {
  if (!jobId) return;
  const logged = await getLocal("loggedJobs", {});
  logged[jobId] = U.todayISO();
  await chrome.storage.local.set({ loggedJobs: logged });
}

// ── Retry queue ─────────────────────────────────────────────────────────
async function updateBadge() {
  const queue = await getLocal("queue", []);
  await chrome.action.setBadgeText({ text: queue.length ? String(queue.length) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#b07d00" });
}

async function enqueue(row, jobId) {
  const queue = await getLocal("queue", []);
  queue.push({ row, jobId, attempts: 0, nextAt: Date.now(), queuedAt: Date.now() });
  await chrome.storage.local.set({ queue });
  await updateBadge();
  await chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 });
}

async function processQueue({ ignoreBackoff = false } = {}) {
  const queue = await getLocal("queue", []);
  if (queue.length === 0) {
    await chrome.alarms.clear(RETRY_ALARM);
    await updateBadge();
    return { remaining: 0 };
  }

  const now = Date.now();
  const remaining = [];
  for (const item of queue) {
    if (!ignoreBackoff && item.nextAt > now) {
      remaining.push(item);
      continue;
    }
    try {
      await appendRow(item.row);
      await recordLogged(item.jobId);
    } catch (e) {
      item.attempts += 1;
      // Exponential backoff: 1, 2, 4, … capped at 60 minutes.
      const delayMin = Math.min(60, 2 ** item.attempts);
      item.nextAt = Date.now() + delayMin * 60_000;
      item.lastError = e.message;
      remaining.push(item);
    }
  }

  await chrome.storage.local.set({ queue: remaining });
  await updateBadge();
  if (remaining.length === 0) await chrome.alarms.clear(RETRY_ALARM);
  return { remaining: remaining.length };
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) processQueue();
});

// ── Lifecycle: context menu, badge, resume retries ──────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "hs2s-log",
    title: "Log this job to Google Sheet",
    contexts: ["page"],
    documentUrlPatterns: [
      "https://*.joinhandshake.com/*",
      "https://*.joinhandshake.co.uk/*",
      "https://*.joinhandshake.de/*",
    ],
  });
  updateBadge();
  getLocal("queue", []).then((q) => {
    if (q.length) chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 });
  });
});

chrome.runtime.onStartup.addListener(() => {
  updateBadge();
  getLocal("queue", []).then((q) => {
    if (q.length) chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "hs2s-log" && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "openLogOverlay" }).catch(() => {});
  }
});

// ── Message router ──────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case "checkDuplicate":
        return checkDuplicate(msg.jobId);

      case "logJob": {
        if (!msg.force) {
          const dup = await checkDuplicate(msg.jobId);
          if (dup.duplicate) return { ok: false, duplicate: true, date: dup.date };
        }
        try {
          // Saving is user-initiated, so an interactive auth prompt is OK here.
          await appendRow(msg.row, { interactive: true });
          await recordLogged(msg.jobId);
          return { ok: true };
        } catch (e) {
          // Never lose an entry: queue on any failure and retry on a timer.
          await enqueue(msg.row, msg.jobId);
          return { ok: false, queued: true, error: e.message };
        }
      }

      case "connectGoogle": {
        try {
          await getToken(true);
          return await verifySheet({ interactive: true });
        } catch (e) {
          return { ok: false, error: e.message };
        }
      }

      case "verifySheet":
        try {
          return await verifySheet({ interactive: true });
        } catch (e) {
          return { ok: false, error: e.message };
        }

      case "retryQueue":
        return processQueue({ ignoreBackoff: true });

      case "getQueue": {
        const queue = await getLocal("queue", []);
        return { count: queue.length, lastError: queue[0]?.lastError || null };
      }

      default:
        return { error: `Unknown message type: ${msg?.type}` };
    }
  })().then(sendResponse);
  return true; // async response
});
