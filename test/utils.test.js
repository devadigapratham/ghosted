// Tests for the pure logic in shared/utils.js. Run: npm test
// utils.js is an IIFE that assigns globalThis.GHOSTED, so requiring it for the
// side effect is the whole setup.
const test = require("node:test");
const assert = require("node:assert");

require("../shared/utils.js");
const U = globalThis.GHOSTED;

// Fixed clock, built from local parts because toISODate reads local getters.
const NOW = new Date(2026, 6, 30); // 2026-07-30

test("COLUMNS starts at Position and stays unique", () => {
  assert.strictEqual(U.COLUMNS[0], "Position");
  assert.strictEqual(U.COLUMNS[14], "Latest word");
  assert.strictEqual(new Set(U.COLUMNS).size, U.COLUMNS.length, "column names must be unique");
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

  test('emits the full width, absent keys as ""', () => {
    const values = U.rowToValues({ Position: "SWE Intern", Company: "Acme" });
    assert.strictEqual(values.length, U.COLUMNS.length);
    assert.strictEqual(values[0], "SWE Intern");
    assert.strictEqual(values[1], "Acme");
    assert.deepStrictEqual(values.slice(2), Array(U.COLUMNS.length - 2).fill(""));
  });

  test("drops keys that aren't in the schema", () => {
    const values = U.rowToValues({ Position: "SWE", jobId: "12345", junk: "x" });
    assert.strictEqual(values.length, U.COLUMNS.length);
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

test.describe("parseDeadline", () => {
  test.describe("recognizes the usual phrasings", () => {
    const cases = [
      ["Apply by Aug 15", "2026-08-15"],
      ["Deadline: 2026-09-01", "2026-09-01"],
      ["Applications close September 1, 2026", "2026-09-01"],
      ["apply by tomorrow", "2026-07-31"],
      ["in 2 weeks", "2026-08-13"],
      ["Aug 15", "2026-08-15"],
      ["August 15th", "2026-08-15"],
    ];
    for (const [input, expected] of cases) {
      test(`${JSON.stringify(input)} -> ${expected}`, () => {
        assert.strictEqual(U.parseDeadline(input, NOW), expected);
      });
    }
  });

  test("a bare month+day already past rolls forward a year", () => {
    // Deadlines point forward, the opposite of posted dates.
    assert.strictEqual(U.parseDeadline("January 10", NOW), "2027-01-10");
    assert.strictEqual(U.parsePostedDate("January 10", NOW), "2026-01-10");
  });

  test("allows a recently closed deadline", () => {
    assert.strictEqual(U.parseDeadline("2026-07-10", NOW), "2026-07-10");
  });

  test("rejects something years out", () => {
    assert.strictEqual(U.parseDeadline("March 3, 2031", NOW), "");
  });

  test('returns "" for junk and blanks', () => {
    assert.strictEqual(U.parseDeadline("rolling basis", NOW), "");
    assert.strictEqual(U.parseDeadline("", NOW), "");
    assert.strictEqual(U.parseDeadline(null, NOW), "");
  });
});

test.describe("classifyWorkAuth", () => {
  const status = (text) => U.classifyWorkAuth(text).status;

  test.describe("flags postings that won't sponsor", () => {
    const cases = [
      "Applicants must be authorized to work in the U.S. without the need for visa sponsorship.",
      "We do not sponsor employment visas at this time.",
      "This role is not eligible for visa sponsorship.",
      "Visa sponsorship is not offered for this position.",
      "We are unable to offer visa sponsorship.",
      "Employer will not sponsor applicants for work visas.",
      "Candidates must not require sponsorship now or in the future.",
      "No visa sponsorship is available.",
    ];
    for (const text of cases) {
      test(text.slice(0, 52), () => assert.strictEqual(status(text), "No sponsorship"));
    }
  });

  test.describe("flags citizenship and clearance requirements", () => {
    const cases = [
      "Must be a US citizen.",
      "U.S. citizenship is required for this role.",
      "This position requires an active security clearance.",
      "Must be a US person as defined under ITAR.",
      "Open to US citizens or permanent residents only.",
      "Candidates must be able to obtain a security clearance.",
    ];
    for (const text of cases) {
      test(text.slice(0, 52), () => assert.strictEqual(status(text), "Citizens/PR only"));
    }
  });

  test.describe("recognizes employers that do sponsor", () => {
    const cases = [
      "We are happy to sponsor H-1B visas for exceptional candidates.",
      "Visa sponsorship is available for this role.",
      "F-1 students on OPT or CPT are welcome to apply.",
      "We sponsor for H-1B and green card.",
      "We encourage international students to apply.",
    ];
    for (const text of cases) {
      test(text.slice(0, 52), () => assert.strictEqual(status(text), "Sponsors"));
    }
  });

  test("a restriction beats a sponsorship blurb elsewhere in the posting", () => {
    const text =
      "We will sponsor H-1B for the right person. This program is subject to ITAR and requires US person status.";
    assert.strictEqual(status(text), "Citizens/PR only");
  });

  test('"not able to" is caught, not just "unable to"', () => {
    assert.strictEqual(status("We are not able to provide visa sponsorship."), "No sponsorship");
    assert.strictEqual(status("We are not able to sponsor visas."), "No sponsorship");
  });

  test("a sponsored lunch is not visa sponsorship", () => {
    assert.strictEqual(status("We do sponsor team lunches every Friday."), "");
  });

  test("no-sponsorship beats a stray positive mention", () => {
    const text = "Sponsorship: we are not able to provide visa sponsorship. We do sponsor team lunches.";
    assert.strictEqual(status(text), "No sponsorship");
  });

  test('says nothing rather than guessing when the posting is silent', () => {
    assert.strictEqual(status("Acme is an equal opportunity employer. Free snacks."), "");
    assert.strictEqual(status(""), "");
    assert.strictEqual(status(null), "");
  });

  test("doesn't trip on the bare word 'person'", () => {
    assert.strictEqual(status("You must be a detail-oriented person who loves data."), "");
  });

  test("doesn't treat a generic 'no experience required' as a restriction", () => {
    assert.strictEqual(status("No experience required. Training provided."), "");
  });

  test("returns the sentence it matched as evidence", () => {
    const r = U.classifyWorkAuth("Great team. We do not sponsor employment visas. Apply today.");
    assert.strictEqual(r.status, "No sponsorship");
    assert.match(r.evidence, /do not sponsor/i);
    assert.ok(!/Great team/.test(r.evidence), "evidence should be the matching sentence only");
  });

  test("caps evidence length", () => {
    const r = U.classifyWorkAuth("x ".repeat(400) + "we do not sponsor visas");
    assert.ok(r.evidence.length <= 200, `evidence was ${r.evidence.length} chars`);
  });
});

test.describe("isSponsorshipBlocker", () => {
  test("blocks on no-sponsorship and citizens-only", () => {
    assert.ok(U.isSponsorshipBlocker("No sponsorship"));
    assert.ok(U.isSponsorshipBlocker("Citizens/PR only"));
  });

  test("does not block on sponsors, unclear or empty", () => {
    assert.ok(!U.isSponsorshipBlocker("Sponsors"));
    assert.ok(!U.isSponsorshipBlocker("Unclear"));
    assert.ok(!U.isSponsorshipBlocker(""));
  });
});

test.describe("normalizeJobType", () => {
  const cases = [
    ["Internship", "Internship"],
    ["Summer 2027 Software Engineering Intern", "Internship"],
    ["Co-op", "Co-op"],
    ["Coop Engineering", "Co-op"],
    ["Full-time", "Full-time"],
    ["FULL TIME", "Full-time"],
    ["New Grad Software Engineer", "New grad"],
    ["Part-time barista", "Part-time"],
    ["Contract role", "Contract"],
    ["Research Fellowship", "Fellowship"],
    ["Senior Engineer", ""],
    ["", ""],
    [null, ""],
  ];
  for (const [input, expected] of cases) {
    test(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
      assert.strictEqual(U.normalizeJobType(input), expected);
    });
  }

  test("co-op wins over intern when both appear", () => {
    assert.strictEqual(U.normalizeJobType("Engineering Co-op / Internship"), "Co-op");
  });
});

test.describe("schema growth", () => {
  test("CORE_COLUMNS is still the original A..O prefix", () => {
    assert.strictEqual(U.CORE_COLUMNS.length, 15);
    assert.deepStrictEqual(U.COLUMNS.slice(0, 15), U.CORE_COLUMNS);
  });

  test("new columns are appended, never inserted", () => {
    assert.deepStrictEqual(U.COLUMNS.slice(15), U.EXTRA_COLUMNS);
    assert.strictEqual(U.CORE_COLUMNS[14], "Latest word");
  });

  test("column names stay unique", () => {
    assert.strictEqual(new Set(U.COLUMNS).size, U.COLUMNS.length);
  });

  test("LAST_COLUMN matches the schema width", () => {
    assert.strictEqual(U.LAST_COLUMN, U.columnLetter(U.COLUMNS.length - 1));
  });

  test("columnLetter handles the A..Z boundary", () => {
    assert.strictEqual(U.columnLetter(0), "A");
    assert.strictEqual(U.columnLetter(25), "Z");
    assert.strictEqual(U.columnLetter(26), "AA");
    assert.strictEqual(U.columnLetter(27), "AB");
  });

  test("rowToValues covers the full width", () => {
    assert.strictEqual(U.rowToValues({}).length, U.COLUMNS.length);
  });
});

test.describe("valuesToRow", () => {
  test("round-trips through rowToValues", () => {
    const row = {};
    U.COLUMNS.forEach((col, i) => { row[col] = `v${i}`; });
    assert.deepStrictEqual(U.valuesToRow(U.rowToValues(row)), row);
  });

  test("pads a short row from the sheet", () => {
    // Sheets omits trailing empty cells, so rows come back short.
    const row = U.valuesToRow(["SWE", "Acme"]);
    assert.strictEqual(row.Position, "SWE");
    assert.strictEqual(row.Company, "Acme");
    assert.strictEqual(row["Job ID"], "");
    assert.strictEqual(Object.keys(row).length, U.COLUMNS.length);
  });

  test("survives undefined", () => {
    assert.strictEqual(U.valuesToRow(undefined).Position, "");
  });
});

test.describe("addDays", () => {
  test("moves forward", () => {
    assert.strictEqual(U.addDays("2026-07-30", 14), "2026-08-13");
  });

  test("moves backward", () => {
    assert.strictEqual(U.addDays("2026-07-30", -1), "2026-07-29");
  });

  test("crosses a year boundary", () => {
    assert.strictEqual(U.addDays("2026-12-31", 1), "2027-01-01");
  });

  test("handles a leap day", () => {
    assert.strictEqual(U.addDays("2028-02-28", 1), "2028-02-29");
  });

  test('returns "" on junk', () => {
    assert.strictEqual(U.addDays("nope", 5), "");
  });
});

test.describe("summarize", () => {
  const TODAY = "2026-07-30";
  const settings = { ...U.DEFAULT_SETTINGS, ghostAfterDays: 21 };
  const row = (over) => ({ Company: "Acme", Position: "SWE", Status: "Applied", ...over });

  test("counts totals and this week", () => {
    const stats = U.summarize(
      [
        row({ "Date Applied": "2026-07-29" }),
        row({ "Date Applied": "2026-07-25" }),
        row({ "Date Applied": "2026-06-01" }),
      ],
      settings,
      TODAY
    );
    assert.strictEqual(stats.total, 3);
    assert.strictEqual(stats.thisWeek, 2);
  });

  test("skips blank spacer rows", () => {
    const stats = U.summarize([row({}), { Status: "Applied" }, {}], settings, TODAY);
    assert.strictEqual(stats.total, 1);
  });

  test("counts silence past the threshold as ghosted", () => {
    const stats = U.summarize(
      [
        row({ "Date Applied": "2026-06-01" }), // 59 days, silent
        row({ "Date Applied": "2026-07-29" }), // 1 day, too soon
      ],
      settings,
      TODAY
    );
    assert.strictEqual(stats.ghosted, 1);
  });

  test("an old application that got a reply is not ghosted", () => {
    const stats = U.summarize(
      [row({ "Date Applied": "2026-06-01", Status: "Interviewing" })],
      settings,
      TODAY
    );
    assert.strictEqual(stats.ghosted, 0);
    assert.strictEqual(stats.interviews, 1);
  });

  test("respects an explicit Ghosted status regardless of age", () => {
    const stats = U.summarize([row({ "Date Applied": TODAY, Status: "Ghosted" })], settings, TODAY);
    assert.strictEqual(stats.ghosted, 1);
    assert.strictEqual(stats.open, 0);
  });

  test("counts offers, rejections and open applications", () => {
    const stats = U.summarize(
      [
        row({ Status: "Offer" }),
        row({ Status: "Rejected" }),
        row({ Status: "Applied" }),
        row({ Status: "Final round" }),
      ],
      settings,
      TODAY
    );
    assert.strictEqual(stats.offers, 1);
    assert.strictEqual(stats.rejected, 1);
    assert.strictEqual(stats.open, 2);
    assert.strictEqual(stats.interviews, 1);
  });

  test("response rate counts anything past Applied", () => {
    const stats = U.summarize(
      [row({ Status: "Applied" }), row({ Status: "Rejected" }), row({ Status: "Offer" }), row({ Status: "Applied" })],
      settings,
      TODAY
    );
    assert.strictEqual(stats.responseRate, 50);
  });

  test("response rate is 0, not NaN, for an empty sheet", () => {
    const stats = U.summarize([], settings, TODAY);
    assert.strictEqual(stats.responseRate, 0);
    assert.strictEqual(stats.total, 0);
  });

  test("counts follow-ups that are due, but not future ones", () => {
    const stats = U.summarize(
      [
        row({ "Follow-up On": "2026-07-29" }), // due
        row({ "Follow-up On": TODAY }), // due today
        row({ "Follow-up On": "2026-08-20" }), // not yet
      ],
      settings,
      TODAY
    );
    assert.strictEqual(stats.needsFollowUp, 2);
  });

  test("does not chase a follow-up on a closed application", () => {
    const stats = U.summarize(
      [row({ "Follow-up On": "2026-07-01", Status: "Rejected" })],
      settings,
      TODAY
    );
    assert.strictEqual(stats.needsFollowUp, 0);
  });

  test("treats a blank status as still open", () => {
    const stats = U.summarize([row({ Status: "", "Date Applied": "2026-06-01" })], settings, TODAY);
    assert.strictEqual(stats.open, 1);
    assert.strictEqual(stats.ghosted, 1);
  });

  test("honors a custom ghost threshold", () => {
    const rows = [row({ "Date Applied": "2026-07-20" })]; // 10 days
    assert.strictEqual(U.summarize(rows, { ...settings, ghostAfterDays: 7 }, TODAY).ghosted, 1);
    assert.strictEqual(U.summarize(rows, { ...settings, ghostAfterDays: 30 }, TODAY).ghosted, 0);
  });
});

test.describe("sheetUrl", () => {
  test("builds an edit URL", () => {
    assert.strictEqual(U.sheetUrl("abc123"), "https://docs.google.com/spreadsheets/d/abc123/edit");
  });

  test('returns "" with no ID', () => {
    assert.strictEqual(U.sheetUrl(""), "");
    assert.strictEqual(U.sheetUrl(undefined), "");
  });
});

test("DEFAULT_SETTINGS covers every new option the pages read", () => {
  for (const key of ["followUpDays", "remindersEnabled", "ghostAfterDays", "needsSponsorship", "showSponsorshipChip"]) {
    assert.ok(key in U.DEFAULT_SETTINGS, `missing default: ${key}`);
  }
});

test.describe("toCSV / toTSV", () => {
  const row = (over) => ({ Position: "SWE", Company: "Acme", ...over });

  test("starts with the schema header", () => {
    const lines = U.toCSV([]).split("\r\n");
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0], U.COLUMNS.join(","));
  });

  test("writes one line per application", () => {
    const lines = U.toCSV([row(), row(), row()]).split("\r\n");
    assert.strictEqual(lines.length, 4); // header + 3
  });

  test("quotes a value containing a comma", () => {
    const csv = U.toCSV([row({ Location: "Seattle, WA" })]);
    assert.match(csv, /"Seattle, WA"/);
  });

  test("doubles embedded quotes", () => {
    const csv = U.toCSV([row({ Notes: 'she said "hi"' })]);
    assert.match(csv, /"she said ""hi"""/);
  });

  test("does not quote a plain value", () => {
    const csv = U.toCSV([row({ Company: "Acme" })]);
    assert.ok(!/"Acme"/.test(csv), "plain values should stay unquoted");
  });

  test("keeps the formula guard in the export", () => {
    // A CSV opened in Excel evaluates formulas too, so the apostrophe matters
    // just as much here as in Sheets.
    const csv = U.toCSV([row({ Notes: "=1+2" })]);
    assert.match(csv, /'=1\+2/);
  });

  test("TSV separates with tabs and quotes a value containing one", () => {
    const tsv = U.toTSV([row({ Location: "Seattle, WA" })]);
    assert.ok(tsv.includes("\t"), "expected tab separators");
    // A comma needs no quoting in TSV.
    assert.ok(!/"Seattle, WA"/.test(tsv), "commas should not be quoted in TSV");
  });

  test("column count per line matches the schema", () => {
    const line = U.toCSV([row()]).split("\r\n")[1];
    // No quoted commas in this row, so a naive split is a valid check.
    assert.strictEqual(line.split(",").length, U.COLUMNS.length);
  });

  test("handles an empty or missing list", () => {
    assert.strictEqual(U.toCSV([]), U.COLUMNS.join(","));
    assert.strictEqual(U.toCSV(undefined), U.COLUMNS.join(","));
  });

  test("ignores the local-only bookkeeping keys", () => {
    const csv = U.toCSV([row({ id: "uuid-here", savedAt: 123, synced: true })]);
    assert.ok(!csv.includes("uuid-here"), "internal id should not be exported");
    assert.ok(!csv.includes("123"), "savedAt should not be exported");
  });
});

test.describe("sortApplications", () => {
  test("puts the most recent application first", () => {
    const sorted = U.sortApplications([
      { Company: "old", "Date Applied": "2026-07-01" },
      { Company: "new", "Date Applied": "2026-07-30" },
      { Company: "mid", "Date Applied": "2026-07-15" },
    ]);
    assert.deepStrictEqual(sorted.map((a) => a.Company), ["new", "mid", "old"]);
  });

  test("breaks ties on save time, newest first", () => {
    const sorted = U.sortApplications([
      { Company: "first", "Date Applied": "2026-07-30", savedAt: 100 },
      { Company: "second", "Date Applied": "2026-07-30", savedAt: 200 },
    ]);
    assert.deepStrictEqual(sorted.map((a) => a.Company), ["second", "first"]);
  });

  test("does not mutate the input", () => {
    const apps = [
      { Company: "a", "Date Applied": "2026-07-01" },
      { Company: "b", "Date Applied": "2026-07-30" },
    ];
    U.sortApplications(apps);
    assert.strictEqual(apps[0].Company, "a");
  });

  test("survives missing dates and an empty list", () => {
    assert.strictEqual(U.sortApplications([]).length, 0);
    assert.strictEqual(U.sortApplications(undefined).length, 0);
    assert.strictEqual(U.sortApplications([{ Company: "x" }]).length, 1);
  });
});

test("summarize works on the local log shape, extra keys and all", () => {
  // What storage.local actually holds: schema fields plus id/savedAt/synced.
  const apps = [
    { Company: "Acme", Position: "SWE", Status: "Applied", "Date Applied": "2026-07-29", id: "a", savedAt: 1, synced: false },
    { Company: "Beta", Position: "SWE", Status: "Offer", "Date Applied": "2026-07-28", id: "b", savedAt: 2, synced: true },
  ];
  const stats = U.summarize(apps, U.DEFAULT_SETTINGS, "2026-07-30");
  assert.strictEqual(stats.total, 2);
  assert.strictEqual(stats.offers, 1);
  assert.strictEqual(stats.thisWeek, 2);
});

test.describe("parseDelimited", () => {
  test("splits a simple CSV", () => {
    assert.deepStrictEqual(U.parseDelimited("a,b\n1,2", ","), [["a", "b"], ["1", "2"]]);
  });

  test("keeps a quoted comma inside one field", () => {
    assert.deepStrictEqual(U.parseDelimited('a,b\n"Seattle, WA",x', ","), [["a", "b"], ["Seattle, WA", "x"]]);
  });

  test("unescapes doubled quotes", () => {
    assert.deepStrictEqual(U.parseDelimited('a\n"she said ""hi"""', ","), [["a"], ['she said "hi"']]);
  });

  test("handles CRLF line endings", () => {
    assert.deepStrictEqual(U.parseDelimited("a,b\r\n1,2\r\n", ","), [["a", "b"], ["1", "2"]]);
  });

  test("ignores a trailing newline instead of adding a blank row", () => {
    assert.strictEqual(U.parseDelimited("a,b\n1,2\n", ",").length, 2);
  });

  test("drops all-blank rows", () => {
    assert.strictEqual(U.parseDelimited("a,b\n,\n1,2", ",").length, 2);
  });

  test("strips a UTF-8 BOM from the first header", () => {
    const table = U.parseDelimited("﻿Position,Company\nSWE,Acme", ",");
    assert.strictEqual(table[0][0], "Position");
  });

  test("reads tab-separated input", () => {
    assert.deepStrictEqual(U.parseDelimited("a\tb\n1\t2", "\t"), [["a", "b"], ["1", "2"]]);
  });

  test("survives empty input", () => {
    assert.deepStrictEqual(U.parseDelimited("", ","), []);
    assert.deepStrictEqual(U.parseDelimited(null, ","), []);
  });
});

test.describe("sniffDelimiter", () => {
  test("picks tab when the header has more tabs", () => {
    assert.strictEqual(U.sniffDelimiter("a\tb\tc\n1\t2\t3"), "\t");
  });
  test("picks comma otherwise", () => {
    assert.strictEqual(U.sniffDelimiter("a,b,c\n1,2,3"), ",");
  });
  test("defaults to comma on junk", () => {
    assert.strictEqual(U.sniffDelimiter(""), ",");
  });
});

test.describe("rowsFromDelimited", () => {
  const header = U.COLUMNS.join(",");

  test("round-trips what toCSV produced", () => {
    const original = [
      { Position: "SWE Intern", Company: "Acme", Status: "Applied", "Date Applied": "2026-07-30",
        Location: "Seattle, WA", Notes: 'said "hi"', Sponsorship: "No sponsorship", "Job ID": "123" },
    ];
    const { rows, error } = U.rowsFromDelimited(U.toCSV(original));
    assert.strictEqual(error, "");
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].Position, "SWE Intern");
    assert.strictEqual(rows[0].Location, "Seattle, WA");
    assert.strictEqual(rows[0].Sponsorship, "No sponsorship");
    assert.strictEqual(rows[0]["Job ID"], "123");
  });

  test("round-trips TSV too", () => {
    const { rows } = U.rowsFromDelimited(U.toTSV([{ Company: "Acme", Position: "SWE" }]));
    assert.strictEqual(rows[0].Company, "Acme");
  });

  test("accepts columns in a different order", () => {
    const { rows, error } = U.rowsFromDelimited("Company,Position\nAcme,SWE");
    assert.strictEqual(error, "");
    assert.strictEqual(rows[0].Company, "Acme");
    assert.strictEqual(rows[0].Position, "SWE");
  });

  test("is case-insensitive about headers", () => {
    const { rows } = U.rowsFromDelimited("company,POSITION\nAcme,SWE");
    assert.strictEqual(rows[0].Company, "Acme");
  });

  test("ignores unknown columns rather than failing", () => {
    const { rows, error } = U.rowsFromDelimited("Company,Vibes,Position\nAcme,good,SWE");
    assert.strictEqual(error, "");
    assert.strictEqual(rows[0].Company, "Acme");
    assert.strictEqual(rows[0].Position, "SWE");
  });

  test("fills missing schema columns with empty strings", () => {
    const { rows } = U.rowsFromDelimited("Company\nAcme");
    assert.strictEqual(Object.keys(rows[0]).length, U.COLUMNS.length);
    assert.strictEqual(rows[0].Status, "");
  });

  test("errors when no header is recognizable", () => {
    const { rows, error } = U.rowsFromDelimited("foo,bar\n1,2");
    assert.strictEqual(rows.length, 0);
    assert.match(error, /recognizable/i);
  });

  test("errors on empty input", () => {
    assert.match(U.rowsFromDelimited("").error, /empty/i);
  });

  test("drops rows with neither company nor position", () => {
    const { rows } = U.rowsFromDelimited(`${header}\n` + ",".repeat(U.COLUMNS.length - 1));
    assert.strictEqual(rows.length, 0);
  });
});

