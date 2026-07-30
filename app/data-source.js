// One narrow interface over storage, so the dashboard runs unchanged in the
// extension and on a plain web host.
//
//   extension → worker messages → chrome.storage → optional Google Sheets
//   web       → localStorage + file import
//
// Views and charts never touch chrome.* or localStorage directly.
(() => {
  const U = globalThis.GHOSTED;
  const isExtension = Boolean(globalThis.chrome?.runtime?.id);

  // Extension
  function extensionSource() {
    const ask = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);

    return {
      env: "extension",
      can: { sheets: true, capture: true, reminders: true, queue: true, notifications: true },

      getRows: () => ask({ type: "getRows" }),
      setStatus: (row, status, source) =>
        ask({ type: "setStatus", source, rowNumber: row._rowNumber, id: row.id, status }),
      deleteRow: (row) => ask({ type: "deleteApplication", id: row.id }),
      restoreRow: (row) => ask({ type: "restoreApplication", row }),
      importRows: (rows) => ask({ type: "importApplications", rows }),
      clearAll: () => ask({ type: "clearApplications" }),

      getSettings: () => chrome.storage.sync.get(U.DEFAULT_SETTINGS),
      saveSettings: (patch) => chrome.storage.sync.set(patch),

      getTheme: () => chrome.storage.local.get({ theme: "" }).then((o) => o.theme),
      setTheme: (theme) => chrome.storage.local.set({ theme }),

      getQueue: () => ask({ type: "getQueue" }),
      connectGoogle: () => ask({ type: "connectGoogle" }),
      openSheet: () => ask({ type: "openSheet" }),
      retryQueue: () => ask({ type: "retryQueue" }),
    };
  }

  // Web
  function webSource() {
    const KEY = { apps: "ghosted.applications", settings: "ghosted.settings", theme: "ghosted.theme" };

    const readApps = () => {
      try {
        const raw = localStorage.getItem(KEY.apps);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
      } catch {
        return [];
      }
    };

    const writeApps = (list) => {
      try {
        localStorage.setItem(KEY.apps, JSON.stringify(list));
      } catch {
        // Quota or private-mode failure. Nothing useful to do from here; the
        // caller re-reads and will simply show the previous state.
      }
    };

    // crypto.randomUUID needs a secure context, which file:// isn't.
    const newId = () =>
      globalThis.crypto?.randomUUID?.() ??
      `id-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;

    return {
      env: "web",
      can: { sheets: false, capture: false, reminders: false, queue: false, notifications: false },

      getRows: async () => ({ ok: true, source: "local", rows: U.sortApplications(readApps()) }),

      setStatus: async (row, status) => {
        const apps = readApps();
        const hit = apps.find((a) => a.id === row.id);
        if (!hit) return { ok: false, error: "Not found" };
        hit.Status = status;
        writeApps(apps);
        return { ok: true };
      },

      deleteRow: async (row) => {
        writeApps(readApps().filter((a) => a.id !== row.id));
        return { ok: true };
      },

      restoreRow: async (row) => {
        const apps = readApps();
        if (!apps.some((a) => a.id === row.id)) apps.push(row);
        writeApps(apps);
        return { ok: true };
      },

      importRows: async (rows) => {
        const stamped = rows.map((r) => ({ ...r, id: newId(), savedAt: Date.now(), synced: false }));
        const { merged, added, skipped } = U.mergeApplications(readApps(), stamped);
        writeApps(merged.slice(-U.APPLICATIONS_MAX));
        return { ok: true, added, skipped };
      },

      clearAll: async () => {
        writeApps([]);
        return { ok: true };
      },

      getSettings: async () => {
        try {
          return { ...U.DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY.settings) || "{}") };
        } catch {
          return { ...U.DEFAULT_SETTINGS };
        }
      },

      saveSettings: async (patch) => {
        const next = { ...(await webSourceSettings()), ...patch };
        try {
          localStorage.setItem(KEY.settings, JSON.stringify(next));
        } catch { /* ignore */ }
      },

      getTheme: async () => {
        try {
          return localStorage.getItem(KEY.theme) || "";
        } catch {
          return "";
        }
      },

      setTheme: async (theme) => {
        try {
          localStorage.setItem(KEY.theme, theme);
        } catch { /* ignore */ }
      },

      getQueue: async () => ({ count: 0 }),
      connectGoogle: async () => ({ ok: false, error: "Sheets sync needs the extension" }),
      openSheet: async () => ({ ok: false }),
      retryQueue: async () => ({ remaining: 0 }),
    };

    async function webSourceSettings() {
      try {
        return { ...U.DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY.settings) || "{}") };
      } catch {
        return { ...U.DEFAULT_SETTINGS };
      }
    }
  }

  globalThis.GHOSTED_DATA = isExtension ? extensionSource() : webSource();
})();
