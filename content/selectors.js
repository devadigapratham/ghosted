// Every Handshake-specific selector and text pattern lives here. When
// Handshake redesigns, this should be the only file you touch.
// Order matters: data-hook/data-testid first, generic fallbacks last.
globalThis.GHOSTED_SELECTORS = {
  jobIdPatterns: [
    /\/jobs?\/(\d+)/,
    /\/postings\/(\d+)/,
    /[?&]job_id=(\d+)/,
    /[?&]jobId=(\d+)/,
  ],

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

  // Fallback for "Industry" / "Pay" style label→value layouts: match a short
  // leaf element, then read its sibling.
  labels: {
    industry: /^industry$/i,
    salary: /^(pay|pay rate|salary|compensation|wage|estimated pay)$/i,
    location: /^location(s)?$/i,
    posted: /^(posted|date posted)$/i,
  },

  postedTextPattern: /posted\s+((\d+|an?)\+?\s*(minute|hour|day|week|month)s?\s*ago|today|yesterday|on\s+\S.*)/i,

  // $25-30/hr, $90k–$110k, $25.50 per hour
  salaryTextPattern: /\$\s?[\d,.]+\s?k?(\s?[-–—]\s?\$?\s?[\d,.]+\s?k?)?\s*(\/|per\s)?\s*(hr|hour|yr|year|mo|month|week|wk)?/i,

  successText: /(application\s+(was\s+)?submitted|successfully\s+(applied|submitted)|you('|’)ve\s+applied|application\s+received|thanks?\s+for\s+applying)/i,

  appliedButton: /^applied\s*(✓)?$/i,

  externalApply: /(apply\s+externally|external\s+(application|link)|apply\s+on\s+(company|employer)\s+(site|website))/i,

  applyModalHeading: /^apply\b/i,

  coverLetter: /cover\s*letter/i,
  resume: /r[eé]sum[eé]|\bcv\b/i,

  // A résumé being *mentioned* in the modal isn't the same as one being
  // attached, so the upload check looks for real evidence: a file input, a
  // picked-document radio/checkbox, or a filename in the DOM.
  resumeUpload: {
    controls: [
      'input[type="file"]',
      '[data-hook*="resume"] input',
      '[data-testid*="resume"] input',
      '[data-hook*="document"] input',
      '[data-testid*="document"] input',
    ],
    filenamePattern: /[\w()\-. ]+\.(pdf|docx?|rtf|txt)\b/i,
    // "Uploaded", "Attached", "Selected: my_resume.pdf"
    attachedText: /(uploaded|attached|selected|replace file|remove file)/i,
  },
};
