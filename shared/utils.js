// Shared utilities. Loaded by both the content script (as a content_scripts
// entry) and the background service worker (via importScripts).
(() => {
  // The exact sheet schema, in column order (A..O). Row objects are keyed by
  // these names everywhere in the extension.
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

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  // Local-timezone YYYY-MM-DD (toISOString would shift across UTC midnight).
  function toISODate(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function todayISO() {
    return toISODate(new Date());
  }

  // Normalize a scraped posted-date string to YYYY-MM-DD.
  // Handles relative forms ("Posted 3 days ago", "2 weeks ago", "yesterday"),
  // ISO dates, and absolute forms ("Jul 5", "July 5, 2026").
  // Returns "" if it can't be parsed — never guesses.
  function parsePostedDate(text, now = new Date()) {
    if (!text) return "";
    let t = String(text)
      .replace(/\s+/g, " ")
      .replace(/^(posted|date posted)[:\s]*/i, "")
      .trim();
    if (!t) return "";

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

    // Absolute dates: "July 5, 2026", "Jul 5", "5 July", "7/5/2026".
    // Month+day with no year must be handled BEFORE new Date(t): V8's lenient
    // parser silently resolves "Jul 5" to the year 2001 rather than failing,
    // so testing for NaN afterwards would never catch it.
    let parsed;
    if (/^[a-z]+\.? \d{1,2}$/i.test(t) || /^\d{1,2} [a-z]+\.?$/i.test(t)) {
      parsed = new Date(`${t.replace(/\./g, "")}, ${now.getFullYear()}`);
      // Posted dates are in the past; if that lands in the future, it was last year.
      if (!isNaN(parsed) && parsed > now) parsed.setFullYear(parsed.getFullYear() - 1);
    } else {
      parsed = new Date(t);
    }
    if (isNaN(parsed)) return "";

    // Sanity window: a posted date can't be in the future or absurdly old.
    // This also catches other lenient-parse surprises (bare "5 Jul" style
    // strings that V8 resolves to 2001) rather than writing a wrong date.
    const oldest = new Date(now);
    oldest.setFullYear(oldest.getFullYear() - 5);
    const newest = new Date(now);
    newest.setDate(newest.getDate() + 1);
    if (parsed < oldest || parsed > newest) return "";

    return toISODate(parsed);
  }

  // Trim, collapse whitespace/newlines, and neutralize formula injection
  // (leading = + - @ gets a leading apostrophe, which Sheets treats as text).
  function sanitizeCell(value) {
    let s = String(value ?? "")
      .replace(/[\r\n]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return s;
  }

  // Convert a row object (keyed by column names) into an ordered,
  // sanitized array of 15 cells.
  function rowToValues(row) {
    return COLUMNS.map((col) => sanitizeCell(row[col]));
  }

  // Extract a spreadsheet ID from a full Sheets URL, or return the input
  // unchanged if it already looks like a bare ID.
  function parseSpreadsheetId(input) {
    const s = String(input || "").trim();
    const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
    return "";
  }

  globalThis.HS2S = {
    COLUMNS,
    DEFAULT_SETTINGS,
    toISODate,
    todayISO,
    parsePostedDate,
    sanitizeCell,
    rowToValues,
    parseSpreadsheetId,
  };
})();
