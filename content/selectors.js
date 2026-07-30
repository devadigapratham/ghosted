// Every site-specific selector and text pattern lives here. When a job board
// redesigns, this should be the only file you touch.
//
// The object below is the shared baseline that works anywhere, mostly by way of
// JSON-LD JobPosting data. SITES underneath it holds per-board overrides, which
// are merged over the baseline by resolveSite().
//
// Order matters within a selector list: data-hook/data-testid first, generic
// fallbacks last.
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
    // The description is where work-authorization language hides, so this
    // wants to be greedy: better to scan too much text than miss the one
    // sentence about sponsorship.
    description: [
      '[data-hook="job-description"]',
      '[data-testid="job-description"]',
      '[data-hook="details"]',
      'section[class*="description"]',
      'div[class*="description"]',
      "article",
      "main",
    ],
    deadline: [
      '[data-hook="apply-by"]',
      '[data-testid="apply-by"]',
      '[data-hook="expiration-date"]',
      '[data-hook="deadline"]',
    ],
    jobType: [
      '[data-hook="job-type"]',
      '[data-testid="job-type"]',
      '[data-hook="employment-type"]',
    ],
  },

  // Fallback for "Industry" / "Pay" style label→value layouts: match a short
  // leaf element, then read its sibling.
  labels: {
    industry: /^industry$/i,
    salary: /^(pay|pay rate|salary|compensation|wage|estimated pay)$/i,
    location: /^location(s)?$/i,
    posted: /^(posted|date posted)$/i,
    deadline: /^(apply by|application deadline|deadline|applications close|closes)$/i,
    jobType: /^(job type|employment type|type|position type)$/i,
  },

  postedTextPattern: /posted\s+((\d+|an?)\+?\s*(minute|hour|day|week|month)s?\s*ago|today|yesterday|on\s+\S.*)/i,

  deadlineTextPattern: /(apply by|applications? (close|due)|deadline)[:\s]+([a-z]{3,9}\.? \d{1,2}(,? \d{4})?|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|tomorrow|today)/i,

  jobTypeTextPattern: /\b(internship|intern|co-?op|full[- ]time|part[- ]time|contract|temporary|fellowship|new grad|entry level)\b/i,

  // $25-30/hr, $90k–$110k, $25.50 per hour
  salaryTextPattern: /\$\s?[\d,.]+\s?k?(\s?[-–—]\s?\$?\s?[\d,.]+\s?k?)?\s*(\/|per\s)?\s*(hr|hour|yr|year|mo|month|week|wk)?/i,

  // How each platform words a successful submission. The connector varies
  // ("was sent", "has been submitted", bare "sent"), and \b stops "sent" from
  // matching inside "sentiment".
  successText: new RegExp(
    [
      "application\\s+(was\\s+|has\\s+been\\s+)?(sent|submitted|received|complete)\\b",
      "successfully\\s+(applied|submitted|sent)\\b",
      "you('|\u2019)ve\\s+applied\\b",
      "thanks?\\s+(you\\s+)?for\\s+(applying|your\\s+(application|interest))\\b",
      "we\\s*('|\u2019)?(ve|have)\\s+received\\s+your\\s+application\\b",
    ].join("|"),
    "i"
  ),

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

