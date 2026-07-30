// The dashboard. Reads whichever copy of the data is authoritative (the sheet
// if one is connected, otherwise the local log) and writes status changes back
// to the same place.
const U = globalThis.GHOSTED;
const DS = globalThis.GHOSTED_DATA;
const $ = (id) => document.getElementById(id);

const VIEWS = ["dashboard", "attention", "pipeline", "jobs", "deadlines", "settings"];
const CHECKBOXES = ["autoCapture", "remindersEnabled", "needsSponsorship", "showSponsorshipChip"];
const NUMBERS = ["followUpDays", "ghostAfterDays", "weeklyGoal"];

// Sponsorship verdicts carry an icon as well as a colour, so the meaning never
// rests on hue alone.
const SPONSOR_META = {
  // Text glyphs, not emoji: they inherit the status colour and don't crowd the
  // label the way a wide emoji does.
  Sponsors: { icon: "✓", cls: "good", blocker: false },
  "No sponsorship": { icon: "✕", cls: "blocked", blocker: true },
  "Citizens/PR only": { icon: "✕", cls: "blocked", blocker: true },
  Unclear: { icon: "?", cls: "", blocker: false },
};
const SPONSOR_ORDER = ["No sponsorship", "Citizens/PR only", "Unclear", "Sponsors"];

let rows = [];
let source = "local";
let settings = { ...U.DEFAULT_SETTINGS };
let sort = { key: "Date Applied", asc: false };
let search = "";

const svgEl = (name, attrs = {}) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const sponsorOf = (row) => {
  const s = (row.Sponsorship || "").trim();
  return SPONSOR_META[s] ? s : "Unclear";
};

// ── Data ──
async function load() {
  settings = await DS.getSettings();
  const resp = await DS.getRows();
  rows = resp?.rows || [];
  source = resp?.source || "local";

  const badge = $("sourceBadge");
  if (resp?.stale) badge.textContent = "sheet unreachable · showing local copy";
  else if (DS.env === "web") badge.textContent = "stored in this browser";
  else badge.textContent = source === "sheet" ? "synced with your sheet" : "stored on this machine";

  renderAll();
}

function renderAll() {
  fillSettings();
  renderDashboard();
  renderAttention();
  renderPipeline();
  renderJobs();
  renderDeadlines();

  // An empty pill still paints its background, so hide it rather than blanking it.
  const setPill = (id, n) => {
    const pill = $(id);
    pill.textContent = n ? String(n) : "";
    pill.hidden = !n;
  };
  setPill("jobsCount", rows.length);
  setPill("dueCount", upcomingDeadlines().length);
  setPill("attnCount", U.needsAttention(rows, settings).length);
}

const today = () => U.todayISO();

function stats() {
  return U.summarize(rows, settings, today());
}

function followUps() {
  return rows
    .filter((r) => {
      const status = (r.Status || "").trim();
      if (status !== "Applied" && status !== "") return false;
      const due = r["Follow-up On"];
      return due && U.daysBetween(due, today()) >= 0;
    })
    .sort((a, b) => String(a["Follow-up On"]).localeCompare(String(b["Follow-up On"])));
}

function deadlines() {
  return rows
    .filter((r) => r.Deadline && U.fromISODate(r.Deadline))
    .sort((a, b) => String(a.Deadline).localeCompare(String(b.Deadline)));
}

// ── Dashboard ──
function renderDashboard() {
  const empty = rows.length === 0;
  $("emptyState").hidden = !empty;
  $("dashContent").hidden = empty;
  if (empty) return;

  const s = stats();

  const kpis = [
    { k: "Applications", v: s.total, n: `${s.open} still open`, hero: true },
    { k: "This week", v: s.thisWeek, n: "in the last 7 days" },
    { k: "Interviews", v: s.interviews + s.offers, n: `incl. ${s.offers} offer${s.offers === 1 ? "" : "s"}` },
    { k: "Ghosted", v: s.ghosted, n: `silent ${settings.ghostAfterDays}+ days` },
    { k: "Heard back", v: `${s.responseRate}%`, n: "got any reply" },
  ];

  const goal = U.weekProgress(rows, settings.weeklyGoal, today());
  if (goal.goal > 0) {
    kpis.splice(2, 0, {
      k: "Weekly goal",
      v: `${goal.count}/${goal.goal}`,
      n: goal.met ? "hit it" : `${goal.goal - goal.count} to go`,
    });
  }

  const box = $("kpis");
  box.textContent = "";
  for (const t of kpis) {
    const tile = el("div", "kpi" + (t.hero ? " hero" : ""));
    tile.append(el("div", "k", t.k), el("div", "v", String(t.v)), el("div", "n", t.n));
    box.appendChild(tile);
  }

  renderWeeklyChart();
  renderStatusChart();
  renderSponsorChart();
  renderList($("followUpList"), followUps().slice(0, 6), "Nothing needs chasing right now.", (r) => ({
    who: `${r.Company || "—"} · ${r.Position || "—"}`,
    when: relativeDue(r["Follow-up On"]),
    overdue: U.daysBetween(r["Follow-up On"], today()) > 0,
  }));
  renderList($("deadlineList"), upcomingDeadlines().slice(0, 6), "No deadlines recorded.", (r) => ({
    who: `${r.Company || "—"} · ${r.Position || "—"}`,
    when: relativeDeadline(r.Deadline),
    overdue: U.daysBetween(r.Deadline, today()) > 0,
  }));
}

