(function applySavedTheme() {
  const saved = localStorage.getItem("codex-studys-theme");
  if (!saved || saved === "system") return;
  document.documentElement.setAttribute("data-theme", saved);
})();

const FALLBACK_THUMB = "assets/codex-telegram.png";
let allBatches = [];
let activeFilter = "all";
let searchQuery = "";
let sortMode = "relevance";
let langFilter = "all";
let visibleCount = 24;
const PAGE_SIZE = 24;

const $ = (selector) => document.querySelector(selector);
const THUMB_PLACEHOLDER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
window.__thumbFallback = (img) => { img.outerHTML = THUMB_PLACEHOLDER_SVG; };
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
}

/* ================= GS Vision data + categories + search ================= */
const GSV = {
  courses: "https://gsvisionapp21.gsvision.in/api/Service/GetAllCourse",
  api: "https://gsvisionapp21ar4.gsvision.in/api/Service/",
  img: "https://gsvisionapp21ar4.gsvision.in/ServiceImages/"
};

function normalizeArray(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const key of ["Data", "data", "Result", "result", "Courses", "courses"]) {
      if (Array.isArray(data[key])) return data[key];
    }
  }
  return [];
}

function validDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return isNaN(date) || date.getFullYear() < 2015 ? "" : value;
}

function gsCourseToBatch(course) {
  if (!course || course.CourseId === undefined || course.CourseId === null || course.CourseId === "") return null;
  return {
    _id: String(course.CourseId),
    name: (course.Name || "").trim(),
    byName: "GS VISION",
    details: course.Details || "",
    language: course.Langauge ? String(course.Langauge).trim() : "Hindi",
    previewImage: (course.Pic && course.Pic !== "ExamLogo.jpg")
      ? `https://gsvisionapp21ar4.gsvision.in/ServiceImages/${course.Pic}`
      : "assets/codex-telegram.png",
    feeTotal: course.Price || 0,
    type: "E_BATCH",
    source: "gsvision",
    // extras used for sorting / About tab
    startDate: validDate(course.AddDate),
    endDate: validDate(course.ExpiryDate),
    teachers: course.Teachers ? String(course.Teachers).trim() : ""
  };
}

// Order matters: the first matching category wins.
const CATEGORIES = [
  { key: "roaro", label: "RO/ARO", re: /\b(ro|aro)\b|review officer/ },
  { key: "uksssc", label: "UKSSSC", re: /uk ?sss?c|uk ?sss\b|subordinate service|patwari|lekhpal|forest guard|vpdo|\bvdo\b/ },
  { key: "ukpsc", label: "UKPSC / PCS", re: /uk ?psc|uttarakhand psc|lower pcs|upper pcs|\bpcs\b|\bacf\b|\brfo\b/ },
  { key: "police", label: "Police", re: /police|constable|sub inspector|\bsi\b|daroga|\bpac\b|fireman|fire man|jail warder|पुलिस/ },
  { key: "ssc", label: "SSC", re: /\bssc\b|\bcgl\b|\bchsl\b|\bmts\b|\bcpo\b|\bgd\b/ },
  { key: "railway", label: "Railway", re: /railway|\brrb\b|\bntpc\b|group d\b|\balp\b|\brpf\b|loco pilot/ },
  { key: "banking", label: "Banking", re: /bank|ibps|\bsbi\b|\brbi\b|\bpo\b|\bclerk\b|nabard/ },
  { key: "teaching", label: "Teaching", re: /teach|\btet\b|\bctet\b|uktet|\bdsssb\b|\bkvs\b|\bnvs\b|\bpgt\b|\btgt\b|\bprt\b|शिक्षक/ },
  { key: "defence", label: "Defence", re: /defen[cs]e|\bnda\b|\bcds\b|agniveer|\barmy\b|\bnavy\b|air force|afcat|\bcapf\b/ },
  { key: "gs", label: "GS / GK", re: /general studies|general knowledge|\bgs\b|\bgk\b|current affairs|uttarakhand|polity|geography|history|economy|reasoning|mathematics|\bmaths\b/ }
];

function normText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, " ").trim();
}

function categoryFor(batch) {
  if (batch.__cat) return batch.__cat;
  const find = (text) => {
    const hit = CATEGORIES.find((category) => category.re.test(normText(text)));
    return hit ? hit.key : "";
  };
  const key = find(batch.name) || find(String(batch.details || "").slice(0, 200)) || "other";
  Object.defineProperty(batch, "__cat", { value: key, enumerable: false, writable: true });
  return key;
}

function categoryLabel(key) {
  const hit = CATEGORIES.find((category) => category.key === key);
  if (hit) return hit.label;
  return key === "other" ? "Other" : String(key).toUpperCase();
}

function plainText(html) {
  const source = String(html || "").replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6])>/gi, "\n");
  try {
    return (new DOMParser().parseFromString(source, "text/html").body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
  } catch (e) {
    return source.replace(/<[^>]*>/g, "").trim();
  }
}

function detailsText(batch) {
  if (batch.__plain === undefined) {
    Object.defineProperty(batch, "__plain", { value: plainText(batch.details), enumerable: false, writable: true });
  }
  return batch.__plain;
}

function priceLabel(batch) {
  const amount = Number(batch.feeTotal) || 0;
  return amount > 0 ? `₹${amount.toLocaleString("en-IN")}` : "Free";
}

function deepSearchText(batch) {
  if (batch.__search) return batch.__search;
  const parts = [batch.name, batch.byName, batch.language, categoryLabel(categoryFor(batch)), batch.teachers, detailsText(batch)];
  const text = normText(parts.filter(Boolean).join(" "));
  const value = { text, compact: text.replace(/ /g, "") };
  Object.defineProperty(batch, "__search", { value, enumerable: false, writable: true });
  return value;
}

// Punctuation is ignored, so "RO/ARO", "ro aro" and "uk sssc" / "UKSSSC" all find the same courses.
function wordMatches(searchText, word) {
  if (word.length <= 2) return ` ${searchText.text} `.includes(` ${word} `);
  return searchText.text.includes(word) || searchText.compact.includes(word);
}

function deepSearchScore(batch, queryWords, rawQuery) {
  const name = normText(batch.name);
  const searchText = deepSearchText(batch);
  const joined = queryWords.join("");
  if (!queryWords.every((word) => wordMatches(searchText, word)) && !(joined.length > 2 && searchText.compact.includes(joined))) return 0;
  if (name === rawQuery) return 100;
  if (name.startsWith(rawQuery)) return 80;
  if (name.includes(rawQuery)) return 60;
  if (queryWords.every((word) => name.includes(word) || name.replace(/ /g, "").includes(word))) return 40;
  return 20;
}

function deepSearch(batches, query) {
  const rawQuery = normText(query);
  if (!rawQuery) return batches;
  const queryWords = rawQuery.split(" ").filter(Boolean);
  return batches
    .map((batch) => ({ batch, score: deepSearchScore(batch, queryWords, rawQuery) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.batch);
}

function openBatch(batch) {
  const id = batch && (batch._id || batch.batch_id);
  if (!id) return showToast("This course is not available right now.");
  addRecentlyViewed(batch);
  try { window.CXProfile && window.CXProfile.trackBatch(batch); } catch (e) {}
  renderRecentlyWatched();
  openViewer(batch);
}

function getRecentlyViewed() {
  try { return JSON.parse(localStorage.getItem("codex-studys-recent") || "[]").filter((item) => item && item.source === "gsvision"); }
  catch { return []; }
}

function addRecentlyViewed(batch) {
  const id = batch._id || batch.batch_id;
  if (!id) return;
  const entry = { _id: id, name: batch.name || "Untitled course", byName: batch.byName || "", language: batch.language || "", previewImage: batch.previewImage || "", source: "gsvision" };
  const recent = getRecentlyViewed().filter((item) => item._id !== id);
  recent.unshift(entry);
  localStorage.setItem("codex-studys-recent", JSON.stringify(recent.slice(0, 8)));
}

function renderRecentlyWatched() {
  const statRecent = document.getElementById("statRecent");
  if (statRecent) statRecent.textContent = String(getRecentlyViewed().length);
  const section = document.getElementById("recentSection");
  const row = document.getElementById("recentRow");
  if (!section || !row) return;
  const items = getRecentlyViewed();
  if (!items.length) { section.style.display = "none"; row.innerHTML = ""; return; }
  section.style.display = "block";
  row.innerHTML = items.map((item) => `
    <button class="recent-item" type="button" data-recent-id="${escapeHtml(item._id)}">
      <img class="recent-thumb" src="${escapeHtml(item.previewImage || FALLBACK_THUMB)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.src='${FALLBACK_THUMB}'">
      <span class="recent-info">
        <span class="recent-name">${escapeHtml(item.name || "Course")}</span>
        <span class="recent-sub">${escapeHtml(item.byName || item.language || "Continue watching")}</span>
      </span>
    </button>`).join("");
  row.querySelectorAll("[data-recent-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.recentId;
      const full = allBatches.find((batch) => (batch._id || batch.batch_id) === id);
      openBatch(full || items.find((item) => item._id === id));
    });
  });
}

function setupRecentlyWatched() {
  renderRecentlyWatched();
  document.getElementById("recentClearBtn")?.addEventListener("click", () => {
    localStorage.removeItem("codex-studys-recent");
    renderRecentlyWatched();
    showToast("Recently watched cleared.");
  });
}

function setupQuickInstall() {
  const button = document.getElementById("installQuickBtn");
  if (!button) return;
  button.addEventListener("click", () => openModal("installModal"));
}

function getFavorites() {
  try { return JSON.parse(localStorage.getItem("codex-studys-favorites") || "[]"); }
  catch { return []; }
}

function isFavorite(id) {
  return getFavorites().includes(id);
}

