// Unit tests for shared/utils.js — the pure logic shared by the content
// script and the service worker. Run with `npm test` (or `node --test test/`).
//
// utils.js is a plain IIFE that assigns globalThis.HS2S (it has to be, so the
// same file can load as a content_scripts entry and via importScripts), so
// requiring it for its side effect is all the setup needed.
const test = require("node:test");
const assert = require("node:assert");

require("../shared/utils.js");
const U = globalThis.HS2S;

// Fixed clock so relative-date tests never depend on the day they run.
// Constructed with local-time parts because toISODate uses local getters.
const NOW = new Date(2026, 6, 30); // 2026-07-30

test("COLUMNS is the 15-column A..O schema", () => {
  assert.strictEqual(U.COLUMNS.length, 15);
  assert.strictEqual(U.COLUMNS[0], "Position");
  assert.strictEqual(U.COLUMNS[14], "Latest word");
  assert.strictEqual(new Set(U.COLUMNS).size, 15, "column names must be unique");
});

test.describe("parsePostedDate — relative forms", () => {
  const cases = [
    ["Posted 3 days ago", "2026-07-27"],
    ["3 days ago", "2026-07-27"],
    ["3+ days ago", "2026-07-27"],
    ["Date posted: 1 day ago", "2026-07-29"],
    ["2 weeks ago", "2026-07-16"],
    ["a week ago", "2026-07-23"],
    ["an hour ago", "2026-07-30"],
    ["2 months ago", "2026-05-30"],
    ["1 year ago", "2025-07-30"],
    ["yesterday", "2026-07-29"],
    ["Posted yesterday", "2026-07-29"],
    ["today", "2026-07-30"],
    ["just now", "2026-07-30"],
    ["5 minutes ago", "2026-07-30"],
  ];
  for (const [input, expected] of cases) {
    test(`${JSON.stringify(input)} -> ${expected}`, () => {
      assert.strictEqual(U.parsePostedDate(input, NOW), expected);
    });
  }
});

test.describe("parsePostedDate — absolute forms", () => {
  const cases = [
    ["2026-07-05", "2026-07-05"],
    ["2026-07-05T12:34:56Z", "2026-07-05"],
    ["July 5, 2026", "2026-07-05"],
    ["Jul 5, 2026", "2026-07-05"],
    ["7/5/2026", "2026-07-05"],
    ["Posted on July 5, 2026", "2026-07-05"],
  ];
  for (const [input, expected] of cases) {
    test(`${JSON.stringify(input)} -> ${expected}`, () => {
      assert.strictEqual(U.parsePostedDate(input, NOW), expected);
    });
  }
});

test.describe("parsePostedDate — month+day with no year", () => {
  // Regression: V8 resolves a bare "Jul 5" to the year 2001 instead of
  // failing, so this must be special-cased before new Date(t) is consulted.
  test('"Jul 5" assumes the current year, not 2001', () => {
    assert.strictEqual(U.parsePostedDate("Jul 5", NOW), "2026-07-05");
  });

  test('"July 5" assumes the current year', () => {
    assert.strictEqual(U.parsePostedDate("July 5", NOW), "2026-07-05");
  });

  test('"Jul. 5" tolerates an abbreviating period', () => {
    assert.strictEqual(U.parsePostedDate("Jul. 5", NOW), "2026-07-05");
  });

  test('"5 July" (day-first) assumes the current year', () => {
    assert.strictEqual(U.parsePostedDate("5 July", NOW), "2026-07-05");
  });

  test("a no-year date that would land in the future rolls back a year", () => {
    // Dec 20 is after 2026-07-30, so the posting must be from 2025.
    assert.strictEqual(U.parsePostedDate("Dec 20", NOW), "2025-12-20");
  });

  test("a no-year date earlier today is kept, not rolled back", () => {
    assert.strictEqual(U.parsePostedDate("Jul 30", NOW), "2026-07-30");
  });
});

test.describe("parsePostedDate — refuses to guess", () => {
  const blanks = [
    ["", "empty string"],
    [null, "null"],
    [undefined, "undefined"],
    ["Posted", "a bare label with no date"],
    ["sometime soon", "unparseable prose"],
    ["Apply by Friday", "an unrelated phrase"],
  ];
  for (const [input, label] of blanks) {
    test(`returns "" for ${label}`, () => {
      assert.strictEqual(U.parsePostedDate(input, NOW), "");
    });
  }

  test("rejects a future posted date", () => {
    assert.strictEqual(U.parsePostedDate("July 5, 2027", NOW), "");
  });

  test("rejects an absurdly old parsed date rather than writing it", () => {
    assert.strictEqual(U.parsePostedDate("July 5, 2001", NOW), "");
  });

  test("accepts a date just inside the 5-year sanity window", () => {
    assert.strictEqual(U.parsePostedDate("August 1, 2021", NOW), "2021-08-01");
  });

  test("an ISO-prefixed string bypasses the sanity window by design", () => {
    // The leading-ISO fast path is an explicit, machine-readable date (from
    // JSON-LD or <time datetime>), so it is trusted as-is.
    assert.strictEqual(U.parsePostedDate("2001-07-05", NOW), "2001-07-05");
  });
});

test("parsePostedDate does not mutate the clock it is given", () => {
  const now = new Date(2026, 6, 30);
  const before = now.getTime();
  U.parsePostedDate("3 days ago", now);
  U.parsePostedDate("Dec 20", now);
  U.parsePostedDate("2 months ago", now);
  assert.strictEqual(now.getTime(), before);
});

