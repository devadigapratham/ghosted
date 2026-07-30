// Watches for application submissions, scrapes the job, shows the confirm
// overlay. Sends the finished row to the worker; does no network work itself.
(() => {
  if (window.top !== window) return;
  // The popup can inject this script into any tab, so it may already be here.
  if (globalThis.__ghostedLoaded) return;
  globalThis.__ghostedLoaded = true;

  // Selectors for whichever board this is, merged over the shared baseline.
  let S = globalThis.GHOSTED_RESOLVE_SITE(location.hostname);
  const U = globalThis.GHOSTED;

  let settings = { ...U.DEFAULT_SETTINGS };

  // Filled in when the apply modal opens, consumed when submission succeeds.
  // Scraping has to happen up front; by the time the success toast appears,
  // the job details behind the modal may already be gone.
  let pendingApp = null;
  let lastUrl = location.href;
  const recentlyLogged = new Map();

  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  // The board's own identifier, kept bare so it reads cleanly in the sheet.
  function getJobId() {
    for (const p of S.jobIdPatterns) {
      const m = location.href.match(p);
      if (m) return m[1];
    }
    // Handshake's split view keeps the id on the selected card, not in the URL.
    const selected = document.querySelector(
      'a[aria-current="true"][href*="/jobs/"], [aria-selected="true"] a[href*="/jobs/"]'
    );
    if (selected) {
      const m = selected.getAttribute("href").match(/\/jobs?\/(\d+)/);
      if (m) return m[1];
    }
    // Boards with no id pattern still need something stable, and the canonical
    // path is it. Without this the floating button never appears on them.
    if (looksLikeJobPage()) return canonicalPath();
    return null;
  }

  // Dedupe key. Prefixed with the board so two sites can't collide on "1234".
  function jobKey(jobId) {
    return jobId ? `${S.siteId}:${jobId}` : null;
  }

  function canonicalPath() {
    const link = document.querySelector('link[rel="canonical"]')?.getAttribute("href");
    try {
      return link ? new URL(link, location.href).pathname : location.pathname;
    } catch {
      return location.pathname;
    }
  }

  // Structured job data, or a URL that says "job", is enough to offer logging.
  function looksLikeJobPage() {
    if (jsonLdJobPosting()) return true;
    return /\/(jobs?|careers?|opening|posting|apply|vacanc)/i.test(location.pathname);
  }

  function jobUrl() {
    const link = document.querySelector('link[rel="canonical"]')?.getAttribute("href");
    const canonical = U.safeHttpUrl(link);
    if (canonical) return canonical;
    // Drop the query string: it is usually tracking, and the path identifies the job.
    return location.origin + location.pathname;
  }

  function queryText(selectorList, root = document) {
    for (const sel of selectorList) {
      let el;
      try {
        el = root.querySelector(sel);
      } catch {
        continue; // selector no longer valid after a redesign
      }
      const t = clean(el?.textContent);
      if (t) return t;
    }
    return "";
  }

  // Match a short leaf element against a label, return the value next to it.
  function labeledValue(labelRegex) {
    for (const el of document.querySelectorAll("dt, h3, h4, h5, span, div, p, b, strong")) {
      if (el.childElementCount > 0) continue;
      const t = clean(el.textContent);
      if (!t || t.length > 30 || !labelRegex.test(t)) continue;

      const sibText = clean(el.nextElementSibling?.textContent);
      if (sibText && sibText.length < 200) return sibText;

      const parent = el.parentElement;
      if (parent) {
        const rest = clean(parent.textContent).replace(t, "").trim();
        if (rest && rest.length < 200) return rest;
      }
    }
    return "";
  }

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
        // Malformed JSON-LD is common enough to just skip.
      }
    }
    return null;
  }

  // The whole description, for work-auth scanning. Capped because some
  // postings paste an entire employee handbook in here.
  function descriptionText() {
    const jp = jsonLdJobPosting();
    const fromJsonLd = jp?.description
      ? clean(String(jp.description).replace(/<[^>]+>/g, " "))
      : "";

    let best = fromJsonLd;
    for (const sel of S.css.description) {
      let el;
      try {
        el = document.querySelector(sel);
      } catch {
        continue;
      }
      const t = clean(el?.textContent);
      // Longest wins: work-auth boilerplate tends to sit at the very bottom.
      if (t.length > best.length) best = t;
      if (best.length > 400 && sel !== "main" && sel !== "article") break;
    }
    return U.descriptionWindow(best);
  }

  function scrapeJob() {
    const fields = {
      Position: "",
      Company: "",
      Industry: "",
      Location: "",
      "Date Posted": "",
      "Salary Range": "",
      "Job Type": "",
      Deadline: "",
    };

    // Structured data beats scraping whenever it's there.
    const jp = jsonLdJobPosting();
    if (jp) {
      fields.Position = clean(jp.title);
      fields.Company = clean(jp.hiringOrganization?.name);
      fields.Industry = clean(jp.industry);
      fields["Date Posted"] = U.parsePostedDate(jp.datePosted);
      fields["Job Type"] = U.normalizeJobType(
        [].concat(jp.employmentType || []).join(" ") || jp.title || ""
      );
      if (jp.validThrough) fields.Deadline = U.parseDeadline(jp.validThrough);

      const locs = []
        .concat(jp.jobLocation || [])
        .map((l) => {
          const a = l?.address || {};
          return clean([a.addressLocality, a.addressRegion].filter(Boolean).join(", "));
        })
        .filter(Boolean);
      if (jp.jobLocationType === "TELECOMMUTE") locs.push("Remote");
      fields.Location = locs.join("; ");

      fields["Salary Range"] = U.formatSalary(jp.baseSalary);
    }

    if (!fields.Position) fields.Position = queryText(S.css.title);
    if (!fields.Company) fields.Company = queryText(S.css.company);
    if (!fields.Location) fields.Location = queryText(S.css.location);
    if (!fields["Salary Range"]) fields["Salary Range"] = queryText(S.css.salary);
    if (!fields.Industry) fields.Industry = queryText(S.css.industry);
    if (!fields["Date Posted"]) {
      const el = document.querySelector("time[datetime]");
      fields["Date Posted"] = el
        ? U.parsePostedDate(el.getAttribute("datetime"))
        : U.parsePostedDate(queryText(S.css.posted));
    }

    if (!fields.Industry) fields.Industry = labeledValue(S.labels.industry);
    if (!fields["Salary Range"]) fields["Salary Range"] = labeledValue(S.labels.salary);
    if (!fields.Location) fields.Location = labeledValue(S.labels.location);
    if (!fields["Date Posted"]) fields["Date Posted"] = U.parsePostedDate(labeledValue(S.labels.posted));

    if (!fields["Date Posted"]) fields["Date Posted"] = U.parsePostedDate(textMatch(S.postedTextPattern));
    if (!fields["Salary Range"]) fields["Salary Range"] = textMatch(S.salaryTextPattern);

    if (!fields.Deadline) fields.Deadline = U.parseDeadline(queryText(S.css.deadline));
    if (!fields.Deadline) fields.Deadline = U.parseDeadline(labeledValue(S.labels.deadline));
    if (!fields.Deadline) fields.Deadline = U.parseDeadline(textMatch(S.deadlineTextPattern));

    if (!fields["Job Type"]) fields["Job Type"] = U.normalizeJobType(queryText(S.css.jobType));
    if (!fields["Job Type"]) fields["Job Type"] = U.normalizeJobType(labeledValue(S.labels.jobType));
    if (!fields["Job Type"]) fields["Job Type"] = U.normalizeJobType(fields.Position);

    // Handshake separates multiple locations with bullets; the sheet uses "; ".
    fields.Location = fields.Location.replace(/\s*[•|·]\s*/g, "; ");

    const description = descriptionText();
    const workAuth = U.classifyWorkAuth(description);
    fields.Sponsorship = workAuth.status || "Unclear";

    return { fields, workAuth };
  }

  // Sponsorship chip
  // Shown before you apply, which is the only time the answer is useful.
  const chipCache = new Map();
  let chip = null;

  function chipStyleFor(status) {
    if (status === "Sponsors") return { cls: "chip good", text: "✓ Sponsors visas" };
    if (status === "No sponsorship") return { cls: "chip bad", text: "⚠ No sponsorship" };
    if (status === "Citizens/PR only") return { cls: "chip bad", text: "⚠ Citizens/PR only" };
    return { cls: "chip meh", text: "? Sponsorship unclear" };
  }

  function updateChip() {
    if (!chip) return;
    const jobId = getJobId();

    if (!jobId || !settings.showSponsorshipChip || !settings.needsSponsorship) {
      chip.style.display = "none";
      return;
    }

    let result = chipCache.get(jobId);
    if (!result) {
      const description = descriptionText();
      // The description loads after the title on some pages; wait for it
      // rather than caching a confident-looking "unclear".
      if (description.length < 200) {
        chip.style.display = "none";
        return;
      }
      result = U.classifyWorkAuth(description);
      chipCache.set(jobId, result);
    }

    const { cls, text } = chipStyleFor(result.status);
    chip.className = cls;
    chip.textContent = text;
    chip.title = result.evidence
      ? `${result.evidence}\n\n(click to dismiss)`
      : "No sponsorship language found in this posting — check with the recruiter.";
    chip.style.display = "block";
  }

  const scheduleChipUpdate = debounce(updateChip, 700);

  function detectResumeUpload(dialog) {
    for (const sel of S.resumeUpload.controls) {
      let inputs;
      try {
        inputs = dialog.querySelectorAll(sel);
      } catch {
        continue;
      }
      for (const input of inputs) {
        if (input.type === "file" && input.files?.length) return "Yes";
        if ((input.type === "radio" || input.type === "checkbox") && input.checked) return "Yes";
      }
    }

    // A rendered filename ("resume_2026.pdf") means something is attached.
    const scopes = dialog.querySelectorAll(
      '[data-hook*="resume"], [data-testid*="resume"], [data-hook*="document"], [data-testid*="document"], label, li, p, span, div'
    );
    for (const el of scopes) {
      if (el.childElementCount > 0) continue;
      const t = clean(el.textContent);
      if (!t || t.length > 120) continue;
      if (S.resumeUpload.filenamePattern.test(t)) return "Yes";
      if (S.resume.test(t) && S.resumeUpload.attachedText.test(t)) return "Yes";
    }

    // The step exists but nothing is attached; say so rather than guessing.
    return S.resume.test(dialog.textContent || "") ? "No" : "";
  }

  function onApplyModalOpen(dialog) {
    const scraped = scrapeJob();
    pendingApp = {
      jobId: getJobId(),
      fields: scraped.fields,
      workAuth: scraped.workAuth,
      coverLetter: "",
      resumeUpload: "",
      dialog,
    };
    scanApplyModal(dialog);
  }

  // Multi-step modals reveal the cover letter / résumé steps as you go, so
  // rescan on every mutation rather than once on open.
  function scanApplyModal(dialog) {
    if (!pendingApp) return;
    if (S.coverLetter.test(dialog.textContent || "")) pendingApp.coverLetter = "Yes";

    const upload = detectResumeUpload(dialog);
    // Never downgrade a "Yes": a later step may re-render without the filename.
    if (upload === "Yes" || !pendingApp.resumeUpload) pendingApp.resumeUpload = upload;
  }

  function findApplyDialog(root) {
    const dialogs = root.matches?.('[role="dialog"], dialog')
      ? [root]
      : [...(root.querySelectorAll?.('[role="dialog"], dialog') || [])];

    for (const d of dialogs) {
      const headText = clean(d.querySelector("h1, h2, h3, [role=heading]")?.textContent);
      const body = d.textContent || "";
      if ((S.applyModalHeading.test(headText) || S.resume.test(body)) && /apply|application/i.test(body)) {
        return d;
      }
    }
    return null;
  }

  function nodeSignalsSuccess(node) {
    if (S.successText.test(node.textContent || "")) return true;
    if (node.matches?.("button") && S.appliedButton.test(clean(node.textContent))) return true;
    for (const btn of node.querySelectorAll?.("button") || []) {
      if (S.appliedButton.test(clean(btn.textContent))) return true;
    }
    return false;
  }

  function onSubmissionDetected() {
    const jobId = pendingApp?.jobId || getJobId();
    if (jobId) {
      const key = jobKey(jobId);
      const last = recentlyLogged.get(key);
      if (last && Date.now() - last < 60_000) return; // toast + button flip both fire
      recentlyLogged.set(key, Date.now());
    }
    triggerLog({ auto: true });
  }

  const observer = new MutationObserver((mutations) => {
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
      if (pendingApp?.dialog?.isConnected) scanApplyModal(pendingApp.dialog);
    }
    scheduleChipUpdate();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // External applies finish on someone else's site, so the click is the only
  // moment we're guaranteed to still be here.
  document.addEventListener(
    "click",
    (e) => {
      if (!settings.autoCapture) return;
      const target = e.target.closest?.("a, button");
      if (!target) return;

      const label = clean(target.textContent) + " " + (target.getAttribute("aria-label") || "");
      if (!S.externalApply.test(label)) return;

      const jobId = getJobId();
      if (jobId && Date.now() - (recentlyLogged.get(jobKey(jobId)) || 0) < 60_000) return;
      if (jobId) recentlyLogged.set(jobKey(jobId), Date.now());

      const scraped = scrapeJob();
      setTimeout(
        () => triggerLog({ auto: true, external: true, presetData: { jobId, ...scraped } }),
        600
      );
    },
    true
  );

  function onUrlChange() {
    lastUrl = location.href;
    S = globalThis.GHOSTED_RESOLVE_SITE(location.hostname);
    pendingApp = null;
    updateFloatingButton();
    scheduleChipUpdate();
  }
  window.addEventListener("ghosted:urlchange", onUrlChange);
  window.addEventListener("popstate", onUrlChange);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "openLogOverlay") {
      triggerLog({ auto: false });
      sendResponse({ ok: true });
    }
  });

  // Closed shadow root so Handshake's stylesheets can't reach the overlay and
  // vice versa.
  const host = document.createElement("div");
  host.id = "ghosted-host";
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

    .chip {
      position: fixed; bottom: 66px; right: 24px; z-index: 2147483645;
      padding: 6px 12px; border-radius: 999px; cursor: help;
      font-size: 12px; font-weight: 600; display: none;
      box-shadow: 0 2px 8px rgba(0,0,0,.25); max-width: 240px;
    }
    .chip.good { background: #d6f2e2; color: #0f5132; border: 1px solid #a6ddc0; }
    .chip.bad  { background: #f8d7da; color: #842029; border: 1px solid #f1aeb5; }
    .chip.meh  { background: #e9ecef; color: #41464b; border: 1px solid #ced4da; }

    .backdrop {
      position: fixed; inset: 0; z-index: 2147483646;
      background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center;
    }
    .panel {
      width: min(620px, 94vw); max-height: 90vh; overflow-y: auto;
      background: #fff; color: #1a1a2e; border-radius: 10px; padding: 18px 20px;
      box-shadow: 0 8px 40px rgba(0,0,0,.4);
    }
    .panel h2 { margin: 0 0 4px; font-size: 16px; }
    .panel .sub { margin: 0 0 12px; font-size: 12px; color: #666; }
    .banner {
      border-radius: 6px; padding: 8px 10px; font-size: 12px; margin-bottom: 10px;
      background: #fff3cd; color: #664d03; border: 1px solid #ffe69c;
    }
    .banner.stop { background: #f8d7da; color: #842029; border-color: #f1aeb5; }
    .banner.info { background: #e7f1ff; color: #084298; border-color: #b6d4fe; }
    .banner .quote { display: block; margin-top: 4px; font-style: italic; opacity: .85; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; }
    .field { display: flex; flex-direction: column; gap: 3px; }
    .field.wide { grid-column: 1 / -1; }
    .field label { font-size: 11px; font-weight: 600; color: #555; }
    .field input, .field select, .field textarea {
      padding: 6px 8px; border: 1px solid #ccc; border-radius: 5px;
      background: #fff; color: inherit; width: 100%;
    }
    .field textarea { resize: vertical; min-height: 44px; }
    .field.missing input, .field.missing select { border-color: #e0a800; background: #fffbea; }
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
      .banner { background: #3a331a; color: #ffd75e; border-color: #6b5a1a; }
      .banner.stop { background: #3d1f22; color: #ff9aa2; border-color: #6b2a30; }
      .banner.info { background: #17233a; color: #9ec5fe; border-color: #2c4470; }
      .btn { background: #2a2a38; border-color: #44445a; color: #e8e8ef; }
      .btn.primary { background: #1b7f4d; border-color: #1b7f4d; }
      .chip.good { background: #14372a; color: #75d6a4; border-color: #256b4a; }
      .chip.bad { background: #3d1f22; color: #ff9aa2; border-color: #6b2a30; }
      .chip.meh { background: #2a2a38; color: #b8b8c8; border-color: #44445a; }
    }
  `;
  shadow.appendChild(style);

  const fab = document.createElement("button");
  fab.className = "fab";
  fab.textContent = "＋ Log this job";
  fab.addEventListener("click", () => triggerLog({ auto: false }));
  shadow.appendChild(fab);

  chip = document.createElement("div");
  chip.className = "chip meh";
  chip.addEventListener("click", () => {
    chip.style.display = "none";
  });
  shadow.appendChild(chip);

  function mountHost() {
    if (!host.isConnected && document.body) document.body.appendChild(host);
  }

  function updateFloatingButton() {
    mountHost();
    fab.style.display = getJobId() ? "block" : "none";
  }

  // Settings load last: it repaints the button and chip, which have to exist
  // first. Reading it earlier only worked because the callback is async.
  chrome.storage.sync.get(U.DEFAULT_SETTINGS, (loaded) => {
    settings = loaded;
    updateFloatingButton();
    scheduleChipUpdate();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue;
    chipCache.clear();
    scheduleChipUpdate();
  });

  updateFloatingButton();
  scheduleChipUpdate();

  function toast(message, kind = "ok", ms = 4000) {
    const el = document.createElement("div");
    el.className = "toast" + (kind !== "ok" ? ` ${kind}` : "");
    el.textContent = message;
    shadow.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  let overlayEl = null;

  // Fields we try to scrape; these get the amber "couldn't find it" treatment.
  const AUTO_FIELDS = new Set(["Position", "Company", "Industry", "Location", "Date Posted", "Salary Range"]);

  async function triggerLog({ auto, external = false, presetData = null }) {
    if (overlayEl) return;

    const jobId = presetData?.jobId ?? pendingApp?.jobId ?? getJobId();
    const fresh = presetData || pendingApp || scrapeJob();
    const scraped = fresh.fields;
    const workAuth = fresh.workAuth || { status: "", evidence: "" };
    const coverLetter = pendingApp?.coverLetter ?? "";
    const resumeUpload = pendingApp?.resumeUpload ?? "";
    pendingApp = null;

    let context = null;
    if (jobId || scraped.Company) {
      try {
        context = await chrome.runtime.sendMessage({
          type: "jobContext",
          jobId: jobKey(jobId),
          company: scraped.Company,
          position: scraped.Position,
        });
      } catch {
        // Worker asleep or reloading; carry on without dupe/company info.
      }
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
      "Follow-up On": U.addDays(today, settings.followUpDays || U.DEFAULT_SETTINGS.followUpDays),
      "Job URL": jobUrl(),
      "Job ID": jobId || "",
      Source: S.siteName,
    };

    openOverlay({
      row,
      jobId,
      workAuth,
      duplicate: context?.duplicate ? context : null,
      companyCount: context?.companyCount || 0,
      external,
      auto,
    });
  }

  function openOverlay({ row, jobId, workAuth, duplicate, companyCount, external }) {
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
    sub.textContent = jobId ? `${S.siteName} · ${jobId}` : "No job detected on this page";
    panel.append(title, sub);

    const banner = (text, kind, quote) => {
      const el = document.createElement("div");
      el.className = "banner" + (kind ? ` ${kind}` : "");
      el.textContent = text;
      if (quote) {
        const q = document.createElement("span");
        q.className = "quote";
        q.textContent = `“${quote}”`;
        el.appendChild(q);
      }
      panel.appendChild(el);
    };

    if (duplicate) {
      banner(
        duplicate.via === "role"
          ? `⚠ You already logged ${row.Company || "this role"} · ${row.Position || ""} on ${duplicate.date}, from a different site. Saving will append a second row.`.replace(" · ", row.Position ? " · " : "")
          : `⚠ You already logged this job on ${duplicate.date}. Saving will append a duplicate row.`
      );
    }

    // The reason this extension exists, for anyone who needs a visa.
    if (settings.needsSponsorship && U.isSponsorshipBlocker(workAuth.status)) {
      banner(
        workAuth.status === "Citizens/PR only"
          ? "⚠ This posting looks restricted to US citizens or permanent residents."
          : "⚠ This posting says it does not offer visa sponsorship.",
        "stop",
        workAuth.evidence
      );
    } else if (settings.needsSponsorship && workAuth.status === "Sponsors") {
      banner("✓ This posting mentions visa sponsorship.", "info", workAuth.evidence);
    }

    if (companyCount > 0) {
      banner(
        `This is application #${companyCount + 1} to ${row.Company || "this company"}.`,
        "info"
      );
    }

    const yesNo = ["", "Yes", "No"];
    const fields = [
      { key: "Position", type: "text" },
      { key: "Company", type: "text" },
      { key: "Industry", type: "text" },
      { key: "Role", type: "select", options: ["", ...settings.roleOptions] },
      { key: "Job Type", type: "select", options: ["", "Internship", "Co-op", "New grad", "Full-time", "Part-time", "Contract", "Fellowship"] },
      { key: "Location", type: "text" },
      {
        key: "Sponsorship",
        type: "select",
        options: ["", "Sponsors", "No sponsorship", "Citizens/PR only", "Unclear"],
      },
      { key: "Date Posted", type: "text", placeholder: "YYYY-MM-DD" },
      { key: "Deadline", type: "text", placeholder: "YYYY-MM-DD" },
      { key: "Date Applied", type: "text" },
      { key: "Follow-up On", type: "text", placeholder: "YYYY-MM-DD" },
      { key: "Connections?", type: "text", datalist: ["Yes", "No"] },
      { key: "Cover Letter", type: "select", options: yesNo },
      { key: "Résumé upload?", type: "select", options: yesNo },
      { key: "Résumé Form?", type: "select", options: yesNo },
      { key: "Salary Range", type: "text" },
      { key: "Source", type: "text" },
      { key: "Status", type: "select", options: U.STATUS_OPTIONS },
      { key: "Notes", type: "textarea", wide: true },
      { key: "Latest word", type: "text", wide: true },
    ];
    // Carried through but not worth a form field.
    const hiddenKeys = ["Job URL", "Job ID"];

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
          dl.id = `ghosted-dl-${f.key.replace(/\W/g, "")}`;
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
      for (const k of hiddenKeys) finalRow[k] = row[k];

      try {
        const resp = await chrome.runtime.sendMessage({
          type: "logJob",
          row: finalRow,
          jobId: jobKey(jobId),
          company: finalRow.Company,
          force: true, // the overlay already showed the dupe warning
        });
        close();
        if (resp?.synced) toast("✓ Saved to Google Sheet");
        else if (resp?.queued) toast("✓ Saved — sheet sync will retry", "warn", 6000);
        else if (resp?.ok) toast("✓ Saved");
        else toast(`Failed to save: ${resp?.error || "unknown error"}`, "error", 8000);
      } catch (e) {
        close();
        toast(`Failed to save: ${e.message}`, "error", 8000);
      }
    };

    // Bound inside the shadow tree, where e.target is still the real input.
    // On the document side, events retarget to the host and the Notes check
    // below would never match.
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

    // Esc still works if focus escaped the overlay.
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

    const firstMissing = fields.find((f) => AUTO_FIELDS.has(f.key) && !row[f.key]);
    (inputs[firstMissing?.key] || inputs.Role).focus();
  }
})();
