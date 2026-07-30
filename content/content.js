// Content script: detects application submissions on Handshake, scrapes job
// data, and shows the confirmation overlay. All Google API work happens in
// the background service worker — no tokens ever live here.
(() => {
  if (window.top !== window) return; // only run in the top frame

  const S = globalThis.HS2S_SELECTORS;
  const U = globalThis.HS2S;

  // ── Settings ──────────────────────────────────────────────────────────
  let settings = { ...U.DEFAULT_SETTINGS };
  chrome.storage.sync.get(U.DEFAULT_SETTINGS, (s) => {
    settings = s;
    updateFloatingButton();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue;
  });

  // ── State ─────────────────────────────────────────────────────────────
  // Scraped when the apply modal opens (before the submission animation can
  // tear the page down), consumed when we detect the success state.
  let pendingApp = null; // { jobId, data, coverLetter, resumeUpload }
  let lastUrl = location.href;
  const recentlyLogged = new Map(); // jobId → timestamp, session-level double-fire guard

  // ── Helpers ───────────────────────────────────────────────────────────
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

  function getJobId() {
    for (const p of S.jobIdPatterns) {
      const m = location.href.match(p);
      if (m) return m[1];
    }
    // Split view: the selected card in the list pane usually links to /jobs/<id>.
    const selected = document.querySelector(
      'a[aria-current="true"][href*="/jobs/"], [aria-selected="true"] a[href*="/jobs/"]'
    );
    if (selected) {
      const m = selected.getAttribute("href").match(/\/jobs?\/(\d+)/);
      if (m) return m[1];
    }
    return null;
  }

  function queryText(selectorList, root = document) {
    for (const sel of selectorList) {
      let el;
      try {
        el = root.querySelector(sel);
      } catch {
        continue;
      }
      const t = clean(el?.textContent);
      if (t) return t;
    }
    return "";
  }

  // Find a short leaf element matching a label regex; return its neighbor's text.
  function labeledValue(labelRegex) {
    for (const el of document.querySelectorAll("dt, h3, h4, h5, span, div, p, b, strong")) {
      if (el.childElementCount > 0) continue;
      const t = clean(el.textContent);
      if (!t || t.length > 30 || !labelRegex.test(t)) continue;
      const sib = el.nextElementSibling;
      const sibText = clean(sib?.textContent);
      if (sibText && sibText.length < 200) return sibText;
      const parent = el.parentElement;
      if (parent) {
        const rest = clean(parent.textContent).replace(t, "").trim();
        if (rest && rest.length < 200) return rest;
      }
    }
    return "";
  }

  // Scan short leaf elements for a free-text pattern (e.g. "Posted 3 days ago").
  function textMatch(pattern) {
    for (const el of document.querySelectorAll("span, div, p, time, li")) {
      if (el.childElementCount > 0) continue;
      const t = clean(el.textContent);
      if (t && t.length < 120) {
        const m = t.match(pattern);
        if (m) return m[0];
      }
    }
    return "";
  }

  function jsonLdJobPosting() {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse(script.textContent);
        const items = Array.isArray(parsed) ? parsed : [parsed, ...(parsed["@graph"] || [])];
        for (const item of items) {
          if (item && item["@type"] === "JobPosting") return item;
        }
      } catch {
        /* malformed JSON-LD — ignore */
      }
    }
    return null;
  }

  // ── Scraping ──────────────────────────────────────────────────────────
  function scrapeJob() {
    const data = {
      Position: "",
      Company: "",
      Industry: "",
      Location: "",
      "Date Posted": "",
      "Salary Range": "",
    };

    // 1) Structured data first — most stable when present.
    const jp = jsonLdJobPosting();
    if (jp) {
      data.Position = clean(jp.title);
      data.Company = clean(jp.hiringOrganization?.name);
      data.Industry = clean(jp.industry);
      data["Date Posted"] = U.parsePostedDate(jp.datePosted);
      const locs = [].concat(jp.jobLocation || []).map((l) => {
        const a = l?.address || {};
        return clean([a.addressLocality, a.addressRegion].filter(Boolean).join(", "));
      }).filter(Boolean);
      if (jp.jobLocationType === "TELECOMMUTE") locs.push("Remote");
      data.Location = locs.join("; ");
      const sal = jp.baseSalary?.value;
      if (sal) {
        const unit = jp.baseSalary.unitText ? `/${String(jp.baseSalary.unitText).toLowerCase()}` : "";
        if (sal.minValue && sal.maxValue) data["Salary Range"] = `$${sal.minValue}–$${sal.maxValue}${unit}`;
        else if (sal.value) data["Salary Range"] = `$${sal.value}${unit}`;
      }
    }

    // 2) CSS selectors (data-hook/testid → semantic → generic).
    if (!data.Position) data.Position = queryText(S.css.title);
    if (!data.Company) data.Company = queryText(S.css.company);
    if (!data.Location) data.Location = queryText(S.css.location);
    if (!data["Salary Range"]) data["Salary Range"] = queryText(S.css.salary);
    if (!data.Industry) data.Industry = queryText(S.css.industry);
    if (!data["Date Posted"]) {
      const el = document.querySelector("time[datetime]");
      if (el) data["Date Posted"] = U.parsePostedDate(el.getAttribute("datetime"));
      else data["Date Posted"] = U.parsePostedDate(queryText(S.css.posted));
    }

    // 3) Label→value pairs.
    if (!data.Industry) data.Industry = labeledValue(S.labels.industry);
    if (!data["Salary Range"]) data["Salary Range"] = labeledValue(S.labels.salary);
    if (!data.Location) data.Location = labeledValue(S.labels.location);
    if (!data["Date Posted"]) data["Date Posted"] = U.parsePostedDate(labeledValue(S.labels.posted));

    // 4) Free-text fallbacks.
    if (!data["Date Posted"]) data["Date Posted"] = U.parsePostedDate(textMatch(S.postedTextPattern));
    if (!data["Salary Range"]) data["Salary Range"] = textMatch(S.salaryTextPattern);

    // Multiple locations sometimes come as "A • B" or "A | B" — normalize to "; ".
    data.Location = data.Location.replace(/\s*[•|·]\s*/g, "; ");

    return data;
  }

  // ── Apply-modal tracking ──────────────────────────────────────────────
  function onApplyModalOpen(dialog) {
    const jobId = getJobId();
    // Scrape NOW, while the job page behind the modal is intact.
    pendingApp = {
      jobId,
      data: scrapeJob(),
      coverLetter: "",
      resumeUpload: "",
      dialog,
    };
    scanApplyModal(dialog);
  }

  // Re-scan the open modal on each mutation: multi-step modals reveal the
  // cover-letter / résumé steps progressively.
  function scanApplyModal(dialog) {
    if (!pendingApp) return;
    const text = dialog.textContent || "";
    if (S.coverLetter.test(text)) pendingApp.coverLetter = "Yes";
    if (S.resume.test(text)) {
      // A résumé section with a file input or an attached document counts as an upload.
      pendingApp.resumeUpload = "Yes";
    }
  }

  function findApplyDialog(root) {
    const dialogs = root.matches?.('[role="dialog"], dialog')
      ? [root]
      : [...(root.querySelectorAll?.('[role="dialog"], dialog') || [])];
    for (const d of dialogs) {
      const heading = d.querySelector("h1, h2, h3, [role=heading]");
      const headText = clean(heading?.textContent);
      if (S.applyModalHeading.test(headText) || S.resume.test(d.textContent || "")) {
        if (/apply|application/i.test(d.textContent || "")) return d;
      }
    }
    return null;
  }

  // ── Submission detection ──────────────────────────────────────────────
  function nodeSignalsSuccess(node) {
    const text = node.textContent || "";
    if (S.successText.test(text)) return true;
    // Apply button flipped to "Applied"
    if (node.matches?.("button") && S.appliedButton.test(clean(node.textContent))) return true;
    for (const btn of node.querySelectorAll?.("button") || []) {
      if (S.appliedButton.test(clean(btn.textContent))) return true;
    }
    return false;
  }

  function onSubmissionDetected() {
    const jobId = pendingApp?.jobId || getJobId();
    if (jobId) {
      const last = recentlyLogged.get(jobId);
      if (last && Date.now() - last < 60_000) return; // debounce double-fires
      recentlyLogged.set(jobId, Date.now());
    }
    triggerLog({ auto: true });
  }

  const observer = new MutationObserver((mutations) => {
    // SPA URL changes that history patching might miss (initial load, hash).
    if (location.href !== lastUrl) onUrlChange();

    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        const dialog = findApplyDialog(node);
        if (dialog && !pendingApp) onApplyModalOpen(dialog);

        if (settings.autoCapture && nodeSignalsSuccess(node)) {
          onSubmissionDetected();
          return;
        }
      }
      // Keep scanning an already-open modal as steps appear.
      if (pendingApp?.dialog?.isConnected) scanApplyModal(pendingApp.dialog);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // External applications: the real submission happens off-site, so capture
  // at the moment the external link is clicked.
  document.addEventListener(
    "click",
    (e) => {
      if (!settings.autoCapture) return;
      const target = e.target.closest?.("a, button");
      if (!target) return;
      const label = clean(target.textContent) + " " + (target.getAttribute("aria-label") || "");
      if (S.externalApply.test(label)) {
        const jobId = getJobId();
        if (jobId && recentlyLogged.has(jobId) && Date.now() - recentlyLogged.get(jobId) < 60_000) return;
        if (jobId) recentlyLogged.set(jobId, Date.now());
        // Scrape immediately; open the overlay shortly after so the click completes.
        const data = scrapeJob();
        setTimeout(() => triggerLog({ auto: true, external: true, presetData: { jobId, data } }), 600);
      }
    },
    true
  );

  // ── URL change handling ───────────────────────────────────────────────
  function onUrlChange() {
    lastUrl = location.href;
    pendingApp = null;
    updateFloatingButton();
  }
  window.addEventListener("hs2s:urlchange", onUrlChange);
  window.addEventListener("popstate", onUrlChange);

  // ── Manual trigger (toolbar popup / context menu) ─────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "openLogOverlay") {
      triggerLog({ auto: false });
      sendResponse({ ok: true });
    }
  });

  // ── Shadow-DOM host: floating button, overlay, toasts ─────────────────
  const host = document.createElement("div");
  host.id = "hs2s-host";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    :where(button, input, select, textarea) { font-size: 13px; }

    .fab {
      position: fixed; bottom: 24px; right: 24px; z-index: 2147483645;
      padding: 10px 16px; border: none; border-radius: 999px; cursor: pointer;
      background: #1b7f4d; color: #fff; font-size: 13px; font-weight: 600;
      box-shadow: 0 2px 10px rgba(0,0,0,.3); display: none;
    }
    .fab:hover { background: #16693f; }

    .backdrop {
      position: fixed; inset: 0; z-index: 2147483646;
      background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center;
    }
    .panel {
      width: min(560px, 94vw); max-height: 90vh; overflow-y: auto;
      background: #fff; color: #1a1a2e; border-radius: 10px; padding: 18px 20px;
      box-shadow: 0 8px 40px rgba(0,0,0,.4);
    }
    .panel h2 { margin: 0 0 4px; font-size: 16px; }
    .panel .sub { margin: 0 0 12px; font-size: 12px; color: #666; }
    .warn-banner {
      background: #fff3cd; color: #664d03; border: 1px solid #ffe69c;
      border-radius: 6px; padding: 8px 10px; font-size: 12px; margin-bottom: 12px;
    }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; }
    .field { display: flex; flex-direction: column; gap: 3px; }
    .field.wide { grid-column: 1 / -1; }
    .field label { font-size: 11px; font-weight: 600; color: #555; }
    .field input, .field select, .field textarea {
      padding: 6px 8px; border: 1px solid #ccc; border-radius: 5px;
      background: #fff; color: inherit; width: 100%;
    }
    .field textarea { resize: vertical; min-height: 44px; }
    .field.missing input, .field.missing select {
      border-color: #e0a800; background: #fffbea;
    }
    .field .miss-note { font-size: 10px; color: #b07d00; }
    .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
    .actions .hint { margin-right: auto; font-size: 11px; color: #888; align-self: center; }
    .btn { padding: 8px 16px; border-radius: 6px; border: 1px solid #ccc; background: #f5f5f5; cursor: pointer; }
    .btn.primary { background: #1b7f4d; border-color: #1b7f4d; color: #fff; font-weight: 600; }
    .btn.primary:hover { background: #16693f; }
    .btn:disabled { opacity: .6; cursor: wait; }

    .toast {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      z-index: 2147483647; padding: 10px 18px; border-radius: 8px;
      font-size: 13px; color: #fff; background: #1b7f4d;
      box-shadow: 0 2px 12px rgba(0,0,0,.35);
    }
    .toast.error { background: #b02a37; }
    .toast.warn { background: #b07d00; }

    @media (prefers-color-scheme: dark) {
      .panel { background: #1e1e28; color: #e8e8ef; }
      .panel .sub { color: #9a9aa8; }
      .field label { color: #b8b8c8; }
      .field input, .field select, .field textarea { background: #2a2a38; border-color: #44445a; color: #e8e8ef; }
      .field.missing input, .field.missing select { background: #3a331a; border-color: #a8861f; }
      .warn-banner { background: #3a331a; color: #ffd75e; border-color: #6b5a1a; }
      .btn { background: #2a2a38; border-color: #44445a; color: #e8e8ef; }
      .btn.primary { background: #1b7f4d; border-color: #1b7f4d; }
    }
  `;
  shadow.appendChild(style);

  const fab = document.createElement("button");
  fab.className = "fab";
  fab.textContent = "＋ Log this job";
  fab.addEventListener("click", () => triggerLog({ auto: false }));
  shadow.appendChild(fab);

  function mountHost() {
    if (!host.isConnected && document.body) document.body.appendChild(host);
  }
  mountHost();

  function updateFloatingButton() {
    mountHost();
    fab.style.display = getJobId() ? "block" : "none";
  }
  updateFloatingButton();

  function toast(message, kind = "ok", ms = 4000) {
    const el = document.createElement("div");
    el.className = "toast" + (kind !== "ok" ? ` ${kind}` : "");
    el.textContent = message;
    shadow.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  // ── Overlay ───────────────────────────────────────────────────────────
  let overlayEl = null;

  const AUTO_FIELDS = new Set(["Position", "Company", "Industry", "Location", "Date Posted", "Salary Range"]);

  async function triggerLog({ auto, external = false, presetData = null }) {
    if (overlayEl) return; // already open

    const jobId = presetData?.jobId ?? pendingApp?.jobId ?? getJobId();
    const scraped = presetData?.data ?? pendingApp?.data ?? scrapeJob();
    const coverLetter = pendingApp?.coverLetter ?? "";
    const resumeUpload = pendingApp?.resumeUpload ?? "";
    pendingApp = null;

    let duplicate = null;
    if (jobId) {
      try {
        duplicate = await chrome.runtime.sendMessage({ type: "checkDuplicate", jobId });
      } catch { /* background asleep/erroring — proceed without dup info */ }
    }

    const today = U.todayISO();
    const row = {
      ...scraped,
      Role: "",
      "Date Applied": today,
      "Connections?": "",
      "Cover Letter": coverLetter,
      "Résumé upload?": resumeUpload,
      "Résumé Form?": "",
      Notes: external ? "External application" : "",
      Status: "Applied",
      "Latest word": `Application submitted ${today}`,
    };

    openOverlay({ row, jobId, duplicate: duplicate?.duplicate ? duplicate : null, external, auto });
  }

  function openOverlay({ row, jobId, duplicate, external }) {
    const backdrop = document.createElement("div");
    backdrop.className = "backdrop";
    overlayEl = backdrop;

    const panel = document.createElement("div");
    panel.className = "panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Log job application");

    const title = document.createElement("h2");
    title.textContent = external ? "Log external application" : "Log job application";
    const sub = document.createElement("p");
    sub.className = "sub";
    sub.textContent = jobId ? `Handshake job #${jobId}` : "No job ID detected for this page";
    panel.append(title, sub);

    if (duplicate) {
      const warn = document.createElement("div");
      warn.className = "warn-banner";
      warn.textContent = `⚠ You already logged this job on ${duplicate.date}. Saving will append a duplicate row.`;
      panel.appendChild(warn);
    }

    const yesNo = ["", "Yes", "No"];
    const fields = [
      { key: "Position", type: "text" },
      { key: "Company", type: "text" },
      { key: "Industry", type: "text" },
      { key: "Role", type: "select", options: ["", ...settings.roleOptions] },
      { key: "Location", type: "text" },
      { key: "Date Posted", type: "text", placeholder: "YYYY-MM-DD" },
      { key: "Date Applied", type: "text" },
      { key: "Connections?", type: "text", datalist: ["Yes", "No"] },
      { key: "Cover Letter", type: "select", options: yesNo },
      { key: "Résumé upload?", type: "select", options: yesNo },
      { key: "Résumé Form?", type: "select", options: yesNo },
      { key: "Salary Range", type: "text" },
      { key: "Notes", type: "textarea", wide: true },
      { key: "Status", type: "text" },
      { key: "Latest word", type: "text" },
    ];

    const grid = document.createElement("div");
    grid.className = "grid";
    const inputs = {};

    for (const f of fields) {
      const wrap = document.createElement("div");
      wrap.className = "field" + (f.wide ? " wide" : "");
      const label = document.createElement("label");
      label.textContent = f.key;
      wrap.appendChild(label);

      let input;
      if (f.type === "select") {
        input = document.createElement("select");
        for (const opt of f.options) {
          const o = document.createElement("option");
          o.value = opt;
          o.textContent = opt === "" ? "—" : opt;
          input.appendChild(o);
        }
        input.value = f.options.includes(row[f.key]) ? row[f.key] : "";
      } else if (f.type === "textarea") {
        input = document.createElement("textarea");
        input.value = row[f.key] || "";
      } else {
        input = document.createElement("input");
        input.type = "text";
        input.value = row[f.key] || "";
        if (f.placeholder) input.placeholder = f.placeholder;
        if (f.datalist) {
          const dl = document.createElement("datalist");
          dl.id = `hs2s-dl-${f.key.replace(/\W/g, "")}`;
          for (const v of f.datalist) {
            const o = document.createElement("option");
            o.value = v;
            dl.appendChild(o);
          }
          wrap.appendChild(dl);
          input.setAttribute("list", dl.id);
        }
      }
      inputs[f.key] = input;
      wrap.appendChild(input);

      // Flag auto-scrape fields that came back empty.
      if (AUTO_FIELDS.has(f.key) && !row[f.key]) {
        wrap.classList.add("missing");
        const note = document.createElement("span");
        note.className = "miss-note";
        note.textContent = "couldn't auto-detect — please fill in";
        wrap.appendChild(note);
      }
      grid.appendChild(wrap);
    }
    panel.appendChild(grid);

    const actions = document.createElement("div");
    actions.className = "actions";
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "Enter to save · Esc to dismiss";
    const skipBtn = document.createElement("button");
    skipBtn.className = "btn";
    skipBtn.textContent = "Skip";
    const saveBtn = document.createElement("button");
    saveBtn.className = "btn primary";
    saveBtn.textContent = duplicate ? "Save anyway" : "Save to Sheet";
    actions.append(hint, skipBtn, saveBtn);
    panel.appendChild(actions);

    backdrop.appendChild(panel);
    shadow.appendChild(backdrop);

    const close = () => {
      backdrop.remove();
      overlayEl = null;
      document.removeEventListener("keydown", onKey, true);
    };

    const save = async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      const finalRow = {};
      for (const f of fields) finalRow[f.key] = inputs[f.key].value;
      try {
        const resp = await chrome.runtime.sendMessage({
          type: "logJob",
          row: finalRow,
          jobId,
          force: true, // duplicate already surfaced in the overlay
        });
        close();
        if (resp?.ok) toast("✓ Saved to Google Sheet");
        else if (resp?.queued) toast("Saved offline — will retry automatically", "warn", 6000);
        else toast(`Failed to save: ${resp?.error || "unknown error"}`, "error", 8000);
      } catch (e) {
        close();
        toast(`Failed to save: ${e.message}`, "error", 8000);
      }
    };

    // Enter/Esc are handled inside the shadow tree, where e.target is the
    // real inner element (outside a closed shadow root, events retarget to
    // the host, which would break the Notes-textarea check).
    backdrop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === "Enter" && e.target !== inputs.Notes) {
        e.preventDefault();
        e.stopPropagation();
        save();
      }
    });
    // Esc fallback for when focus is outside the overlay entirely.
    const onKey = (e) => {
      if (overlayEl && e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey, true);
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) close();
    });
    skipBtn.addEventListener("click", close);
    saveBtn.addEventListener("click", save);

    // Focus the first empty required-ish field, else Role.
    const firstMissing = fields.find((f) => AUTO_FIELDS.has(f.key) && !row[f.key]);
    (inputs[firstMissing?.key] || inputs.Role).focus();
  }
})();
