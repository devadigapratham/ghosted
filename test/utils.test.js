// Tests for the pure logic in shared/utils.js. Run: npm test
// utils.js is an IIFE that assigns globalThis.GHOSTED, so requiring it for the
// side effect is the whole setup.
const test = require("node:test");
const assert = require("node:assert");

require("../shared/utils.js");
const U = globalThis.GHOSTED;

// Fixed clock, built from local parts because toISODate reads local getters.
const NOW = new Date(2026, 6, 30); // 2026-07-30

test("COLUMNS is the 15-column A..O schema", () => {
  assert.strictEqual(U.COLUMNS.length, 15);
  assert.strictEqual(U.COLUMNS[0], "Position");
  assert.strictEqual(U.COLUMNS[14], "Latest word");
  assert.strictEqual(new Set(U.COLUMNS).size, 15, "column names must be unique");
});

test.describe("parsePostedDate — relative", () => {
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

test.describe("parsePostedDate — absolute", () => {
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

test.describe("parsePostedDate — month+day, no year", () => {
  // V8 parses a bare "Jul 5" as the year 2001 instead of failing, which is why
  // this case is handled before new Date() gets a look.
  test('"Jul 5" uses the current year, not 2001', () => {
    assert.strictEqual(U.parsePostedDate("Jul 5", NOW), "2026-07-05");
  });

  test('"July 5" uses the current year', () => {
    assert.strictEqual(U.parsePostedDate("July 5", NOW), "2026-07-05");
  });

  test('"Jul. 5" tolerates the abbreviating period', () => {
    assert.strictEqual(U.parsePostedDate("Jul. 5", NOW), "2026-07-05");
  });

  test('"5 July" (day first) uses the current year', () => {
    assert.strictEqual(U.parsePostedDate("5 July", NOW), "2026-07-05");
  });

  test("a date that would land in the future rolls back a year", () => {
    assert.strictEqual(U.parsePostedDate("Dec 20", NOW), "2025-12-20");
  });

  test("today's date is kept, not rolled back", () => {
    assert.strictEqual(U.parsePostedDate("Jul 30", NOW), "2026-07-30");
  });
});

test.describe("parsePostedDate — refuses to guess", () => {
  const blanks = [
    ["", "empty string"],
    [null, "null"],
    [undefined, "undefined"],
    ["Posted", "a bare label"],
    ["sometime soon", "unparseable prose"],
    ["Apply by Friday", "an unrelated phrase"],
  ];
  for (const [input, label] of blanks) {
    test(`returns "" for ${label}`, () => {
      assert.strictEqual(U.parsePostedDate(input, NOW), "");
    });
  }

  test("rejects a future date", () => {
    assert.strictEqual(U.parsePostedDate("July 5, 2027", NOW), "");
  });

  test("rejects an absurdly old date instead of writing it", () => {
    assert.strictEqual(U.parsePostedDate("July 5, 2001", NOW), "");
  });

  test("accepts a date just inside the 5-year window", () => {
    assert.strictEqual(U.parsePostedDate("August 1, 2021", NOW), "2021-08-01");
  });

  test("an ISO string bypasses the window by design", () => {
    // Machine-readable dates come from JSON-LD or <time datetime> and are trusted.
    assert.strictEqual(U.parsePostedDate("2001-07-05", NOW), "2001-07-05");
  });
});

test("parsePostedDate doesn't mutate the clock it's handed", () => {
  const now = new Date(2026, 6, 30);
  const before = now.getTime();
  U.parsePostedDate("3 days ago", now);
  U.parsePostedDate("Dec 20", now);
  U.parsePostedDate("2 months ago", now);
  assert.strictEqual(now.getTime(), before);
});

test.describe("sanitizeCell", () => {
  test("escapes a leading = so Sheets keeps it as text", () => {
    assert.strictEqual(U.sanitizeCell("=1+2"), "'=1+2");
  });

  for (const ch of ["+", "-", "@"]) {
    test(`escapes a leading ${ch}`, () => {
      assert.strictEqual(U.sanitizeCell(`${ch}danger`), `'${ch}danger`);
    });
  }

  test("escapes a HYPERLINK payload", () => {
    const out = U.sanitizeCell('=HYPERLINK("http://evil.test","click")');
    assert.ok(out.startsWith("'="), `expected a leading apostrophe, got ${out}`);
  });

  test("leaves a mid-string = alone", () => {
    assert.strictEqual(U.sanitizeCell("a=b"), "a=b");
  });

  test("collapses newlines and whitespace runs", () => {
    assert.strictEqual(U.sanitizeCell("Software\n\nEngineer   Intern"), "Software Engineer Intern");
    assert.strictEqual(U.sanitizeCell("  padded  "), "padded");
  });

  test("nullish becomes empty, not the literal word", () => {
    assert.strictEqual(U.sanitizeCell(null), "");
    assert.strictEqual(U.sanitizeCell(undefined), "");
    assert.strictEqual(U.sanitizeCell(""), "");
  });

  test("stringifies non-strings", () => {
    assert.strictEqual(U.sanitizeCell(42), "42");
  });

  test("escapes a negative number Sheets would otherwise compute", () => {
    assert.strictEqual(U.sanitizeCell("-5"), "'-5");
  });
});

test.describe("parseSpreadsheetId", () => {
  const ID = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";

  test("pulls the ID out of a full edit URL", () => {
    assert.strictEqual(U.parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`), ID);
  });

  test("pulls the ID out of a share URL", () => {
    assert.strictEqual(U.parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}?usp=sharing`), ID);
  });

  test("passes a bare ID through", () => {
    assert.strictEqual(U.parseSpreadsheetId(ID), ID);
  });

  test("trims whitespace", () => {
    assert.strictEqual(U.parseSpreadsheetId(`  ${ID}  `), ID);
  });

  test('returns "" for a too-short token', () => {
    assert.strictEqual(U.parseSpreadsheetId("Sheet1"), "");
  });

  test('returns "" for nothing', () => {
    assert.strictEqual(U.parseSpreadsheetId(""), "");
    assert.strictEqual(U.parseSpreadsheetId(null), "");
    assert.strictEqual(U.parseSpreadsheetId(undefined), "");
  });

  test('returns "" for a non-Sheets URL', () => {
    assert.strictEqual(U.parseSpreadsheetId("https://example.test/not/a/sheet"), "");
  });
});

test.describe("rowToValues", () => {
  test("orders cells to match COLUMNS", () => {
    const row = {};
    U.COLUMNS.forEach((col, i) => { row[col] = `v${i}`; });
    assert.deepStrictEqual(U.rowToValues(row), U.COLUMNS.map((_, i) => `v${i}`));
  });

  test('always emits 15 cells, absent keys as ""', () => {
    const values = U.rowToValues({ Position: "SWE Intern", Company: "Acme" });
    assert.strictEqual(values.length, 15);
    assert.strictEqual(values[0], "SWE Intern");
    assert.strictEqual(values[1], "Acme");
    assert.deepStrictEqual(values.slice(2), Array(13).fill(""));
  });

  test("drops keys that aren't in the schema", () => {
    const values = U.rowToValues({ Position: "SWE", jobId: "12345", junk: "x" });
    assert.strictEqual(values.length, 15);
    assert.ok(!values.includes("12345"));
  });

  test("sanitizes every cell", () => {
    const values = U.rowToValues({ Notes: "=1+2", Position: "Data\nEngineer" });
    assert.strictEqual(values[U.COLUMNS.indexOf("Notes")], "'=1+2");
    assert.strictEqual(values[U.COLUMNS.indexOf("Position")], "Data Engineer");
  });

  test("puts the accented Résumé columns in the right slots", () => {
    const values = U.rowToValues({ "Résumé upload?": "Yes", "Résumé Form?": "No" });
    assert.strictEqual(values[9], "Yes");
    assert.strictEqual(values[10], "No");
  });
});

test.describe("toISODate / todayISO", () => {
  test("uses local parts, not UTC", () => {
    // 23:30 on the 30th stays the 30th even where UTC has rolled over.
    assert.strictEqual(U.toISODate(new Date(2026, 6, 30, 23, 30)), "2026-07-30");
  });

  test("zero-pads month and day", () => {
    assert.strictEqual(U.toISODate(new Date(2026, 0, 5)), "2026-01-05");
  });

  test("todayISO agrees with toISODate(now)", () => {
    assert.strictEqual(U.todayISO(), U.toISODate(new Date()));
  });
});

test.describe("daysBetween", () => {
  test("counts forward", () => {
    assert.strictEqual(U.daysBetween("2026-07-27", "2026-07-30"), 3);
  });

  test("is zero for the same day", () => {
    assert.strictEqual(U.daysBetween("2026-07-30", "2026-07-30"), 0);
  });

  test("spans a month boundary", () => {
    assert.strictEqual(U.daysBetween("2026-06-30", "2026-07-30"), 30);
  });

  test("returns 0 on garbage rather than NaN", () => {
    assert.strictEqual(U.daysBetween("nope", "2026-07-30"), 0);
  });
});

test.describe("pruneLoggedJobs", () => {
  const TODAY = "2026-07-30";

  test("keeps recent entries untouched", () => {
    const logged = { 111: "2026-07-29", 222: "2026-07-01" };
    assert.deepStrictEqual(U.pruneLoggedJobs(logged, TODAY), logged);
  });

  test("drops entries past the age limit", () => {
    const logged = { fresh: "2026-07-29", ancient: "2020-01-01" };
    const out = U.pruneLoggedJobs(logged, TODAY);
    assert.deepStrictEqual(Object.keys(out), ["fresh"]);
  });

  test("keeps an entry exactly at the age limit", () => {
    const logged = { edge: "2025-07-30" }; // 365 days old
    assert.strictEqual(U.daysBetween("2025-07-30", TODAY), 365);
    assert.deepStrictEqual(U.pruneLoggedJobs(logged, TODAY), logged);
  });

  test("caps the cache, dropping oldest first", () => {
    const logged = {};
    for (let i = 0; i < U.DEDUPE_MAX_ENTRIES + 50; i++) {
      // Older ids get older dates, so ids 0..49 should be the ones evicted.
      const day = String((i % 28) + 1).padStart(2, "0");
      const month = i < 50 ? "01" : "07";
      logged[`job${i}`] = `2026-${month}-${day}`;
    }
    const out = U.pruneLoggedJobs(logged, TODAY);
    assert.strictEqual(Object.keys(out).length, U.DEDUPE_MAX_ENTRIES);
    assert.ok(!("job0" in out), "oldest entry should have been evicted");
    assert.ok(`job${U.DEDUPE_MAX_ENTRIES + 49}` in out, "newest entry should survive");
  });

  test("handles an empty or missing cache", () => {
    assert.deepStrictEqual(U.pruneLoggedJobs({}, TODAY), {});
    assert.deepStrictEqual(U.pruneLoggedJobs(undefined, TODAY), {});
  });

  test("doesn't mutate its input", () => {
    const logged = { fresh: "2026-07-29", ancient: "2019-01-01" };
    U.pruneLoggedJobs(logged, TODAY);
    assert.strictEqual(Object.keys(logged).length, 2);
  });
});

test("DEFAULT_SETTINGS has the keys the options page reads", () => {
  for (const key of ["spreadsheetId", "sheetName", "roleOptions", "autoCapture"]) {
    assert.ok(key in U.DEFAULT_SETTINGS, `missing default: ${key}`);
  }
  assert.ok(Array.isArray(U.DEFAULT_SETTINGS.roleOptions));
});