test.describe("rowsFromJSON", () => {
  test("reads a bare array", () => {
    const { rows, error } = U.rowsFromJSON('[{"Company":"Acme","Position":"SWE"}]');
    assert.strictEqual(error, "");
    assert.strictEqual(rows[0].Company, "Acme");
  });

  test("reads an { applications: [...] } wrapper", () => {
    const { rows } = U.rowsFromJSON('{"applications":[{"Company":"Acme"}]}');
    assert.strictEqual(rows.length, 1);
  });

  test("errors on invalid JSON", () => {
    assert.match(U.rowsFromJSON("{nope").error, /valid JSON/i);
  });

  test("errors when there's no array", () => {
    assert.match(U.rowsFromJSON('{"a":1}').error, /applications array/i);
  });

  test("coerces every schema field to a string", () => {
    const { rows } = U.rowsFromJSON('[{"Company":"Acme","Job ID":12345}]');
    assert.strictEqual(rows[0]["Job ID"], "12345");
  });

  test("skips non-objects in the array", () => {
    const { rows } = U.rowsFromJSON('[null,"x",{"Company":"Acme"}]');
    assert.strictEqual(rows.length, 1);
  });
});

test.describe("parseImport", () => {
  test("routes .json by filename", () => {
    const { rows } = U.parseImport('[{"Company":"Acme"}]', "backup.json");
    assert.strictEqual(rows[0].Company, "Acme");
  });

  test("routes JSON by leading brace even without the extension", () => {
    const { rows } = U.parseImport('[{"Company":"Acme"}]', "mystery.txt");
    assert.strictEqual(rows[0].Company, "Acme");
  });

  test("routes CSV otherwise", () => {
    const { rows } = U.parseImport("Company,Position\nAcme,SWE", "export.csv");
    assert.strictEqual(rows[0].Position, "SWE");
  });
});

