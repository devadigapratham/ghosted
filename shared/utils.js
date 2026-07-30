// Loaded twice: as a content script entry, and via importScripts() in the
// worker. Hence the IIFE + globalThis instead of real modules.
(() => {
  // The original A..O schema. New columns get appended after it, never
  // inserted, so a sheet created by an older version still lines up.
  const CORE_COLUMNS = [
    "Position",
    "Company",
    "Industry",
    "Role",
    "Location",
    "Date Posted",
    "Date Applied",
    "Connections?",
    "Cover Letter",
    "Résumé upload?",
    "Résumé Form?",
    "Salary Range",
    "Notes",
    "Status",
    "Latest word",
  ];

  const EXTRA_COLUMNS = [
    "Job Type",
    "Sponsorship",
    "Deadline",
    "Follow-up On",
    "Job URL",
    "Job ID",
  ];

  const COLUMNS = [...CORE_COLUMNS, ...EXTRA_COLUMNS];

  // A1 range covering the whole schema: "A:U" for 21 columns.
  function columnLetter(index) {
    let s = "";
    for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
    return s;
  }
  const LAST_COLUMN = columnLetter(COLUMNS.length - 1);

  const STATUS_OPTIONS = [
    "Applied",
    "Online assessment",
    "Phone screen",
    "Interviewing",
    "Final round",
    "Offer",
    "Rejected",
    "Withdrawn",
    "Ghosted",
  ];

  // Statuses that mean the ball is still in their court.
  const OPEN_STATUSES = new Set(["Applied", "Online assessment", "Phone screen", "Interviewing", "Final round"]);

  const DEFAULT_SETTINGS = {
    spreadsheetId: "",
    sheetName: "Sheet1",
    roleOptions: ["SWE", "Data", "PM", "Research", "Other"],
    autoCapture: true,
    // Days after applying to nudge you about silence.
    followUpDays: 14,
    remindersEnabled: true,
    // Silence past this many days counts as ghosted in the stats.
    ghostAfterDays: 21,
    // International-student features: the on-page sponsorship chip, and
    // whether an unsponsored posting is worth warning about at all.
    needsSponsorship: true,
    showSponsorshipChip: true,
  };

  const DEDUPE_MAX_AGE_DAYS = 365;
  const DEDUPE_MAX_ENTRIES = 750;

  const pad2 = (n) => String(n).padStart(2, "0");

  // Local time, not UTC — toISOString() would shift the date either side of
  // midnight depending on the timezone.
  function toISODate(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function todayISO() {
    return toISODate(new Date());
  }

  function fromISODate(iso) {
    const d = new Date(`${iso}T00:00:00`);
    return isNaN(d) ? null : d;
  }

  function addDays(iso, n) {
    const d = fromISODate(iso);
    if (!d) return "";
    d.setDate(d.getDate() + n);
    return toISODate(d);
  }

  function daysBetween(isoA, isoB) {
    const a = fromISODate(isoA);
    const b = fromISODate(isoB);
    if (!a || !b) return 0;
    return Math.round((b - a) / 86_400_000);
  }

  // Absolute dates only. Month+day with no year has to be caught before
  // new Date(): V8 resolves "Jul 5" to the year 2001 instead of failing, so an
  // isNaN() check after the fact never fires.
  function absoluteDate(t, now, preferFuture) {
    const noYear = /^[a-z]+\.? \d{1,2}(st|nd|rd|th)?$/i.test(t) || /^\d{1,2}(st|nd|rd|th)? [a-z]+\.?$/i.test(t);
    if (!noYear) {
      const d = new Date(t);
      return isNaN(d) ? null : d;
    }

    const cleaned = t.replace(/\./g, "").replace(/(\d+)(st|nd|rd|th)/i, "$1");
    const d = new Date(`${cleaned}, ${now.getFullYear()}`);
    if (isNaN(d)) return null;

    // Postings are in the past, deadlines are in the future — roll the year
    // whichever way makes the bare date make sense.
    if (preferFuture && d < now) d.setFullYear(d.getFullYear() + 1);
    if (!preferFuture && d > now) d.setFullYear(d.getFullYear() - 1);
    return d;
  }

  function withinWindow(d, now, minDays, maxDays) {
    const delta = Math.round((d - now) / 86_400_000);
    return delta >= minDays && delta <= maxDays;
  }

  // Turns whatever Handshake shows into YYYY-MM-DD. Returns "" rather than
  // guessing, so the overlay can flag the field instead of writing junk.
  function parsePostedDate(text, now = new Date()) {
    if (!text) return "";
    const t = String(text)
      .replace(/\s+/g, " ")
      .replace(/^(posted|date posted)[:\s]*/i, "")
      .trim();
    if (!t) return "";

    // Already machine-readable (JSON-LD, <time datetime>). Trusted as-is.
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);

    const lower = t.toLowerCase();
    if (/(just now|today|hour|minute|moment)/.test(lower)) return toISODate(now);
    if (/yesterday/.test(lower)) return addDays(toISODate(now), -1);

    // "3 days ago", "3+ days ago", "a week ago", "an hour ago"
    const rel = lower.match(/(\d+|an?)\+?\s*(day|week|month|year)s?\s*ago/);
    if (rel) {
      const n = /^\d+$/.test(rel[1]) ? parseInt(rel[1], 10) : 1;
      const d = new Date(now);
      if (rel[2] === "day") d.setDate(d.getDate() - n);
      else if (rel[2] === "week") d.setDate(d.getDate() - n * 7);
      else if (rel[2] === "month") d.setMonth(d.getMonth() - n);
      else d.setFullYear(d.getFullYear() - n);
      return toISODate(d);
    }

    const parsed = absoluteDate(t, now, false);
    if (!parsed) return "";
    // Nothing was posted in the future or five years ago. Catches the rest of
    // V8's lenient-parsing surprises.
    return withinWindow(parsed, now, -365 * 5, 1) ? toISODate(parsed) : "";
  }

  // Application deadlines: same idea, but they point forward.
  function parseDeadline(text, now = new Date()) {
    if (!text) return "";
    const t = String(text)
      .replace(/\s+/g, " ")
      .replace(/^(apply by|applications? (close|due|deadline)|deadline|closes?|due)[:\s]*/i, "")
      .replace(/^on\s+/i, "")
      .trim();
    if (!t) return "";

    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);

    const lower = t.toLowerCase();
    if (/^today\b/.test(lower)) return toISODate(now);
    if (/^tomorrow\b/.test(lower)) return addDays(toISODate(now), 1);

    // "in 3 days", "in 2 weeks"
    const rel = lower.match(/in\s+(\d+|an?)\s*(day|week|month)s?/);
    if (rel) {
      const n = /^\d+$/.test(rel[1]) ? parseInt(rel[1], 10) : 1;
      const d = new Date(now);
      if (rel[2] === "day") d.setDate(d.getDate() + n);
      else if (rel[2] === "week") d.setDate(d.getDate() + n * 7);
      else d.setMonth(d.getMonth() + n);
      return toISODate(d);
    }

    const parsed = absoluteDate(t, now, true);
    if (!parsed) return "";
    // A deadline can be a little in the past (just closed) but not years out.
    return withinWindow(parsed, now, -60, 365 * 2) ? toISODate(parsed) : "";
  }

  // ── Work authorization ──
  // The single most important thing on a posting if you need a visa, and it's
  // always buried in a wall of boilerplate. Most restrictive match wins, so a
  // "we sponsor H-1B" blurb can't override a clearance requirement.
  const WORK_AUTH_RULES = [
    {
      status: "Citizens/PR only",
      patterns: [
        /must be (a |an )?(u\.?s\.?|united states) citizen/i,
        /(u\.?s\.?|united states) citizenship (is )?(required|mandatory)/i,
        /citizens?(hip)? only/i,
        /(u\.?s\.?\s*)?citizens?\s+or\s+(lawful\s+)?permanent residents?\s+only/i,
        /must be a (u\.?s\.?|united states) person\b/i,
        /security clearance/i,
        /\bTS\/SCI\b/,
        /\bITAR\b/i,
        /export control(led)?\s+(regulations?|requirements?|laws?)/i,
        /ability to obtain (a )?(security )?clearance/i,
      ],
    },
    {
      status: "No sponsorship",
      patterns: [
        /no (visa |immigration |third[- ]party )?sponsorship/i,
        // "not able" needs the space alternative — (not|un)able only ever
        // matched "unable" and "notable".
        /(not\s+|un)able to (provide|offer|support|sponsor)\s*(visa |immigration )?(sponsorship)?/i,
        // "will not sponsor applicants for work visas" — the object can be
        // several words away from the verb.
        /(will|can|do|does)\s*not\s+(be able to\s+)?(provide|offer|sponsor|support)\b[^.]{0,50}(visa|sponsorship|immigration|work authoriz)/i,
        /(will|can)\s?not\s+sponsor\b/i,
        /not eligible for (visa |immigration )?sponsorship/i,
        /sponsorship (is )?(not available|unavailable|not offered|not provided|not supported)/i,
        /without (the need for |requiring |any )?(visa |immigration )?sponsorship/i,
        /authoriz(ed|ation) to work in the (u\.?s\.?|united states)[^.]{0,90}without sponsorship/i,
        /(must|do|does|will|can)\s*not\s+require\s+(visa |immigration )?sponsorship/i,
        /unable to sponsor/i,
        /we do not sponsor/i,
      ],
    },
    {
      status: "Sponsors",
      patterns: [
        // Needs a work-related object nearby, or "we do sponsor team lunches"
        // reads as good news.
        /(will|can|do|does|able to|happy to|open to)\s+sponsor\b[^.]{0,40}\b(visa|h-?1b|immigration|green card|candidate|employee|applicant|work authoriz|international|student)/i,
        /(visa|h-?1b|immigration)\s+sponsorship\s+(is )?(available|provided|offered|supported)/i,
        /sponsorship (is )?available/i,
        /we sponsor/i,
        /open to (candidates )?(requiring|needing)\s+sponsorship/i,
        /\b(f-?1|opt|cpt)\b[^.]{0,60}\b(welcome|eligible|accepted|considered)/i,
        /(welcome|encourage)[^.]{0,60}\b(international|f-?1|opt|cpt)\b/i,
        /sponsor(ship)? (for )?(h-?1b|green card|permanent residency)/i,
      ],
    },
  ];

  // Splits into sentence-ish chunks so the evidence we surface is readable.
  function sentences(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?;])\s+|\s*[•·|]\s*|\s*•\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Returns { status, evidence }. status is "" when nothing matched, which the
  // UI shows as "Unclear" — never as good news.
  function classifyWorkAuth(text) {
    if (!text) return { status: "", evidence: "" };
    const chunks = sentences(text);

    for (const rule of WORK_AUTH_RULES) {
      for (const pattern of rule.patterns) {
        const hit = chunks.find((c) => pattern.test(c));
        if (hit) {
          return {
            status: rule.status,
            evidence: hit.length > 200 ? hit.slice(0, 197) + "…" : hit,
          };
        }
        // The phrase may straddle a sentence split.
        if (pattern.test(text)) {
          const m = String(text).replace(/\s+/g, " ").match(pattern);
          return { status: rule.status, evidence: m ? m[0] : "" };
        }
      }
    }
    return { status: "", evidence: "" };
  }

  // Should we warn the user about this posting before they spend 20 minutes on it?
  function isSponsorshipBlocker(status) {
    return status === "No sponsorship" || status === "Citizens/PR only";
  }

  function normalizeJobType(text) {
    const t = String(text || "").toLowerCase();
    if (!t) return "";
    if (/\bco-?op\b/.test(t)) return "Co-op";
    if (/\bintern(ship)?\b/.test(t)) return "Internship";
    if (/\bnew grad|entry level|university grad|campus hire\b/.test(t)) return "New grad";
    if (/\bpart[- ]time\b/.test(t)) return "Part-time";
    if (/\bcontract(or)?|temporary|temp\b/.test(t)) return "Contract";
    if (/\bfull[- ]time\b/.test(t)) return "Full-time";
    if (/\bfellowship\b/.test(t)) return "Fellowship";
    if (/\bvolunteer\b/.test(t)) return "Volunteer";
    return "";
  }

  // Leading = + - @ would make Sheets evaluate the cell, so a job title of
  // "=IMPORTRANGE(...)" gets an apostrophe and stays text.
  function sanitizeCell(value) {
    let s = String(value ?? "")
      .replace(/[\r\n]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return s;
  }

  function rowToValues(row) {
    return COLUMNS.map((col) => sanitizeCell(row[col]));
  }

  // Turns a sheet row back into an object. Used by the stats read.
  function valuesToRow(values) {
    const row = {};
    COLUMNS.forEach((col, i) => { row[col] = values?.[i] ?? ""; });
    return row;
  }

  function parseSpreadsheetId(input) {
    const s = String(input || "").trim();
    const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
    return "";
  }

  function sheetUrl(spreadsheetId) {
    return spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` : "";
  }

  // Drops entries past DEDUPE_MAX_AGE_DAYS, then trims oldest-first if still
  // over the cap. Returns a new object.
  function pruneLoggedJobs(logged, today = todayISO()) {
    const entries = Object.entries(logged || {}).filter(
      ([, date]) => daysBetween(date, today) <= DEDUPE_MAX_AGE_DAYS
    );
    if (entries.length > DEDUPE_MAX_ENTRIES) {
      entries.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
      entries.splice(0, entries.length - DEDUPE_MAX_ENTRIES);
    }
    return Object.fromEntries(entries);
  }

  // Given the sheet's rows, work out what's worth telling the user. "Ghosted"
  // is an open application that's been silent past the threshold.
  function summarize(rows, settings = DEFAULT_SETTINGS, today = todayISO()) {
    const ghostAfter = settings.ghostAfterDays ?? DEFAULT_SETTINGS.ghostAfterDays;
    const stats = {
      total: 0,
      thisWeek: 0,
      open: 0,
      ghosted: 0,
      interviews: 0,
      offers: 0,
      rejected: 0,
      needsFollowUp: 0,
      responseRate: 0,
    };

    for (const row of rows) {
      if (!row.Company && !row.Position) continue;
      stats.total += 1;

      const applied = row["Date Applied"];
      const age = applied ? daysBetween(applied, today) : null;
      if (age !== null && age >= 0 && age <= 7) stats.thisWeek += 1;

      const status = (row.Status || "").trim();
      const open = OPEN_STATUSES.has(status) || status === "";

      if (status === "Offer") stats.offers += 1;
      else if (status === "Rejected") stats.rejected += 1;
      if (["Phone screen", "Interviewing", "Final round", "Online assessment"].includes(status)) {
        stats.interviews += 1;
      }

      if (open) {
        stats.open += 1;
        if (age !== null && age >= ghostAfter && (status === "Applied" || status === "")) stats.ghosted += 1;
        const due = row["Follow-up On"];
        if (due && daysBetween(due, today) >= 0 && (status === "Applied" || status === "")) {
          stats.needsFollowUp += 1;
        }
      } else if (status === "Ghosted") {
        stats.ghosted += 1;
      }
    }

    // Anything that got past "Applied" counts as a response.
    const responded = stats.interviews + stats.offers + stats.rejected;
    stats.responseRate = stats.total ? Math.round((responded / stats.total) * 100) : 0;
    return stats;
  }

  globalThis.GHOSTED = {
    CORE_COLUMNS,
    EXTRA_COLUMNS,
    COLUMNS,
    LAST_COLUMN,
    STATUS_OPTIONS,
    OPEN_STATUSES,
    DEFAULT_SETTINGS,
    DEDUPE_MAX_AGE_DAYS,
    DEDUPE_MAX_ENTRIES,
    WORK_AUTH_RULES,
    columnLetter,
    toISODate,
    todayISO,
    fromISODate,
    addDays,
    daysBetween,
    parsePostedDate,
    parseDeadline,
    classifyWorkAuth,
    isSponsorshipBlocker,
    normalizeJobType,
    sanitizeCell,
    rowToValues,
    valuesToRow,
    parseSpreadsheetId,
    sheetUrl,
    pruneLoggedJobs,
    summarize,
  };
})();