function upcomingDeadlines() {
  return deadlines().filter((r) => U.daysBetween(r.Deadline, today()) <= 0);
}

function relativeDue(due) {
  const d = U.daysBetween(due, today());
  if (d === 0) return "today";
  if (d > 0) return `${d}d overdue`;
  return `in ${-d}d`;
}

function relativeDeadline(date) {
  const d = U.daysBetween(date, today());
  if (d === 0) return "closes today";
  if (d > 0) return "closed";
  return `${-d}d left`;
}

function renderList(container, items, emptyText, map) {
  container.textContent = "";
  if (!items.length) {
    container.appendChild(el("p", "empty-note", emptyText));
    return;
  }
  for (const r of items) {
    const { who, when, overdue } = map(r);
    const item = el("div", "item");
    item.append(el("span", "who", who), el("span", "when" + (overdue ? " overdue" : ""), when));
    container.appendChild(item);
  }
}

// Monday-anchored week key, so buckets line up with how people think about weeks.
function weekStart(iso) {
  const d = U.fromISODate(iso);
  if (!d) return null;
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return U.toISODate(d);
}

function weeklyBuckets(count = 12) {
  const start = weekStart(today());
  const keys = [];
  for (let i = count - 1; i >= 0; i--) keys.push(U.addDays(start, -7 * i));

  const tally = new Map(keys.map((k) => [k, 0]));
  for (const r of rows) {
    const k = weekStart(r["Date Applied"]);
    if (k && tally.has(k)) tally.set(k, tally.get(k) + 1);
  }
  return keys.map((k) => ({ key: k, count: tally.get(k) }));
}

