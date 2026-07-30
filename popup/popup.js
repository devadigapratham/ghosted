const $ = (id) => document.getElementById(id);

async function refreshQueue() {
  const resp = await chrome.runtime.sendMessage({ type: "getQueue" }).catch(() => null);
  const count = resp?.count ?? 0;
  const info = $("queueInfo");
  info.textContent = `Queue: ${count} pending`;
  info.classList.toggle("has", count > 0);
  $("retryBtn").hidden = count === 0;
}

$("logBtn").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/https:\/\/[^/]*joinhandshake\.(com|co\.uk|de)\//.test(tab.url || "")) {
    $("logBtn").textContent = "Open a Handshake page first";
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "openLogOverlay" });
    window.close();
  } catch {
    $("logBtn").textContent = "Reload the Handshake tab first";
  }
});

$("retryBtn").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "retryQueue" }).catch(() => null);
  refreshQueue();
});

$("optionsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());

refreshQueue();
