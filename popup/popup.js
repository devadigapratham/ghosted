const $ = (id) => document.getElementById(id);
const HANDSHAKE = /^https:\/\/[^/]*joinhandshake\.(com|co\.uk|de)\//;

const ask = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);

async function refreshQueue() {
  const resp = await ask({ type: "getQueue" });
  const count = resp?.count ?? 0;
  const info = $("queueInfo");
  info.textContent = count === 1 ? "1 row waiting to save" : `${count} rows waiting to save`;
  info.classList.toggle("has", count > 0);
  $("retryBtn").hidden = count === 0;
}

async function refreshStats() {
  const resp = await ask({ type: "getStats" });

  if (!resp?.ok) {
    // Not configured yet, or offline. Don't shout about it in a popup.
    $("statsNote").hidden = false;
    $("statsNote").textContent = resp?.error
      ? "Stats unavailable — check Options."
      : "Connect a sheet in Options to see stats.";
    return;
  }

  const s = resp.stats;
  $("sTotal").textContent = s.total;
  $("sWeek").textContent = s.thisWeek;
  $("sInterviews").textContent = s.interviews + s.offers;
  $("sGhosted").textContent = s.ghosted;
  $("stats").hidden = false;

  $("statsNote").hidden = false;
  $("statsNote").textContent = s.total
    ? `${s.responseRate}% heard back · ${s.open} still open`
    : "No applications logged yet.";

  if (s.needsFollowUp > 0) {
    $("nudge").hidden = false;
    $("nudge").textContent =
      s.needsFollowUp === 1
        ? "1 application is due a follow-up."
        : `${s.needsFollowUp} applications are due a follow-up.`;
  }
}

$("logBtn").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // tab.url is only readable because of the activeTab permission, which Chrome
  // grants for this tab the moment the user clicks the toolbar icon.
  if (!tab?.id || !HANDSHAKE.test(tab.url || "")) {
    $("logBtn").textContent = "Open a Handshake page first";
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "openLogOverlay" });
    window.close();
  } catch {
    // No content script listening — the tab predates the last extension reload.
    $("logBtn").textContent = "Reload the Handshake tab first";
  }
});

$("retryBtn").addEventListener("click", async () => {
  await ask({ type: "retryQueue" });
  refreshQueue();
});

$("sheetBtn").addEventListener("click", async () => {
  const resp = await ask({ type: "openSheet" });
  if (resp?.ok) window.close();
  else $("sheetBtn").textContent = "No sheet configured yet";
});

$("optionsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());

refreshQueue();
refreshStats();