function niceTicks(max) {
  if (max <= 4) return Array.from({ length: max + 1 }, (_, i) => i);
  const step = Math.ceil(max / 4 / 5) * 5 || 1;
  const ticks = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

// Single-series column chart: one hue, no legend (the caption names it), value
// on the tallest cap only, hover for the rest.
function renderWeeklyChart() {
  const data = weeklyBuckets();
  const host = $("weeklyChart");
  // Hidden views report 0; 720 is a sane fallback until the view is shown.
  const W = Math.max(360, Math.round(host.clientWidth) || 720);
  const H = 210;
  const pad = { l: 34, r: 8, t: 14, b: 26 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;

  const ticks = niceTicks(Math.max(...data.map((d) => d.count), 1));
  const yMax = ticks[ticks.length - 1];
  const band = plotW / data.length;
  const barW = Math.min(24, band * 0.62);
  const peak = data.reduce((best, d, i) => (d.count > data[best].count ? i : best), 0);

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
  svg.appendChild(svgEl("title", {})).textContent =
    `Applications per week for the last ${data.length} weeks`;

  const y = (v) => pad.t + plotH - (v / yMax) * plotH;

  for (const t of ticks) {
    svg.appendChild(svgEl("line", {
      class: t === 0 ? "axis-line" : "grid-line",
      x1: pad.l, x2: W - pad.r, y1: y(t), y2: y(t),
    }));
    const label = svgEl("text", { class: "tick-text", x: pad.l - 6, y: y(t) + 3, "text-anchor": "end" });
    label.textContent = t;
    svg.appendChild(label);
  }

  data.forEach((d, i) => {
    const x = pad.l + i * band + (band - barW) / 2;
    const h = d.count === 0 ? 0 : Math.max(2, (d.count / yMax) * plotH);
    const top = pad.t + plotH - h;
    const g = svgEl("g", { class: "band" });

    // Hit target spans the whole band, not just the bar.
    const hit = svgEl("rect", { class: "hit", x: pad.l + i * band, y: pad.t, width: band, height: plotH });
    g.appendChild(hit);

    if (h > 0) {
      const r = Math.min(4, h);
      // Rounded data-end, square at the baseline.
      g.appendChild(svgEl("path", {
        class: "bar",
        d: `M${x},${top + h} L${x},${top + r} Q${x},${top} ${x + r},${top}
            L${x + barW - r},${top} Q${x + barW},${top} ${x + barW},${top + r}
            L${x + barW},${top + h} Z`,
      }));
    }

    if (i === peak && d.count > 0) {
      const cap = svgEl("text", {
        class: "cap-text", x: x + barW / 2, y: top - 4, "text-anchor": "middle",
      });
      cap.textContent = d.count;
      g.appendChild(cap);
    }

    // Label every other week so ticks never collide.
    if (i % 2 === 0 || data.length <= 8) {
      const tick = svgEl("text", {
        class: "tick-text", x: pad.l + i * band + band / 2, y: H - 8, "text-anchor": "middle",
      });
      tick.textContent = shortDate(d.key);
      g.appendChild(tick);
    }

    const label = `Week of ${shortDate(d.key)}`;
    g.addEventListener("pointerenter", (e) => showTip(e, label, `${d.count} application${d.count === 1 ? "" : "s"}`));
    g.addEventListener("pointermove", (e) => showTip(e, label, `${d.count} application${d.count === 1 ? "" : "s"}`));
    g.addEventListener("pointerleave", hideTip);
    svg.appendChild(g);
  });

  host.textContent = "";
  host.appendChild(svg);
}

// The chart is generated at pixel width, so it has to be regenerated when that
// width changes rather than relying on SVG scaling.
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!$("view-dashboard").hidden && rows.length) renderWeeklyChart();
  }, 150);
});