test.describe("identityOf / mergeApplications", () => {
  test("job id wins as the identity", () => {
    const a = { "Job ID": "1", Company: "A", Position: "X" };
    const b = { "Job ID": "1", Company: "B", Position: "Y" };
    assert.strictEqual(U.identityOf(a), U.identityOf(b));
  });

  test("falls back to company + position + date", () => {
    const a = { Company: "Acme", Position: "SWE", "Date Applied": "2026-07-30" };
    const b = { Company: "acme", Position: "swe", "Date Applied": "2026-07-30" };
    assert.strictEqual(U.identityOf(a), U.identityOf(b), "should be case-insensitive");
  });

  test("different dates are different applications", () => {
    const a = { Company: "Acme", Position: "SWE", "Date Applied": "2026-07-30" };
    const b = { Company: "Acme", Position: "SWE", "Date Applied": "2026-06-01" };
    assert.notStrictEqual(U.identityOf(a), U.identityOf(b));
  });

  test("adds only what's new", () => {
    const existing = [{ "Job ID": "1", Company: "Acme" }];
    const incoming = [{ "Job ID": "1", Company: "Acme" }, { "Job ID": "2", Company: "Globex" }];
    const { merged, added, skipped } = U.mergeApplications(existing, incoming);
    assert.strictEqual(added, 1);
    assert.strictEqual(skipped, 1);
    assert.strictEqual(merged.length, 2);
  });

  test("never edits an existing row", () => {
    // An import must not silently overwrite a status set by hand.
    const existing = [{ "Job ID": "1", Company: "Acme", Status: "Offer" }];
    const { merged } = U.mergeApplications(existing, [{ "Job ID": "1", Company: "Acme", Status: "Applied" }]);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].Status, "Offer");
  });

  test("dedupes within the incoming batch too", () => {
    const dup = { "Job ID": "9", Company: "Acme" };
    const { added, skipped } = U.mergeApplications([], [dup, { ...dup }]);
    assert.strictEqual(added, 1);
    assert.strictEqual(skipped, 1);
  });

  test("handles empty inputs", () => {
    assert.deepStrictEqual(U.mergeApplications(undefined, undefined), { merged: [], added: 0, skipped: 0 });
  });

  test("does not mutate the existing array", () => {
    const existing = [{ "Job ID": "1" }];
    U.mergeApplications(existing, [{ "Job ID": "2" }]);
    assert.strictEqual(existing.length, 1);
  });
});

