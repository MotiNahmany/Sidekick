// ---- Tab navigation (left pane) ----
const navButtons = document.querySelectorAll(".nav-btn");
const views = document.querySelectorAll(".view");

const VIEWS = ["book", "plan", "perf", "news", "claude", "login"];

function showView(name) {
  navButtons.forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  views.forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  if (location.hash !== `#${name}`) location.hash = name;
  // Start the Power BI auto-refresh only while its tab is showing.
  if (name === "perf") startReportRefresh();
  else stopReportRefresh();
  // Start each news feed's auto-refresh only while its tab is showing.
  if (name === "news") startFeed(tradingFeed);
  else stopFeed(tradingFeed);
  if (name === "claude") startFeed(claudeFeed);
  else stopFeed(claudeFeed);
}

navButtons.forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
window.addEventListener("hashchange", () => {
  const name = location.hash.slice(1);
  if (VIEWS.includes(name)) showView(name);
});

// ---- Top Performers: embedded Power BI report, refreshed every minute ----
// The iframe carries the embed URL in data-src so it only loads when the tab
// is first opened. Reloading re-renders the report with the latest data the
// Power BI service holds (it does not trigger a dataset refresh).
const reportFrame = document.getElementById("perf-report");
let reportTimer = null;

// News-feed configs (declared early — showView() touches these on first load).
// Both the Trading News and Claude News tabs share the same render/poll code;
// only the endpoint, label, and element ids differ.
const tradingFeed = {
  endpoint: "/api/news",
  label: "trading news",
  tableId: "news-table",
  statusId: "news-status",
  updatedId: "news-updated",
  timer: null,
  loadedOnce: false,
};
const claudeFeed = {
  endpoint: "/api/claude-news",
  label: "Claude news",
  tableId: "claude-table",
  statusId: "claude-status",
  updatedId: "claude-updated",
  timer: null,
  loadedOnce: false,
};

function loadReport() {
  if (reportFrame) reportFrame.src = reportFrame.dataset.src;
}

function startReportRefresh() {
  if (!reportFrame) return;
  if (!reportFrame.src) loadReport(); // first open
  if (reportTimer) return; // already running
  reportTimer = setInterval(loadReport, 60_000);
}

function stopReportRefresh() {
  if (reportTimer) {
    clearInterval(reportTimer);
    reportTimer = null;
  }
}

// Restore the tab from the URL hash (defaults to Book Match).
showView(VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "book");

// ---- Shared helper ----
function showStatus(el, message, isError = false) {
  if (!message) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = message;
  el.classList.toggle("error", isError);
}

// ---- Voice input (Web Speech API; client-side, no key) ----
// Reusable: wires a mic button to dictate into a target textarea. Each call
// gets its own recognition instance so the two tabs never cross-feed.
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

