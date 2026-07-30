// Tests for the per-board selector registry in content/selectors.js.
// It assigns globals rather than exporting, so requiring it is the setup.
const test = require("node:test");
const assert = require("node:assert");

require("../content/selectors.js");
const resolve = globalThis.GHOSTED_RESOLVE_SITE;
const BASE = globalThis.GHOSTED_SELECTORS;
const SITES = globalThis.GHOSTED_SITES;

test.describe("host matching", () => {
  const cases = [
    ["app.joinhandshake.com", "handshake"],
    ["myschool.joinhandshake.com", "handshake"],
    ["joinhandshake.co.uk", "handshake"],
    ["boards.greenhouse.io", "greenhouse"],
    ["job-boards.greenhouse.io", "greenhouse"],
    ["jobs.lever.co", "lever"],
    ["jobs.ashbyhq.com", "ashby"],
    ["acme.wd1.myworkdayjobs.com", "workday"],
    ["jobs.smartrecruiters.com", "smartrecruiters"],
    ["apply.workable.com", "workable"],
    ["www.linkedin.com", "linkedin"],
    ["www.indeed.com", "indeed"],
    ["ca.indeed.com", "indeed"],
  ];
  for (const [host, id] of cases) {
    test(`${host} resolves to ${id}`, () => {
      assert.strictEqual(resolve(host).siteId, id);
    });
  }

  test("an unknown host falls back to generic", () => {
    assert.strictEqual(resolve("example.com").siteId, "generic");
    assert.strictEqual(resolve("").siteId, "generic");
    assert.strictEqual(resolve(undefined).siteId, "generic");
  });

  test("an unknown host still gets a usable name for the Source column", () => {
    assert.strictEqual(resolve("careers.example.com").siteName, "careers.example.com");
    assert.strictEqual(resolve("www.example.com").siteName, "example.com");
    assert.strictEqual(resolve("").siteName, "this page");
  });

  test("a lookalike domain does not match", () => {
    // notlinkedin.com must not be treated as LinkedIn.
    assert.strictEqual(resolve("notlinkedin.com").siteId, "generic");
    assert.strictEqual(resolve("joinhandshake.com.evil.test").siteId, "generic");
  });
});

test.describe("merge behaviour", () => {
  test("a board's selectors come before the generic fallbacks", () => {
    const s = resolve("www.indeed.com");
    assert.strictEqual(s.css.title[0], '[data-testid="jobsearch-JobInfoHeader-title"]');
    assert.ok(s.css.title.includes("h1"), "baseline fallbacks should still be present");
  });

  test("selector groups the board does not override are inherited", () => {
    const s = resolve("jobs.ashbyhq.com");
    assert.deepStrictEqual(s.css.company, BASE.css.company);
  });

  test("non-selector overrides replace the baseline outright", () => {
    const s = resolve("www.linkedin.com");
    assert.notStrictEqual(s.externalApply.source, BASE.externalApply.source);
  });

  test("shared patterns survive on every board", () => {
    for (const site of SITES) {
      const s = resolve(sampleHost(site));
      assert.ok(s.successText instanceof RegExp, `${site.id} lost successText`);
      assert.ok(s.resume instanceof RegExp, `${site.id} lost resume`);
      assert.ok(s.labels && s.labels.industry, `${site.id} lost labels`);
    }
  });

  test("resolving does not mutate the baseline", () => {
    const before = BASE.css.title.length;
    resolve("www.indeed.com");
    resolve("boards.greenhouse.io");
    assert.strictEqual(BASE.css.title.length, before);
  });

  test("every board reports a display name", () => {
    for (const site of SITES) {
      assert.ok(resolve(sampleHost(site)).siteName, `${site.id} has no name`);
    }
  });
});