test.describe("weekProgress", () => {
  const TODAY = "2026-07-30";
  const at = (d) => ({ Company: "A", "Date Applied": d });

  test("counts the trailing 7 days inclusive", () => {
    const p = U.weekProgress([at("2026-07-30"), at("2026-07-24"), at("2026-07-23")], 5, TODAY);
    assert.strictEqual(p.count, 2, "07-23 is 7 days back and outside the window");
  });

  test("reports percent and met", () => {
    const p = U.weekProgress([at(TODAY), at(TODAY), at(TODAY)], 3, TODAY);
    assert.strictEqual(p.pct, 100);
    assert.strictEqual(p.met, true);
  });

  test("caps percent at 100", () => {
    const p = U.weekProgress([at(TODAY), at(TODAY), at(TODAY)], 1, TODAY);
    assert.strictEqual(p.pct, 100);
  });

  test("a zero or missing goal is never 'met' and never divides by zero", () => {
    const p = U.weekProgress([at(TODAY)], 0, TODAY);
    assert.strictEqual(p.pct, 0);
    assert.strictEqual(p.met, false);
  });

  test("ignores rows with no date", () => {
    assert.strictEqual(U.weekProgress([{ Company: "A" }], 5, TODAY).count, 0);
  });
});

test.describe("needsAttention", () => {
  const TODAY = "2026-07-30";
  const S = { ...U.DEFAULT_SETTINGS, ghostAfterDays: 21 };
  const row = (over) => ({ Company: "Acme", Position: "SWE", Status: "Applied", ...over });

  test("flags a deadline inside a week", () => {
    const items = U.needsAttention([row({ Deadline: "2026-08-02" })], S, TODAY);
    assert.ok(items.some((i) => i.kind === "deadline"));
  });

  test("ignores a deadline further out than a week", () => {
    const items = U.needsAttention([row({ Deadline: "2026-09-30" })], S, TODAY);
    assert.strictEqual(items.filter((i) => i.kind === "deadline").length, 0);
  });

  test("ignores a deadline that already passed", () => {
    const items = U.needsAttention([row({ Deadline: "2026-07-01" })], S, TODAY);
    assert.strictEqual(items.filter((i) => i.kind === "deadline").length, 0);
  });

  test("flags an overdue follow-up", () => {
    const items = U.needsAttention([row({ "Follow-up On": "2026-07-25" })], S, TODAY);
    const f = items.find((i) => i.kind === "followup");
    assert.ok(f);
    assert.match(f.label, /overdue/);
  });

  test("flags silence past the ghost threshold", () => {
    const items = U.needsAttention([row({ "Date Applied": "2026-06-01" })], S, TODAY);
    assert.ok(items.some((i) => i.kind === "stale"));
  });

  test("leaves closed applications alone", () => {
    const items = U.needsAttention(
      [row({ Status: "Rejected", "Date Applied": "2026-06-01", "Follow-up On": "2026-07-01" })],
      S, TODAY
    );
    assert.strictEqual(items.filter((i) => i.kind !== "deadline").length, 0);
  });

  test("still surfaces a closing deadline on a closed application's row only once", () => {
    const items = U.needsAttention([row({ Status: "Rejected", Deadline: "2026-08-01" })], S, TODAY);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].kind, "deadline");
  });

  test("sorts most urgent first", () => {
    const items = U.needsAttention(
      [
        row({ Company: "Later", Deadline: "2026-08-05" }),
        row({ Company: "Sooner", Deadline: "2026-07-31" }),
      ], S, TODAY
    );
    assert.strictEqual(items[0].row.Company, "Sooner");
  });

  test("returns nothing for a healthy pipeline", () => {
    assert.strictEqual(U.needsAttention([row({ "Date Applied": TODAY })], S, TODAY).length, 0);
  });

  test("survives empty input", () => {
    assert.strictEqual(U.needsAttention([], S, TODAY).length, 0);
    assert.strictEqual(U.needsAttention(undefined, S, TODAY).length, 0);
  });
});