function toggleFavorite(id) {
  const favorites = getFavorites();
  const index = favorites.indexOf(id);
  if (index === -1) favorites.push(id); else favorites.splice(index, 1);
  localStorage.setItem("codex-studys-favorites", JSON.stringify(favorites));
  return favorites.includes(id);
}

function updateFavoritesCount() {
  const count = getFavorites().length;
  const button = $('.filter-row .filter[data-filter="favorites"]');
  if (button) button.textContent = count ? `❤ Favorite Batches (${count})` : "❤ Favorite Batches";
  const navBadge = $("#favNavBadge");
  if (navBadge) {
    navBadge.textContent = String(count);
    navBadge.style.display = count ? "grid" : "none";
  }
  const statFav = $("#statFav");
  if (statFav) statFav.textContent = count.toLocaleString();
}

function filteredBatches() {
  let batches;
  if (activeFilter === "favorites") {
    const favorites = getFavorites();
    batches = allBatches.filter((batch) => favorites.includes(batch._id || batch.batch_id || ""));
  } else {
    batches = allBatches.filter((batch) => activeFilter === "all" || categoryFor(batch) === activeFilter);
  }
  if (langFilter !== "all") {
    batches = batches.filter((batch) => {
      const lang = (batch.language || "").toLowerCase();
      if (langFilter === "hinglish") return lang.includes("hinglish") || (lang.includes("hindi") && lang.includes("english"));
      return lang.includes(langFilter);
    });
  }
  if (searchQuery.trim()) {
    batches = deepSearch(batches, searchQuery);
  }
  if (sortMode === "az") {
    batches = [...batches].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  } else if (sortMode === "za") {
    batches = [...batches].sort((a, b) => (b.name || "").localeCompare(a.name || ""));
  } else if (sortMode === "newest") {
    batches = [...batches].sort((a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0));
  }
  return batches;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (isNaN(date)) return "";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function isRecent(value) {
  if (!value) return false;
  const date = new Date(value);
  if (isNaN(date)) return false;
  const days = (Date.now() - date.getTime()) / 86400000;
  return days >= 0 && days <= 21;
}

function courseCard(batch) {
  const title = escapeHtml(batch.name || "Untitled course");
  const snippet = detailsText(batch).replace(/\s+/g, " ").slice(0, 120);
  const description = escapeHtml(snippet || batch.byName || "Structured learning for your next milestone");
  const language = escapeHtml(batch.language || "Self-paced");
  const category = categoryLabel(categoryFor(batch));
  const image = escapeHtml(batch.previewImage || FALLBACK_THUMB);
  const id = escapeHtml(batch._id || batch.batch_id || "");
  const favActive = isFavorite(id);
    const fresh = isRecent(batch.startDate);
  return `
    <article class="course-card" data-id="${id}" tabindex="0" role="button" aria-label="Open ${title}">
      <div class="course-thumb">
        <div class="thumb-fallback thumb-shimmer"></div>
        <img src="${image}" alt="" loading="lazy" referrerpolicy="no-referrer" onload="this.classList.add('loaded');this.previousElementSibling.style.display='none'" onerror="this.style.display='none'">
        <span class="course-tag">${escapeHtml(category)}</span>
        ${fresh ? '<span class="course-tag course-tag-new">NEW</span>' : ""}
        <button class="fav-btn${favActive ? " active" : ""}" type="button" data-fav-id="${id}" aria-label="${favActive ? "Remove from favorites" : "Add to favorites"}" aria-pressed="${favActive}">
          <svg viewBox="0 0 24 24" fill="${favActive ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2"><path d="M12 21s-7.2-4.5-9.6-9C.6 8.1 2.4 4.5 6 4.2c2.1-.15 3.6 1.05 6 3.3 2.4-2.25 3.9-3.45 6-3.3 3.6.3 5.4 3.9 3.6 7.8-2.4 4.5-9.6 9-9.6 9Z"/></svg>
        </button>
        <button class="info-btn" type="button" data-info-id="${id}" aria-label="Quick view details">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.6"/></svg>
        </button>
        ${getNote(id) ? '<span class="note-badge">📝 Note</span>' : ""}
      </div>
      <div class="course-chips"><span class="chip">${language}</span><span class="chip chip-accent">${escapeHtml(category)}</span></div>
      <div class="course-body">
        <h3 class="course-title">${title}</h3>
        <p class="course-description">${description}</p>
        <div class="course-meta"><span>${escapeHtml(priceLabel(batch))}</span><button class="course-cta" type="button">Let's Study <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></div>
      </div>
    </article>`;
}

function syncUrlParams() {
  const params = new URLSearchParams();
  if (activeFilter !== "all") params.set("filter", activeFilter);
  if (searchQuery.trim()) params.set("q", searchQuery.trim());
  if (sortMode !== "relevance") params.set("sort", sortMode);
  if (langFilter !== "all") params.set("lang", langFilter);
  const query = params.toString();
  const newUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  window.history.replaceState(null, "", newUrl);
}

function renderBatches() {
  const grid = $("#batchGrid");
  const loadMoreBtn = $("#loadMoreBtn");
  const batches = filteredBatches();
  const visible = batches.slice(0, visibleCount);
  const filterLabel = activeFilter === "all" ? "courses" : activeFilter === "favorites" ? "favorite courses" : `${categoryLabel(activeFilter)} courses`;
  const noteText = batches.length
    ? `Showing ${visible.length} of ${batches.length.toLocaleString()} ${filterLabel}.`
    : activeFilter === "favorites" ? "No favorites yet. Tap the heart on any course to save it here." : "No courses matched that filter yet.";
  $("#resultsNote").textContent = noteText;
  const announcer = $("#filterAnnouncer");
  if (announcer) announcer.textContent = noteText;
  grid.innerHTML = visible.length ? visible.map(courseCard).join("") : '<div class="empty">Try another category or search the full library.</div>';
  $$(".course-card").forEach((card, index) => {
    card.addEventListener("click", () => openBatch(visible[index]));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openBatch(visible[index]);
      }
    });
  });
  $$(".fav-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const nowActive = toggleFavorite(button.dataset.favId);
      button.classList.toggle("active", nowActive);
      button.setAttribute("aria-pressed", String(nowActive));
      button.querySelector("svg").setAttribute("fill", nowActive ? "currentColor" : "none");
      if (nowActive) {
        button.classList.remove("pop");
        void button.offsetWidth;
        button.classList.add("pop");
      }
      if (activeFilter === "favorites" && !nowActive) renderBatches();
      updateFavoritesCount();
    });
  });
  $$(".info-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const batch = visible.find((item) => (item._id || item.batch_id || "") === button.dataset.infoId);
      if (batch) openDetail(batch);
    });
  });
  if (loadMoreBtn) {
    const remaining = batches.length - visible.length;
    loadMoreBtn.style.display = remaining > 0 ? "inline-flex" : "none";
    loadMoreBtn.textContent = remaining > 0 ? "Loading more courses…" : "";
  }
  const clearBtn = $("#clearFiltersBtn");
  if (clearBtn) clearBtn.style.display = (activeFilter !== "all" || searchQuery.trim()) ? "inline-flex" : "none";
  syncUrlParams();
}

function getSearchHistory() {
  try { return JSON.parse(localStorage.getItem("codex-studys-search-history") || "[]"); }
  catch { return []; }
}

function addSearchHistory(term) {
  const trimmed = term.trim();
  if (!trimmed) return;
  const history = getSearchHistory().filter((item) => item.toLowerCase() !== trimmed.toLowerCase());
  history.unshift(trimmed);
  localStorage.setItem("codex-studys-search-history", JSON.stringify(history.slice(0, 6)));
}

function highlightMatch(text, query) {
  const safe = escapeHtml(text || "");
  if (!query) return safe;
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean).map((w) => escapeHtml(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return safe;
  return safe.replace(new RegExp(`(${words.join("|")})`, "gi"), "<mark>$1</mark>");
}

function renderSearchResults(query = "") {
  const results = $("#searchResults");
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    const history = getSearchHistory();
    const recent = getRecentlyViewed();
    if (!history.length && !recent.length) {
      results.innerHTML = '<div class="search-hint">Start typing to find your next course.</div>';
      return;
    }
    let html = "";
    if (history.length) {
      html += `<div class="search-hint" style="text-align:left;margin-bottom:2px;">Recent searches</div>
        <div class="search-history-row">${history.map((term) => `<button type="button" class="search-history-chip">${escapeHtml(term)}</button>`).join("")}</div>`;
    }
    if (recent.length) {
      html += `<div class="search-hint" style="text-align:left;margin-bottom:2px;">Recently viewed</div>` + recent.map((batch) => `
        <div class="search-result" data-id="${escapeHtml(batch._id)}">
          <div class="search-result-thumb">${batch.previewImage ? `<img src="${escapeHtml(batch.previewImage)}" alt="" referrerpolicy="no-referrer" onerror="window.__thumbFallback(this)">` : THUMB_PLACEHOLDER_SVG}</div>
          <div><strong>${escapeHtml(batch.name)}</strong><small>${escapeHtml(batch.byName || batch.language || "Course")}</small></div>
        </div>`).join("");
    }
    results.innerHTML = html;
    $$(".search-history-chip").forEach((chip, index) => chip.addEventListener("click", () => {
      const input = $("#searchInput");
      if (input) { input.value = history[index]; renderSearchResults(history[index]); }
    }));
    $$(".search-result").forEach((result, index) => result.addEventListener("click", () => {
      openBatch(recent[index]);
      closeModal("searchModal");
    }));
    return;
  }
  const matches = deepSearch(allBatches, normalized).slice(0, 40);
  if (!matches.length) {
    results.innerHTML = '<div class="search-hint">No matches yet. Try a subject, exam or class.</div>';
    return;
  }
  results.innerHTML = `<div class="search-hint" style="text-align:left;margin-bottom:2px;">${matches.length} result${matches.length === 1 ? "" : "s"}</div>` + matches.map((batch) => `
    <div class="search-result" data-id="${escapeHtml(batch._id || batch.batch_id || "")}">
      <div class="search-result-thumb">${batch.previewImage ? `<img src="${escapeHtml(batch.previewImage)}" alt="" referrerpolicy="no-referrer" onerror="window.__thumbFallback(this)">` : THUMB_PLACEHOLDER_SVG}</div>
      <div><strong>${highlightMatch(batch.name || "Untitled course", normalized)}</strong><small>${escapeHtml(batch.byName || batch.language || "Course")}</small></div>
      ${isRecent(batch.startDate) ? '<span class="search-new-badge">new</span>' : ""}
    </div>`).join("");
  $$(".search-result").forEach((result, index) => result.addEventListener("click", () => {
    openBatch(matches[index]);
    closeModal("searchModal");
  }));
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  $$(".overlay.visible").forEach((other) => {
    if (other.id === id) return;
    other.classList.remove("visible");
    if (other.id === "viewerModal") onViewerClosed();
  });
  modal.classList.add("visible");
  document.body.classList.add("modal-open");
  modal.querySelector("input")?.focus();
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove("visible");
  if (!$$(".overlay.visible").length) document.body.classList.remove("modal-open");
  if (id === "viewerModal") onViewerClosed();
}