test.describe("registry integrity", () => {
  test("ids are unique", () => {
    const ids = SITES.map((s) => s.id);
    assert.strictEqual(new Set(ids).size, ids.length);
  });

  test("every board has a host regex and at least one id pattern", () => {
    for (const site of SITES) {
      assert.ok(site.host instanceof RegExp, `${site.id} host`);
      assert.ok(Array.isArray(site.jobIdPatterns) && site.jobIdPatterns.length, `${site.id} patterns`);
    }
  });

  test("no board's host regex matches another board's sample host", () => {
    for (const site of SITES) {
      const host = sampleHost(site);
      const matches = SITES.filter((s) => s.host.test(host));
      assert.strictEqual(matches.length, 1, `${host} matched ${matches.map((m) => m.id).join(", ")}`);
    }
  });
});

test.describe("job id extraction", () => {
  const idFrom = (host, url) => {
    for (const p of resolve(host).jobIdPatterns) {
      const m = url.match(p);
      if (m) return m[1];
    }
    return null;
  };

  const cases = [
    ["app.joinhandshake.com", "https://app.joinhandshake.com/jobs/8271234", "8271234"],
    ["app.joinhandshake.com", "https://app.joinhandshake.com/stu/postings/551", "551"],
    ["boards.greenhouse.io", "https://boards.greenhouse.io/acme/jobs/4099887?gh_jid=4099887", "4099887"],
    ["jobs.lever.co", "https://jobs.lever.co/acme/8f14e45f-ceea-467a-9c1b-2b4a6f1c9d3e", "8f14e45f-ceea-467a-9c1b-2b4a6f1c9d3e"],
    ["www.linkedin.com", "https://www.linkedin.com/jobs/view/3912345678/", "3912345678"],
    ["www.linkedin.com", "https://www.linkedin.com/jobs/search/?currentJobId=3912345678", "3912345678"],
    ["www.indeed.com", "https://www.indeed.com/viewjob?jk=a1b2c3d4e5f60718", "a1b2c3d4e5f60718"],
    ["apply.workable.com", "https://apply.workable.com/acme/j/A1B2C3D4E5/", "A1B2C3D4E5"],
  ];
  for (const [host, url, expected] of cases) {
    test(`${host}: ${expected}`, () => assert.strictEqual(idFrom(host, url), expected));
  }

  test("a non-job URL yields no id", () => {
    assert.strictEqual(idFrom("www.linkedin.com", "https://www.linkedin.com/feed/"), null);
  });
});

test.describe("success text covers the common confirmations", () => {
  const phrases = [
    "Application submitted",
    "Your application has been submitted",
    "Thank you for applying",
    "Thanks for your application",
    "We've received your application",
    "We have received your application",
    "Your application was received",
    "Application received",
    "Application complete",
    "You've applied",
    "Successfully applied",
    // LinkedIn Easy Apply, which the earlier pattern missed: it allowed
    // "has been" but not "was", and not a bare "sent".
    "Your application was sent to Globex",
    "Application sent",
  ];
  for (const phrase of phrases) {
    test(JSON.stringify(phrase), () => assert.ok(BASE.successText.test(phrase)));
  }

  test("ordinary job page copy does not read as a confirmation", () => {
    for (const noise of [
      "Submit your application below",
      "Applications are reviewed weekly",
      "Apply now",
      "3 applicants",
      "Applications received: 47",
      "Your application will be reviewed",
      "Complete your application",
      "Application sentiment analysis",
    ]) {
      assert.ok(!BASE.successText.test(noise), `false positive on ${JSON.stringify(noise)}`);
    }
  });
});

// The first host each board's regex is meant to serve.
function sampleHost(site) {
  return {
    handshake: "app.joinhandshake.com",
    greenhouse: "boards.greenhouse.io",
    lever: "jobs.lever.co",
    ashby: "jobs.ashbyhq.com",
    workday: "acme.wd1.myworkdayjobs.com",
    smartrecruiters: "jobs.smartrecruiters.com",
    workable: "apply.workable.com",
    linkedin: "www.linkedin.com",
    indeed: "www.indeed.com",
  }[site.id];
}