test.describe("safeHttpUrl", () => {
  test("passes http and https through", () => {
    assert.strictEqual(U.safeHttpUrl("https://example.test/a?b=1"), "https://example.test/a?b=1");
    assert.strictEqual(U.safeHttpUrl("http://example.test/"), "http://example.test/");
  });

  test("rejects javascript: URLs", () => {
    assert.strictEqual(U.safeHttpUrl("javascript:alert(1)"), "");
    assert.strictEqual(U.safeHttpUrl("JavaScript:alert(1)"), "");
  });

  test("rejects a javascript: URL smuggled past a naive check with a tab", () => {
    // The URL parser strips tabs and newlines before the scheme, which is why
    // this inspects the parsed protocol rather than the raw string.
    assert.strictEqual(U.safeHttpUrl("java\tscript:alert(1)"), "");
    assert.strictEqual(U.safeHttpUrl("java\nscript:alert(1)"), "");
    assert.strictEqual(U.safeHttpUrl("  javascript:alert(1)  "), "");
  });

  test("rejects data:, vbscript: and file:", () => {
    assert.strictEqual(U.safeHttpUrl("data:text/html,<script>alert(1)</script>"), "");
    assert.strictEqual(U.safeHttpUrl("vbscript:msgbox(1)"), "");
    assert.strictEqual(U.safeHttpUrl("file:///etc/passwd"), "");
  });

  test("rejects a chrome-extension: URL", () => {
    assert.strictEqual(U.safeHttpUrl("chrome-extension://abc/app/app.html"), "");
  });

  test("rejects relative and malformed input", () => {
    assert.strictEqual(U.safeHttpUrl("//evil.test/x"), "");
    assert.strictEqual(U.safeHttpUrl("/jobs/1"), "");
    assert.strictEqual(U.safeHttpUrl("not a url"), "");
  });

  test("returns \"\" for nullish and empty", () => {
    assert.strictEqual(U.safeHttpUrl(""), "");
    assert.strictEqual(U.safeHttpUrl(null), "");
    assert.strictEqual(U.safeHttpUrl(undefined), "");
  });
});

