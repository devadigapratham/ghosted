const $ = (id) => document.getElementById(id);
const HANDSHAKE = /^https:\/\/[^/]*joinhandshake\.(com|co\.uk|de)\//;

const ask = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);

async function refreshQueue() {
  const resp = await ask({ type: "getQueue" });
  const count = resp?.count ?? 0;
  const info = $("queueInfo");
  // Rows are already saved locally; the queue is only the sheet mirror.
  info.textContent = count === 0
    ? "All rows saved"
    : count === 1
      ? "1 row waiting to sync to your sheet"
      : `${count} rows waiting to sync to your sheet`;
  info.classList.toggle("has", count > 0);
  $("retryBtn").hidden = count === 0;
}

async function refreshStats() {
  const resp = await ask({ type: "getStats" });

  if (!resp?.ok) {
    $("statsNote").hidden = false;
    $("statsNote").textContent = "Stats unavailable — check Options.";
    return;
  }

  const s = resp.stats;
  $("sTotal").textContent = s.total;
  $("sWeek").textContent = s.thisWeek;
  $("sInterviews").textContent = s.interviews + s.offers;
  $("sGhosted").textContent = s.ghosted;
  $("stats").hidden = false;

  $("statsNote").hidden = false;
  if (!s.total) {
    $("statsNote").textContent = "No applications logged yet.";
  } else {
    const where = resp.stale ? " · sheet unreachable, showing local" : "";
    $("statsNote").textContent = `${s.responseRate}% heard back · ${s.open} still open${where}`;
  }

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
    // No content script listening; the tab predates the last extension reload.
    $("logBtn").textContent = "Reload the Handshake tab first";
  }
});

$("retryBtn").addEventListener("click", async () => {
  await ask({ type: "retryQueue" });
  refreshQueue();
});

// The dashboard is the main surface; the popup is just a launcher for it.
$("appBtn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

refreshQueue();
refreshStats();