function showToast(message) {
  const oldToast = $(".toast");
  oldToast?.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2800);
}

const BATCH_CACHE_KEY = "cx-batches-cache-v2";

function readBatchCache() {
  try {
    sessionStorage.removeItem("cx-batches-cache-v1"); // old cache that still held the PW batch
    const raw = sessionStorage.getItem(BATCH_CACHE_KEY);
    const list = raw ? JSON.parse(raw) : null;
    return Array.isArray(list) && list.length ? list.filter((batch) => batch && batch.source === "gsvision") : null;
  } catch (e) { return null; }
}

function restoreScroll() {
  try {
    const y = Number(sessionStorage.getItem("cx-scroll") || 0);
    sessionStorage.removeItem("cx-scroll");
    if (y > 0) window.requestAnimationFrame(() => window.scrollTo(0, y));
  } catch (e) {}
}

async function fetchGsCourses() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(GSV.courses, { mode: "cors", signal: controller.signal });
    if (!response.ok) throw new Error(`GS Vision courses HTTP ${response.status}`);
    const seen = new Set();
    return normalizeArray(await response.json())
      .map(gsCourseToBatch)
      .filter((batch) => batch && batch.name && !seen.has(batch._id) && seen.add(batch._id));
  } finally {
    clearTimeout(timer);
  }
}

// Hide category chips that have no courses and show counts on the rest.
function updateCategoryChips() {
  const counts = {};
  allBatches.forEach((batch) => { const key = categoryFor(batch); counts[key] = (counts[key] || 0) + 1; });
  $$("#catFilters .filter").forEach((button) => {
    const count = counts[button.dataset.filter] || 0;
    button.textContent = count ? `${button.dataset.label} (${count})` : button.dataset.label;
    button.hidden = !count && !button.classList.contains("active");
  });
}

// Drop favorites that pointed at courses which no longer exist (e.g. the removed PW batch).
function pruneStaleFavorites() {
  if (!allBatches.length) return;
  const ids = new Set(allBatches.map((batch) => batch._id));
  const favorites = getFavorites();
  const kept = favorites.filter((id) => ids.has(id));
  if (kept.length !== favorites.length) localStorage.setItem("codex-studys-favorites", JSON.stringify(kept));
  updateFavoritesCount();
}

async function loadBatches() {
  const cached = readBatchCache();
  let usedCache = false;
  try {
    const grid = $("#batchGrid");
    if (cached) {
      allBatches = cached;
      usedCache = true;
      updateStats();
      updateCategoryChips();
      renderBatches();
      $("#globalPreloader").classList.add("hidden");
    } else if (grid && !allBatches.length) {
      grid.innerHTML = Array.from({ length: 8 }, () => '<div class="skeleton-card"><div class="skeleton-thumb"></div><div class="skeleton-body"><div class="skeleton-line" style="width:88%"></div><div class="skeleton-line" style="width:60%"></div><div class="skeleton-line" style="width:40%"></div></div></div>').join("");
    }
    let fresh;
    try {
      fresh = await fetchGsCourses();
    } catch (liveError) {
      console.warn("GS Vision live fetch failed", liveError);
      if (usedCache) return;
      // Last resort: a static list in batches.json (empty by default).
      const response = await fetch("batches.json", { cache: "no-store" });
      if (!response.ok) throw liveError;
      const data = await response.json();
      fresh = Array.isArray(data.batches) ? data.batches : [];
      if (!fresh.length) throw liveError;
    }
    const changed = JSON.stringify(fresh) !== JSON.stringify(allBatches);
    allBatches = fresh;
    try { sessionStorage.setItem(BATCH_CACHE_KEY, JSON.stringify(fresh)); sessionStorage.setItem("cx-loaded", "1"); } catch (e) {}
    pruneStaleFavorites();
    if (changed || !usedCache) { updateStats(); updateCategoryChips(); renderBatches(); }
    const updatedNote = $("#dataUpdatedNote");
    if (updatedNote) updatedNote.textContent = `· library refreshed ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } catch (error) {
    console.error(error);
    if (!usedCache) {
      $("#resultsNote").textContent = "The course library could not be loaded.";
      $("#batchGrid").innerHTML = '<div class="empty">Could not reach GS Vision right now. Check your connection and tap the refresh button.</div>';
      showToast("Course library unavailable");
    }
  } finally {
    $("#globalPreloader").classList.add("hidden");
  }
}

function setupNavigation() {
  const menu = $("#navLinks");
  const menuButton = $("#menuBtn");
  menuButton.addEventListener("click", () => {
    const open = menu.classList.toggle("open");
    menuButton.setAttribute("aria-expanded", String(open));
  });
  $$(".nav-link").forEach((link) => link.addEventListener("click", () => {
    menu.classList.remove("open");
    menuButton.setAttribute("aria-expanded", "false");
  }));
  const sections = $$("main section[id]");
  const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (entry.isIntersecting) {
      $$(".nav-link").forEach((link) => link.classList.toggle("active", link.getAttribute("href") === `#${entry.target.id}`));
    }
  }), { rootMargin: "-35% 0px -55% 0px" });
  sections.forEach((section) => observer.observe(section));
}

function setupHeaderActions() {
  const refreshBtn = $("#refreshBtn");
  refreshBtn?.addEventListener("click", async () => {
    if (refreshBtn.classList.contains("spinning")) return;
    refreshBtn.classList.add("spinning");
    await loadBatches();
    showToast("Course library refreshed.");
    refreshBtn.classList.remove("spinning");
  });
  $("#favNavBtn")?.addEventListener("click", () => {
    activeFilter = "favorites";
    localStorage.setItem("codex-studys-last-filter", "favorites");
    visibleCount = PAGE_SIZE;
    $$(".filter-row .filter").forEach((item) => item.classList.toggle("active", item.dataset.filter === "favorites"));
    renderBatches();
    $("#courses")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function setupModals() {
  $("#searchBtn").addEventListener("click", () => {
    openModal("searchModal");
    renderSearchResults($("#searchInput").value);
  });
  let modalSearchDebounce;
  $("#searchInput").addEventListener("input", (event) => {
    const value = event.target.value;
    clearTimeout(modalSearchDebounce);
    modalSearchDebounce = setTimeout(() => renderSearchResults(value), 120);
  });
  $("#searchInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.value.trim()) addSearchHistory(event.target.value);
  });
  $$("[data-close]").forEach((button) => button.addEventListener("click", () => closeModal(button.dataset.close)));
  $$(".overlay").forEach((overlay) => overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeModal(overlay.id);
  }));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") $$(".overlay.visible").forEach((modal) => closeModal(modal.id));
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openModal("searchModal");
      renderSearchResults($("#searchInput").value);
    }
  });
}

function setupFilters() {
  updateFavoritesCount();
  const filterKey = "codex-studys-last-filter";
  const urlParams = new URLSearchParams(window.location.search);
  const urlFilter = urlParams.get("filter");
  const urlQuery = urlParams.get("q");
  const urlSort = urlParams.get("sort");
  const savedFilter = urlFilter || localStorage.getItem(filterKey);
  const savedButton = savedFilter && $(`.filter-row .filter[data-filter="${savedFilter}"]`);
  if (savedButton) {
    activeFilter = savedFilter;
    $$(".filter-row .filter").forEach((item) => item.classList.toggle("active", item === savedButton));
  }
  if (urlQuery) {
    searchQuery = urlQuery;
    const inlineSearchEl = $("#inlineSearchInput");
    if (inlineSearchEl) inlineSearchEl.value = urlQuery;
  }
  if (urlSort && ["relevance", "newest", "az", "za"].includes(urlSort)) {
    sortMode = urlSort;
    const sortSelectEl = $("#sortSelect");
    if (sortSelectEl) sortSelectEl.value = urlSort;
  }
  const urlLang = urlParams.get("lang");
  if (urlLang && ["hindi", "english", "hinglish"].includes(urlLang)) {
    langFilter = urlLang;
    const langSelectEl = $("#langSelect");
    if (langSelectEl) langSelectEl.value = urlLang;
  }
  $$(".filter-row .filter").forEach((button) => button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    localStorage.setItem(filterKey, activeFilter);
    visibleCount = PAGE_SIZE;
    $$(".filter-row .filter").forEach((item) => item.classList.toggle("active", item === button));
    renderBatches();
  }));
  const inlineSearch = $("#inlineSearchInput");
  let searchDebounce;
  inlineSearch?.addEventListener("input", (event) => {
    const value = event.target.value;
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      searchQuery = value;
      visibleCount = PAGE_SIZE;
      renderBatches();
    }, 150);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey) return;
    const active = document.activeElement;
    const typing = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
    if (typing) return;
    event.preventDefault();
    inlineSearch?.focus();
  });
  $("#sortSelect")?.addEventListener("change", (event) => {
    sortMode = event.target.value;
    visibleCount = PAGE_SIZE;
    renderBatches();
  });
  $("#langSelect")?.addEventListener("change", (event) => {
    langFilter = event.target.value;
    visibleCount = PAGE_SIZE;
    renderBatches();
  });
  $("#copyLinkBtn")?.addEventListener("click", () => {
    syncUrlParams();
    const url = window.location.href;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => showToast("Link copied!")).catch(() => showToast("Could not copy link"));
    } else {
      showToast("Copy not supported on this browser");
    }
  });
  $("#clearFiltersBtn")?.addEventListener("click", () => {
    activeFilter = "all";
    searchQuery = "";
    sortMode = "relevance";
    langFilter = "all";
    const langSelectEl = $("#langSelect");
    if (langSelectEl) langSelectEl.value = "all";
    visibleCount = PAGE_SIZE;
    localStorage.setItem(filterKey, "all");
    if (inlineSearch) inlineSearch.value = "";
    const sortSelectEl = $("#sortSelect");
    if (sortSelectEl) sortSelectEl.value = "relevance";
    $$(".filter-row .filter").forEach((item) => item.classList.toggle("active", item.dataset.filter === "all"));
    renderBatches();
  });
}