test.describe("import strips unsafe Job URLs", () => {
  test("a javascript: URL in a CSV does not survive import", () => {
    const { rows } = U.rowsFromDelimited(
      "Company,Position,Job URL\nEvil,SWE,javascript:fetch('//evil.test')"
    );
    assert.strictEqual(rows[0]["Job URL"], "");
  });

  test("a javascript: URL in a JSON backup does not survive import", () => {
    const { rows } = U.rowsFromJSON('[{"Company":"E","Position":"P","Job URL":"javascript:alert(1)"}]');
    assert.strictEqual(rows[0]["Job URL"], "");
  });

  test("a legitimate job URL is preserved on import", () => {
    const { rows } = U.rowsFromDelimited(
      "Company,Position,Job URL\nAcme,SWE,https://app.joinhandshake.com/jobs/1"
    );
    assert.strictEqual(rows[0]["Job URL"], "https://app.joinhandshake.com/jobs/1");
  });

  test("the rest of the row is untouched by scrubbing", () => {
    const { rows } = U.rowsFromDelimited(
      "Company,Position,Job URL\nAcme,SWE Intern,javascript:alert(1)"
    );
    assert.strictEqual(rows[0].Company, "Acme");
    assert.strictEqual(rows[0].Position, "SWE Intern");
  });
});