function shortDate(iso) {
  const d = U.fromISODate(iso);
  if (!d) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Horizontal bars, single hue, ordered by pipeline stage. Every bar is labelled,
// so colour is never the identity channel.
function renderStatusChart() {
  const counts = new Map(U.STATUS_OPTIONS.map((s) => [s, 0]));
  for (const r of rows) {
    const s = (r.Status || "").trim() || "Applied";
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  const data = U.STATUS_OPTIONS.map((s) => ({ label: s, count: counts.get(s) || 0 }));
  drawHBars($("statusChart"), data, () => "");
}

// Emphasis form: the postings that can't hire you are in the critical hue, the
// rest recede to gray. Avoids a red/green pair carrying the meaning.
function renderSponsorChart() {
  const counts = new Map(SPONSOR_ORDER.map((s) => [s, 0]));
  for (const r of rows) {
    const s = sponsorOf(r);
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  const data = SPONSOR_ORDER.map((s) => ({
    label: `${SPONSOR_META[s].icon} ${s}`,
    count: counts.get(s) || 0,
    emphasis: SPONSOR_META[s].blocker,
  }));
  drawHBars($("sponsorChart"), data, (d) => (d.emphasis ? "is-emphasis" : "is-deemphasis"));
}

function drawHBars(container, data, classFor) {
  const max = Math.max(...data.map((d) => d.count), 1);
  container.textContent = "";

  for (const d of data) {
    const rowEl = el("div", "hbar" + (d.count === 0 ? " zero" : ""));
    rowEl.append(el("span", "hlabel", d.label));

    const track = el("div", "htrack");
    const fill = el("div", `hfill ${classFor(d)}`);
    fill.style.width = `${(d.count / max) * 100}%`;
    if (d.count === 0) fill.style.width = "0";
    track.appendChild(fill);
    rowEl.appendChild(track);

    rowEl.append(el("span", "hval", String(d.count)));
    container.appendChild(rowEl);
  }
}

function showTip(e, label, value) {
  const tip = $("tooltip");
  tip.textContent = "";
  tip.append(el("div", "", label), el("div", "tv", value));
  tip.hidden = false;
  const pad = 12;
  const rect = tip.getBoundingClientRect();
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  if (x + rect.width > window.innerWidth) x = e.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight) y = e.clientY - rect.height - pad;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}

function hideTip() {
  $("tooltip").hidden = true;
}

// ── Status writing ──
function statusSelect(row, onDone) {
  const sel = document.createElement("select");
  for (const opt of U.STATUS_OPTIONS) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    sel.appendChild(o);
  }
  sel.value = U.STATUS_OPTIONS.includes((row.Status || "").trim()) ? row.Status.trim() : "Applied";

  sel.addEventListener("change", async () => {
    const previous = row.Status;
    row.Status = sel.value;
    const resp = await DS.setStatus(row, sel.value, source);
    if (!resp?.ok) {
      row.Status = previous;
      sel.value = previous || "Applied";
      alertLine(`Couldn't save that status: ${resp?.error || "unknown error"}`);
      return;
    }
    renderDashboard();
    if (onDone) onDone();
  });
  return sel;
}

function alertLine(text) {
  const badge = $("sourceBadge");
  badge.textContent = text;
  setTimeout(() => load(), 2500);
}

// ── Pipeline ──
function renderPipeline() {
  const board = $("board");
  board.textContent = "";

  for (const status of U.STATUS_OPTIONS) {
    const inCol = rows.filter((r) => ((r.Status || "").trim() || "Applied") === status);
    const col = el("div", "col");
    const head = el("h4");
    head.append(el("span", "", status), el("span", "", String(inCol.length)));
    col.appendChild(head);

    if (!inCol.length) col.appendChild(el("p", "empty-note", "—"));

    for (const r of inCol.slice(0, 40)) {
      const card = el("div", "jobcard");
      card.append(el("div", "co", r.Company || "—"), el("div", "po", r.Position || "—"));

      const meta = el("div", "meta");
      if (r["Date Applied"]) meta.appendChild(el("span", "", r["Date Applied"]));
      const sp = sponsorOf(r);
      if (SPONSOR_META[sp].blocker) meta.appendChild(el("span", "", `${SPONSOR_META[sp].icon} ${sp}`));
      card.appendChild(meta);

      card.appendChild(statusSelect(r, renderPipeline));
      col.appendChild(card);
    }
    board.appendChild(col);
  }
}

// ── All jobs table ──
function fillFilterOptions() {
  const fill = (sel, values) => {
    const keep = sel.value;
    sel.textContent = "";
    const any = document.createElement("option");
    any.value = "";
    any.textContent = "Any";
    sel.appendChild(any);
    for (const v of values) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      sel.appendChild(o);
    }
    sel.value = keep;
  };
  fill($("fStatus"), U.STATUS_OPTIONS);
  fill($("fSponsor"), SPONSOR_ORDER);
  fill($("fType"), [...new Set(rows.map((r) => r["Job Type"]).filter(Boolean))].sort());
}

function visibleRows() {
  const q = search.trim().toLowerCase();
  const fStatus = $("fStatus").value;
  const fSponsor = $("fSponsor").value;
  const fType = $("fType").value;

  let out = rows.filter((r) => {
    if (fStatus && ((r.Status || "").trim() || "Applied") !== fStatus) return false;
    if (fSponsor && sponsorOf(r) !== fSponsor) return false;
    if (fType && r["Job Type"] !== fType) return false;
    if (!q) return true;
    return ["Company", "Position", "Notes", "Location", "Role", "Industry"]
      .some((k) => String(r[k] || "").toLowerCase().includes(q));
  });

  const { key, asc } = sort;
  out.sort((a, b) => {
    const cmp = String(a[key] || "").localeCompare(String(b[key] || ""), undefined, { numeric: true });
    return asc ? cmp : -cmp;
  });
  return out;
}