function setupLoadMore() {
  const loadMoreBtn = $("#loadMoreBtn");
  if (!loadMoreBtn) return;
  const loadNext = () => {
    visibleCount += PAGE_SIZE;
    renderBatches();
  };
  loadMoreBtn.addEventListener("click", loadNext);
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting && loadMoreBtn.style.display !== "none") loadNext();
    });
  }, { rootMargin: "600px" });
  observer.observe(loadMoreBtn);
}

function setupAnnouncements() {
  const key = "codex-studys-announce-seen";
  const badge = document.querySelector("#announceBtn .icon-badge");
  if (localStorage.getItem(key) === "true") badge?.remove();
  $("#announceBtn")?.addEventListener("click", () => {
    openModal("announceModal");
    localStorage.setItem(key, "true");
    badge?.remove();
  });
  $("#announceCopyLink")?.addEventListener("click", () => {
    const url = window.location.origin + window.location.pathname;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => showToast("Link copied!")).catch(() => showToast("Could not copy link"));
    } else {
      showToast("Copy not supported on this browser");
    }
  });
}

const THEME_COLORS = {
  light: "#f4f5f9", dark: "#090b10", sandalwood: "#1c130c", "forest-emerald": "#06140f",
  "ocean-deep": "#050e17", "sakura-blossom": "#fff3f6", "dracula-midnight": "#14121f",
  "lavender-mist": "#f5f2fc", "cyberpunk-neon": "#05020a"
};

function syncThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const current = document.documentElement.getAttribute("data-theme");
  meta.setAttribute("content", THEME_COLORS[current] || THEME_COLORS.dark);
}

function setupThemePicker() {
  syncThemeColor();
  const key = "codex-studys-theme";
  const markActive = () => {
    const current = localStorage.getItem(key) || "system";
    $$(".theme-option").forEach((option) => option.classList.toggle("active", option.dataset.theme === current));
  };
  $("#themeBtn")?.addEventListener("click", () => {
    markActive();
    openModal("themeModal");
  });
  $$(".theme-option").forEach((option) => option.addEventListener("click", () => {
    const theme = option.dataset.theme;
    localStorage.setItem(key, theme);
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
      const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
      if (prefersLight) document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
    syncThemeColor();
    markActive();
  }));
}

/* ================= Animation Effects ================= */
function setupFxEngine() {
  const ENABLED_KEY = "codex-studys-fx-enabled";
  const EFFECT_KEY = "codex-studys-fx-effect";
  const INTENSITY_KEY = "codex-studys-fx-intensity";
  const SCALE = [0.55, 1, 1.85];

  const enableToggle = $("#fxEnableToggle");
  const grid = $("#effectsGrid");
  const intensityInput = $("#fxIntensity");
  const fxBtn = $("#fxBtn");
  if (!grid) return;

  let canvas = null, ctx = null, rafId = null, dpr = 1, running = false, last = 0;
  let particles = [], bolts = [], flash = 0, burstTimer = 0, boltTimer = 0;
  let effect = localStorage.getItem(EFFECT_KEY) || "rain";
  let intensity = Number(localStorage.getItem(INTENSITY_KEY));
  if (!Number.isInteger(intensity) || intensity < 0 || intensity > 2) intensity = 1;
  let enabled = localStorage.getItem(ENABLED_KEY) === "true";

  const reducedMotion = () =>
    document.documentElement.getAttribute("data-reduced-motion") === "true" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.id = "fxCanvas";
    canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(canvas);
    ctx = canvas.getContext("2d");
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
  }

  function resizeCanvas() {
    if (!canvas) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function density(base) {
    const w = window.innerWidth;
    const dscale = w < 480 ? 0.5 : w < 900 ? 0.75 : 1;
    return Math.max(6, Math.round(base * dscale * SCALE[intensity]));
  }

  function seed() {
    const w = window.innerWidth, h = window.innerHeight;
    particles = []; bolts = []; flash = 0; burstTimer = 0; boltTimer = 0;
    if (effect === "rain" || effect === "storm") {
      const n = density(effect === "storm" ? 100 : 75);
      for (let i = 0; i < n; i++) particles.push({
        x: Math.random() * w, y: Math.random() * h - h,
        len: 14 + Math.random() * 16, speed: 7 + Math.random() * 7,
        drift: effect === "storm" ? 2.6 : 0.7
      });
    } else if (effect === "snow") {
      const n = density(70);
      for (let i = 0; i < n; i++) particles.push({
        x: Math.random() * w, y: Math.random() * h,
        r: 1.5 + Math.random() * 2.6, speed: 0.6 + Math.random() * 1.3,
        phase: Math.random() * Math.PI * 2, amp: 10 + Math.random() * 20
      });
    } else if (effect === "hail") {
      const n = density(55);
      for (let i = 0; i < n; i++) particles.push({
        x: Math.random() * w, y: Math.random() * h - h,
        r: 2 + Math.random() * 2, speed: 10 + Math.random() * 6, drift: 1.4
      });
    } else if (effect === "fireball") {
      const n = density(40);
      for (let i = 0; i < n; i++) particles.push({
        x: Math.random() * w, y: h + Math.random() * 100,
        r: 2 + Math.random() * 3.2, speed: 0.7 + Math.random() * 1.3,
        drift: Math.random() * 1.2 - 0.6, flick: Math.random() * Math.PI * 2
      });
    }
  }

  function spawnBurst(w, h) {
    const cx = 40 + Math.random() * (w - 80);
    const cy = 60 + Math.random() * (h * 0.45);
    const hue = Math.floor(Math.random() * 360);
    const count = density(26);
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count + Math.random() * 0.3;
      const sp = 1.6 + Math.random() * 2.2;
      particles.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, hue });
    }
  }

  function spawnBolt(w, h) {
    const points = [];
    let x = 60 + Math.random() * Math.max(w - 120, 20), y = 0;
    points.push({ x, y });
    while (y < h * 0.7) {
      y += 18 + Math.random() * 22;
      x += (Math.random() - 0.5) * 40;
      points.push({ x, y });
    }
    bolts.push({ points, life: 1 });
    flash = 0.35;
  }

  function step(dt, w, h) {
    ctx.clearRect(0, 0, w, h);
    if (effect === "rain" || effect === "storm") {
      ctx.strokeStyle = "rgba(160,200,255,.55)";
      ctx.lineWidth = 1.3;
      particles.forEach((p) => {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.drift * 3, p.y + p.len);
        ctx.stroke();
        p.y += p.speed * dt * 60; p.x += p.drift * dt * 60;
        if (p.y > h) { p.y = -p.len; p.x = Math.random() * w; }
      });
      if (effect === "storm") {
        boltTimer -= dt;
        if (boltTimer <= 0) { spawnBolt(w, h); boltTimer = 2.5 + Math.random() * 4; }
      }
    } else if (effect === "snow") {
      ctx.fillStyle = "rgba(255,255,255,.85)";
      particles.forEach((p) => {
        p.phase += dt;
        const x = p.x + Math.sin(p.phase) * p.amp * 0.02;
        ctx.beginPath(); ctx.arc(x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        p.y += p.speed * dt * 60;
        if (p.y > h) { p.y = -4; p.x = Math.random() * w; }
      });
    } else if (effect === "hail") {
      ctx.fillStyle = "rgba(220,235,255,.9)";
      particles.forEach((p) => {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        p.y += p.speed * dt * 60; p.x += p.drift * dt * 60;
        if (p.y > h) { p.y = -6; p.x = Math.random() * w; }
      });
    } else if (effect === "fireball") {
      particles.forEach((p) => {
        p.flick += dt * 6;
        const alpha = 0.5 + Math.sin(p.flick) * 0.3;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3);
        grad.addColorStop(0, `rgba(255,180,80,${alpha})`);
        grad.addColorStop(1, "rgba(255,80,20,0)");
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2); ctx.fill();
        p.y -= p.speed * dt * 60; p.x += p.drift * dt * 30;
        if (p.y < -10) { p.y = h + Math.random() * 40; p.x = Math.random() * w; }
      });
    } else if (effect === "firecracker") {
      burstTimer -= dt;
      if (burstTimer <= 0) { spawnBurst(w, h); burstTimer = 1.1 + Math.random() * (2.6 - intensity * 0.7); }
      particles = particles.filter((p) => p.life > 0);
      particles.forEach((p) => {
        p.vy += dt * 1.6; p.x += p.vx * dt * 60; p.y += p.vy * dt * 60; p.life -= dt * 0.9;
        ctx.fillStyle = `hsla(${p.hue},95%,65%,${Math.max(p.life, 0)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2); ctx.fill();
      });
    } else if (effect === "lightning") {
      boltTimer -= dt;
      if (boltTimer <= 0) { spawnBolt(w, h); boltTimer = 2.6 + Math.random() * (5 - intensity); }
    }

    if (effect === "storm" || effect === "lightning") {
      bolts = bolts.filter((b) => b.life > 0);
      bolts.forEach((b) => {
        ctx.strokeStyle = `rgba(220,235,255,${b.life})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        b.points.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
        ctx.stroke();
        b.life -= dt * 1.8;
      });
      if (flash > 0) {
        ctx.fillStyle = `rgba(210,225,255,${flash})`;
        ctx.fillRect(0, 0, w, h);
        flash -= dt * 0.9;
      }
    }
  }

  function loop(ts) {
    if (!running) return;
    const dt = Math.min((ts - last) / 1000 || 0, 0.05);
    last = ts;
    step(dt, window.innerWidth, window.innerHeight);
    rafId = requestAnimationFrame(loop);
  }

  function start() {
    if (running) return;
    ensureCanvas();
    seed();
    running = true;
    last = 0;
    rafId = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  function apply() {
    if (enabled && !reducedMotion() && !document.hidden) start(); else stop();
  }

  document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); else apply(); });
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener?.("change", apply);
  window.__codexFxApply = apply;

  function markActive() {
    $$(".effect-option").forEach((btn) => btn.classList.toggle("active", btn.dataset.effect === effect));
  }
  enableToggle?.setAttribute("aria-checked", String(enabled));
  if (intensityInput) intensityInput.value = String(intensity);
  markActive();

  enableToggle?.addEventListener("click", () => {
    enabled = enableToggle.getAttribute("aria-checked") !== "true";
    enableToggle.setAttribute("aria-checked", String(enabled));
    localStorage.setItem(ENABLED_KEY, String(enabled));
    apply();
  });

  grid.addEventListener("click", (event) => {
    const btn = event.target.closest(".effect-option");
    if (!btn) return;
    effect = btn.dataset.effect;
    localStorage.setItem(EFFECT_KEY, effect);
    markActive();
    if (running) { stop(); apply(); }
  });

  intensityInput?.addEventListener("input", () => {
    intensity = Number(intensityInput.value);
    localStorage.setItem(INTENSITY_KEY, String(intensity));
    if (running) seed();
  });

  fxBtn?.addEventListener("click", () => openModal("effectsModal"));

  if (enabled) apply();
}

