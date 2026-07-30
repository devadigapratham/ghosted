// Loaded twice: as a content script entry, and via importScripts() in the
// worker. Hence the IIFE + globalThis instead of real modules.
(() => {
  // Column order is the sheet's column order (A..O). Row objects are keyed by
  // these strings everywhere.
  const COLUMNS = [
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

  const DEFAULT_SETTINGS = {
    spreadsheetId: "",
    sheetName: "Sheet1",
    roleOptions: ["SWE", "Data", "PM", "Research", "Other"],
    autoCapture: true,
  };

  // How long a logged job stays in the dedupe cache, and a hard cap so the
  // cache can't grow without bound.
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

  function daysBetween(isoA, isoB) {
    const a = new Date(`${isoA}T00:00:00`);
    const b = new Date(`${isoB}T00:00:00`);
    if (isNaN(a) || isNaN(b)) return 0;
    return Math.round((b - a) / 86_400_000);
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
    if (/yesterday/.test(lower)) {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return toISODate(d);
    }

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

    // Month+day with no year has to be caught before new Date(): V8 resolves
    // "Jul 5" to the year 2001 instead of failing, so an isNaN() check after
    // the fact never fires.
    let parsed;
    if (/^[a-z]+\.? \d{1,2}$/i.test(t) || /^\d{1,2} [a-z]+\.?$/i.test(t)) {
      parsed = new Date(`${t.replace(/\./g, "")}, ${now.getFullYear()}`);
      if (!isNaN(parsed) && parsed > now) parsed.setFullYear(parsed.getFullYear() - 1);
    } else {
      parsed = new Date(t);
    }
    if (isNaN(parsed)) return "";

    // Nothing was posted in the future or five years ago. Catches the rest of
    // V8's lenient-parsing surprises.
    const oldest = new Date(now);
    oldest.setFullYear(oldest.getFullYear() - 5);
    const newest = new Date(now);
    newest.setDate(newest.getDate() + 1);
    if (parsed < oldest || parsed > newest) return "";

    return toISODate(parsed);
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

  function parseSpreadsheetId(input) {
    const s = String(input || "").trim();
    const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
    return "";
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

  globalThis.GHOSTED = {
    COLUMNS,
    DEFAULT_SETTINGS,
    DEDUPE_MAX_AGE_DAYS,
    DEDUPE_MAX_ENTRIES,
    toISODate,
    todayISO,
    daysBetween,
    parsePostedDate,
    sanitizeCell,
    rowToValues,
    parseSpreadsheetId,
    pruneLoggedJobs,
  };
})();