function setupDictation({ button, label, hint, target, idleLabel }) {
  if (!button) return null;

  if (!SpeechRec) {
    button.disabled = true;
    button.title = "Voice input isn't supported in this browser. Try Chrome or Edge.";
    hint.textContent = "Voice input needs Chrome or Edge.";
    return null;
  }

  const recognition = new SpeechRec();
  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = true;

  let listening = false;
  // Text already in the box when dictation starts; finals get appended to it.
  let baseText = "";

  recognition.onstart = () => {
    listening = true;
    button.classList.add("listening");
    button.setAttribute("aria-pressed", "true");
    label.textContent = "Stop";
    hint.textContent = "Listening… speak now.";
  };

  recognition.onend = () => {
    listening = false;
    button.classList.remove("listening");
    button.setAttribute("aria-pressed", "false");
    label.textContent = idleLabel;
    if (hint.textContent === "Listening… speak now.") hint.textContent = "";
  };

  recognition.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      hint.textContent =
        "Microphone blocked — allow mic access in the address bar, then reload.";
      // Refine the message if the permission is persistently set to "denied".
      if (navigator.permissions?.query) {
        navigator.permissions
          .query({ name: "microphone" })
          .then((p) => {
            if (p.state === "denied") {
              hint.textContent =
                "Mic is set to Block for this site — click the lock/sliders icon in the address bar → Microphone → Allow, then reload.";
            }
          })
          .catch(() => {});
      }
    } else if (e.error === "audio-capture") {
      hint.textContent = "No microphone detected — check your input device.";
    } else if (e.error === "no-speech") {
      hint.textContent = "Didn't catch that — try again.";
    } else if (e.error === "network") {
      hint.textContent = "Network error reaching the speech service — check your connection.";
    } else if (e.error !== "aborted") {
      hint.textContent = "Voice input error: " + e.error;
    }
  };

  recognition.onresult = (event) => {
    let interim = "";
    let final = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) final += transcript;
      else interim += transcript;
    }
    if (final) baseText = (baseText + " " + final).replace(/\s+/g, " ").trim();
    target.value = (baseText + (interim ? " " + interim : "")).trim();
  };

  button.addEventListener("click", () => {
    if (listening) {
      recognition.stop();
      return;
    }

    // SpeechRecognition only runs in a secure context. localhost is secure;
    // a LAN IP over http (or a file:// page) is not, and fails with not-allowed.
    if (!window.isSecureContext) {
      hint.textContent =
        "Voice needs a secure page — open http://localhost:3000 (not an IP address).";
      return;
    }

    baseText = target.value.trim();
    hint.textContent = "";
    try {
      recognition.start();
    } catch {
      /* start() throws if it's already starting — safe to ignore */
    }
  });

  return {
    stop() {
      if (listening) recognition.stop();
    },
  };
}

// =====================================================================
//  Book Match
// =====================================================================
const form = document.getElementById("form");
const interestsEl = document.getElementById("interests");
const submitBtn = document.getElementById("submit");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");

const bookDictation = setupDictation({
  button: document.getElementById("mic-book"),
  label: document.getElementById("mic-book-label"),
  hint: document.getElementById("mic-book-hint"),
  target: interestsEl,
  idleLabel: "Speak your interests",
});

function amazonUrl(title, author) {
  const query = encodeURIComponent(`${title} ${author}`);
  return `https://www.amazon.com/s?k=${query}&i=stripbooks`;
}

