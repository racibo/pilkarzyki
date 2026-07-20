import { getBootstrapStatic } from "./api.js";
import { t, setLang, getLang } from "./i18n.js";

let bootstrapData = null;
let currentRankingsTab = "gk";
let currentSortField = "totalPoints";
let currentSortDir = "desc";

const TEAM_COLORS = {
  1: "#e30613", 2: "#0057a8", 3: "#ee2737", 4: "#6c1d45",
  5: "#f0102c", 6: "#c8102e", 7: "#003090", 8: "#f78f1e",
  9: "#e03a3e", 10: "#da291c", 11: "#132257", 12: "#ec1c24",
  13: "#ee2523", 14: "#c8102e", 15: "#000000", 16: "#1b1d21",
  17: "#7b2d26", 18: "#132257", 19: "#fdb913", 20: "#e4d28a",
};

const POS_MAP = { 1: "gk", 2: "def", 3: "mid", 4: "fwd" };

function initNav() {
  const nav = document.getElementById("nav");
  nav.addEventListener("click", (e) => {
    const item = e.target.closest(".nav-item");
    if (!item) return;
    nav.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    item.classList.add("active");
    document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
    const page = document.getElementById(`page-${item.dataset.page}`);
    if (page) page.classList.add("active");
  });
}

function initLang() {
  const btn = document.getElementById("lang-btn");
  btn.textContent = getLang() === "pl" ? "EN" : "PL";
  btn.addEventListener("click", () => {
    setLang(getLang() === "pl" ? "en" : "pl");
    btn.textContent = getLang() === "pl" ? "EN" : "PL";
    applyTranslations();
    if (bootstrapData) renderRankings();
  });
}

function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
}

async function loadData() {
  const body = document.getElementById("rankings-body");
  body.innerHTML = `<tr><td colspan="5"><div class="loading"><div class="spinner"></div><div>${t("common.loading")}</div></div></td></tr>`;
  try {
    bootstrapData = await getBootstrapStatic();
    renderRankings();
    updateCacheStatus(bootstrapData);
  } catch (err) {
    body.innerHTML = `<tr><td colspan="5"><div class="error-msg">${t("common.error")}: ${err.message}</div></td></tr>`;
  }
}

function updateCacheStatus(data) {
  const el = document.getElementById("cache-status");
  if (data?.elements) {
    const gw = data.events?.find((e) => e.is_current) || data.events?.[data.events.length - 1];
    el.textContent = `GW${gw?.id ?? "?"} · ${data.elements.length} zaw. · ${new Date().toLocaleTimeString("pl-PL")}`;
  }
}

function buildRankingsData(posKey) {
  if (!bootstrapData) return [];
  const posType = { gk: 1, def: 2, mid: 3, fwd: 4 }[posKey];
  const players = bootstrapData.elements.filter((p) => p.element_type === posType);
  const teams = {};
  for (const t of bootstrapData.teams) {
    teams[t.id] = t.short_name || t.name;
  }
  const result = [];
  for (const p of players) {
    if (p.minutes === 0) continue;
    const tid = p.team;
    if (!teams[tid]) continue;
    if (!result.find((r) => r.teamId === tid)) {
      result.push({
        teamId: tid,
        teamName: teams[tid],
        totalPoints: 0,
        playerCount: 0,
        avgPoints: 0,
      });
    }
    const entry = result.find((r) => r.teamId === tid);
    entry.totalPoints += p.total_points;
    entry.playerCount += 1;
  }
  for (const r of result) {
    r.avgPoints = r.playerCount > 0 ? +(r.totalPoints / r.playerCount).toFixed(1) : 0;
  }
  result.sort((a, b) => b[currentSortField] - a[currentSortField]);
  return result;
}

function renderRankings() {
  const data = buildRankingsData(currentRankingsTab);
  const body = document.getElementById("rankings-body");
  if (data.length === 0) {
    body.innerHTML = `<tr><td colspan="5"><div class="placeholder">Brak danych</div></td></tr>`;
    return;
  }
  body.innerHTML = data
    .map((r, i) => {
      const color = TEAM_COLORS[r.teamId] || "#555";
      const rankClass = i < 3 ? ` rank-${i + 1}` : "";
      return `<tr>
        <td class="rank-num${rankClass}">${i + 1}</td>
        <td><span class="team-color" style="background:${color}"></span>${r.teamName}</td>
        <td class="stat-val">${r.totalPoints}</td>
        <td class="stat-val">${r.avgPoints}</td>
        <td>${r.playerCount}</td>
      </tr>`;
    })
    .join("");
}

function initRankingsTabs() {
  const tabs = document.getElementById("rankings-tabs");
  tabs.addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (!tab) return;
    tabs.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    currentRankingsTab = tab.dataset.tab;
    renderRankings();
  });
}

function initRankingsSort() {
  const table = document.querySelector("#rankings-table thead tr");
  table.addEventListener("click", (e) => {
    const th = e.target.closest("th");
    if (!th || !th.dataset.sort) return;
    const field = th.dataset.sort;
    if (field === "team") return;
    if (currentSortField === field) {
      currentSortDir = currentSortDir === "desc" ? "asc" : "desc";
    } else {
      currentSortField = field;
      currentSortDir = "desc";
    }
    table.querySelectorAll("th").forEach((h) => {
      h.classList.remove("sort-asc", "sort-desc");
    });
    th.classList.add(currentSortDir === "asc" ? "sort-asc" : "sort-desc");
    renderRankings();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initNav();
  initLang();
  applyTranslations();
  initRankingsTabs();
  initRankingsSort();
  loadData();
});