test.describe("descriptionWindow", () => {
  test("short text is returned unchanged", () => {
    assert.strictEqual(U.descriptionWindow("short"), "short");
  });

  test("text at the limit is unchanged", () => {
    const exact = "x".repeat(U.DESCRIPTION_MAX);
    assert.strictEqual(U.descriptionWindow(exact), exact);
  });

  test("long text is bounded", () => {
    const out = U.descriptionWindow("x".repeat(U.DESCRIPTION_MAX * 3));
    assert.ok(out.length <= U.DESCRIPTION_MAX + 3, `got ${out.length}`);
  });

  test("keeps the head", () => {
    const text = "HEADMARKER" + "x".repeat(U.DESCRIPTION_MAX * 2);
    assert.ok(U.descriptionWindow(text).startsWith("HEADMARKER"));
  });

  test("keeps the tail, which a plain truncation would drop", () => {
    const text = "x".repeat(U.DESCRIPTION_MAX * 2) + "TAILMARKER";
    assert.ok(U.descriptionWindow(text).endsWith("TAILMARKER"));
  });

  test("sponsorship language in trailing boilerplate still classifies", () => {
    // Regression: truncating to the first N characters silently lost the
    // sponsorship verdict on long postings.
    const posting = "Great role. ".repeat(3000) + "We are not able to provide visa sponsorship.";
    assert.strictEqual(U.classifyWorkAuth(U.descriptionWindow(posting)).status, "No sponsorship");
    assert.strictEqual(U.classifyWorkAuth(posting.slice(0, U.DESCRIPTION_MAX)).status, "");
  });

  test("scanning a bounded window is fast", () => {
    const t0 = Date.now();
    U.classifyWorkAuth(U.descriptionWindow("word ".repeat(50_000)));
    assert.ok(Date.now() - t0 < 500, "classify should stay well under half a second");
  });

  test("handles nullish input", () => {
    assert.strictEqual(U.descriptionWindow(null), "");
    assert.strictEqual(U.descriptionWindow(undefined), "");
  });
});