// Look up a real cover image via the free Open Library API (no key needed).
// Fetches a few results and returns the first that actually has a cover.
async function fetchCover(title, author) {
  try {
    const url =
      "https://openlibrary.org/search.json?limit=8&fields=cover_i" +
      `&q=${encodeURIComponent(`${title} ${author}`)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const doc = (data.docs || []).find((d) => d.cover_i);
    return doc ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null;
  } catch {
    return null;
  }
}

function renderBooks(books) {
  resultsEl.innerHTML = "";
  books.forEach((book, i) => {
    const card = document.createElement("a");
    card.className = "card";
    card.href = amazonUrl(book.title, book.author);
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    card.style.animationDelay = `${i * 60}ms`;
    card.innerHTML = `
      <div class="cover-wrap loading"><img class="cover" alt="" loading="lazy" /></div>
      <div class="card-body">
        <span class="num">${String(i + 1).padStart(2, "0")}</span>
        <h2></h2>
        <p class="author"></p>
        <p class="why"></p>
        <span class="find">Find on Amazon</span>
      </div>
    `;
    card.querySelector("h2").textContent = book.title;
    card.querySelector(".author").textContent = `by ${book.author}`;
    card.querySelector(".why").textContent = book.why;
    resultsEl.appendChild(card);

    // Load the cover asynchronously; show a shimmer until it resolves.
    const wrap = card.querySelector(".cover-wrap");
    const img = card.querySelector(".cover");
    img.alt = `Cover of ${book.title}`;
    const collapse = () => wrap.classList.remove("loading") || wrap.classList.add("empty");
    img.onload = () => {
      wrap.classList.remove("loading");
      img.classList.add("loaded");
    };
    img.onerror = collapse;
    fetchCover(book.title, book.author).then((src) => {
      if (src) img.src = src;
      else collapse();
    });
  });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  bookDictation?.stop();
  const interests = interestsEl.value.trim();
  if (!interests) return;

  submitBtn.disabled = true;
  resultsEl.innerHTML = "";
  showStatus(statusEl, "Reading your interests and picking books…");

  try {
    const res = await fetch("/api/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interests }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Something went wrong.");

    showStatus(statusEl, null);
    renderBooks(data.books);
  } catch (err) {
    showStatus(statusEl, err.message, true);
  } finally {
    submitBtn.disabled = false;
  }
});

// =====================================================================
//  Plan My Day
// =====================================================================
const planForm = document.getElementById("plan-form");
const todosEl = document.getElementById("todos");
const planSubmit = document.getElementById("plan-submit");
const planStatusEl = document.getElementById("plan-status");
const planResultsEl = document.getElementById("plan-results");

// ---- Voice input (shared factory; see setupDictation above) ----
const planDictation = setupDictation({
  button: document.getElementById("mic"),
  label: document.getElementById("mic-label"),
  hint: document.getElementById("mic-hint"),
  target: todosEl,
  idleLabel: "Speak your plan",
});

function cell(value) {
  return Array.isArray(value)
    ? value.length
      ? value.join(", ")
      : "—"
    : value || "—";
}

function renderSchedule(schedule) {
  planResultsEl.innerHTML = "";
  if (!schedule || !schedule.length) {
    showStatus(planStatusEl, "No tasks found to schedule.", true);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  table.className = "schedule";
  table.innerHTML =
    "<thead><tr><th>Time</th><th>Task</th><th>People</th><th>Depends on</th></tr></thead>";

  const tbody = document.createElement("tbody");
  schedule.forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      '<td class="t-time"></td><td class="t-desc"></td><td class="t-people"></td><td class="t-deps"></td>';
    tr.querySelector(".t-time").textContent = item.time || "";
    tr.querySelector(".t-desc").textContent = item.description || "";
    tr.querySelector(".t-people").textContent = cell(item.people);
    tr.querySelector(".t-deps").textContent = cell(item.dependencies);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrap.appendChild(table);
  planResultsEl.appendChild(wrap);
}

planForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  planDictation?.stop();
  const todos = todosEl.value.trim();
  if (!todos) return;

  planSubmit.disabled = true;
  planResultsEl.innerHTML = "";
  showStatus(planStatusEl, "Organizing and optimizing your day…");

  try {
    const res = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ todos }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Something went wrong.");

    showStatus(planStatusEl, null);
    renderSchedule(data.schedule);
  } catch (err) {
    showStatus(planStatusEl, err.message, true);
  } finally {
    planSubmit.disabled = false;
  }
});

// =====================================================================
//  Attorney Login — lien register (public snapshot from liens.json)
// =====================================================================
const LIEN_COLUMNS = [
  { key: "accid_id", label: "Account ID" },
  { key: "ref_datetime", label: "Referred", type: "date" },
  { key: "Prac_Loc", label: "Practice / Loc" },
  { key: "SF_Account_Name", label: "Law Firm", cls: "lien-firm" },
  { key: "zip_code", label: "ZIP" },
  { key: "onset_date", label: "Onset", type: "date" },
  { key: "Lien_Form_Waived", label: "Form Waived", type: "bool" },
  { key: "Lien_Cap_Amt", label: "Lien Cap", type: "money" },
  { key: "accid_Bal", label: "Balance", type: "money" },
];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function fmtLien(col, v) {
  if (v === null || v === undefined || v === "") return "—";
  if (col.type === "money")
    return "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (col.type === "date") return String(v).slice(0, 10);
  if (col.type === "bool") return v ? "Yes" : "No";
  return String(v);
}

let lienRows = [];

function lienTableHtml(rows) {
  const head = LIEN_COLUMNS.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("");
  const body = rows
    .map((r) => {
      const cells = LIEN_COLUMNS.map((c) => {
        const cls = [c.cls, c.type === "money" || c.type === "num" ? "num" : ""]
          .filter(Boolean)
          .join(" ");
        return `<td${cls ? ` class="${cls}"` : ""}>${escapeHtml(fmtLien(c, r[c.key]))}</td>`;
      }).join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `<table class="lien-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function applyLienFilter() {
  const table = document.getElementById("lien-table");
  const select = document.getElementById("lien-firm");
  const count = document.getElementById("lien-count");
  if (!table) return;
  const firm = select ? select.value : "";
  const rows = firm ? lienRows.filter((r) => (r.SF_Account_Name || "") === firm) : lienRows;
  table.innerHTML = lienTableHtml(rows);
  if (count) count.textContent = `${rows.length} of ${lienRows.length} records`;
}

let lienLoaded = false;
async function loadLiens() {
  const table = document.getElementById("lien-table");
  const status = document.getElementById("lien-status");
  const select = document.getElementById("lien-firm");
  if (lienLoaded || !table) return;
  lienLoaded = true;
  if (status) showStatus(status, "Loading lien register…");
  try {
    const res = await fetch("liens.json");
    if (!res.ok) throw new Error("Could not load lien data.");
    lienRows = await res.json();
    if (select) {
      const firms = [...new Set(lienRows.map((r) => r.SF_Account_Name).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b)
      );
      select.innerHTML =
        `<option value="">All law firms (${lienRows.length})</option>` +
        firms.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join("");
      select.onchange = applyLienFilter;
    }
    applyLienFilter();
    if (status) showStatus(status, null);
  } catch (err) {
    lienLoaded = false;
    if (status) showStatus(status, err.message, true);
  }
}

// Load the register when the Attorney Login tab is opened (or deep-linked).
document
  .querySelectorAll('.nav-btn[data-view="login"]')
  .forEach((b) => b.addEventListener("click", loadLiens));
window.addEventListener("hashchange", () => {
  if (location.hash.slice(1) === "login") loadLiens();
});
if (location.hash.slice(1) === "login") loadLiens();

// =====================================================================
//  News feeds — Trading News + Claude News (server-refreshed; polled here)
// =====================================================================
function newsTableHtml(items) {
  const body = items
    .map((it) => {
      const date = escapeHtml(fmtNewsDate(it.date));
      const source = escapeHtml(it.source || "—");
      const summary = escapeHtml(it.summary || "—").replace(/\n/g, "<br>");
      return `<tr><td class="news-date">${date}</td><td class="news-source">${source}</td><td class="news-summary">${summary}</td></tr>`;
    })
    .join("");
  return (
    '<table class="news-table"><thead><tr>' +
    "<th>Date</th><th>Source</th><th>Summary</th>" +
    `</tr></thead><tbody>${body}</tbody></table>`
  );
}

function fmtNewsDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
}