/* ================= Network Status ================= */
function setupNetworkStatus() {
  const netBtn = $("#netBtn");
  const typeEl = $("#netType");
  const pingEl = $("#netPing");
  const latencyEl = $("#netLatency");
  const bwEl = $("#netBandwidth");
  const statusEl = $("#netStatus");
  const refreshBtn = $("#netRefreshBtn");
  if (!netBtn || !typeEl) return;

  let pollTimer = null;
  const PING_ASSET = "assets/icon-192.png";

  function connInfo() {
    return navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  }
  function typeLabel() {
    const c = connInfo();
    if (c) {
      const t = c.type && c.type !== "unknown" ? c.type : c.effectiveType;
      if (t) return t === "wifi" ? "Wi-Fi" : t.toUpperCase();
    }
    return "Unknown";
  }
  function bandwidthLabel() {
    const c = connInfo();
    return c && typeof c.downlink === "number" ? `${c.downlink} Mbps` : "—";
  }
  function setStatus(online) {
    statusEl.innerHTML = `<span class="net-status-dot${online ? "" : " offline"}"></span>${online ? "Online" : "Offline"}`;
  }

  async function measure() {
    if (!navigator.onLine) {
      typeEl.textContent = "Offline"; pingEl.textContent = "—"; latencyEl.textContent = "—";
      bwEl.textContent = "—"; setStatus(false);
      return;
    }
    typeEl.textContent = typeLabel();
    bwEl.textContent = bandwidthLabel();
    setStatus(true);
    const samples = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      try {
        await fetch(`${PING_ASSET}?_=${Date.now()}_${i}`, { method: "HEAD", cache: "no-store" });
        samples.push(performance.now() - t0);
      } catch (error) { /* ignore a single dropped sample */ }
    }
    if (samples.length) {
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      pingEl.textContent = `${Math.round(avg)} ms`;
      const entries = performance.getEntriesByType("resource").filter((r) => r.name.includes(PING_ASSET));
      const lastEntry = entries[entries.length - 1];
      const ttfb = lastEntry ? Math.max(0, lastEntry.responseStart - lastEntry.requestStart) : avg * 0.4;
      latencyEl.textContent = `${Math.round(ttfb || avg * 0.4)} ms`;
    } else {
      pingEl.textContent = "Timeout"; latencyEl.textContent = "—"; setStatus(false);
    }
  }

  function startPolling() {
    measure();
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = window.setInterval(() => {
      const modal = document.getElementById("networkModal");
      if (!modal || !modal.classList.contains("visible")) {
        window.clearInterval(pollTimer); pollTimer = null; return;
      }
      measure();
    }, 8000);
  }

  netBtn.addEventListener("click", () => { openModal("networkModal"); startPolling(); });
  refreshBtn?.addEventListener("click", measure);
}

const POPUP_SNOOZE_KEY = "codex-studys-popups-snooze";
const POPUP_SNOOZE_MS = 24 * 60 * 60 * 1000;

function popupsSnoozed() {
  try {
    const until = Number(localStorage.getItem(POPUP_SNOOZE_KEY) || 0);
    return until > Date.now();
  } catch (e) { return false; }
}

function setupTelegramPopup() {
  document.querySelectorAll("[data-snooze-popups]").forEach((btn) => {
    btn.addEventListener("click", () => {
      try { localStorage.setItem(POPUP_SNOOZE_KEY, String(Date.now() + POPUP_SNOOZE_MS)); } catch (e) {}
      closeModal("telegramModal");
      closeModal("installModal");
      showToast("Popups 24 ghante ke liye band");
    });
  });
  if (popupsSnoozed()) return;
  let seen = false;
  try { seen = sessionStorage.getItem("cx-popups-shown") === "1"; } catch (e) {}
  if (seen) return; // already shown this session (e.g. coming back from a batch)
  window.setTimeout(() => {
    try { sessionStorage.setItem("cx-popups-shown", "1"); } catch (e) {}
    openModal("telegramModal");
    const modal = document.getElementById("telegramModal");
    if (!modal) return;
    const watcher = window.setInterval(() => {
      if (!modal.classList.contains("visible")) {
        window.clearInterval(watcher);
        window.setTimeout(() => { if (!isStandaloneApp() && !popupsSnoozed()) openModal("installModal"); }, 200);
      }
    }, 150);
  }, 700);
}

let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
});

function isStandaloneApp() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isIOSDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function setupInstallPrompt() {
  if (isStandaloneApp()) return;
  const installBtn = $("#installActionBtn");
  const iosSteps = $("#iosInstallSteps");
  const body = $("#installBody");

  const showForIOS = () => {
    if (installBtn) installBtn.style.display = "none";
    if (iosSteps) iosSteps.style.display = "grid";
    if (body) body.textContent = "Add CODEX STUDYS to your home screen for a faster, app-like experience.";
  };

  installBtn?.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    closeModal("installModal");
    if (outcome === "accepted") showToast("Installing CODEX STUDYS…");
  });

  window.addEventListener("appinstalled", () => {
    closeModal("installModal");
    showToast("CODEX STUDYS installed!");
  });

  if (isIOSDevice()) showForIOS();
}

function setupOfflineBanner() {
  const banner = $("#offlineBanner");
  if (!banner) return;
  const update = () => banner.classList.toggle("visible", !navigator.onLine);
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}

function setupViewToggle() {
  const key = "codex-studys-view";
  const grid = $("#batchGrid");
  const gridBtn = $("#gridViewBtn");
  const listBtn = $("#listViewBtn");
  if (!grid || !gridBtn || !listBtn) return;
  const apply = (mode) => {
    grid.classList.toggle("list-view", mode === "list");
    gridBtn.classList.toggle("active", mode !== "list");
    gridBtn.setAttribute("aria-pressed", String(mode !== "list"));
    listBtn.classList.toggle("active", mode === "list");
    listBtn.setAttribute("aria-pressed", String(mode === "list"));
  };
  apply(localStorage.getItem(key) || "grid");
  gridBtn.addEventListener("click", () => { localStorage.setItem(key, "grid"); apply("grid"); });
  listBtn.addEventListener("click", () => { localStorage.setItem(key, "list"); apply("list"); });
}

function setupPreferences() {
  const contrastToggle = $("#contrastToggle");
  const motionToggle = $("#motionToggle");

  const applyContrast = (on) => {
    document.documentElement.setAttribute("data-contrast", on ? "high" : "normal");
    contrastToggle?.setAttribute("aria-checked", String(on));
  };
  const applyMotion = (on) => {
    document.documentElement.setAttribute("data-reduced-motion", String(on));
    motionToggle?.setAttribute("aria-checked", String(on));
  };
  applyContrast(localStorage.getItem("codex-studys-contrast") === "true");
  applyMotion(localStorage.getItem("codex-studys-reduced-motion") === "true");

  contrastToggle?.addEventListener("click", () => {
    const on = contrastToggle.getAttribute("aria-checked") !== "true";
    localStorage.setItem("codex-studys-contrast", String(on));
    applyContrast(on);
  });
  motionToggle?.addEventListener("click", () => {
    const on = motionToggle.getAttribute("aria-checked") !== "true";
    localStorage.setItem("codex-studys-reduced-motion", String(on));
    applyMotion(on);
    window.__codexFxApply?.();
  });

  $("#exportFavBtn")?.addEventListener("click", () => {
    const favorites = getFavorites();
    if (!favorites.length) return showToast("No favorites to export yet.");
    const details = allBatches.filter((batch) => favorites.includes(batch._id || batch.batch_id || ""));
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), favorites: details }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "codex-studys-favorites.json";
    a.click();
    URL.revokeObjectURL(url);
    showToast("Favorites exported.");
  });

  const importInput = $("#importFavFile");
  $("#importFavBtn")?.addEventListener("click", () => importInput?.click());
  importInput?.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const ids = (data.favorites || []).map((batch) => batch._id || batch.batch_id).filter(Boolean);
        const current = getFavorites();
        const merged = [...new Set([...current, ...ids])];
        localStorage.setItem("codex-studys-favorites", JSON.stringify(merged));
        updateFavoritesCount();
        renderBatches();
        showToast(`Imported ${ids.length} favorite${ids.length === 1 ? "" : "s"}.`);
      } catch {
        showToast("That file could not be read.");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  });

  $("#clearDataBtn")?.addEventListener("click", () => {
    if (!confirm("This clears favorites, theme, search history and all saved preferences on this device. Continue?")) return;
    Object.keys(localStorage).filter((key) => key.startsWith("codex-studys")).forEach((key) => localStorage.removeItem(key));
    showToast("App data cleared. Reloading…");
    setTimeout(() => window.location.reload(), 900);
  });
}