function renderJobs() {
  fillFilterOptions();
  const list = visibleRows();
  const body = $("jobsRows");
  body.textContent = "";

  $("jobsSummary").textContent =
    list.length === rows.length
      ? `${rows.length} application${rows.length === 1 ? "" : "s"}`
      : `${list.length} of ${rows.length}`;

  for (const th of document.querySelectorAll("#jobsTable th[data-sort]")) {
    th.classList.toggle("sorted", th.dataset.sort === sort.key);
    th.classList.toggle("asc", th.dataset.sort === sort.key && sort.asc);
  }

  for (const r of list) {
    const tr = document.createElement("tr");

    const td = (text, cls) => {
      const cell = el("td", cls, text || "—");
      return cell;
    };

    tr.appendChild(td(r["Date Applied"], "num"));

    const posTd = el("td", "strong");
    if (r["Job URL"]) {
      const a = el("a", "joblink", r.Position || "—");
      a.href = r["Job URL"];
      a.target = "_blank";
      a.rel = "noreferrer";
      posTd.appendChild(a);
    } else {
      posTd.textContent = r.Position || "—";
    }
    tr.appendChild(posTd);

    tr.appendChild(td(r.Company, "strong"));
    tr.appendChild(td(r["Job Type"]));

    const sp = sponsorOf(r);
    const spTd = el("td", "");
    spTd.appendChild(el("span", `spons ${SPONSOR_META[sp].cls}`, `${SPONSOR_META[sp].icon} ${sp}`));
    tr.appendChild(spTd);

    tr.appendChild(td(r.Deadline, "num"));

    const stTd = document.createElement("td");
    stTd.appendChild(statusSelect(r, renderJobs));
    tr.appendChild(stTd);

    const delTd = document.createElement("td");
    if (r.id) {
      const del = el("button", "rowbtn", "✕");
      del.title = "Delete from the local log";
      del.addEventListener("click", () => deleteWithUndo(r));
      delTd.appendChild(del);
    }
    tr.appendChild(delTd);

    body.appendChild(tr);
  }
}

function renderDeadlines() {
  const all = deadlines();
  renderList($("deadlineFull"), all, "No application recorded an apply-by date.", (r) => ({
    who: `${r.Company || "—"} · ${r.Position || "—"}`,
    when: `${r.Deadline} · ${relativeDeadline(r.Deadline)}`,
    overdue: U.daysBetween(r.Deadline, today()) > 0,
  }));
}

// ── Needs attention ──
// One list answering "what should I do now", instead of three places to look.
const ATTENTION_LABEL = {
  deadline: "Deadline",
  followup: "Follow up",
  stale: "No reply",
};

function renderAttention() {
  const items = U.needsAttention(rows, settings, today());
  const host = $("attentionList");
  host.textContent = "";

  $("attentionEmpty").hidden = items.length > 0;
  if (!items.length) return;

  for (const { row, kind, label } of items) {
    const item = el("div", "item");
    const tag = el("span", `tag tag-${kind}`, ATTENTION_LABEL[kind]);
    const who = el("span", "who", `${row.Company || "—"} · ${row.Position || "—"}`);
    const when = el("span", "when" + (kind !== "deadline" ? " overdue" : ""), label);
    item.append(tag, who, when);
    host.appendChild(item);
  }
}

// ── Delete with undo ──
// Deleting the wrong row is easy and a confirm() dialog on every row is worse
// than an undo, so the row is held for 8 seconds and can be put back.
let undoTimer;
let undoRow = null;

async function deleteWithUndo(row) {
  const resp = await DS.deleteRow(row);
  if (!resp?.ok) return;

  rows = rows.filter((r) => r.id !== row.id);
  undoRow = row;
  renderAll();

  const bar = $("undoBar");
  $("undoText").textContent = `Deleted ${row.Company || "row"} · ${row.Position || ""}`.trim();
  bar.hidden = false;

  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    bar.hidden = true;
    undoRow = null;
  }, 8000);
}

$("undoBtn").addEventListener("click", async () => {
  if (!undoRow) return;
  await DS.restoreRow(undoRow);
  undoRow = null;
  $("undoBar").hidden = true;
  clearTimeout(undoTimer);
  load();
});

// ── Import ──
function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Couldn't read that file"));
    reader.readAsText(file);
  });
}

async function importFile(file) {
  let text;
  try {
    text = await readFile(file);
  } catch (e) {
    return setStatusText("exportStatus", e.message, "err");
  }

  const { rows: parsed, error } = U.parseImport(text, file.name);
  if (error) return setStatusText("exportStatus", error, "err");
  if (!parsed.length) return setStatusText("exportStatus", "Nothing importable in that file", "err");

  const resp = await DS.importRows(parsed);
  if (!resp?.ok) return setStatusText("exportStatus", resp?.error || "Import failed", "err");

  const skipped = resp.skipped ? `, ${resp.skipped} already there` : "";
  setStatusText("exportStatus", `Imported ${resp.added}${skipped}`, "ok");
  load();
  return undefined;
}

$("importBtn").addEventListener("click", () => $("importInput").click());
$("importInput").addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) importFile(file);
  e.target.value = ""; // let the same file be picked twice
});

