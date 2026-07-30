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
  const isDemo = !isExtension && /(^|[?&])demo(=|&|$)/.test(location.search);

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
        if (!U.STATUS_OPTIONS.includes(String(status || "").trim())) {
          return { ok: false, error: "Unknown status" };
        }
        const apps = readApps();
        const hit = apps.find((a) => a.id === row.id);
        if (!hit) return { ok: false, error: "Not found" };
        hit.Status = String(status).trim();
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
        if (!Array.isArray(rows)) return { ok: false, error: "Nothing to import" };
        const stamped = rows.slice(0, U.APPLICATIONS_MAX).map((r) => {
          const clean = {};
          for (const col of U.COLUMNS) clean[col] = U.sanitizeCell(r[col]);
          clean["Job URL"] = U.safeHttpUrl(r["Job URL"]);
          return { ...clean, id: newId(), savedAt: Date.now(), synced: false };
        });
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

  // Demo mode: a browsable sample set held in memory, so the hosted page shows
  // what the tool does without an install and without touching real storage.
  function demoSource() {
    const rows = buildDemoRows();
    let memory = rows;
    let theme = "";

    const nope = async () => ({ ok: false, error: "Not available in the demo" });

    return {
      env: "demo",
      demo: true,
      can: { sheets: false, capture: false, reminders: false, queue: false, notifications: false },

      getRows: async () => ({ ok: true, source: "demo", rows: U.sortApplications(memory) }),

      // Edits work so the demo feels real, but nothing is persisted.
      setStatus: async (row, status) => {
        if (!U.STATUS_OPTIONS.includes(String(status || "").trim())) {
          return { ok: false, error: "Unknown status" };
        }
        const hit = memory.find((a) => a.id === row.id);
        if (hit) hit.Status = String(status).trim();
        return { ok: true };
      },
      deleteRow: async (row) => {
        memory = memory.filter((a) => a.id !== row.id);
        return { ok: true };
      },
      restoreRow: async (row) => {
        if (!memory.some((a) => a.id === row.id)) memory.push(row);
        return { ok: true };
      },
      clearAll: async () => {
        memory = [];
        return { ok: true };
      },

      importRows: nope,
      getSettings: async () => ({ ...U.DEFAULT_SETTINGS }),
      saveSettings: async () => {},
      getTheme: async () => theme,
      setTheme: async (next) => { theme = next; },
      getQueue: async () => ({ count: 0 }),
      connectGoogle: nope,
      openSheet: nope,
      retryQueue: async () => ({ remaining: 0 }),
    };
  }

  // Deterministic, so the demo looks the same for everyone, and anchored to
  // today so the charts and deadlines always read as current.
  function buildDemoRows() {
    const COMPANIES = [
      ["Globex", "SWE Intern, Platform", "No sponsorship"],
      ["Acme Robotics", "ML Research Intern", "Sponsors"],
      ["Initech", "Platform Co-op", "Unclear"],
      ["Hooli", "Backend Engineer, New Grad", "Sponsors"],
      ["Stark Industries", "Data Analyst Intern", "Citizens/PR only"],
      ["Wonka Labs", "Product Intern", "Sponsors"],
      ["Cyberdyne", "Systems Intern", "No sponsorship"],
      ["Umbrella Health", "Bioinformatics Intern", "Unclear"],
      ["Soylent Foods", "Data Engineer Intern", "Sponsors"],
      ["Tyrell Corp", "Infrastructure Intern", "Citizens/PR only"],
      ["Aperture Science", "Research Intern", "Unclear"],
      ["Wayne Enterprises", "Security Intern", "No sponsorship"],
    ];
    const STATUSES = [
      "Applied", "Applied", "Applied", "Applied", "Online assessment",
      "Phone screen", "Interviewing", "Final round", "Offer", "Rejected", "Ghosted",
    ];
    const TYPES = ["Internship", "Internship", "Co-op", "New grad", "Full-time"];

    let seed = 20260730;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const today = U.todayISO();

    const rows = [];
    for (let i = 0; i < 26; i++) {
      const [company, position, sponsorship] = COMPANIES[i % COMPANIES.length];
      const age = Math.floor(rnd() * 78);
      const applied = U.addDays(today, -age);
      const status = age > 24 ? STATUSES[Math.floor(rnd() * STATUSES.length)] : "Applied";

      const row = {};
      for (const col of U.COLUMNS) row[col] = "";
      Object.assign(row, {
        Position: position,
        Company: company,
        Industry: "Technology",
        Role: ["SWE", "Data", "PM", "Research"][Math.floor(rnd() * 4)],
        Location: ["Seattle, WA", "New York, NY", "Remote", "Austin, TX"][Math.floor(rnd() * 4)],
        "Date Posted": U.addDays(applied, -Math.floor(rnd() * 12) - 1),
        "Date Applied": applied,
        "Cover Letter": rnd() > 0.5 ? "Yes" : "No",
        "Résumé upload?": "Yes",
        "Salary Range": `$${38 + Math.floor(rnd() * 20)}–$${58 + Math.floor(rnd() * 15)}/hour`,
        Status: status,
        "Latest word": `Application submitted ${applied}`,
        "Job Type": TYPES[Math.floor(rnd() * TYPES.length)],
        Sponsorship: sponsorship,
        Deadline: rnd() > 0.6 ? U.addDays(today, Math.floor(rnd() * 20) - 2) : "",
        "Follow-up On": U.addDays(applied, 14),
        "Job URL": "https://example.com/jobs/" + (4100 + i),
        "Job ID": String(4100 + i),
        id: `demo-${i}`,
        savedAt: i,
        synced: false,
      });
      rows.push(row);
    }

    // Make sure the demo shows the full pipeline, including a win.
    rows[0].Status = "Offer";
    rows[1].Status = "Final round";
    rows[2].Status = "Interviewing";
    return rows;
  }

  globalThis.GHOSTED_DATA = isExtension
    ? extensionSource()
    : isDemo
      ? demoSource()
      : webSource();
})();