function animateCount(element, target) {
  if (!element) return;
  if (target <= 0) { element.textContent = "0"; return; }
  const duration = 700;
  const start = performance.now();
  const step = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = Math.round(target * eased).toLocaleString();
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function updateStats() {
  const strip = $("#statsStrip");
  if (!strip) return;
  strip.style.display = "grid";
  const freshCount = allBatches.filter((batch) => isRecent(batch.startDate)).length;
  animateCount($("#statTotal"), allBatches.length);
  animateCount($("#statNew"), freshCount);
  const statFav = $("#statFav");
  if (statFav) statFav.textContent = getFavorites().length.toLocaleString();
  const statRecent = $("#statRecent");
  if (statRecent) statRecent.textContent = String(getRecentlyViewed().length);
}

function setupBackToTop() {
  const button = $("#backToTopBtn");
  if (!button) return;
  const onScroll = () => button.classList.toggle("visible", window.scrollY > 480);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  button.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
}


/* ---------- Personal notes ---------- */
function getNotes() {
  try { return JSON.parse(localStorage.getItem("codex-studys-notes") || "{}"); }
  catch { return {}; }
}

function getNote(id) {
  return getNotes()[id] || "";
}

function setNote(id, text) {
  const notes = getNotes();
  if (text.trim()) notes[id] = text.trim(); else delete notes[id];
  localStorage.setItem("codex-studys-notes", JSON.stringify(notes));
}

/* ---------- Quick view ---------- */
let detailBatch = null;

function openDetail(batch) {
  detailBatch = batch;
  const id = batch._id || batch.batch_id || "";
  const hero = document.getElementById("detailHero");
  if (hero) {
    hero.src = batch.previewImage || FALLBACK_THUMB;
    hero.onerror = () => { hero.onerror = null; hero.src = FALLBACK_THUMB; };
  }
  const titleEl = document.getElementById("detailTitle");
  if (titleEl) titleEl.textContent = batch.name || "Untitled course";
  const subEl = document.getElementById("detailSub");
  if (subEl) subEl.textContent = batch.byName || "Structured learning for your next milestone";
  const facts = [
    ["Category", categoryLabel(categoryFor(batch))],
    ["Language", batch.language || "Hindi"],
    ["Price", priceLabel(batch)],
    ["Added", formatDate(batch.startDate) || "—"]
  ];
  const factsEl = document.getElementById("detailFacts");
  if (factsEl) factsEl.innerHTML = facts.map(([k, v]) => `<div class="detail-fact"><span>${escapeHtml(k)}</span><span>${escapeHtml(String(v))}</span></div>`).join("");
  const noteEl = document.getElementById("detailNote");
  if (noteEl) noteEl.value = getNote(id);
  syncDetailFavButton(id);
  openModal("detailModal");
}

function syncDetailFavButton(id) {
  const favBtn = document.getElementById("detailFavBtn");
  if (favBtn) favBtn.textContent = isFavorite(id) ? "❤ Saved" : "❤ Save";
}

function setupDetailModal() {
  document.getElementById("detailFavBtn")?.addEventListener("click", () => {
    if (!detailBatch) return;
    const id = detailBatch._id || detailBatch.batch_id || "";
    const active = toggleFavorite(id);
    syncDetailFavButton(id);
    updateFavoritesCount();
    renderBatches();
    showToast(active ? "Added to favorites." : "Removed from favorites.");
  });
  document.getElementById("detailOpenBtn")?.addEventListener("click", () => {
    if (detailBatch) openBatch(detailBatch);
  });
  const noteEl = document.getElementById("detailNote");
  let noteTimer;
  noteEl?.addEventListener("input", () => {
    if (!detailBatch) return;
    const id = detailBatch._id || detailBatch.batch_id || "";
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      setNote(id, noteEl.value);
      renderBatches();
    }, 400);
  });
}

/* ================= In-app course viewer (GS Vision) ================= */
const gsvCache = new Map();
const VIEWER = {
  batch: null, tab: "about", subject: null, chapter: null, topic: null,
  items: [], videos: [], pdfs: [], media: "lectures", playing: -1,
  token: 0, pushed: false, hls: null
};
const enc = encodeURIComponent;
const vBody = () => document.getElementById("vBody");

async function gsvGet(path) {
  if (gsvCache.has(path)) return gsvCache.get(path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(GSV.api + path, { mode: "cors", signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const list = normalizeArray(await response.json());
    gsvCache.set(path, list);
    return list;
  } finally {
    clearTimeout(timer);
  }
}

function pickStr(obj, keys) {
  if (!obj) return "";
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim() && value.trim().toLowerCase() !== "null") return value.trim();
  }
  return "";
}

const secureUrl = (url) => (window.location.protocol === "https:" ? url.replace(/^http:\/\//i, "https://") : url);
const asSubject = (s) => ({ id: String(s.SubjectId ?? s.SubjectID ?? s.id ?? ""), name: String(s.Name || s.SubjectName || "Subject").trim(), raw: s });
const asChapter = (c) => ({ id: String(c.ChapterId ?? c.ChapterID ?? c.id ?? ""), name: String(c.Name || c.ChapterName || "Chapter").trim(), raw: c });
const asTopic = (t) => ({ id: String(t.TopicId ?? t.TopicID ?? t.id ?? ""), name: String(t.Name || t.TopicName || "Topic").trim(), raw: t });

/* ---------- media helpers ---------- */
function videoSourceOf(item) {
  let url = pickStr(item, ["VideoLink1", "VideoLink", "VideoLink2", "VideoPath", "Link", "Url"]);
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) {
    if (url.includes("youtu")) url = "https://" + url.replace(/^\/+/, "");
    else if (/^[\w-]{11}$/.test(url)) return { kind: "yt", id: url, url: `https://www.youtube.com/watch?v=${url}` };
    else url = GSV.img + enc(url);
  }
  url = secureUrl(url);
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|live\/|shorts\/))([\w-]{11})/i);
  if (yt) return { kind: "yt", id: yt[1], url };
  const drive = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/i);
  if (drive) return { kind: "iframe", embed: `https://drive.google.com/file/d/${drive[1]}/preview`, url };
  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (vimeo) return { kind: "iframe", embed: `https://player.vimeo.com/video/${vimeo[1]}`, url };
  if (/\.m3u8(\?|#|$)/i.test(url)) return { kind: "hls", url };
  return { kind: "file", url };
}

function pdfUrlOf(file) {
  const value = String(file || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return secureUrl(value);
  return GSV.img + value.replace(/^\/+/, "").replace(/ /g, "%20");
}

let hlsPromise = null;
function loadHlsLib() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (!hlsPromise) {
    hlsPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js";
      script.onload = () => resolve(window.Hls);
      script.onerror = () => { hlsPromise = null; reject(new Error("hls.js failed to load")); };
      document.head.appendChild(script);
    });
  }
  return hlsPromise;
}

function teardownPlayer() {
  if (VIEWER.hls) { try { VIEWER.hls.destroy(); } catch (e) {} VIEWER.hls = null; }
  const box = document.getElementById("vPlayer");
  if (!box) return;
  const video = box.querySelector("video");
  if (video) { try { video.pause(); video.removeAttribute("src"); video.load(); } catch (e) {} }
  box.innerHTML = "";
}

function playerFallback(box, url) {
  box.innerHTML = `<div class="v-state">This lecture could not be played inside the app.<br><a class="btn btn-quiet" href="${escapeHtml(url)}" target="_blank" rel="noopener">Open in new tab</a></div>`;
}