// ── Settings ──
function fillSettings() {
  // The web build has no worker, so nothing that needs one is shown.
  for (const [cap, id] of [["sheets", "sheetsSection"], ["capture", "captureSection"], ["reminders", "remindersSection"]]) {
    const node = $(id);
    if (node) node.hidden = !DS.can[cap];
  }
  const webNote = $("webNote");
  if (webNote) webNote.hidden = DS.env !== "web";

  $("sheetUrl").value = settings.spreadsheetId || "";
  $("sheetName").value = settings.sheetName || "Sheet1";
  $("roleOptions").value = (settings.roleOptions || []).join(", ");
  for (const id of CHECKBOXES) $(id).checked = Boolean(settings[id]);
  for (const id of NUMBERS) $(id).value = settings[id] ?? U.DEFAULT_SETTINGS[id];
}

function readNumber(id) {
  const node = $(id);
  const n = parseInt(node.value, 10);
  if (!Number.isFinite(n) || n < Number(node.min || 1)) return U.DEFAULT_SETTINGS[id];
  return Math.min(n, Number(node.max || 365));
}

function setStatusText(id, text, kind) {
  const node = $(id);
  node.textContent = text;
  node.className = "status" + (kind ? ` ${kind}` : "");
}

async function saveSettings() {
  const raw = $("sheetUrl").value.trim();
  const spreadsheetId = U.parseSpreadsheetId(raw);
  if (raw && !spreadsheetId) {
    setStatusText("saveStatus", "Couldn't parse a spreadsheet ID from that", "err");
    return false;
  }

  const roleOptions = $("roleOptions").value.split(",").map((s) => s.trim()).filter(Boolean);
  const next = {
    spreadsheetId,
    sheetName: $("sheetName").value.trim() || "Sheet1",
    roleOptions: roleOptions.length ? roleOptions : U.DEFAULT_SETTINGS.roleOptions,
  };
  for (const id of CHECKBOXES) next[id] = $(id).checked;
  for (const id of NUMBERS) next[id] = readNumber(id);
  next.weeklyGoal = readNumber("weeklyGoal");

  await DS.saveSettings(next);
  settings = { ...settings, ...next };
  if (spreadsheetId) $("sheetUrl").value = spreadsheetId;
  for (const id of NUMBERS) $(id).value = next[id];
  setStatusText("saveStatus", "Saved ✓", "ok");
  return true;
}

function showHeaderResult(resp) {
  const warn = $("headerWarning");
  warn.hidden = true;

  if (!resp) return setStatusText("connectStatus", "No response from the worker", "err");
  if (!resp.ok) return setStatusText("connectStatus", resp.error || "Failed", "err");

  if (resp.header === "written") {
    setStatusText("connectStatus", "Connected ✓ — header row written", "ok");
  } else if (resp.header === "upgraded") {
    setStatusText("connectStatus", "Connected ✓ — added the new columns", "ok");
    warn.hidden = false;
    warn.textContent = `Added: ${(resp.added || []).join(", ")}. Existing rows untouched.`;
  } else if (resp.header === "mismatch") {
    setStatusText("connectStatus", "Connected, but headers don't match", "err");
    warn.hidden = false;
    warn.textContent =
      `Nothing was overwritten. Expected: ${U.COLUMNS.join(" | ")}. ` +
      `Found: ${(resp.existing || []).join(" | ") || "(empty)"}.`;
  } else {
    setStatusText("connectStatus", "Connected ✓ — headers verified", "ok");
  }
  return undefined;
}

async function refreshQueue() {
  const resp = await DS.getQueue();
  $("queueCount").textContent = resp?.count ?? "0";
  const err = $("queueError");
  err.hidden = !resp?.lastError;
  if (resp?.lastError) err.textContent = `Last error: ${resp.lastError}`;
}

// ── Export ──
function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ── Routing ──
function show(view) {
  const target = VIEWS.includes(view) ? view : "dashboard";
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== target;
  for (const link of document.querySelectorAll(".navlink")) {
    link.classList.toggle("active", link.dataset.view === target);
  }
  if (target === "dashboard" && rows.length) renderWeeklyChart();
}

function currentView() {
  return location.hash.replace("#", "") || "dashboard";
}

window.addEventListener("hashchange", () => show(currentView()));

// ── Theme ──
async function initTheme() {
  const theme = await DS.getTheme();
  if (theme) document.documentElement.dataset.theme = theme;
}

