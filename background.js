// Owns the OAuth token, every Sheets call, the retry queue, reminders and the
// badge. Content scripts never touch a token.
importScripts("shared/utils.js");
const U = globalThis.GHOSTED;

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const RETRY_ALARM = "ghosted-retry";
const FOLLOWUP_ALARM = "ghosted-followup";
const FOLLOWUP_NOTIFICATION = "ghosted-followup-note";

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
    `${SHEETS_BASE}/${settings.spreadsheetId}/values/` +
    `${rangeFor(settings.sheetName, `A:${U.LAST_COLUMN}`)}:append` +
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

async function writeHeader(settings, columns, startIndex, interactive) {
  const from = U.columnLetter(startIndex);
  const to = U.columnLetter(startIndex + columns.length - 1);
  const url =
    `${SHEETS_BASE}/${settings.spreadsheetId}/values/` +
    `${rangeFor(settings.sheetName, `${from}1:${to}1`)}?valueInputOption=RAW`;

  return sheetsFetch(
    url,
    { method: "PUT", body: JSON.stringify({ majorDimension: "ROWS", values: [columns] }) },
    { interactive }
  );
}

// Writes the header if the tab is empty, adds the newer columns if the sheet
// was created by an older version, reports a mismatch otherwise. Never
// overwrites a header cell that already has something in it.
async function verifySheet({ interactive = true } = {}) {
  const settings = await getSettings();
  if (!settings.spreadsheetId) return { ok: false, error: "No spreadsheet configured" };

  const getUrl = `${SHEETS_BASE}/${settings.spreadsheetId}/values/${rangeFor(settings.sheetName, "1:1")}`;
  const resp = await sheetsFetch(getUrl, {}, { interactive });
  if (!resp.ok) {
    return { ok: false, error: `Sheets API ${resp.status}: ${(await errorDetail(resp)) || resp.statusText}` };
  }

  const existing = ((await resp.json()).values?.[0] || []).map((h) => (h || "").trim());

  if (existing.length === 0) {
    const write = await writeHeader(settings, U.COLUMNS, 0, interactive);
    if (!write.ok) return { ok: false, error: `Failed to write header row (${write.status})` };
    return { ok: true, header: "written" };
  }

  const isPrefix = existing.every((h, i) => h === U.COLUMNS[i]);

  if (isPrefix && existing.length === U.COLUMNS.length) return { ok: true, header: "ok" };

  if (isPrefix && existing.length < U.COLUMNS.length) {
    const missing = U.COLUMNS.slice(existing.length);
    const write = await writeHeader(settings, missing, existing.length, interactive);
    if (!write.ok) return { ok: false, error: `Failed to add new columns (${write.status})` };
    return { ok: true, header: "upgraded", added: missing };
  }

  return { ok: true, header: "mismatch", existing };
}

// Pulls the whole sheet back to compute stats. One call, data rows only.
async function readStats({ interactive = false } = {}) {
  const settings = await getSettings();
  if (!settings.spreadsheetId) return { ok: false, error: "No spreadsheet configured" };

  const url =
    `${SHEETS_BASE}/${settings.spreadsheetId}/values/` +
    `${rangeFor(settings.sheetName, `A2:${U.LAST_COLUMN}`)}`;
  const resp = await sheetsFetch(url, {}, { interactive });
  if (!resp.ok) {
    return { ok: false, error: `Sheets API ${resp.status}: ${(await errorDetail(resp)) || resp.statusText}` };
  }

  const rows = ((await resp.json()).values || []).map(U.valuesToRow);
  return { ok: true, stats: U.summarize(rows, settings) };
}

async function checkDuplicate(jobId) {
  if (!jobId) return { duplicate: false };
  const logged = await getLocal("loggedJobs", {});
  return logged[jobId] ? { duplicate: true, date: logged[jobId] } : { duplicate: false };
}

const companyKey = (company) => String(company || "").trim().toLowerCase();

async function companyCount(company) {
  const key = companyKey(company);
  if (!key) return 0;
  const counts = await getLocal("companyCounts", {});
  return counts[key] || 0;
}

