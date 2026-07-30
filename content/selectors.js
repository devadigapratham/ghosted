// ── All Handshake DOM selectors and text patterns live here. ──
// When Handshake redesigns and scraping breaks, this is the only file that
// should need editing. Strategies are ordered most-stable-first:
// data-hook/data-testid attributes, then ARIA/semantic markup, then
// generic fallbacks. content.js also tries JSON-LD (JobPosting structured
// data) before any of these CSS selectors.
globalThis.HS2S_SELECTORS = {
  // Job ID extraction from the URL, tried in order.
  // Covers /jobs/123456, school subdomains (myschool.joinhandshake.com/stu/jobs/123456),
  // split-view list pages that select a job via query param, and postings URLs.
  jobIdPatterns: [
    /\/jobs?\/(\d+)/,
    /\/postings\/(\d+)/,
    /[?&]job_id=(\d+)/,
    /[?&]jobId=(\d+)/,
  ],

  // CSS selector lists, tried in order until one matches non-empty text.
  css: {
    title: [
      '[data-hook="job-title"]',
      '[data-testid="job-title"]',
      'h1[class*="job"]',
      "main h1",
      "h1",
    ],
    company: [
      '[data-hook="employer-name"] a',
      '[data-hook="employer-name"]',
      '[data-testid="employer-name"]',
      'a[href*="/employers/"]',
      'a[href*="/e/"]',
    ],
    location: [
      '[data-hook="job-location"]',
      '[data-testid="job-location"]',
      '[data-hook="locations"]',
    ],
    salary: [
      '[data-hook="job-pay"]',
      '[data-testid="job-pay"]',
      '[data-hook="salary"]',
    ],
    posted: [
      '[data-hook="posted-date"]',
      '[data-testid="posted-date"]',
      "time[datetime]",
    ],
    industry: [
      '[data-hook="employer-industry"]',
      '[data-testid="employer-industry"]',
    ],
  },

  // Label→value scraping: find a short leaf element whose text matches the
  // label regex, then read its sibling/parent for the value. Used as a
  // fallback when the CSS selectors above fail.
  labels: {
    industry: /^industry$/i,
    salary: /^(pay|pay rate|salary|compensation|wage|estimated pay)$/i,
    location: /^location(s)?$/i,
    posted: /^(posted|date posted)$/i,
  },

  // Free-text pattern for "Posted 3 days ago" style strings anywhere on the page.
  postedTextPattern: /posted\s+((\d+|an?)\+?\s*(minute|hour|day|week|month)s?\s*ago|today|yesterday|on\s+\S.*)/i,

  // Inline salary pattern fallback ($25-30/hr, $90k–$110k, $25.50 per hour).
  salaryTextPattern: /\$\s?[\d,.]+\s?k?(\s?[-–—]\s?\$?\s?[\d,.]+\s?k?)?\s*(\/|per\s)?\s*(hr|hour|yr|year|mo|month|week|wk)?/i,

  // ── Application-flow detection patterns ──
  // Success confirmation after submitting in Handshake's native apply modal.
  successText: /(application\s+(was\s+)?submitted|successfully\s+(applied|submitted)|you('|’)ve\s+applied|application\s+received|thanks?\s+for\s+applying)/i,

  // The Apply button flipping to "Applied".
  appliedButton: /^applied\s*(✓)?$/i,

  // External-application links/buttons.
  externalApply: /(apply\s+externally|external\s+(application|link)|apply\s+on\s+(company|employer)\s+(site|website))/i,

  // The native apply modal (role=dialog whose heading/content looks like an
  // application form).
  applyModalHeading: /^apply\b/i,

  // Detection of steps inside the apply modal.
  coverLetter: /cover\s*letter/i,
  resume: /r[eé]sum[eé]|\bcv\b/i,
};