$("themeBtn").addEventListener("click", async () => {
  const root = document.documentElement;
  const isDark = root.dataset.theme
    ? root.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  const next = isDark ? "light" : "dark";
  root.dataset.theme = next;
  await DS.setTheme(next);
  // Marks are CSS-variable driven, so the charts need re-reading of nothing —
  // but the tooltip may be mid-flight.
  hideTip();
});

// ── Wiring ──
$("refreshBtn").addEventListener("click", () => load());

$("search").addEventListener("input", (e) => {
  search = e.target.value;
  renderJobs();
});

for (const id of ["fStatus", "fSponsor", "fType"]) {
  $(id).addEventListener("change", renderJobs);
}

$("clearFilters").addEventListener("click", () => {
  for (const id of ["fStatus", "fSponsor", "fType"]) $(id).value = "";
  $("search").value = "";
  search = "";
  renderJobs();
});

for (const th of document.querySelectorAll("#jobsTable th[data-sort]")) {
  th.addEventListener("click", () => {
    const key = th.dataset.sort;
    sort = { key, asc: sort.key === key ? !sort.asc : true };
    renderJobs();
  });
}

$("exportCsvBtn").addEventListener("click", () => {
  if (!rows.length) return setStatusText("exportStatus", "Nothing to export yet", "err");
  download(`ghosted-${today()}.csv`, U.toCSV(rows), "text/csv;charset=utf-8");
  return setStatusText("exportStatus", `${rows.length} row(s) exported`, "ok");
});

$("copyTsvBtn").addEventListener("click", async () => {
  if (!rows.length) return setStatusText("exportStatus", "Nothing to export yet", "err");
  try {
    await navigator.clipboard.writeText(U.toTSV(rows));
    return setStatusText("exportStatus", "Copied — paste into a sheet", "ok");
  } catch {
    return setStatusText("exportStatus", "Clipboard blocked — use CSV", "err");
  }
});

$("saveBtn").addEventListener("click", async () => {
  if (await saveSettings()) load();
});

$("connectBtn").addEventListener("click", async () => {
  if (!(await saveSettings())) return;
  if (!$("sheetUrl").value.trim()) {
    setStatusText("connectStatus", "Add a spreadsheet URL first", "err");
    return;
  }
  setStatusText("connectStatus", "Connecting…");
  showHeaderResult(await DS.connectGoogle());
  load();
});

$("openSheetBtn").addEventListener("click", async () => {
  const resp = await DS.openSheet();
  if (!resp?.ok) setStatusText("connectStatus", resp?.error || "No sheet configured", "err");
});

$("retryBtn").addEventListener("click", async () => {
  await DS.retryQueue();
  refreshQueue();
  load();
});

// Two deliberate clicks instead of confirm(), which blocks the page.
$("clearBtn").addEventListener("click", async () => {
  const btn = $("clearBtn");
  if (btn.dataset.armed !== "1") {
    btn.dataset.armed = "1";
    btn.textContent = "Click again to permanently delete";
    setStatusText("clearStatus", `${rows.length} row(s) will go`, "err");
    setTimeout(() => {
      btn.dataset.armed = "";
      btn.textContent = "Delete all local applications";
      setStatusText("clearStatus", "");
    }, 5000);
    return;
  }
  await DS.clearAll();
  btn.dataset.armed = "";
  btn.textContent = "Delete all local applications";
  setStatusText("clearStatus", "Local log cleared", "ok");
  load();
});

// ── Keyboard ──
// "/" to search, g+letter to jump, ? for the list. Ignored while typing.
const GOTO = { d: "dashboard", a: "attention", p: "pipeline", j: "jobs", l: "deadlines", s: "settings" };
let awaitingGoto = false;

document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === "Escape") {
    awaitingGoto = false;
    $("shortcutHelp").hidden = true;
    if (typing) e.target.blur();
    return;
  }
  if (typing) return;

  if (awaitingGoto) {
    awaitingGoto = false;
    const view = GOTO[e.key.toLowerCase()];
    if (view) {
      e.preventDefault();
      location.hash = `#${view}`;
    }
    return;
  }

  if (e.key === "/") {
    e.preventDefault();
    $("search").focus();
  } else if (e.key === "?") {
    e.preventDefault();
    $("shortcutHelp").hidden = !$("shortcutHelp").hidden;
  } else if (e.key.toLowerCase() === "g") {
    awaitingGoto = true;
  } else if (e.key.toLowerCase() === "r") {
    load();
  }
});

initTheme();
show(currentView());
refreshQueue();
load();