test.describe("formatSalary", () => {
  test("reads unitText from the QuantitativeValue, where schema.org puts it", () => {
    // Regression: the unit was read off baseSalary, one level too high, so every
    // hourly range rendered without "/hour".
    assert.strictEqual(
      U.formatSalary({ currency: "USD", value: { minValue: 45, maxValue: 58, unitText: "HOUR" } }),
      "$45–$58/hour"
    );
  });

  test("still reads unitText from baseSalary when a publisher puts it there", () => {
    assert.strictEqual(
      U.formatSalary({ unitText: "YEAR", value: { minValue: 90000, maxValue: 120000 } }),
      "$90000–$120000/year"
    );
  });

  test("handles a single value", () => {
    assert.strictEqual(U.formatSalary({ value: { value: 50, unitText: "HOUR" } }), "$50/hour");
  });

  test("handles value as a bare number", () => {
    assert.strictEqual(U.formatSalary({ value: 85000, unitText: "YEAR" }), "$85000/year");
  });

  test("omits the unit when none is given", () => {
    assert.strictEqual(U.formatSalary({ value: { minValue: 20, maxValue: 30 } }), "$20–$30");
  });

  test("handles a zero minimum without dropping it", () => {
    assert.strictEqual(U.formatSalary({ value: { minValue: 0, maxValue: 30 } }), "$0–$30");
  });

  test("returns \"\" for missing or malformed input", () => {
    assert.strictEqual(U.formatSalary(undefined), "");
    assert.strictEqual(U.formatSalary(null), "");
    assert.strictEqual(U.formatSalary({}), "");
    assert.strictEqual(U.formatSalary({ value: {} }), "");
    assert.strictEqual(U.formatSalary("$50/hr"), "");
  });
});

test.describe("roleKey", () => {
  test("is board-independent, so the same role matches across sites", () => {
    // Applying via LinkedIn's "apply on company website" lands on Greenhouse
    // with a different job id; without this the application logs twice.
    assert.strictEqual(
      U.roleKey("Globex", "SWE Intern"),
      U.roleKey("globex", "swe intern")
    );
  });

  test("trims surrounding whitespace", () => {
    assert.strictEqual(U.roleKey("  Globex ", " SWE Intern "), U.roleKey("Globex", "SWE Intern"));
  });

  test("different roles at one company stay distinct", () => {
    assert.notStrictEqual(U.roleKey("Globex", "SWE Intern"), U.roleKey("Globex", "Data Intern"));
  });

  test("different companies with one role stay distinct", () => {
    assert.notStrictEqual(U.roleKey("Globex", "SWE Intern"), U.roleKey("Acme", "SWE Intern"));
  });

  test('returns "" when either half is missing, so it never collides', () => {
    assert.strictEqual(U.roleKey("", "SWE Intern"), "");
    assert.strictEqual(U.roleKey("Globex", ""), "");
    assert.strictEqual(U.roleKey(null, undefined), "");
  });

  test("is namespaced so it cannot collide with a job key", () => {
    assert.ok(U.roleKey("a", "b").startsWith("role:"));
  });
});

test.describe("Source column", () => {
  test("is the last column", () => {
    assert.strictEqual(U.COLUMNS[U.COLUMNS.length - 1], "Source");
    assert.strictEqual(U.LAST_COLUMN, "V");
  });

  test("was appended, so older sheets still line up", () => {
    assert.deepStrictEqual(U.COLUMNS.slice(0, 15), U.CORE_COLUMNS);
  });

  test("round-trips through export and import", () => {
    const { rows } = U.rowsFromDelimited(U.toCSV([{ Company: "Acme", Position: "SWE", Source: "LinkedIn" }]));
    assert.strictEqual(rows[0].Source, "LinkedIn");
  });
});

test.describe("looksLikeJobPath", () => {
  test.describe("accepts a specific posting", () => {
    const paths = [
      "/jobs/8271934",
      "/stu/postings/551",
      "/acme/jobs/4099887",
      "/jobs/view/3912345678",
      "/en/job/12345/software-engineer-intern",
      "/careers/swe-intern",
      "/job/R-12345",
      "/apply/senior-engineer",
    ];
    for (const p of paths) {
      test(p, () => assert.strictEqual(U.looksLikeJobPath(p), true));
    }
  });

  test.describe("rejects a list or search page", () => {
    // These are why the guard exists: the button used to appear here, and
    // logging saved a row whose id was the search path.
    const paths = [
      "/jobs",
      "/jobs/",
      "/jobs/search/",
      "/jobs/search",
      "/careers",
      "/careers/",
      "/positions/",
      "/jobs/browse/engineering",
      "/search/jobs",
      "/feed/",
      "/",
      "/messaging/thread/123",
    ];
    for (const p of paths) {
      test(p, () => assert.strictEqual(U.looksLikeJobPath(p), false));
    }
  });

  test("handles nullish input", () => {
    assert.strictEqual(U.looksLikeJobPath(undefined), false);
    assert.strictEqual(U.looksLikeJobPath(null), false);
    assert.strictEqual(U.looksLikeJobPath(""), false);
  });
});

test.describe("compareVersions", () => {
  test("orders normal releases", () => {
    assert.strictEqual(U.compareVersions("1.1.0", "1.0.0"), 1);
    assert.strictEqual(U.compareVersions("1.0.0", "1.1.0"), -1);
    assert.strictEqual(U.compareVersions("1.0.0", "1.0.0"), 0);
  });

  test("compares numerically, not as strings", () => {
    // "1.10.0" > "1.9.0" is false under string comparison.
    assert.strictEqual(U.compareVersions("1.10.0", "1.9.0"), 1);
    assert.strictEqual(U.compareVersions("2.0.0", "10.0.0"), -1);
  });

  test("handles differing segment counts", () => {
    assert.strictEqual(U.compareVersions("1.1", "1.1.0"), 0);
    assert.strictEqual(U.compareVersions("1.1.1", "1.1"), 1);
  });

  test("treats missing or junk input as 0", () => {
    assert.strictEqual(U.compareVersions("", ""), 0);
    assert.strictEqual(U.compareVersions("1.0.0", null), 1);
    assert.strictEqual(U.compareVersions(undefined, "0.0.1"), -1);
  });
});