// Per-board overrides, merged over the baseline above. A board that emits
// JSON-LD JobPosting data needs almost nothing here; the entries exist for the
// fields structured data usually omits.
globalThis.GHOSTED_SITES = [
  {
    id: "handshake",
    name: "Handshake",
    host: /(^|\.)joinhandshake\.(com|co\.uk|de)$/i,
    jobIdPatterns: [/\/jobs?\/(\d+)/, /\/postings\/(\d+)/, /[?&]job_id=(\d+)/, /[?&]jobId=(\d+)/],
  },
  {
    id: "greenhouse",
    name: "Greenhouse",
    host: /(^|\.)(greenhouse\.io|boards\.greenhouse\.io)$/i,
    jobIdPatterns: [/[?&]gh_jid=(\d+)/, /\/jobs\/(\d+)/],
    css: {
      title: ["h1.app-title", '[class*="job__title"] h1', "h1"],
      company: [".company-name", '[class*="company"]', 'meta[property="og:site_name"]'],
      location: [".location", '[class*="location"]'],
      description: ["#content", "#app_body", '[class*="job__description"]', "main"],
    },
  },
  {
    id: "lever",
    name: "Lever",
    host: /(^|\.)(lever\.co|jobs\.lever\.co)$/i,
    jobIdPatterns: [/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i],
    css: {
      title: [".posting-headline h2", "h2"],
      company: [".main-header-logo img", 'meta[property="og:site_name"]'],
      location: [".posting-categories .location", '[class*="location"]'],
      description: [".posting-page", '[class*="section-wrapper"]', "main"],
    },
  },
  {
    id: "ashby",
    name: "Ashby",
    host: /(^|\.)ashbyhq\.com$/i,
    jobIdPatterns: [/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i],
    css: {
      title: ['[class*="_title"]', "h1"],
      description: ['[class*="_description"]', "main"],
    },
  },
  {
    id: "workday",
    name: "Workday",
    host: /(^|\.)myworkdayjobs\.com$/i,
    jobIdPatterns: [/\/job\/[^/]+\/[^/]*?_(R?-?\d[\w-]*)/i, /[?&]jobId=([\w-]+)/],
    css: {
      title: ['[data-automation-id="jobPostingHeader"]', "h1"],
      location: ['[data-automation-id="locations"]', '[data-automation-id="location"]'],
      posted: ['[data-automation-id="postedOn"]'],
      jobType: ['[data-automation-id="time"]'],
      description: ['[data-automation-id="jobPostingDescription"]', "main"],
    },
  },
  {
    id: "smartrecruiters",
    name: "SmartRecruiters",
    host: /(^|\.)smartrecruiters\.com$/i,
    jobIdPatterns: [/\/(\d{6,})(?:-|$)/],
    css: { description: ['[class*="job-sections"]', "main"] },
  },
  {
    id: "workable",
    name: "Workable",
    host: /(^|\.)workable\.com$/i,
    jobIdPatterns: [/\/j\/([0-9A-F]{6,})/i],
    css: { description: ['[data-ui="job-description"]', "main"] },
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    host: /(^|\.)linkedin\.com$/i,
    jobIdPatterns: [/\/jobs\/view\/(\d+)/, /[?&]currentJobId=(\d+)/],
    css: {
      title: [".job-details-jobs-unified-top-card__job-title", ".top-card-layout__title", "h1"],
      company: [".job-details-jobs-unified-top-card__company-name", ".topcard__org-name-link"],
      location: [".job-details-jobs-unified-top-card__bullet", ".topcard__flavor--bullet"],
      description: [".jobs-description__content", ".description__text", "main"],
    },
    // LinkedIn's Easy Apply is a modal; an external apply leaves the site.
    externalApply: /(apply\s+on\s+company\s+(site|website)|apply\s+externally)/i,
  },
  {
    id: "indeed",
    name: "Indeed",
    host: /(^|\.)indeed\.(com|co\.uk|ca|de|in)$/i,
    jobIdPatterns: [/[?&]jk=([0-9a-f]+)/i, /[?&]vjk=([0-9a-f]+)/i],
    css: {
      title: ['[data-testid="jobsearch-JobInfoHeader-title"]', ".jobsearch-JobInfoHeader-title", "h1"],
      company: ['[data-testid="inlineHeader-companyName"]', '[data-company-name="true"]'],
      location: ['[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]'],
      description: ["#jobDescriptionText", "main"],
    },
  },
];

// Merges a board's overrides over the baseline. Selector groups merge key by
// key, with the board's list first so its specific hooks are tried before the
// generic fallbacks.
globalThis.GHOSTED_RESOLVE_SITE = function resolveSite(hostname) {
  const base = globalThis.GHOSTED_SELECTORS;
  const site = globalThis.GHOSTED_SITES.find((s) => s.host.test(String(hostname || "")));
  // An unrecognized host still gets a usable label for the Source column.
  if (!site) {
    const host = String(hostname || "").replace(/^www\./i, "");
    return { ...base, siteId: "generic", siteName: host || "this page" };
  }

  const merged = { ...base, siteId: site.id, siteName: site.name };
  for (const [key, value] of Object.entries(site)) {
    if (key === "host" || key === "id" || key === "name") continue;
    if (key === "css") {
      merged.css = { ...base.css };
      for (const [field, list] of Object.entries(value)) {
        merged.css[field] = [...list, ...(base.css[field] || [])];
      }
    } else {
      merged[key] = value;
    }
  }
  return merged;
};