test.describe("sanitizeCell", () => {
  test("escapes a leading = so Sheets stores it as text", () => {
    assert.strictEqual(U.sanitizeCell("=1+2"), "'=1+2");
  });

  for (const ch of ["+", "-", "@"]) {
    test(`escapes a leading ${ch}`, () => {
      assert.strictEqual(U.sanitizeCell(`${ch}danger`), `'${ch}danger`);
    });
  }

  test("escapes the classic HYPERLINK injection payload", () => {
    const out = U.sanitizeCell('=HYPERLINK("http://evil.test","click")');
    assert.ok(out.startsWith("'="), `expected a leading apostrophe, got ${out}`);
  });

  test("leaves a mid-string = alone", () => {
    assert.strictEqual(U.sanitizeCell("a=b"), "a=b");
  });

  test("collapses newlines and runs of whitespace", () => {
    assert.strictEqual(U.sanitizeCell("Software\n\nEngineer   Intern"), "Software Engineer Intern");
    assert.strictEqual(U.sanitizeCell("  padded  "), "padded");
  });

  test("renders null/undefined as an empty string, not the word", () => {
    assert.strictEqual(U.sanitizeCell(null), "");
    assert.strictEqual(U.sanitizeCell(undefined), "");
    assert.strictEqual(U.sanitizeCell(""), "");
  });

  test("stringifies non-strings", () => {
    assert.strictEqual(U.sanitizeCell(42), "42");
  });

  test("escapes a negative number, which Sheets would otherwise compute", () => {
    assert.strictEqual(U.sanitizeCell("-5"), "'-5");
  });
});

test.describe("parseSpreadsheetId", () => {
  const ID = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";

  test("extracts the ID from a full edit URL", () => {
    assert.strictEqual(
      U.parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`),
      ID
    );
  });

  test("extracts the ID from a URL with query params and no /edit", () => {
    assert.strictEqual(
      U.parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}?usp=sharing`),
      ID
    );
  });

  test("passes through a bare ID", () => {
    assert.strictEqual(U.parseSpreadsheetId(ID), ID);
  });

  test("trims surrounding whitespace", () => {
    assert.strictEqual(U.parseSpreadsheetId(`  ${ID}  `), ID);
  });

  test("returns \"\" for a too-short bare token", () => {
    assert.strictEqual(U.parseSpreadsheetId("Sheet1"), "");
  });

  test("returns \"\" for empty/nullish input", () => {
    assert.strictEqual(U.parseSpreadsheetId(""), "");
    assert.strictEqual(U.parseSpreadsheetId(null), "");
    assert.strictEqual(U.parseSpreadsheetId(undefined), "");
  });

  test("returns \"\" for a non-Sheets URL", () => {
    assert.strictEqual(U.parseSpreadsheetId("https://example.test/not/a/sheet"), "");
  });
});

test.describe("rowToValues", () => {
  test("orders cells to match COLUMNS exactly", () => {
    const row = {};
    U.COLUMNS.forEach((col, i) => { row[col] = `v${i}`; });
    const values = U.rowToValues(row);
    assert.deepStrictEqual(values, U.COLUMNS.map((_, i) => `v${i}`));
  });

  test("always emits 15 cells, filling absent keys with \"\"", () => {
    const values = U.rowToValues({ Position: "SWE Intern", Company: "Acme" });
    assert.strictEqual(values.length, 15);
    assert.strictEqual(values[0], "SWE Intern");
    assert.strictEqual(values[1], "Acme");
    assert.deepStrictEqual(values.slice(2), Array(13).fill(""));
  });

  test("ignores keys that are not part of the schema", () => {
    const values = U.rowToValues({ Position: "SWE", jobId: "12345", junk: "x" });
    assert.strictEqual(values.length, 15);
    assert.ok(!values.includes("12345"));
  });

  test("sanitizes every cell it writes", () => {
    const values = U.rowToValues({ Notes: "=1+2", Position: "Data\nEngineer" });
    assert.strictEqual(values[U.COLUMNS.indexOf("Notes")], "'=1+2");
    assert.strictEqual(values[U.COLUMNS.indexOf("Position")], "Data Engineer");
  });

  test("places the accented Résumé columns correctly", () => {
    const values = U.rowToValues({ "Résumé upload?": "Yes", "Résumé Form?": "No" });
    assert.strictEqual(values[9], "Yes");
    assert.strictEqual(values[10], "No");
  });
});

test.describe("toISODate / todayISO", () => {
  test("formats using local-time parts, not UTC", () => {
    // 23:30 local on the 30th must stay the 30th even where UTC is already
    // the 31st — the bug toISOString() would introduce.
    assert.strictEqual(U.toISODate(new Date(2026, 6, 30, 23, 30)), "2026-07-30");
  });

  test("zero-pads single-digit months and days", () => {
    assert.strictEqual(U.toISODate(new Date(2026, 0, 5)), "2026-01-05");
  });

  test("todayISO matches toISODate(now)", () => {
    assert.strictEqual(U.todayISO(), U.toISODate(new Date()));
  });
});

test("DEFAULT_SETTINGS has the keys the options page reads", () => {
  for (const key of ["spreadsheetId", "sheetName", "roleOptions", "autoCapture"]) {
    assert.ok(key in U.DEFAULT_SETTINGS, `missing default: ${key}`);
  }
  assert.ok(Array.isArray(U.DEFAULT_SETTINGS.roleOptions));
});