function playVideo(index) {
  const video = VIEWER.videos[index];
  const box = document.getElementById("vPlayer");
  if (!video || !box) return;
  teardownPlayer();
  VIEWER.playing = index;
  const source = videoSourceOf(video.raw);
  const nowEl = document.getElementById("vNow");
  if (nowEl) {
    nowEl.innerHTML = `<span>${escapeHtml(video.name)}</span>${source ? `<a href="${escapeHtml(source.url || source.embed)}" target="_blank" rel="noopener">Open in new tab ↗</a>` : ""}`;
    nowEl.hidden = false;
  }
  $$("#vMedia [data-vplay]").forEach((item) => item.classList.toggle("active", Number(item.dataset.vplay) === index));
  if (!source) {
    box.innerHTML = '<div class="v-state">No playable link was uploaded for this lecture.</div>';
    return;
  }
  if (source.kind === "yt" || source.kind === "iframe") {
    const src = source.kind === "yt"
      ? `https://www.youtube-nocookie.com/embed/${source.id}?autoplay=1&rel=0&playsinline=1&modestbranding=1`
      : source.embed;
    box.innerHTML = `<iframe src="${escapeHtml(src)}" title="${escapeHtml(video.name)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    return;
  }
  const el = document.createElement("video");
  el.controls = true;
  el.autoplay = true;
  el.playsInline = true;
  el.preload = "metadata";
  el.addEventListener("ended", () => { if (VIEWER.playing === index && index < VIEWER.videos.length - 1) playVideo(index + 1); });
  el.addEventListener("error", () => { if (!VIEWER.hls) playerFallback(box, source.url); });
  box.appendChild(el);
  if (source.kind === "hls" && !el.canPlayType("application/vnd.apple.mpegurl")) {
    loadHlsLib().then((Hls) => {
      if (VIEWER.playing !== index || !Hls || !Hls.isSupported()) return playerFallback(box, source.url);
      const hls = new Hls();
      VIEWER.hls = hls;
      hls.loadSource(source.url);
      hls.attachMedia(el);
      hls.on(Hls.Events.MANIFEST_PARSED, () => el.play().catch(() => {}));
      hls.on(Hls.Events.ERROR, (event, data) => { if (data && data.fatal) playerFallback(box, source.url); });
    }).catch(() => playerFallback(box, source.url));
  } else {
    el.src = source.url;
  }
}

async function downloadPdf(url, name) {
  try {
    showToast("Downloading…");
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) throw new Error("bad status");
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${String(name || "notes").replace(/[\\/:*?"<>|]+/g, " ").trim() || "notes"}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  } catch (e) {
    // The server may block cross-origin downloads; open it so the browser's own save button works.
    window.open(url, "_blank", "noopener");
    showToast("Opened in a new tab — save it from there.");
  }
}

/* ---------- navigation / rendering ---------- */
const V_ICON = {
  lectures: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="M15.5 10.5 21 7.5v9l-5.5-3"/></svg>',
  notes: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
  go: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>'
};

function openViewer(batch) {
  teardownPlayer();
  Object.assign(VIEWER, { batch, tab: "lectures", subject: null, chapter: null, topic: null, items: [], videos: [], pdfs: [], media: "lectures", playing: -1, token: VIEWER.token + 1 });
  openModal("viewerModal");
  document.body.classList.add("viewer-open");
  if (!VIEWER.pushed) { try { window.history.pushState({ cxv: 1 }, ""); VIEWER.pushed = true; } catch (e) {} }
  renderViewer();
}

function onViewerClosed() {
  document.body.classList.remove("viewer-open");
  teardownPlayer();
  VIEWER.token++;
  if (VIEWER.pushed) {
    VIEWER.pushed = false;
    try { window.history.back(); } catch (e) {}
  }
}

// Page level: about | subjects | chapters | topics | content
function viewerLevel() {
  if (VIEWER.topic) return "content";
  if (VIEWER.chapter) return "topics";
  if (VIEWER.subject) return "chapters";
  return VIEWER.tab === "about" ? "about" : "subjects";
}

function setViewerTab(tab) {
  teardownPlayer();
  VIEWER.tab = tab === "notes" || tab === "about" ? tab : "lectures";
  VIEWER.subject = VIEWER.chapter = VIEWER.topic = null;
  renderViewer();
}

// One step "up": Lectures/Notes -> Topics -> Chapters -> Subjects -> close.
function viewerBack() {
  teardownPlayer();
  if (VIEWER.topic) VIEWER.topic = null;
  else if (VIEWER.chapter) VIEWER.chapter = null;
  else if (VIEWER.subject) VIEWER.subject = null;
  else { closeModal("viewerModal"); return "closed"; }
  renderViewer();
  return "stepped";
}

function updateViewerHeader() {
  const batch = VIEWER.batch;
  document.getElementById("vTitle").textContent = batch.name || "Course";
  const trail = [VIEWER.subject && VIEWER.subject.name, VIEWER.chapter && VIEWER.chapter.name, VIEWER.topic && VIEWER.topic.name].filter(Boolean);
  const crumb = document.getElementById("vCrumb");
  crumb.textContent = trail.join(" › ");
  crumb.hidden = !trail.length;
}

function renderViewer() {
  VIEWER.token++;
  updateViewerHeader();
  vBody().scrollTop = 0;
  const level = viewerLevel();
  if (level === "about") renderAbout();
  else if (level === "content") renderContent();
  else renderBrowse(level);
}

const skeletonHtml = () => '<div class="vb-list">' + Array.from({ length: 5 }, () => '<div class="skeleton-line" style="height:84px;border-radius:20px"></div>').join("") + "</div>";
const errorHtml = (message) => `<div class="v-state">${escapeHtml(message)}<br><button class="btn btn-quiet" type="button" data-vretry>Try again</button></div>`;

function bannerHtml() {
  const batch = VIEWER.batch;
  const full = detailsText(batch).replace(/\s+/g, " ");
  const desc = full ? full.slice(0, 140) + (full.length > 140 ? "…" : "") : (batch.byName || "");
  return `<div class="vb-banner">
    <img class="vb-banner-img" src="${escapeHtml(batch.previewImage || FALLBACK_THUMB)}" alt="" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${FALLBACK_THUMB}'">
    <div class="vb-banner-body">
      <h3 class="vb-banner-title">${escapeHtml(batch.name || "Untitled course")}</h3>
      ${desc ? `<p class="vb-banner-desc">${escapeHtml(desc)}</p>` : ""}
      <div class="vb-badges"><span class="vb-badge vb-badge-accent">${escapeHtml(batch.language || "Hindi")}</span><span class="vb-badge">${escapeHtml(categoryLabel(categoryFor(batch)))}</span></div>
    </div>
  </div>`;
}

function tabsHtml() {
  return `<div class="vb-tabs" role="tablist">${[["lectures", "Lectures"], ["notes", "Notes"], ["about", "About"]].map(([key, label]) =>
    `<button type="button" role="tab" class="vb-tab${VIEWER.tab === key ? " active" : ""}" aria-selected="${VIEWER.tab === key}" data-vtab="${key}">${label}</button>`).join("")}</div>`;
}

function renderAbout() {
  const batch = VIEWER.batch;
  const id = batch._id || "";
  const facts = [["Language", batch.language || "Hindi"], ["Category", categoryLabel(categoryFor(batch))], ["Price", priceLabel(batch)]];
  if (batch.teachers) facts.push(["Faculty", batch.teachers]);
  if (formatDate(batch.startDate)) facts.push(["Added", formatDate(batch.startDate)]);
  if (formatDate(batch.endDate)) facts.push(["Valid till", formatDate(batch.endDate)]);
  const details = detailsText(batch);
  vBody().innerHTML = `
    ${bannerHtml()}${tabsHtml()}
    <div class="detail-facts">${facts.map(([k, v]) => `<div class="detail-fact"><span>${escapeHtml(k)}</span><span>${escapeHtml(String(v))}</span></div>`).join("")}</div>
    ${details ? `<p class="v-desc">${escapeHtml(details)}</p>` : ""}
    <div class="v-actions">
      <button class="btn btn-quiet" type="button" data-vfav>${isFavorite(id) ? "❤ Saved" : "❤ Save"}</button>
      <button class="btn btn-primary" type="button" data-vgo="lectures">Start learning</button>
    </div>`;
}

/* counts: use numbers the API gives; otherwise count the next level (real data, fetched lazily) */
const COUNT_KEYS = {
  lectures: ["TotalVideos", "VideoCount", "TotalVideo", "NoOfVideos", "VideosCount", "TotalLectures", "LectureCount"],
  notes: ["TotalPdf", "PdfCount", "TotalPdfs", "NoOfPdf", "PdfsCount", "TotalNotes", "NotesCount"]
};
function rawCount(raw, kind) {
  if (!raw) return null;
  for (const key of COUNT_KEYS[kind]) {
    const value = raw[key];
    if (value !== undefined && value !== null && value !== "" && !isNaN(Number(value))) return Number(value);
  }
  return null;
}
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function fillCounts(level, kind, items, token) {
  const mediaWord = kind === "notes" ? "note" : "lecture";
  const label = { subjects: "chapter", chapters: "topic", topics: mediaWord }[level];
  const setText = (index, text) => {
    if (token !== VIEWER.token) return;
    const el = vBody().querySelector(`[data-vcount="${index}"]`);
    if (el) el.textContent = text;
  };
  const pathFor = (item) => level === "subjects" ? `GetAllChapterBySubject/${enc(item.id)}`
    : level === "chapters" ? `GetAllTopicByChapter/${enc(item.id)}`
    : kind === "notes" ? `GetAllPdfNotesDetailsByTopic/${enc(item.id)}` : `GetAllVideosDetailsByTopic/${enc(item.id)}`;
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      if (token !== VIEWER.token) return;
      const direct = rawCount(items[index].raw, kind);
      if (direct !== null) { setText(index, plural(direct, mediaWord)); continue; }
      try {
        const list = await gsvGet(pathFor(items[index]));
        setText(index, plural(list.length, label));
      } catch (e) { /* leave the count blank if it can't be loaded */ }
    }
  };
  for (let w = 0; w < 4; w++) worker();
}

async function renderBrowse(level) {
  level = level || viewerLevel();
  const kind = VIEWER.tab === "notes" ? "notes" : "lectures";
  const cfg = {
    subjects: { path: `GetAllSubjectByCourse/${enc(VIEWER.batch._id)}`, norm: asSubject, empty: "No subjects have been added to this course yet." },
    chapters: { heading: VIEWER.subject && VIEWER.subject.name, sub: "Chapters — pick one to see its topics.", path: `GetAllChapterBySubject/${enc(VIEWER.subject && VIEWER.subject.id)}`, norm: asChapter, empty: "No chapters in this subject yet." },
    topics: { heading: VIEWER.chapter && VIEWER.chapter.name, sub: `Topics — pick one to open its ${kind}.`, path: `GetAllTopicByChapter/${enc(VIEWER.chapter && VIEWER.chapter.id)}`, norm: asTopic, empty: "No topics in this chapter yet." }
  }[level];
  const token = VIEWER.token;
  const head = level === "subjects"
    ? bannerHtml() + tabsHtml()
    : `<h3 class="v-heading">${escapeHtml(cfg.heading)}</h3><p class="v-sub">${escapeHtml(cfg.sub)}</p>`;
  vBody().innerHTML = head + skeletonHtml();
  try {
    const items = (await gsvGet(cfg.path)).map(cfg.norm).filter((item) => item.id);
    if (token !== VIEWER.token) return;
    VIEWER.items = items;
    vBody().innerHTML = head + (items.length
      ? `<div class="vb-list">${items.map((item, index) => `
          <button class="vb-card" type="button" data-vpick="${index}" data-vlevel="${level}">
            <span class="vb-card-ico">${V_ICON[kind]}</span>
            <span class="vb-card-text"><span class="vb-card-name">${escapeHtml(item.name)}</span><span class="vb-card-sub" data-vcount="${index}"></span></span>
            <span class="vb-card-go">${V_ICON.go}</span>
          </button>`).join("")}</div>`
      : `<div class="v-state">${escapeHtml(cfg.empty)}</div>`);
    fillCounts(level, kind, items, token);
  } catch (error) {
    if (token !== VIEWER.token) return;
    console.warn(error);
    vBody().innerHTML = head + errorHtml("Could not load this list.");
  }
}

async function renderContent() {
  if (!VIEWER.topic) { renderBrowse(viewerLevel()); return; }
  const token = VIEWER.token;
  const topic = VIEWER.topic;
  const head = `<h3 class="v-heading">${escapeHtml(topic.name)}</h3>`;
  vBody().innerHTML = head + skeletonHtml();
  const [videosResult, pdfsResult] = await Promise.allSettled([
    gsvGet(`GetAllVideosDetailsByTopic/${enc(topic.id)}`),
    gsvGet(`GetAllPdfNotesDetailsByTopic/${enc(topic.id)}`)
  ]);
  if (token !== VIEWER.token) return;
  if (videosResult.status === "rejected" && pdfsResult.status === "rejected") {
    vBody().innerHTML = head + errorHtml("Could not load lectures and notes.");
    return;
  }
  const videos = videosResult.status === "fulfilled" ? videosResult.value : [];
  const pdfs = pdfsResult.status === "fulfilled" ? pdfsResult.value : [];
  VIEWER.videos = videos.map((raw, index) => ({ raw, name: pickStr(raw, ["Name", "Title", "VideoName"]) || `Lecture ${index + 1}` }));
  VIEWER.pdfs = [];
  pdfs.forEach((raw, index) => {
    const title = pickStr(raw, ["Title", "Name", "PdfName"]) || `Notes ${index + 1}`;
    const files = [pickStr(raw, ["PdfLang1", "PdfLink", "PdfPath", "Pdf", "Url", "Attachment"]), pickStr(raw, ["PdfLang2"])].filter(Boolean);
    const unique = [...new Set(files)];
    unique.forEach((file, i) => VIEWER.pdfs.push({ name: unique.length > 1 ? `${title} (${i + 1})` : title, url: pdfUrlOf(file) }));
  });
  VIEWER.playing = -1;
  const wantNotes = VIEWER.tab === "notes";
  VIEWER.media = wantNotes
    ? (VIEWER.pdfs.length || !VIEWER.videos.length ? "notes" : "lectures")
    : (VIEWER.videos.length || !VIEWER.pdfs.length ? "lectures" : "notes");
  vBody().innerHTML = `${head}
    <div class="v-seg">
      <button type="button" data-vseg="lectures">▶ Lectures (${VIEWER.videos.length})</button>
      <button type="button" data-vseg="notes">📄 Notes (${VIEWER.pdfs.length})</button>
    </div>
    <div id="vMedia"></div>`;
  renderMedia();
}

function renderMedia() {
  const box = document.getElementById("vMedia");
  if (!box) return;
  teardownPlayer();
  VIEWER.playing = -1;
  $$("#viewerModal [data-vseg]").forEach((button) => button.classList.toggle("active", button.dataset.vseg === VIEWER.media));
  if (VIEWER.media === "lectures") {
    box.innerHTML = VIEWER.videos.length
      ? `<div class="v-player" id="vPlayer"><div class="v-state">Tap a lecture below to start playing.</div></div>
         <div class="v-now" id="vNow" hidden></div>
         <div class="v-list">${VIEWER.videos.map((video, index) => `
           <button class="v-item" type="button" data-vplay="${index}">
             <span class="v-item-ico">${index + 1}</span>
             <span class="v-item-name">${escapeHtml(video.name)}</span>
             <span class="v-item-go">▶</span>
           </button>`).join("")}</div>`
      : '<div class="v-state">No lectures have been uploaded for this topic yet.</div>';
  } else {
    box.innerHTML = VIEWER.pdfs.length
      ? `<div class="v-list">${VIEWER.pdfs.map((pdf, index) => `
          <div class="v-pdf">
            <span class="v-item-ico">PDF</span>
            <span class="v-pdf-name">${escapeHtml(pdf.name)}</span>
            <span class="v-pdf-actions">
              <a class="v-mini v-mini-primary" href="${escapeHtml(pdf.url)}" target="_blank" rel="noopener">Open</a>
              <button class="v-mini" type="button" data-vdl="${index}">Download</button>
            </span>
          </div>`).join("")}</div>`
      : '<div class="v-state">No notes have been uploaded for this topic yet.</div>';
  }
}

function pickViewerItem(index, level) {
  const item = VIEWER.items[index];
  if (!item) return;
  if (level === "subjects") { VIEWER.subject = item; VIEWER.chapter = null; VIEWER.topic = null; }
  else if (level === "chapters") { VIEWER.chapter = item; VIEWER.topic = null; }
  else { VIEWER.topic = item; }
  renderViewer();
}

function setupViewer() {
  const body = vBody();
  if (!body) return;
  document.getElementById("vBackBtn").addEventListener("click", () => viewerBack());
  body.addEventListener("click", (event) => {
    const target = event.target.closest("[data-vtab],[data-vpick],[data-vplay],[data-vdl],[data-vseg],[data-vback],[data-vgo],[data-vretry],[data-vfav]");
    if (!target || !body.contains(target)) return;
    if (target.hasAttribute("data-vtab")) setViewerTab(target.dataset.vtab);
    else if (target.hasAttribute("data-vpick")) pickViewerItem(Number(target.dataset.vpick), target.dataset.vlevel);
    else if (target.hasAttribute("data-vplay")) playVideo(Number(target.dataset.vplay));
    else if (target.hasAttribute("data-vdl")) { const pdf = VIEWER.pdfs[Number(target.dataset.vdl)]; if (pdf) downloadPdf(pdf.url, pdf.name); }
    else if (target.hasAttribute("data-vseg")) { VIEWER.media = target.dataset.vseg; renderMedia(); }
    else if (target.hasAttribute("data-vback")) viewerBack();
    else if (target.hasAttribute("data-vgo")) setViewerTab(target.dataset.vgo);
    else if (target.hasAttribute("data-vretry")) { VIEWER.topic ? renderContent() : renderBrowse(viewerLevel()); }
    else if (target.hasAttribute("data-vfav")) {
      const id = VIEWER.batch._id || "";
      const active = toggleFavorite(id);
      target.textContent = active ? "❤ Saved" : "❤ Save";
      updateFavoritesCount();
      renderBatches();
      showToast(active ? "Added to favorites." : "Removed from favorites.");
    }
  });
  // Phone/browser back button steps back inside the viewer instead of leaving the app.
  window.addEventListener("popstate", () => {
    const modal = document.getElementById("viewerModal");
    if (!modal || !modal.classList.contains("visible")) return;
    VIEWER.pushed = false;
    if (viewerBack() === "closed") return;
    try { window.history.pushState({ cxv: 1 }, ""); VIEWER.pushed = true; } catch (e) {}
  });
}

/* ---------- Reading progress ---------- */
function setupScrollProgress() {
  const bar = document.getElementById("scrollProgress");
  if (!bar) return;
  const update = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = `${max > 0 ? Math.min((window.scrollY / max) * 100, 100) : 0}%`;
  };
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  update();
}

/* ---------- Shortcuts ---------- */
function setupShortcuts() {
  document.getElementById("shortcutsBtn")?.addEventListener("click", () => openModal("shortcutsModal"));
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT")) return;
    const key = event.key.toLowerCase();
    if (event.key === "?") { event.preventDefault(); openModal("shortcutsModal"); }
    else if (key === "f") { event.preventDefault(); document.getElementById("favNavBtn")?.click(); }
    else if (key === "t") { event.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupDetailModal();
  setupViewer();
  setupScrollProgress();
  setupShortcuts();
  setupNavigation();
  setupModals();
  setupFilters();
  setupLoadMore();
  setupViewToggle();
  setupThemePicker();
  setupPreferences();
  setupFxEngine();
  setupNetworkStatus();
  setupAnnouncements();
  setupHeaderActions();
  setupTelegramPopup();
  setupInstallPrompt();
  setupQuickInstall();
  setupRecentlyWatched();
  setupBackToTop();
  setupOfflineBanner();
  registerServiceWorker();
  loadBatches();
});


/* Disable page zoom (pinch, double-tap, ctrl+wheel, ctrl +/-) */
(() => {
  ["gesturestart", "gesturechange", "gestureend"].forEach((t) =>
    document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
  document.addEventListener("touchmove", (e) => { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
  let lastTouch = 0;
  document.addEventListener("touchend", (e) => {
    const now = Date.now();
    if (now - lastTouch < 300) e.preventDefault();
    lastTouch = now;
  }, { passive: false });
  document.addEventListener("wheel", (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && ["+", "=", "-", "_", "0"].includes(e.key)) e.preventDefault();
  });
})();