async function recordLogged(jobId, company) {
  if (jobId) {
    const logged = await getLocal("loggedJobs", {});
    logged[jobId] = U.todayISO();
    await chrome.storage.local.set({ loggedJobs: U.pruneLoggedJobs(logged) });
  }

  const key = companyKey(company);
  if (key) {
    const counts = await getLocal("companyCounts", {});
    counts[key] = (counts[key] || 0) + 1;
    await chrome.storage.local.set({ companyCounts: counts });
  }
}

async function updateBadge() {
  const queue = await getLocal("queue", []);
  await chrome.action.setBadgeText({ text: queue.length ? String(queue.length) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#b07d00" });
}

async function enqueue(row, jobId, company) {
  const queue = await getLocal("queue", []);
  queue.push({ row, jobId, company, attempts: 0, nextAt: Date.now(), queuedAt: Date.now() });
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
      await recordLogged(item.jobId, item.company);
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

// Once a day, count applications sitting past their follow-up date and say so.
// Silent on any failure — a background nudge isn't worth an error popup.
async function checkFollowUps() {
  const settings = await getSettings();
  if (!settings.remindersEnabled || !settings.spreadsheetId) return;

  const result = await readStats({ interactive: false }).catch(() => null);
  if (!result?.ok) return;

  const { needsFollowUp, ghosted } = result.stats;
  if (needsFollowUp < 1) return;

  const noun = needsFollowUp === 1 ? "application" : "applications";
  chrome.notifications.create(FOLLOWUP_NOTIFICATION, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: `${needsFollowUp} ${noun} to follow up on`,
    message:
      ghosted > 0
        ? `${ghosted} have gone quiet past ${settings.ghostAfterDays} days. Click to open your sheet.`
        : "Click to open your sheet.",
    priority: 0,
  });
}

async function openSheet() {
  const settings = await getSettings();
  const url = U.sheetUrl(settings.spreadsheetId);
  if (url) await chrome.tabs.create({ url });
  return { ok: Boolean(url) };
}

chrome.notifications.onClicked.addListener((id) => {
  if (id === FOLLOWUP_NOTIFICATION) {
    openSheet();
    chrome.notifications.clear(id);
  }
});

function scheduleAlarms() {
  updateBadge();
  getLocal("queue", []).then((q) => {
    if (q.length) chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 });
  });
  // Daily, first run an hour after the worker wakes so it isn't the very first
  // thing a new install does.
  chrome.alarms.create(FOLLOWUP_ALARM, { delayInMinutes: 60, periodInMinutes: 1440 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) processQueue();
  else if (alarm.name === FOLLOWUP_ALARM) checkFollowUps();
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
  scheduleAlarms();
});

chrome.runtime.onStartup.addListener(scheduleAlarms);

function openOverlayInTab(tabId) {
  chrome.tabs.sendMessage(tabId, { type: "openLogOverlay" }).catch(() => {});
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "ghosted-log" && tab?.id) openOverlayInTab(tab.id);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "log-job") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) openOverlayInTab(tab.id);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case "jobContext": {
        const dup = await checkDuplicate(msg.jobId);
        return { ...dup, companyCount: await companyCount(msg.company) };
      }

      case "logJob": {
        if (!msg.force) {
          const dup = await checkDuplicate(msg.jobId);
          if (dup.duplicate) return { ok: false, duplicate: true, date: dup.date };
        }
        try {
          // User pressed save, so an auth prompt here is expected.
          await appendRow(msg.row, { interactive: true });
          await recordLogged(msg.jobId, msg.company);
          return { ok: true };
        } catch (e) {
          // Queue on *any* failure. Losing a row the user already filled in is
          // worse than a delayed write.
          await enqueue(msg.row, msg.jobId, msg.company);
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

      case "getStats":
        try {
          return await readStats({ interactive: false });
        } catch (e) {
          return { ok: false, error: e.message };
        }

      case "openSheet":
        return openSheet();

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