async function loadFeed(feed) {
  const table = document.getElementById(feed.tableId);
  const status = document.getElementById(feed.statusId);
  const updated = document.getElementById(feed.updatedId);
  if (!table) return;
  if (!feed.loadedOnce && status) showStatus(status, `Loading ${feed.label}…`);
  try {
    const res = await fetch(feed.endpoint);
    if (!res.ok) throw new Error(`Could not load ${feed.label}.`);
    const data = await res.json();
    const items = data.items || [];
    if (!items.length) {
      table.innerHTML = "";
      if (status)
        showStatus(
          status,
          data.error || "Gathering the latest headlines — check back in a moment.",
          !!data.error
        );
    } else {
      table.innerHTML = newsTableHtml(items);
      if (status) showStatus(status, null);
    }
    if (updated) {
      updated.textContent = data.updatedAt
        ? `Updated ${fmtNewsDate(data.updatedAt)} · ${items.length} items`
        : "";
    }
    feed.loadedOnce = true;
  } catch (err) {
    if (status) showStatus(status, err.message, true);
  }
}

// Poll while a news tab is open. The server refreshes the underlying data every
// 10 minutes; the client re-fetches on the same cadence.
function startFeed(feed) {
  loadFeed(feed);
  if (feed.timer) return;
  feed.timer = setInterval(() => loadFeed(feed), 10 * 60 * 1000);
}
function stopFeed(feed) {
  if (feed.timer) {
    clearInterval(feed.timer);
    feed.timer = null;
  }
}

// Restore a news tab on deep-link.
if (location.hash.slice(1) === "news") startFeed(tradingFeed);
if (location.hash.slice(1) === "claude") startFeed(claudeFeed);
