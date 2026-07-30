// Owns the OAuth token, every Sheets call, the retry queue and the badge.
// Content scripts never touch a token.
importScripts("shared/utils.js");
const U = globalThis.GHOSTED;

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const RETRY_ALARM = "ghosted-retry";

function getSettings() {
  return chrome.storage.sync.get(U.DEFAULT_SETTINGS);
}

async function getLocal(key, fallback) {
  const o = await chrome.storage.local.get({ [key]: fallback });
  return o[key];
}

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

// Access tokens last an hour, so a 401 usually just means "stale" — drop it
// and retry once before bothering the user.
async function sheetsFetch(url, options = {}, { interactive = false } = {}) {
  let token = await getToken(interactive);
  const doFetch = (t) =>
    fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${t}`,
        "Content-Type": "application/json",
      },
    });

  let resp = await doFetch(token);
  if (resp.status === 401) {
    await removeCachedToken(token);
    token = await getToken(interactive);
    resp = await doFetch(token);
  }
  return resp;
}

// Sheet names can contain spaces and quotes; both need escaping in an A1 range.
function rangeFor(sheetName, cells) {
  return encodeURIComponent(`'${sheetName.replace(/'/g, "''")}'!${cells}`);
}

async function errorDetail(resp) {
  try {
    return (await resp.json())?.error?.message || "";
  } catch {
    return "";
  }
}

async function appendRow(row, { interactive = false } = {}) {
  const settings = await getSettings();
  if (!settings.spreadsheetId) {
    const err = new Error("No spreadsheet configured — open the extension options");
    err.retryable = true;
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
    const detail = await errorDetail(resp);
    const err = new Error(`Sheets API ${resp.status}: ${detail || resp.statusText}`);
    err.retryable = resp.status === 429 || resp.status >= 500;
    throw err;
  }
}

// Writes the header if the tab is empty, reports a mismatch otherwise. Never
// overwrites an existing header row.
async function verifySheet({ interactive = true } = {}) {
  const settings = await getSettings();
  if (!settings.spreadsheetId) return { ok: false, error: "No spreadsheet configured" };

  const getUrl = `${SHEETS_BASE}/${settings.spreadsheetId}/values/${rangeFor(settings.sheetName, "1:1")}`;
  const resp = await sheetsFetch(getUrl, {}, { interactive });
  if (!resp.ok) {
    return { ok: false, error: `Sheets API ${resp.status}: ${(await errorDetail(resp)) || resp.statusText}` };
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

async function checkDuplicate(jobId) {
  if (!jobId) return { duplicate: false };
  const logged = await getLocal("loggedJobs", {});
  return logged[jobId] ? { duplicate: true, date: logged[jobId] } : { duplicate: false };
}

async function recordLogged(jobId) {
  if (!jobId) return;
  const logged = await getLocal("loggedJobs", {});
  logged[jobId] = U.todayISO();
  await chrome.storage.local.set({ loggedJobs: U.pruneLoggedJobs(logged) });
}

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
      item.nextAt = Date.now() + Math.min(60, 2 ** item.attempts) * 60_000;
      item.lastError = e.message;
      remaining.push(item);
    }
  }

  await chrome.storage.local.set({ queue: remaining });
  await updateBadge();
  if (remaining.length === 0) await chrome.alarms.clear(RETRY_ALARM);
  return { remaining: remaining.length };
}

function resumeRetries() {
  updateBadge();
  getLocal("queue", []).then((q) => {
    if (q.length) chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 });
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) processQueue();
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "ghosted-log",
    title: "Log this job to Google Sheet",
    contexts: ["page"],
    documentUrlPatterns: [
      "https://*.joinhandshake.com/*",
      "https://*.joinhandshake.co.uk/*",
      "https://*.joinhandshake.de/*",
    ],
  });
  resumeRetries();
});

chrome.runtime.onStartup.addListener(resumeRetries);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "ghosted-log" && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "openLogOverlay" }).catch(() => {});
  }
});

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
          // User pressed save, so an auth prompt here is expected.
          await appendRow(msg.row, { interactive: true });
          await recordLogged(msg.jobId);
          return { ok: true };
        } catch (e) {
          // Queue on *any* failure. Losing a row the user already filled in is
          // worse than a delayed write.
          await enqueue(msg.row, msg.jobId);
          return { ok: false, queued: true, error: e.message };
        }
      }

      case "connectGoogle":
        try {
          await getToken(true);
          return await verifySheet({ interactive: true });
        } catch (e) {
          return { ok: false, error: e.message };
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
  return true;
});
