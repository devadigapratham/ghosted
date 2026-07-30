const $ = (id) => document.getElementById(id);
const HANDSHAKE = /^https:\/\/[^/]*joinhandshake\.(com|co\.uk|de)\//;

async function refreshQueue() {
  const resp = await chrome.runtime.sendMessage({ type: "getQueue" }).catch(() => null);
  const count = resp?.count ?? 0;
  const info = $("queueInfo");
  info.textContent = count === 1 ? "1 row waiting to save" : `${count} rows waiting to save`;
  info.classList.toggle("has", count > 0);
  $("retryBtn").hidden = count === 0;
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
  await chrome.runtime.sendMessage({ type: "retryQueue" }).catch(() => null);
  refreshQueue();
});

$("optionsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());

refreshQueue();
