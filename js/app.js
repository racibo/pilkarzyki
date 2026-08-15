import { getBootstrapStatic, getPlayerSummary, getManagerPicks, getLeagueStandings, getFixtures, fetchVaastavGW, fetchGWBatch, fetchFPL, getVaastavSeason, getVaastavCumulative, getVaastavPlayerCumulative, computeExpectedPoints, vaastavTeamId, getManagerHistory } from "./api.js";

// Manager (FPL entry) IDs per season — the user's ID differs across seasons.
const MANAGER_IDS = { "2026-27": 76582, "2025-26": 424097 };
function managerIdForSeason(seasonDash) {
  if (MANAGER_IDS[seasonDash] != null) return String(MANAGER_IDS[seasonDash]);
  return MANAGER_IDS["2026-27"] != null ? String(MANAGER_IDS["2026-27"]) : "";
}
import { t, setLang, getLang } from "./i18n.js";
import { TEAM_COORDS, REGIONS, travelDistance } from "./stadiums.js";

let bootstrapData = null;
let currentRankingsTab = "gk";
let currentRankingsSort = { field: "totalPoints", dir: "desc" };
let homeAwaySort = { field: "diff", dir: "desc" };
let homeAwayData = [];
let myTeamData = null;
let naStartSort = { field: "ptsPerCost", dir: "desc" };
let top15AllData = {};
let top15Tab = "points";
let squadMap = null;

const _ttEl = document.createElement("div");
_ttEl.className = "chart-tooltip";
document.body.appendChild(_ttEl);
window._chartTT = { show(evt, html, pi) {
  _ttEl.innerHTML = html;
  _ttEl.classList.add("visible");
  this.move(evt);
  if (pi !== undefined) {
    const svg = evt.target.closest("svg");
    if (svg) {
      svg.querySelectorAll(".chart-line").forEach(l => l.classList.toggle("dimmed", l.dataset.pi !== String(pi)));
      svg.querySelectorAll(".chart-dot").forEach(d => { if (d.dataset.pi === String(pi)) d.setAttribute("r", "5"); });
    }
  }
}, hide() {
  _ttEl.classList.remove("visible");
  document.querySelectorAll(".chart-line.dimmed").forEach(l => l.classList.remove("dimmed"));
  document.querySelectorAll(".chart-dot-hl").forEach(d => d.setAttribute("r", "3"));
  document.querySelectorAll(".chart-dot").forEach(d => d.setAttribute("r", "3"));
},
move(evt) {
  if (!_ttEl.classList.contains("visible")) return;
  const r = _ttEl.getBoundingClientRect();
  let x = evt.clientX + 12, y = evt.clientY - 10;
  if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - 12;
  if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - 10;
  if (y < 4) y = 4;
  _ttEl.style.left = x + "px";
  _ttEl.style.top = y + "px";
}};
document.addEventListener("mousemove", e => window._chartTT.move(e));

window._setDiffMode = function(mode) {
  top15DiffMode = mode;
  renderTop15Charts();
};
window._sortDiffTable = function(field) {
  if (top15DiffTableSort.field === field) {
    top15DiffTableSort.dir = top15DiffTableSort.dir === "asc" ? "desc" : "asc";
  } else {
    top15DiffTableSort = { field, dir: field === "name" || field === "position" ? "asc" : "desc" };
  }
  renderTop15Charts();
};
window._sortPopTable = function(field) {
  if (popTableSort.field === field) {
    popTableSort.dir = popTableSort.dir === "asc" ? "desc" : "asc";
  } else {
    popTableSort = { field, dir: field === "name" || field === "position" ? "asc" : "desc" };
  }
  renderTop15Charts();
};

let allFixturesData = [];
let fixturesLoaded = false;
async function loadAllFixtures() {
  if (fixturesLoaded) return allFixturesData;
  try { allFixturesData = await getFixtures(); } catch { allFixturesData = []; }
  fixturesLoaded = true;
  return allFixturesData;
}
function getTeamUpcomingFixtures(teamId, count) {
  if (!allFixturesData.length) return [];
  return allFixturesData
    .filter(f => !f.finished && (f.team_h === teamId || f.team_a === teamId))
    .sort((a, b) => a.event - b.event)
    .slice(0, count)
    .map(f => {
      const isHome = f.team_h === teamId;
      const oppId = isHome ? f.team_a : f.team_h;
      const diff = isHome ? f.team_h_difficulty : f.team_a_difficulty;
      const opp = bootstrapData?.teams?.find(t => t.id === oppId);
      return { gw: f.event, opponent: opp?.name || String(oppId), opponentShort: opp?.short_name || String(oppId), isHome, difficulty: diff || 3 };
    });
}
function getTeamAvgFDR(teamId, count) {
  const fx = getTeamUpcomingFixtures(teamId, count);
  if (!fx.length) return 3;
  return fx.reduce((s, f) => s + f.difficulty, 0) / fx.length;
}
function renderFixtureStrip(teamId, count, lang) {
  const fx = getTeamUpcomingFixtures(teamId, count);
  if (!fx.length) return "";
  const diffBg = d => d <= 2 ? "#166534" : d === 3 ? "#854d0e" : "#991b1b";
  return fx.map(f => `<span class="fdr-badge" style="background:${diffBg(f.difficulty)}" title="GW${f.gw}: ${f.isHome ? "vs" : "@"} ${f.opponent} (FDR ${f.difficulty})">${lang === "pl" ? "K" : "G"}${f.gw} ${f.isHome ? "vs" : "@"}${f.opponentShort} ${f.difficulty}</span>`).join("");
}

const TEAM_COLORS = {
  1: "#e30613", 2: "#670e36", 3: "#da291c", 4: "#e30613",
  5: "#0057b8", 6: "#034694", 7: "#6cb4ee", 8: "#c4122e",
  9: "#003399", 10: "#cc0000", 11: "#f57f25", 12: "#3a64a3",
  13: "#ffcd00", 14: "#c8102e", 15: "#6cabdd", 16: "#da291c",
  17: "#241f20", 18: "#dd0000", 19: "#132257", 20: "#eb172b",
};

function getTeamName(id) {
  const team = bootstrapData?.teams?.find((t) => t.id === id);
  return team?.short_name || team?.name || "?";
}

function getPositionShort(type) {
  return { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" }[type] || "?";
}

// ===================== LOCAL STORAGE CACHE =====================

const LS_PREFIX = "fpl-cache";
const LS_VERSION = 4;
const LS_TTL = { bootstrap: 60 * 60 * 1000, element: 30 * 60 * 1000 };

// Clear stale cache from older versions
(function clearStaleCache() {
  const ver = parseInt(localStorage.getItem(`${LS_PREFIX}-ver`) || "0");
  if (ver < LS_VERSION) {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
    localStorage.setItem(`${LS_PREFIX}-ver`, String(LS_VERSION));
  }
})();

function lsGet(key) {
  try {
    const raw = localStorage.getItem(`${LS_PREFIX}-${key}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function lsSet(key, data, ttlMs) {
  try {
    localStorage.setItem(`${LS_PREFIX}-${key}`, JSON.stringify({ data, ts: Date.now(), ttl: ttlMs }));
    return true;
  } catch { return false; }
}

function lsValid(entry) {
  return entry && entry.data && entry.ts && Date.now() - entry.ts < (entry.ttl || Infinity);
}

function compressBootstrap(data) {
  return {
    events: data.events,
    game_settings: data.game_settings,
    teams: data.teams,
    element_types: data.element_types,
    elements: data.elements.map((p) => ({
      id: p.id, web_name: p.web_name, first_name: p.first_name, second_name: p.second_name,
      team: p.team, element_type: p.element_type,
      total_points: p.total_points, now_cost: p.now_cost, minutes: p.minutes,
      goals_scored: p.goals_scored, assists: p.assists, clean_sheets: p.clean_sheets,
      form: p.form, ict_index: p.ict_index, selected_by_percent: p.selected_by_percent,
      expected_goals: p.expected_goals, expected_assists: p.expected_assists,
      points_per_game: p.points_per_game, bonus: p.bonus,
    })),
  };
}

function updateCacheStatus(data, fromCache) {
  const el = document.getElementById("cache-status");
  if (!el) return;
  const lang = getLang();
  const icon = fromCache ? "💾" : "🌐";
  const label = fromCache ? (lang === "pl" ? "Z cache" : "From cache") : (lang === "pl" ? "Świeże dane" : "Fresh data");
  el.textContent = `${icon} ${label}`;
}

async function cachedBootstrap() {
  const cached = lsGet("bootstrap");
  if (lsValid(cached)) {
    updateCacheStatus(cached.data, true);
    return cached.data;
  }
  const raw = await getBootstrapStatic();
  const data = compressBootstrap(raw);
  lsSet("bootstrap", data, LS_TTL.bootstrap);
  updateCacheStatus(data, false);
  return data;
}

async function cachedPlayerSummary(id) {
  const cached = lsGet(`elem-${id}`);
  if (lsValid(cached)) return cached.data;
  const data = await getPlayerSummary(id);
  // Compress: keep only history we need
  const compressed = {
    history: (data.history || []).map((h) => ({
      round: h.round, total_points: h.total_points, was_home: h.was_home,
      goals_scored: h.goals_scored, assists: h.assists,
      expected_goals: h.expected_goals, expected_assists: h.expected_assists,
      expected_goal_involvements: h.expected_goal_involvements,
      minutes: h.minutes,
      value: h.value,
    })),
    history_past: data.history_past,
  };
  lsSet(`elem-${id}`, compressed, LS_TTL.element);
  return compressed;
}

// ===================== SEASON =====================

function detectSeason(data) {
  const url = data?.game_settings?.static_content_url || "";
  const match = url.match(/(\d{4})_(\d{2})/);
  if (match) return `${match[1]}/${match[2]}`;
  const gw = data.events?.find((e) => e.is_current) || data.events?.[data.events.length - 1];
  if (gw?.deadline_time) {
    const year = new Date(gw.deadline_time).getFullYear();
    return `${year - 1}/${String(year).slice(2)}`;
  }
  return "?";
}

function seasonShort(full) {
  const m = String(full).match(/(\d{4})\D(\d{2})/);
  if (!m) return String(full);
  return `${m[1].slice(2)}/${m[2]}`;
}

function prevSeasonShort(full) {
  const m = String(full).match(/(\d{4})\D(\d{2})/);
  if (!m) return String(full);
  const y1 = parseInt(m[1], 10) - 1;
  const y2 = parseInt(m[2], 10) - 1;
  return `${String(y1).slice(2)}/${y2}`;
}

// True when the current FPL season has at least one finished gameweek.
function isCurrentSeasonStarted() {
  return (bootstrapData?.events || []).some((e) => e.finished);
}

// The season to use for archived/vaastav data: the live season when it has
// started, otherwise the most recent completed season (e.g. 25/26).
function getEffectiveDataSeason() {
  if (!bootstrapData) return "2025-26";
  if (isCurrentSeasonStarted()) return detectSeason(bootstrapData).replace("/", "-");
  return prevSeasonShort(detectSeason(bootstrapData)).replace("/", "-");
}

function updateSeasonBanner(data) {
  const banner = document.getElementById("season-banner");
  if (!banner || !data) return;
  const fullSeason = detectSeason(data);
  const season = seasonShort(fullSeason);
  const lastSeason = prevSeasonShort(fullSeason);
  const lang = getLang();
  const events = data.events || [];
  const currentGW = events.find((e) => e.is_current);
  const seasonStarted = !!currentGW || events.some((e) => e.finished);
  const now = new Date();
  const timeStr = now.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  const dateStr = now.toLocaleDateString("pl-PL");

  let statusLine;
  if (!seasonStarted) {
    statusLine = lang === "pl" ? `Przed startem sezonu ${season}` : `Pre-season (${season})`;
  } else if (currentGW && currentGW.finished) {
    statusLine = lang === "pl" ? `Sezon ${season} zakończony` : `${season} season finished`;
  } else if (currentGW) {
    statusLine = `GW${currentGW.id} · ${lang === "pl" ? `Dane bieżące (${season})` : `Current data (${season})`}`;
  } else {
    statusLine = lang === "pl" ? `Dane bieżące (${season})` : `Current data (${season})`;
  }

  let note;
  if (!seasonStarted) {
    note = lang === "pl"
      ? `Ceny i składy: ${season} (nowy sezon — dane mogą być puste przed startem). Punkty, forma i xP pojawią się po rozpoczęciu rozgrywek. Dane archiwalne (${lastSeason}) są dostępne w sekcjach „Archiwum” i „Historia ceny”.`
      : `Prices & squads: ${season} (new season — may be empty before kick-off). Points, form and xP appear once the season starts. Archived data (${lastSeason}) is available in „Archive” and „Price History”.`;
  } else {
    note = lang === "pl"
      ? `Dane bieżące z sezonu ${season} (punkty, forma i xP na żywo z oficjalnego API FPL).`
      : `Live data from ${season} (points, form and xP from the official FPL API).`;
  }

  banner.innerHTML = `${lang === "pl" ? "Sezon" : "Season"} ${fullSeason} · ${statusLine} · ${data.elements?.length ?? "?"} ${t("common.players")} · <span style="opacity:0.6">${lang === "pl" ? "Pobrano" : "Fetched"}: ${dateStr} ${timeStr}</span><div style="font-size:0.72rem;color:var(--text-dim);margin-top:2px">${note}</div>`;

  const curOpt = document.querySelector('#pricehistory-season option[value="current"]');
  if (curOpt) curOpt.textContent = lang === "pl" ? `Bieżący (${season})` : `Current (${season})`;
}

function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    const val = t(key);
    if (val === key) return;
    if (el.tagName === "OPTGROUP") {
      el.label = val;
    } else {
      el.textContent = val;
    }
  });
  document.querySelectorAll("[data-i18n-text]").forEach((el) => {
    const key = el.dataset.i18nText;
    const val = t(key);
    if (val !== key) el.setAttribute("data-i18n-text", val);
  });
}

function showSection(sectionId, state) {
  const loading = document.getElementById(`${sectionId}-loading`);
  const placeholder = document.getElementById(`${sectionId}-placeholder`);
  const table = document.getElementById(`${sectionId}-table`);
  const result = document.getElementById(`${sectionId}-result`);
  const charts = document.getElementById(`${sectionId}-charts`);
  const chartWrap = document.getElementById(`${sectionId}-chart-wrap`);
  if (loading) loading.style.display = state === "loading" ? "" : "none";
  if (placeholder) placeholder.style.display = state === "placeholder" ? "" : "none";
  if (table) table.style.display = state === "table" ? "" : "none";
  if (charts && state !== "table") charts.style.display = "none";
  if (result && state !== "result") result.style.display = "none";
  if (chartWrap && state !== "chart" && state !== "table") chartWrap.style.display = "none";
}

function updateOptimizerSlider() {
  if (!bootstrapData) return;
  const allPlayers = bootstrapData.elements.filter((p) => p.now_cost > 0);
  const limits = { 1: 2, 2: 5, 3: 5, 4: 3 };
  let minCost = 0;
  for (const [pos, count] of Object.entries(limits)) {
    const cheapest = allPlayers
      .filter((p) => p.element_type === parseInt(pos) && p.now_cost > 0)
      .sort((a, b) => a.now_cost - b.now_cost)
      .slice(0, count);
    minCost += cheapest.reduce((s, p) => s + p.now_cost, 0);
  }
  // Round up to nearest 5, add 10 margin
  const sliderMin = Math.ceil((minCost + 10) / 5) * 5;
  const slider = document.getElementById("optimizer-budget");
  if (slider) {
    slider.min = Math.max(sliderMin, 550);
    slider.max = 1200;
    slider.value = 1000;
    document.getElementById("optimizer-budget-display").textContent = "100.0";
  }
}

async function loadData() {
  showSection("rankings", "loading");
  try {
    bootstrapData = await cachedBootstrap();
    applySeasonPrices(bootstrapData);
    updateSeasonBanner(bootstrapData);
    renderRankings();
    renderNaStart();
    populateKetchupPlayers();
    populateTop15GWs();
    updateOptimizerSlider();
    runOptimizer();
  } catch (err) {
    const body = document.getElementById("rankings-body");
    body.innerHTML = `<tr><td colspan="5"><div class="error-msg">${t("common.error")}: ${err.message}</div></td></tr>`;
    showSection("rankings", "table");
  }
}

const SEASON_26_27_PRICES = [
  { name: "Haaland", now_cost: 155 },
  { name: "B.Fernandes", now_cost: 120 },
  { name: "Gabriel", now_cost: 80 },
];

function applySeasonPrices(data) {
  if (!data || !data.elements) return;
  for (const override of SEASON_26_27_PRICES) {
    const player = data.elements.find(p => p.web_name === override.name || p.web_name?.includes(override.name));
    if (player && override.now_cost) player.now_cost = override.now_cost;
  }
}

function getOptimizedPlayers() {
  return bootstrapData.elements;
}

// ===================== RANKINGS =====================

function buildRankingsData(posKey) {
  if (!bootstrapData) return [];
  const posType = { gk: 1, def: 2, mid: 3, fwd: 4 }[posKey];
  const players = bootstrapData.elements.filter((p) => p.element_type === posType);
  const teamsMap = {};
  for (const p of players) {
    if (!teamsMap[p.team]) {
      teamsMap[p.team] = { teamId: p.team, teamName: getTeamName(p.team), totalPoints: 0, playerCount: 0 };
    }
    teamsMap[p.team].totalPoints += p.total_points;
    teamsMap[p.team].playerCount += 1;
  }
  const result = Object.values(teamsMap).map((r) => ({
    ...r,
    avgPoints: r.playerCount > 0 ? +(r.totalPoints / r.playerCount).toFixed(1) : 0,
  }));
  const dir = currentRankingsSort.dir === "desc" ? -1 : 1;
  result.sort((a, b) => (b[currentRankingsSort.field] - a[currentRankingsSort.field]) * dir);
  return result;
}

function renderRankings() {
  const data = buildRankingsData(currentRankingsTab);
  const body = document.getElementById("rankings-body");
  showSection("rankings", "table");
  if (data.length === 0) {
    body.innerHTML = `<tr><td colspan="5"><div class="placeholder">${t("common.noData")}</div></td></tr>`;
    return;
  }
  body.innerHTML = data.map((r, i) => {
    const color = TEAM_COLORS[r.teamId] || "#555";
    const rankClass = i < 3 ? ` rank-${i + 1}` : "";
    return `<tr>
      <td class="rank-num${rankClass}">${i + 1}</td>
      <td><span class="team-color" style="background:${color}"></span>${r.teamName}</td>
      <td class="stat-val">${r.totalPoints}</td>
      <td class="stat-val">${r.avgPoints}</td>
      <td>${r.playerCount}</td>
    </tr>`;
  }).join("");
}

// ===================== FORMA vs OCZEKIWANIA =====================

let ketchupSelectedId = null;
let ketchupPlayersList = [];
let ketchupLeadersShowCount = { underrated: 5, overrated: 5 };
let ketchupFilterState = { pos: "0", team: "0", gws: "10" };

function populateKetchupPlayers() {
  if (!bootstrapData) return;
  ketchupPlayersList = bootstrapData.elements
    .filter((p) => p.now_cost > 0)
    .sort((a, b) => b.total_points - a.total_points)
    .map((p) => ({
      id: p.id,
      name: p.web_name,
      team: getTeamName(p.team),
      pos: getPositionShort(p.element_type),
      pts: p.total_points,
    }));
  populateKetchupTeamFilter();
  renderKetchupLeaders();
}

function populateKetchupTeamFilter() {
  if (!bootstrapData) return;
  const sel = document.getElementById("ketchup-leaders-team");
  if (!sel) return;
  const teams = bootstrapData.teams || [];
  sel.innerHTML = `<option value="0">${getLang() === "pl" ? "Wszystkie" : "All"}</option>` +
    teams.map(t => `<option value="${t.id}">${t.short_name}</option>`).join("");
  sel.value = ketchupFilterState.team;
}

async function getKetchupLeadersData() {
  const season = document.getElementById("ketchup-season")?.value || "current";
  const posFilter = parseInt(ketchupFilterState.pos);
  const teamFilter = parseInt(ketchupFilterState.team);
  const gwFilter = parseInt(ketchupFilterState.gws);

  let players = [];
  let playedGWs = 1;

  if (season === "current") {
    if (!bootstrapData) return [];
    const allGWs = bootstrapData.events || [];
    const finishedGWs = allGWs.filter(e => e.finished);
    const maxGW = finishedGWs.length > 0 ? finishedGWs[finishedGWs.length - 1].id : 0;
    if (maxGW === 0) {
      // Current season not started yet — fall back to the last completed season
      // (vaastav has no gw CSVs for the upcoming season until GW1).
      const lastSeason = prevSeasonShort(detectSeason(bootstrapData)).replace("/", "-");
      const cum = await getVaastavPlayerCumulative(lastSeason, 38);
      const posMap = { GK: 1, DEF: 2, MID: 3, FWD: 4 };
      players = Object.keys(cum).map(id => {
        const c = cum[id];
        return {
          id: parseInt(id, 10),
          web_name: c.name,
          team: parseInt(c.team, 10) || c.team,
          element_type: posMap[c.position] || 0,
          total_points: c.total_points,
          xPts: c.xPts,
        };
      });
      playedGWs = 38;
    } else {
      playedGWs = finishedGWs.length;
      const vSeason = detectSeason(bootstrapData).replace("/", "-");
      const cum = await getVaastavPlayerCumulative(vSeason, maxGW);
      players = bootstrapData.elements.filter(p => p.now_cost > 0).map(p => {
        const c = cum[String(p.id)] || { total_points: p.total_points, xPts: 0 };
        return {
          id: p.id,
          web_name: p.web_name,
          team: p.team,
          element_type: p.element_type,
          total_points: c.total_points || p.total_points,
          xPts: c.xPts || 0,
        };
      });
    }
  } else {
    const cum = await getVaastavPlayerCumulative(season, 38);
    const posMap = { GK: 1, DEF: 2, MID: 3, FWD: 4 };
    players = Object.keys(cum).map(id => {
      const c = cum[id];
      return {
        id: parseInt(id, 10),
        web_name: c.name,
        team: parseInt(c.team, 10) || c.team,
        element_type: posMap[c.position] || 0,
        total_points: c.total_points,
        xPts: c.xPts,
      };
    });
    playedGWs = 38;
  }

  if (posFilter > 0) players = players.filter(p => p.element_type === posFilter);
  if (teamFilter > 0) players = players.filter(p => p.team === teamFilter);

  if (gwFilter > 0) {
    const played = Math.max(playedGWs, 1);
    const scale = Math.min(gwFilter, played) / played;
    return players.map(p => {
      const approxPts = Math.round(p.total_points * scale);
      const approxXPts = p.xPts * scale;
      return { ...p, pts: approxPts, diff: approxPts - approxXPts };
    });
  }

  return players.map(p => ({ ...p, pts: p.total_points, diff: p.total_points - p.xPts }));
}

async function renderKetchupLeaders() {
  const lang = getLang();
  const el = document.getElementById("ketchup-leaders");
  if (!el) return;

  populateKetchupTeamFilter();

  let scored = [];
  try {
    scored = await getKetchupLeadersData();
  } catch (e) {
    console.error("Ketchup leaders failed:", e);
    el.innerHTML = `<div class="placeholder">${lang === "pl" ? "Błąd ładowania danych archiwalnych. Spróbuj ponownie." : "Error loading archived data. Please try again."}</div>`;
    return;
  }
  const totalFiltered = scored.length;
  if (totalFiltered === 0) {
    const season = document.getElementById("ketchup-season")?.value || "current";
    const msg = season === "current"
      ? (lang === "pl" ? "Brak danych: bieżący sezon jeszcze się nie rozpoczął (xP z live FPL = 0)." : "No data: the current season hasn't started yet (live xP = 0).")
      : (lang === "pl" ? "Brak danych xP dla wybranego sezonu." : "No xP data available for the selected season.");
    el.innerHTML = `<div class="placeholder">${msg}</div>`;
    return;
  }
  const underrated = [...scored].sort((a, b) => b.diff - a.diff);
  const overrated = [...scored].sort((a, b) => a.diff - b.diff);

  const showU = Math.min(ketchupLeadersShowCount.underrated, underrated.length);
  const showO = Math.min(ketchupLeadersShowCount.overrated, overrated.length);

  const posNames = { 0: lang === "pl" ? "Wszystkie" : "All", 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };
  const teamName = ketchupFilterState.team !== "0" ? getTeamName(parseInt(ketchupFilterState.team)) : (lang === "pl" ? "Wszystkie drużyny" : "All teams");
  const gwLabel = ketchupFilterState.gws !== "0" ? `GW ${ketchupFilterState.gws}` : (lang === "pl" ? "Wszystkie GW" : "All GWs");
  const filterSummary = `${posNames[ketchupFilterState.pos] || "All"} · ${teamName} · ${gwLabel} · ${totalFiltered} ${lang === "pl" ? "zawodników" : "players"}`;

  const renderCard = (title, color, icon, list, showCount, key) => {
    const visible = list.slice(0, showCount);
    const rows = visible.map((p, i) => {
      const teamColor = TEAM_COLORS[p.team] || "#555";
      return `<div class="leader-row">
        <span class="rank-num" style="min-width:20px;color:${color}">${i + 1}</span>
        <span class="team-color" style="background:${teamColor}"></span>
        <span style="font-weight:600">${p.web_name}</span>
        <span style="color:var(--text-dim);font-size:0.82rem">${getTeamName(p.team)} ${getPositionShort(p.element_type)}</span>
        <span style="margin-left:auto;font-weight:700;color:${color}" title="${lang === "pl" ? `Różnica: ${p.pts} pkt - ${p.xPts.toFixed(0)} xP` : `Diff: ${p.pts} pts - ${p.xPts.toFixed(0)} xP`}">${p.diff >= 0 ? '+' : ''}${p.diff.toFixed(1)} <span style="font-size:0.7rem;font-weight:400;opacity:0.6">(${lang === "pl" ? "pkt - xP" : "pts - xP"})</span></span>
      </div>`;
    }).join("");
    const hasMore = list.length > showCount;
    const moreBtn = hasMore ? `<div class="leader-more" data-key="${key}" data-add="5" style="text-align:center;padding:8px;cursor:pointer;color:var(--accent);font-size:0.85rem">
      ${lang === "pl" ? `Pokaż więcej (+5) z ${list.length}` : `Show more (+5) of ${list.length}`}
    </div>` : "";
    return `<div class="leader-card">
      <h3 style="color:${color}">${icon} ${title} <span style="font-size:0.75rem;font-weight:400;color:var(--text-dim)">(${showCount}/${list.length})</span></h3>
      ${rows}
      ${moreBtn}
    </div>`;
  };

  const uTitle = lang === "pl" ? "Niedoszacowani (grają ponad oczekiwania)" : "Underrated (overperforming xP)";
  const oTitle = lang === "pl" ? "Przeszacowani (grają poniżej oczekiwań)" : "Overrated (underperforming xP)";

  const gwsOptions = ["0","5","10","19","29"].map(v =>
    `<option value="${v}" ${ketchupFilterState.gws === v ? "selected" : ""}>${v === "0" ? (lang === "pl" ? "Wszystkie" : "All") : v}</option>`
  ).join("");
  const posOptions = [
    {v:"0",l: lang === "pl" ? "Wszystkie" : "All"},
    {v:"1",l: lang === "pl" ? "Bramkarze" : "GK"},
    {v:"2",l: lang === "pl" ? "Obrońcy" : "DEF"},
    {v:"3",l: lang === "pl" ? "Pomocnicy" : "MID"},
    {v:"4",l: lang === "pl" ? "Napastnicy" : "FWD"},
  ].map(o => `<option value="${o.v}" ${ketchupFilterState.pos === o.v ? "selected" : ""}>${o.l}</option>`).join("");

  el.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="form-row" style="align-items:end">
        <div class="form-group">
          <label data-i18n="ketchup.position">Pozycja</label>
          <select id="ketchup-leaders-pos">${posOptions}</select>
        </div>
        <div class="form-group">
          <label data-i18n="ketchup.team">Drużyna</label>
          <select id="ketchup-leaders-team"></select>
        </div>
        <div class="form-group">
          <label data-i18n="common.lastGWs">Ostatnie X kolejek</label>
          <select id="ketchup-leaders-gws">${gwsOptions}</select>
        </div>
        <div style="color:var(--text-dim);font-size:0.82rem;padding-bottom:4px">${filterSummary}</div>
      </div>
    </div>
    <div class="charts-row">
      ${renderCard(uTitle, "var(--green)", "📈", underrated, showU, "underrated")}
      ${renderCard(oTitle, "var(--red)", "📉", overrated, showO, "overrated")}
    </div>`;

  populateKetchupTeamFilter();
  document.getElementById("ketchup-leaders-pos").value = ketchupFilterState.pos;
  document.getElementById("ketchup-leaders-gws").value = ketchupFilterState.gws;

  el.querySelectorAll(".leader-more").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.key;
      const add = parseInt(btn.dataset.add);
      ketchupLeadersShowCount[key] = (ketchupLeadersShowCount[key] || 5) + add;
      renderKetchupLeaders();
    });
  });

  el.querySelectorAll("#ketchup-leaders-pos, #ketchup-leaders-team, #ketchup-leaders-gws").forEach(sel => {
    sel.addEventListener("change", () => {
      ketchupFilterState.pos = document.getElementById("ketchup-leaders-pos").value;
      ketchupFilterState.team = document.getElementById("ketchup-leaders-team").value;
      ketchupFilterState.gws = document.getElementById("ketchup-leaders-gws").value;
      ketchupLeadersShowCount = { underrated: 5, overrated: 5 };
      renderKetchupLeaders();
    });
  });
}

function initKetchupSearch() {
  const input = document.getElementById("ketchup-search");
  const results = document.getElementById("ketchup-results");
  if (!input || !results) return;

  let activeIdx = -1;

  function renderResults(query) {
    const q = query.trim().toLowerCase();
    if (q.length < 1) { results.classList.remove("open"); return; }

    const matches = ketchupPlayersList.filter((p) =>
      p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q)
    ).slice(0, 20);

    if (matches.length === 0) { results.classList.remove("open"); return; }

    activeIdx = -1;
    results.innerHTML = matches.map((p, i) => {
      const highlighted = p.name.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"), "<mark>$1</mark>");
      return `<div class="player-result-item" data-id="${p.id}" data-idx="${i}">
        <span class="result-name">${highlighted}</span>
        <span class="result-meta">${p.team} ${p.pos} · ${p.pts} pkt</span>
      </div>`;
    }).join("");
    results.classList.add("open");
  }

  function selectPlayer(id) {
    const player = ketchupPlayersList.find((p) => p.id === id);
    if (!player) return;
    input.value = `${player.name} (${player.team} ${player.pos})`;
    results.classList.remove("open");
    ketchupSelectedId = id;
    runKetchup();
  }

  input.addEventListener("input", (e) => renderResults(e.target.value));

  input.addEventListener("keydown", (e) => {
    const items = results.querySelectorAll(".player-result-item");
    if (!items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle("active", i === activeIdx));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      items.forEach((el, i) => el.classList.toggle("active", i === activeIdx));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx >= 0 && activeIdx < items.length) {
        selectPlayer(parseInt(items[activeIdx].dataset.id));
      }
    } else if (e.key === "Escape") {
      results.classList.remove("open");
    }
  });

  results.addEventListener("click", (e) => {
    const item = e.target.closest(".player-result-item");
    if (item) selectPlayer(parseInt(item.dataset.id));
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".player-search")) results.classList.remove("open");
  });

  input.addEventListener("focus", () => {
    if (input.value.length >= 1) renderResults(input.value);
  });
}

async function runKetchup() {
  if (!bootstrapData) return;
  if (!ketchupSelectedId) return;

  const season = document.getElementById("ketchup-season")?.value || "current";
  const gwCount = parseInt(document.getElementById("ketchup-gw-count").value) || 10;
  const lang = getLang();

  showSection("ketchup", "loading");

  try {
    let history = [];
    let seasonLabel = "";

    if (season === "current") {
      const allGWs = bootstrapData.events || [];
      const finishedGWs = allGWs.filter((e) => e.finished);
      const maxGW = finishedGWs.length > 0 ? finishedGWs[finishedGWs.length - 1].id : 0;
      if (maxGW === 0) {
        // Current season not started — show the last completed season instead.
        const lastSeason = prevSeasonShort(detectSeason(bootstrapData)).replace("/", "-");
        seasonLabel = seasonShort(lastSeason.replace("-", "/"));
        const startGW = Math.max(1, 38 - gwCount + 1);
        history = await getKetchupArchivedHistory(lastSeason, ketchupSelectedId, startGW, 38);
      } else {
        const startGW = Math.max(1, maxGW - gwCount + 1);
        const summary = await cachedPlayerSummary(ketchupSelectedId);
        history = (summary.history || [])
          .filter((h) => h.round >= startGW && h.round <= maxGW)
          .sort((a, b) => a.round - b.round);
        seasonLabel = seasonShort(detectSeason(bootstrapData));
      }
      if (history.length === 0) {
        const phSeason = seasonShort(detectSeason(bootstrapData));
        const lastSeason = prevSeasonShort(detectSeason(bootstrapData));
        document.getElementById("ketchup-placeholder").innerHTML = `<div class="placeholder-icon">⚽</div>
          <div>${lang === "pl" ? `Brak danych dla bieżącego sezonu ${phSeason}` : `No data for the current ${phSeason} season`}</div>
          <div style="color:var(--text-dim);font-size:0.85rem;margin-top:4px">${lang === "pl" ? `Sezon jeszcze się nie rozpoczął. Wybierz sezon archiwalny (np. ${lastSeason}) z listy powyżej.` : `The season hasn't started yet. Pick an archived season (e.g. ${lastSeason}) from the list above.`}</div>`;
        showSection("ketchup", "placeholder");
        document.getElementById("ketchup-chart-wrap").style.display = "none";
        return;
      }
    } else {
      const maxGW = 38;
      const startGW = Math.max(1, maxGW - gwCount + 1);
      seasonLabel = seasonShort(season.replace("-", "/"));
      history = await getKetchupArchivedHistory(season, ketchupSelectedId, startGW, maxGW);
      if (history.length === 0) {
        document.getElementById("ketchup-placeholder").innerHTML = `<div class="placeholder-icon">⚽</div>
          <div>${lang === "pl" ? `Brak danych archiwalnych dla sezonu ${seasonLabel}.` : `No archived data for the ${seasonLabel} season.`}</div>`;
        showSection("ketchup", "placeholder");
        document.getElementById("ketchup-chart-wrap").style.display = "none";
        return;
      }
    }

    const startGW = history[0].round;
    const maxGW = history[history.length - 1].round;
    const player = bootstrapData.elements.find((p) => p.id === ketchupSelectedId);
    renderKetchupChart(player, history, startGW, maxGW, seasonLabel);
    showSection("ketchup", "table");
    document.getElementById("ketchup-chart-wrap").style.display = "";
    document.getElementById("ketchup-placeholder").style.display = "none";
  } catch (err) {
    document.getElementById("ketchup-placeholder").innerHTML = `<div class="placeholder-icon">⚽</div>
      <div>${lang === "pl" ? "Wystąpił błąd podczas ładowania danych." : "An error occurred while loading data."}</div>`;
    showSection("ketchup", "placeholder");
    document.getElementById("ketchup-chart-wrap").style.display = "none";
  }
}

// Estimate expected points (xP) from FPL's expected stats — defined in api.js.

// Lowercases and strips diacritics so names from different sources (bootstrap
// first_name/second_name vs vaastav "First Last") compare reliably.
function normalizeName(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Builds the full name (first + second) the way vaastav writes it in its CSV
// (e.g. "Bruno Fernandes"), instead of the short web_name ("B.Fernandes").
function getFullPlayerName(player) {
  return normalizeName(`${player.first_name || ""} ${player.second_name || ""}`);
}

function findVaastavRow(csv, player) {
  const fullName = getFullPlayerName(player);
  const lastName = normalizeName(player.second_name);
  let match = csv.find((r) => fullName && r.name && normalizeName(r.name) === fullName);
  if (!match && lastName) {
    match = csv.find((r) => r.name && normalizeName(r.name).endsWith(" " + lastName));
  }
  return match;
}

async function getKetchupArchivedHistory(season, playerId, startGW, maxGW) {
  const player = bootstrapData.elements.find((p) => p.id === playerId);
  if (!player) return [];
  const gws = [];
  for (let gw = startGW; gw <= maxGW; gw++) gws.push(gw);
  const fetched = await fetchGWBatch(season, gws);
  const rows = [];
  for (const gw of gws) {
    const csv = fetched[gw] || [];
    const match = findVaastavRow(csv, player);
    if (!match) continue;
    rows.push({
      round: gw,
      total_points: parseInt(match.total_points) || 0,
      expected_goal_involvements: parseFloat(match.expected_goal_involvements) || 0,
      xP: computeExpectedPoints(match),
      goals_scored: parseInt(match.goals_scored) || 0,
      assists: parseInt(match.assists) || 0,
    });
  }
  return rows.sort((a, b) => a.round - b.round);
}

function renderKetchupChart(player, data, startGW, maxGW, seasonLabel) {
  const lang = getLang();
  const color = TEAM_COLORS[player.team] || "#555";
  const posClass = `pos-${getPositionShort(player.element_type).toLowerCase()}`;

  // Player info
  const seasonPts = data.reduce((s, d) => s + (d.total_points || 0), 0);
  const infoEl = document.getElementById("ketchup-player-info");
  infoEl.innerHTML = `
    <span class="team-color" style="background:${color};width:6px;height:28px;border-radius:3px;display:inline-block"></span>
    <span class="player-name">${player.web_name}</span>
    <span class="player-team">${getTeamName(player.team)}</span>
    <span class="pos-badge ${posClass}">${getPositionShort(player.element_type)}</span>
    <span style="color:var(--text-dim);font-size:0.85rem">${(player.now_cost / 10).toFixed(1)}m · ${seasonPts} pkt${seasonLabel ? ` · ${seasonLabel}` : ""}</span>
  `;

  // Use real expected points (xP) from the source data when available;
  // fall back to the xGI*4 proxy only for live-current history that lacks xP.
  const dataWithXP = data.map((d) => {
    const realXP = parseFloat(d.xP);
    const xPts = !isNaN(realXP)
      ? realXP
      : (parseFloat(d.expected_goal_involvements) || 0) * 4;
    return {
      ...d,
      xPts: +xPts.toFixed(2),
      gaActual: (d.goals_scored || 0) + (d.assists || 0),
    };
  });

  // Chart
  const svgW = 800;
  const svgH = 320;
  const pad = { top: 30, right: 20, bottom: 40, left: 50 };
  const chartW = svgW - pad.left - pad.right;
  const chartH = svgH - pad.top - pad.bottom;

  const allPts = dataWithXP.map((d) => d.total_points);
  const allXPts = dataWithXP.map((d) => d.xPts);
  const maxVal = Math.max(...allPts, ...allXPts, 1);

  let actualPath = "";
  let xpPath = "";
  let actualDots = "";
  let xpDots = "";
  let xLabels = "";

  const XP_COLOR = "#a855f7";

  dataWithXP.forEach((d, i) => {
    const x = pad.left + (i / Math.max(dataWithXP.length - 1, 1)) * chartW;
    const yActual = pad.top + chartH - (d.total_points / maxVal) * chartH;
    const yXP = pad.top + chartH - (d.xPts / maxVal) * chartH;

    if (i === 0) {
      actualPath = `M ${x} ${yActual}`;
      xpPath = `M ${x} ${yXP}`;
    } else {
      actualPath += ` L ${x} ${yActual}`;
      xpPath += ` L ${x} ${yXP}`;
    }

    const actualTt = `<div class="tt-name">${player.web_name}</div><span class="tt-dim">GW${d.round}:</span> <span class="tt-val">${d.total_points} pkt</span> <span class="tt-dim">(${d.goals_scored || 0}G ${d.assists || 0}A)</span>`;
    const xpTt = `<div class="tt-name">${player.web_name}</div><span class="tt-dim">GW${d.round}:</span> <span class="tt-val">~${d.xPts.toFixed(1)} pkt</span> <span class="tt-dim">(xP)</span>`;
    actualDots += `<circle cx="${x}" cy="${yActual}" r="4" fill="#3b82f6" stroke="var(--bg-card)" stroke-width="2"
      onmouseenter="window._chartTT.show(event, this.getAttribute('data-tt'))"
      onmouseleave="window._chartTT.hide()" data-tt="${actualTt.replace(/"/g, '&quot;')}"/>`;
    actualDots += `<circle class="chart-hover-dot" cx="${x}" cy="${yActual}"
      onmouseenter="window._chartTT.show(event, this.getAttribute('data-tt'))"
      onmouseleave="window._chartTT.hide()" data-tt="${actualTt.replace(/"/g, '&quot;')}"/>`;

    xpDots += `<circle cx="${x}" cy="${yXP}" r="4" fill="${XP_COLOR}" stroke="var(--bg-card)" stroke-width="2"
      onmouseenter="window._chartTT.show(event, this.getAttribute('data-tt'))"
      onmouseleave="window._chartTT.hide()" data-tt="${xpTt.replace(/"/g, '&quot;')}"/>`;
    xpDots += `<circle class="chart-hover-dot" cx="${x}" cy="${yXP}"
      onmouseenter="window._chartTT.show(event, this.getAttribute('data-tt'))"
      onmouseleave="window._chartTT.hide()" data-tt="${xpTt.replace(/"/g, '&quot;')}"/>`;

    xLabels += `<text class="chart-label" x="${x}" y="${pad.top + chartH + 18}" text-anchor="middle" font-size="10">${d.round}</text>`;
  });

  // Y axis
  let yTicks = "";
  const ySteps = 5;
  for (let i = 0; i <= ySteps; i++) {
    const val = (maxVal / ySteps) * i;
    const y = pad.top + chartH - (chartH / ySteps) * i;
    yTicks += `<text class="chart-label" x="${pad.left - 6}" y="${y + 3}" text-anchor="end" font-size="10">${Math.round(val)}</text>`;
    yTicks += `<line class="chart-grid" x1="${pad.left}" y1="${y}" x2="${pad.left + chartW}" y2="${y}"/>`;
  }

  const chartEl = document.getElementById("ketchup-chart");
  chartEl.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
    <line class="chart-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + chartH}"/>
    <line class="chart-axis" x1="${pad.left}" y1="${pad.top + chartH}" x2="${pad.left + chartW}" y2="${pad.top + chartH}"/>
    ${yTicks}
    ${xLabels}
    <path class="chart-line" d="${actualPath}" stroke="#3b82f6"/>
    <path class="chart-line" d="${xpPath}" stroke="${XP_COLOR}" stroke-dasharray="6 3"/>
    ${actualDots}
    ${xpDots}
    <text x="${pad.left + chartW - 10}" y="${pad.top + 12}" text-anchor="end" font-size="11" fill="#3b82f6" font-weight="600" font-family="sans-serif">● ${lang === "pl" ? "Pkt rzeczywiste" : "Actual pts"}</text>
    <text x="${pad.left + chartW - 10}" y="${pad.top + 26}" text-anchor="end" font-size="11" fill="${XP_COLOR}" font-weight="600" font-family="sans-serif">- - xP</text>
  </svg>`;

  // Summary stats
  const totalActual = dataWithXP.reduce((s, d) => s + d.total_points, 0);
  const totalXPts = dataWithXP.reduce((s, d) => s + d.xPts, 0);
  const totalGoals = dataWithXP.reduce((s, d) => s + (d.goals_scored || 0), 0);
  const totalAssists = dataWithXP.reduce((s, d) => s + (d.assists || 0), 0);
  const diff = totalActual - totalXPts;
  const overperformers = dataWithXP.filter((d) => d.total_points > d.xPts).length;
  const underperformers = dataWithXP.filter((d) => d.total_points < d.xPts).length;

  const sumEl = document.getElementById("ketchup-summary");
  const iPl = (tip) => `<span class="info-icon stat-info" data-i18n-text="${tip}">i</span>`;
  const tipTotal = lang === "pl" ? "Suma wszystkich zdobytych punktów FPL w wybranych kolejkach" : "Sum of all FPL points scored in selected gameweeks";
  const tipExpected = lang === "pl" ? "Suma oczekiwanych punktów (xP). Kolumna xP w danych jest pusta, więc xP jest szacowany z xG, xA i prawdopodobieństwa czystego konta (xGC) według punktacji FPL." : "Sum of expected points (xP). The source xP column is empty, so xP is estimated from xG, xA and clean-sheet probability (xGC) using FPL scoring.";
  const tipDiff = lang === "pl" ? "Różnica między rzeczywistymi a oczekiwanymi pkt. Dodatnia = zawodnik gra lepiej niż wskazuje xP (niedoszacowany). Ujemna = gra gorzej (przeszacowany)" : "Difference between actual and expected pts. Positive = player overperforming xP (undervalued). Negative = underperforming (overvalued)";
  const tipGA = lang === "pl" ? "Łączna liczba goli (G) i asyst (A) w wybranych kolejkach" : "Total goals (G) and assists (A) in selected gameweeks";
  const tipXP = lang === "pl" ? "Expected Points (xP) — szacowane oczekiwane punkty z xG, xA i czystych kont (xGC). Uwzględnia m.in. występy, gole, asysty i czyste konta." : "Expected Points (xP) — estimated expected points from xG, xA and clean sheets (xGC), including appearances, goals, assists and clean sheets.";
  const tipOver = lang === "pl" ? "Liczba kolejkach w których zawodnik zdobył więcej pkt niż oczekiwano (ponad xP)" : "Number of gameweeks where player scored more pts than expected (over xP)";
  const tipUnder = lang === "pl" ? "Liczba kolejkach w których zawodnik zdobył mniej pkt niż oczekiwano (poniżej xP)" : "Number of gameweeks where player scored fewer pts than expected (under xP)";

  sumEl.innerHTML = `
    <div class="ketchup-stat">
      <div class="ketchup-stat-val" style="color:var(--accent)">${totalActual}</div>
      <div class="ketchup-stat-label">${lang === "pl" ? "Łącznie pkt" : "Total pts"}${iPl(tipTotal)}</div>
    </div>
    <div class="ketchup-stat">
      <div class="ketchup-stat-val" style="color:var(--yellow)">${totalXPts.toFixed(1)}</div>
      <div class="ketchup-stat-label">xP${iPl(tipExpected)}</div>
    </div>
    <div class="ketchup-stat">
      <div class="ketchup-stat-val" style="color:${diff >= 0 ? 'var(--green)' : 'var(--red)'}">${diff >= 0 ? '+' : ''}${diff.toFixed(1)}</div>
      <div class="ketchup-stat-label">${lang === "pl" ? "Różnica" : "Diff"}${iPl(tipDiff)}</div>
    </div>
    <div class="ketchup-stat">
      <div class="ketchup-stat-val">${totalGoals}G ${totalAssists}A</div>
      <div class="ketchup-stat-label">${lang === "pl" ? "Gole / Asysty" : "Goals / Assists"}${iPl(tipGA)}</div>
    </div>
    <div class="ketchup-stat">
      <div class="ketchup-stat-val" style="color:var(--green)">${overperformers}</div>
      <div class="ketchup-stat-label">${lang === "pl" ? "Ponad xP" : "Over xP"}${iPl(tipOver)}</div>
    </div>
    <div class="ketchup-stat">
      <div class="ketchup-stat-val" style="color:var(--red)">${underperformers}</div>
      <div class="ketchup-stat-label">${lang === "pl" ? "Poniżej xP" : "Under xP"}${iPl(tipUnder)}</div>
    </div>
  `;
}

// ===================== OPTIMIZER =====================

let optimizerSort = { field: "total_points", dir: "desc" };
let optimizerSquad = [];
let optimizerLockedIds = [];

function runOptimizer() {
  if (!bootstrapData) return;
  const budget = parseInt(document.getElementById("optimizer-budget").value);
  const allPlayers = getOptimizedPlayers().filter((p) => p.now_cost > 0);
  const maxPerTeam = 3;
  const limits = { 1: 2, 2: 5, 3: 5, 4: 3 };
  const lang = getLang();

  const lockedPlayers = optimizerLockedIds
    .map(id => allPlayers.find(p => p.id === id))
    .filter(Boolean);

  const lockedCost = lockedPlayers.reduce((s, p) => s + p.now_cost, 0);
  const remainingBudget = budget - lockedCost;

  const lockedPosCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const lockedTeamCount = {};
  for (const p of lockedPlayers) {
    lockedPosCounts[p.element_type] = (lockedPosCounts[p.element_type] || 0) + 1;
    lockedTeamCount[p.team] = (lockedTeamCount[p.team] || 0) + 1;
  }

  const adjustedLimits = {};
  for (const pos of [1, 2, 3, 4]) {
    adjustedLimits[pos] = limits[pos] - (lockedPosCounts[pos] || 0);
  }

  const result = solveOptimizerFull(remainingBudget, allPlayers, maxPerTeam, adjustedLimits, lockedPlayers, lockedTeamCount);
  
  if (result.success) {
    optimizerSquad = [...lockedPlayers.map(p => ({ ...p, _locked: true })), ...result.squad];
  } else {
    optimizerSquad = [...lockedPlayers.map(p => ({ ...p, _locked: true }))];
  }

  if (!result.success) {
    const msg = lockedPlayers.length > 0
      ? (lang === "pl" ? "Nie udało się dobrać pozostałych zawodników do zablokowanych. Zwiększ budżet lub zmień zablokowanych." : "Could not fill remaining slots with locked players. Increase budget or change locked players.")
      : (lang === "pl" ? "Nie udało się wybrać 15 zawodników w tym budżecie. Zwiększ budżet na suwaku." : "Could not select 15 players within this budget. Increase the budget slider.");
    document.getElementById("optimizer-pitch").innerHTML = `<div style="padding:40px;text-align:center;color:var(--red)">
      <div style="font-size:1.1rem;font-weight:600;margin-bottom:6px">${lang === "pl" ? "Za mały budżet" : "Budget too low"}</div>
      <div style="font-size:0.9rem;color:var(--text-dim)">${msg}</div>
    </div>`;
    document.getElementById("optimizer-pitch-wrap").style.display = "";
    document.getElementById("optimizer-placeholder").style.display = "none";
    document.getElementById("optimizer-charts").style.display = "none";
    renderOptimizer();
    return;
  }

  loadAllFixtures().then(() => {
    for (const p of optimizerSquad) {
      const xGI = (parseFloat(p.expected_goals) || 0) + (parseFloat(p.expected_assists) || 0);
      p.epNext = parseFloat(p.ep_next) || 0;
      p.xgi = +xGI.toFixed(2);
      p.chanceNext = p.chance_of_playing_next_round;
      const upcoming = getTeamUpcomingFixtures(p.team, 5);
      const avgFDR = upcoming.length > 0 ? upcoming.reduce((s, f) => s + f.difficulty, 0) / upcoming.length : 3;
      p.avgFDR = +avgFDR.toFixed(1);
      p.upcomingFixtures = upcoming;
    }

    const fixtureTeams = [...new Set(optimizerSquad.map(p => p.team))];
    const fixtureEl = document.getElementById("optimizer-fixtures");
    if (fixtureEl && fixtureTeams.length > 0) {
      let fhtml = `<h3 style="font-size:0.95rem;margin:12px 0 10px;color:var(--text)">${lang === "pl" ? "Terminarz składu (5 kolejek)" : "Squad fixtures (5 GW)"}</h3>`;
      for (const teamId of fixtureTeams) {
        const color = TEAM_COLORS[teamId] || "#555";
        fhtml += `<div class="fdr-row"><span class="team-color" style="background:${color}"></span><span style="font-weight:600;min-width:90px">${getTeamName(teamId)}</span><div class="fdr-badges">${renderFixtureStrip(teamId, 5, lang)}</div></div>`;
      }
      fixtureEl.innerHTML = fhtml;
      fixtureEl.style.display = "";
    }

    renderOptimizer();
    document.getElementById("optimizer-pitch-wrap").style.display = "";
    document.getElementById("optimizer-placeholder").style.display = "none";
    document.getElementById("optimizer-charts").style.display = "";
    renderOptimizerCharts();
  });
}

function solveOptimizerFull(budget, allPlayers, maxPerTeam, limits, lockedPlayers, lockedTeamCount) {
  lockedPlayers = lockedPlayers || [];
  lockedTeamCount = lockedTeamCount || {};
  const lockedIds = new Set(lockedPlayers.map(p => p.id));
  const byPos = { 1: [], 2: [], 3: [], 4: [] };
  for (const p of allPlayers) {
    if (p.element_type in byPos && !lockedIds.has(p.id)) byPos[p.element_type].push(p);
  }

  for (const pos of Object.keys(byPos)) {
    byPos[pos].sort((a, b) => b.total_points - a.total_points);
  }

  function getCheapestAvailable(pos, count, exclude, teamCnt) {
    const avail = byPos[pos].filter(p =>
      p.now_cost > 0 && !exclude.has(p.id) && (teamCnt[p.team] || 0) < maxPerTeam
    );
    avail.sort((a, b) => a.now_cost - b.now_cost);
    return avail.slice(0, count);
  }

  function getMinCostForSlots(exclude, teamCnt) {
    let total = 0;
    let remaining = { 1: limits[1], 2: limits[2], 3: limits[3], 4: limits[4] };
    for (const pos of [1, 2, 3, 4]) {
      remaining[pos] -= [...exclude].filter(id => {
        const p = allPlayers.find(x => x.id === id);
        return p && p.element_type === pos;
      }).length;
    }
    for (const pos of [2, 3, 4, 1]) {
      if (remaining[pos] <= 0) continue;
      const cheapest = getCheapestAvailable(pos, remaining[pos], exclude, teamCnt);
      total += cheapest.reduce((s, p) => s + p.now_cost, 0);
      for (const p of cheapest) exclude.add(p.id);
    }
    return total;
  }

  const squad = [];
  const teamCount = { ...lockedTeamCount };
  const squadIds = new Set();
  const totalSlots = Object.values(limits).reduce((a, b) => a + b, 0);

  for (const pos of [2, 3, 4, 1]) {
    const need = limits[pos];
    const candidates = byPos[pos].filter(p => p.now_cost > 0 && p.total_points > 0);
    let picked = 0;
    for (const p of candidates) {
      if (picked >= need) break;
      if (squadIds.has(p.id)) continue;
      if ((teamCount[p.team] || 0) >= maxPerTeam) continue;
      const curCost = squad.reduce((s, x) => s + x.now_cost, 0);
      const testExclude = new Set(squadIds);
      testExclude.add(p.id);
      const minForRest = getMinCostForSlots(testExclude, { ...teamCount, [p.team]: (teamCount[p.team] || 0) + 1 });
      if (curCost + p.now_cost + minForRest > budget) continue;
      squad.push({ ...p });
      squadIds.add(p.id);
      teamCount[p.team] = (teamCount[p.team] || 0) + 1;
      picked++;
    }
  }

  for (const pos of [1, 2, 3, 4]) {
    const filled = squad.filter(s => s.element_type === pos).length;
    if (filled >= limits[pos]) continue;
    const need = limits[pos] - filled;
    const cheapest = byPos[pos]
      .filter(p => p.now_cost > 0 && !squadIds.has(p.id) && (teamCount[p.team] || 0) < maxPerTeam)
      .sort((a, b) => a.now_cost - b.now_cost);
    let picked = 0;
    for (const p of cheapest) {
      if (picked >= need) break;
      const curCost = squad.reduce((s, x) => s + x.now_cost, 0);
      if (curCost + p.now_cost > budget) continue;
      squad.push({ ...p });
      squadIds.add(p.id);
      teamCount[p.team] = (teamCount[p.team] || 0) + 1;
      picked++;
    }
  }

  const success = squad.length === totalSlots;
  let totalCost = squad.reduce((s, p) => s + p.now_cost, 0);

  if (success) {
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < squad.length; i++) {
        const cur = squad[i];
        const pos = cur.element_type;
        const candidates = byPos[pos]
          .filter(p => p.id !== cur.id && p.total_points > cur.total_points && !squadIds.has(p.id))
          .sort((a, b) => b.total_points - a.total_points);
        for (const candidate of candidates) {
          const costDiff = candidate.now_cost - cur.now_cost;
          if (costDiff > (budget - totalCost)) continue;
          if (cur.team !== candidate.team && (teamCount[candidate.team] || 0) >= maxPerTeam) continue;
          if (cur.team !== candidate.team) {
            teamCount[cur.team] = (teamCount[cur.team] || 1) - 1;
            teamCount[candidate.team] = (teamCount[candidate.team] || 0) + 1;
          }
          squadIds.delete(cur.id);
          squadIds.add(candidate.id);
          squad[i] = { ...candidate };
          totalCost += costDiff;
          improved = true;
          break;
        }
      }
    }
  }

  return { squad, success, budget };
}

function renderOptimizer() {
  const dir = optimizerSort.dir === "desc" ? -1 : 1;
  const sorted = [...optimizerSquad].sort((a, b) => {
    const av = a[optimizerSort.field] ?? 0;
    const bv = b[optimizerSort.field] ?? 0;
    if (typeof av === "string") return dir * av.localeCompare(bv);
    return (bv - av) * dir;
  });

  const totalPts = sorted.reduce((s, p) => s + p.total_points, 0);
  const totalCost = sorted.reduce((s, p) => s + p.now_cost, 0);
  const avgPts = sorted.length > 0 ? (totalPts / sorted.length).toFixed(1) : 0;
  const avgCost = sorted.length > 0 ? (totalCost / sorted.length / 10).toFixed(1) : 0;
  const lang = getLang();
  const posCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  sorted.forEach((p) => { posCounts[p.element_type] = (posCounts[p.element_type] || 0) + 1; });

  const budget = parseInt(document.getElementById("optimizer-budget").value);
  const remaining = ((budget - totalCost) / 10).toFixed(1);

  function makeJersey(p) {
    const color = TEAM_COLORS[p.team] || "#555";
    const dark = shadeColor(color, -30);
    const posShort = getPositionShort(p.element_type);
    const teamAbbr = getTeamName(p.team) || "";
    const locked = p._locked
      ? `<span class="pitch-jersey-locked" title="${lang === "pl" ? "Zawodnik na sztywno" : "Locked player"}">🔒</span>` : "";
    return `<div class="pitch-jersey">
      <div class="pitch-jersey-body" style="background:${color};box-shadow:inset 0 -10px 14px ${dark}, 0 2px 6px rgba(0,0,0,0.4)">
        <span style="position:relative;z-index:1;text-align:center;line-height:1.15;font-size:0.78rem;font-weight:800;padding:2px">${p.web_name}</span>
        <span class="pitch-jersey-badge">${teamAbbr}</span>
        ${locked}
      </div>
      <div class="pitch-jersey-name">${p.web_name}</div>
      <div class="pitch-jersey-info">${(p.now_cost / 10).toFixed(1)}m · ${p.total_points} pkt · ${(p.epNext || 0).toFixed(1)} exp</div>
    </div>`;
  }

  const gk = sorted.filter(p => p.element_type === 1);
  const def = sorted.filter(p => p.element_type === 2);
  const mid = sorted.filter(p => p.element_type === 3);
  const fwd = sorted.filter(p => p.element_type === 4);

  const posLabels = { gk: "GK", def: "DEF", mid: "MID", fwd: "FWD" };

  const pitch = document.getElementById("optimizer-pitch");
  pitch.innerHTML = `
    <div class="pitch-row">
      <span class="pitch-row-label">${posLabels.gk}</span>
      ${gk.map(makeJersey).join("")}
    </div>
    <div class="pitch-row">
      <span class="pitch-row-label">${posLabels.def}</span>
      ${def.map(makeJersey).join("")}
    </div>
    <div class="pitch-row">
      <span class="pitch-row-label">${posLabels.mid}</span>
      ${mid.map(makeJersey).join("")}
    </div>
    <div class="pitch-row">
      <span class="pitch-row-label">${posLabels.fwd}</span>
      ${fwd.map(makeJersey).join("")}
    </div>`;

  const tbody = document.getElementById("optimizer-body");
  tbody.innerHTML = sorted.map((p, i) => {
    const color = TEAM_COLORS[p.team] || "#555";
    const posClass = `pos-${getPositionShort(p.element_type).toLowerCase()}`;
    const lockLabel = p._locked ? `<span title="${lang === "pl" ? "Zawodnik na sztywno" : "Locked player"}" style="font-size:0.75rem;margin-right:3px">🔒</span>` : "";
    const epColor = (p.epNext || 0) >= 4 ? "var(--green)" : (p.epNext || 0) >= 2 ? "var(--yellow)" : "var(--text-dim)";
    let chanceHtml = "—";
    if (p.chanceNext !== null && p.chanceNext !== undefined) {
      const ch = parseInt(p.chanceNext);
      const chClass = ch >= 75 ? "chance-ok" : ch >= 50 ? "chance-doubt" : "chance-out";
      chanceHtml = `<span class="chance-badge ${chClass}">${ch}%</span>`;
    } else if (p.status === "a") {
      chanceHtml = `<span class="chance-badge chance-ok">100%</span>`;
    }
    const fdrColor = (p.avgFDR || 3) <= 2 ? "var(--green)" : (p.avgFDR || 3) <= 3 ? "var(--yellow)" : "var(--red)";
    return `<tr style="${p._locked ? 'background:rgba(37,99,235,0.08)' : ''}">
      <td class="rank-num">${i + 1}</td>
      <td>${lockLabel}${p.web_name}</td>
      <td><span class="team-color" style="background:${color}"></span>${getTeamName(p.team)}</td>
      <td><span class="pos-badge ${posClass}">${getPositionShort(p.element_type)}</span></td>
      <td class="stat-val">${(p.now_cost / 10).toFixed(1)}</td>
      <td class="stat-val">${p.total_points}</td>
      <td class="stat-val" style="color:${epColor}">${(p.epNext || 0).toFixed(1)}</td>
      <td class="stat-val">${chanceHtml}</td>
      <td class="stat-val">${(p.xgi || 0).toFixed(1)}</td>
      <td class="stat-val" style="color:${fdrColor}">${p.avgFDR || "—"}</td>
    </tr>`;
  }).join("");

  const totalEpNext = sorted.reduce((s, p) => s + (p.epNext || 0), 0);
  const totalXGI = sorted.reduce((s, p) => s + (p.xgi || 0), 0);

  const summary = document.getElementById("optimizer-summary");
  summary.innerHTML = `
    <div class="optimizer-stat-box">
      <div class="optimizer-stat-val">${(totalCost / 10).toFixed(1)}m</div>
      <div class="optimizer-stat-label">${lang === "pl" ? "Koszt" : "Cost"}</div>
    </div>
    <div class="optimizer-stat-box">
      <div class="optimizer-stat-val">${totalPts}</div>
      <div class="optimizer-stat-label">${lang === "pl" ? "Punkty" : "Points"}</div>
    </div>
    <div class="optimizer-stat-box">
      <div class="optimizer-stat-val">${remaining}m</div>
      <div class="optimizer-stat-label">${lang === "pl" ? "Pozostało" : "Remaining"}</div>
    </div>
    <div class="optimizer-stat-box">
      <div class="optimizer-stat-val">${posCounts[1]}GK · ${posCounts[2]}DEF · ${posCounts[3]}MID · ${posCounts[4]}FWD</div>
      <div class="optimizer-stat-label">${lang === "pl" ? "Skład" : "Formation"}</div>
    </div>
    <div class="optimizer-stat-box">
      <div class="optimizer-stat-val">${totalEpNext.toFixed(1)}</div>
      <div class="optimizer-stat-label">${lang === "pl" ? "exp pkt" : "exp pts"}</div>
    </div>
    <div class="optimizer-stat-box">
      <div class="optimizer-stat-val">${totalXGI.toFixed(1)}</div>
      <div class="optimizer-stat-label">xGI</div>
    </div>`;

  initTableSort("optimizer-table", optimizerSort, renderOptimizer, ["web_name", "now_cost", "total_points"]);
}

function shadeColor(hex, percent) {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + percent));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + percent));
  const b = Math.min(255, Math.max(0, (num & 0x0000FF) + percent));
  return `rgb(${r},${g},${b})`;
}

function renderOptimizerCharts() {
  renderPriceDistChart();
  renderBudgetSensitivityChart();
}

function renderPriceDistChart() {
  const container = document.getElementById("optimizer-chart-dist");
  if (!container || optimizerSquad.length === 0) return;

  const sorted = [...optimizerSquad].sort((a, b) => b.now_cost - a.now_cost);
  const maxCost = Math.max(...sorted.map((p) => p.now_cost));
  const svgW = 500;
  const svgH = 260;
  const pad = { top: 10, right: 20, bottom: 40, left: 45 };
  const chartW = svgW - pad.left - pad.right;
  const chartH = svgH - pad.top - pad.bottom;
  const barW = Math.floor(chartW / 15) - 4;
  const gap = 4;

  const posColors = { 1: "#fbbf24", 2: "#3b82f6", 3: "#22c55e", 4: "#ef4444" };

  let bars = "";
  sorted.forEach((p, i) => {
    const x = pad.left + i * (barW + gap);
    const h = maxCost > 0 ? (p.now_cost / maxCost) * chartH : 0;
    const y = pad.top + chartH - h;
    const color = posColors[p.element_type] || "#555";
    bars += `<rect class="chart-bar" x="${x}" y="${y}" width="${barW}" height="${h}" fill="${color}" rx="2">
      <title>${p.web_name} — ${(p.now_cost / 10).toFixed(1)}m (${getPositionShort(p.element_type)})</title>
    </rect>`;
    bars += `<text class="chart-label" x="${x + barW / 2}" y="${pad.top + chartH + 14}" text-anchor="middle" font-size="9">${p.web_name}</text>`;
    if (barW > 18) {
      bars += `<text class="chart-value" x="${x + barW / 2}" y="${y - 4}" text-anchor="middle" font-size="9">${(p.now_cost / 10).toFixed(1)}</text>`;
    }
  });

  let yTicks = "";
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const val = (maxCost / steps) * i;
    const y = pad.top + chartH - (chartH / steps) * i;
    yTicks += `<text class="chart-label" x="${pad.left - 6}" y="${y + 3}" text-anchor="end" font-size="10">${(val / 10).toFixed(0)}m</text>`;
    if (i > 0) yTicks += `<line class="chart-grid" x1="${pad.left}" y1="${y}" x2="${pad.left + chartW}" y2="${y}"/>`;
  }

  container.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
    <line class="chart-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + chartH}"/>
    <line class="chart-axis" x1="${pad.left}" y1="${pad.top + chartH}" x2="${pad.left + chartW}" y2="${pad.top + chartH}"/>
    ${yTicks}
    ${bars}
  </svg>`;
}

function renderBudgetSensitivityChart() {
  const container = document.getElementById("optimizer-chart-budget");
  if (!container || !bootstrapData) return;

  const budgets = [55, 60, 70, 80, 90, 100, 110, 120];
  const results = [];

  for (const b of budgets) {
    const r = solveOptimizer(b * 10);
    results.push({ budget: b, pts: r.totalPts, cost: r.totalCost / 10 });
  }

  const maxPts = Math.max(...results.map((r) => r.pts));
  const minPts = Math.min(...results.map((r) => r.pts));
  const range = maxPts - minPts || 1;
  const svgW = 500;
  const svgH = 260;
  const pad = { top: 20, right: 20, bottom: 40, left: 50 };
  const chartW = svgW - pad.left - pad.right;
  const chartH = svgH - pad.top - pad.bottom;

  const points = results.map((r, i) => {
    const x = pad.left + (i / (results.length - 1)) * chartW;
    const y = pad.top + chartH - ((r.pts - minPts) / range) * chartH * 0.85 - chartH * 0.05;
    return { x, y, ...r };
  });

  let areaPath = `M ${points[0].x} ${pad.top + chartH}`;
  points.forEach((p) => { areaPath += ` L ${p.x} ${p.y}`; });
  areaPath += ` L ${points[points.length - 1].x} ${pad.top + chartH} Z`;

  let linePath = `M ${points[0].x} ${points[0].y}`;
  points.slice(1).forEach((p) => { linePath += ` L ${p.x} ${p.y}`; });

  let yTicks = "";
  const ySteps = 5;
  for (let i = 0; i <= ySteps; i++) {
    const val = minPts + (range / ySteps) * i;
    const y = pad.top + chartH - (chartH / ySteps) * i * 0.85 - chartH * 0.05 * (i / ySteps);
    yTicks += `<text class="chart-label" x="${pad.left - 6}" y="${y + 3}" text-anchor="end" font-size="10">${Math.round(val)}</text>`;
    yTicks += `<line class="chart-grid" x1="${pad.left}" y1="${y}" x2="${pad.left + chartW}" y2="${y}"/>`;
  }

  let xLabels = "";
  let dots = "";
  points.forEach((p) => {
    xLabels += `<text class="chart-label" x="${p.x}" y="${pad.top + chartH + 18}" text-anchor="middle" font-size="10">${p.budget}m</text>`;
    const ttHtml = `<div class="tt-name">Budżet: ${p.budget}m</div><span class="tt-val">${p.pts} pkt</span>`;
    dots += `<circle class="chart-dot" cx="${p.x}" cy="${p.y}" r="4"
      onmouseenter="window._chartTT.show(event, this.getAttribute('data-tt'))"
      onmouseleave="window._chartTT.hide()" data-tt="${ttHtml.replace(/"/g, '&quot;')}"/>`;
    dots += `<circle class="chart-hover-dot" cx="${p.x}" cy="${p.y}"
      onmouseenter="window._chartTT.show(event, this.getAttribute('data-tt'))"
      onmouseleave="window._chartTT.hide()" data-tt="${ttHtml.replace(/"/g, '&quot;')}"/>`;
  });

  container.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="budgetGradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.4"/>
        <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    <line class="chart-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + chartH}"/>
    <line class="chart-axis" x1="${pad.left}" y1="${pad.top + chartH}" x2="${pad.left + chartW}" y2="${pad.top + chartH}"/>
    ${yTicks}
    <path class="chart-area" d="${areaPath}"/>
    <path class="chart-line" d="${linePath}"/>
    ${dots}
    ${xLabels}
  </svg>`;
}

function solveOptimizer(budget) {
  const allPlayers = getOptimizedPlayers().filter((p) => p.now_cost > 0);
  const maxPerTeam = 3;
  const limits = { 1: 2, 2: 5, 3: 5, 4: 3 };
  const result = solveOptimizerFull(budget, allPlayers, maxPerTeam, limits);
  return {
    totalPts: result.squad.reduce((s, p) => s + p.total_points, 0),
    totalCost: result.squad.reduce((s, p) => s + p.now_cost, 0),
  };
}

// ===================== HOME / AWAY =====================

async function runHomeAway() {
  if (!bootstrapData) return;
  const posFilter = parseInt(document.getElementById("homeaway-position").value);
  const players = bootstrapData.elements
    .filter((p) => p.now_cost > 0)
    .sort((a, b) => b.total_points - a.total_points);
  const filtered = posFilter > 0 ? players.filter((p) => p.element_type === posFilter) : players;
  const sample = filtered.slice(0, 40);

  showSection("homeaway", "loading");
  const loadingEl = document.getElementById("homeaway-loading");
  const lang = getLang();

  homeAwayData = [];
  for (let i = 0; i < sample.length; i++) {
    const p = sample[i];
    if (i % 5 === 0 && loadingEl) {
      const inner = loadingEl.querySelector("div:last-child");
      if (inner) inner.textContent = `${lang === "pl" ? "Pobieranie" : "Fetching"} ${i + 1}/${sample.length}...`;
    }
    try {
      const summary = await cachedPlayerSummary(p.id);
      const history = summary.history || [];
      let homePts = 0, awayPts = 0, homeGames = 0, awayGames = 0;
      for (const h of history) {
        if (h.was_home) { homePts += h.total_points; homeGames++; }
        else { awayPts += h.total_points; awayGames++; }
      }
      homeAwayData.push({
        id: p.id,
        web_name: p.web_name,
        team: p.team,
        element_type: p.element_type,
        homeAvg: homeGames > 0 ? +(homePts / homeGames).toFixed(1) : 0,
        awayAvg: awayGames > 0 ? +(awayPts / awayGames).toFixed(1) : 0,
        homePts, awayPts,
        homeGames, awayGames,
        diff: homeGames > 0 && awayGames > 0 ? +((homePts / homeGames) - (awayPts / awayGames)).toFixed(1) : 0,
      });
    } catch {}
  }

  renderHomeAway();
  showSection("homeaway", "table");
}

function renderHomeAway() {
  const dir = homeAwaySort.dir === "desc" ? -1 : 1;
  const sorted = [...homeAwayData].sort((a, b) => {
    const av = a[homeAwaySort.field] ?? 0;
    const bv = b[homeAwaySort.field] ?? 0;
    return (bv - av) * dir;
  });

  const tbody = document.getElementById("homeaway-body");
  tbody.innerHTML = sorted.map((r, i) => {
    const color = TEAM_COLORS[r.team] || "#555";
    const posClass = `pos-${getPositionShort(r.element_type).toLowerCase()}`;
    return `<tr>
      <td class="rank-num">${i + 1}</td>
      <td>${r.web_name}</td>
      <td><span class="team-color" style="background:${color}"></span>${getTeamName(r.team)}</td>
      <td><span class="pos-badge ${posClass}">${getPositionShort(r.element_type)}</span></td>
      <td class="stat-val">${r.homeAvg} <span style="color:var(--text-dim);font-size:0.75rem">(${r.homeGames}g)</span></td>
      <td class="stat-val">${r.awayAvg} <span style="color:var(--text-dim);font-size:0.75rem">(${r.awayGames}g)</span></td>
      <td class="stat-val" style="color:${r.diff > 0 ? 'var(--green)' : 'var(--red)'}">${r.diff > 0 ? '+' : ''}${r.diff}</td>
    </tr>`;
  }).join("");

  renderHomeAwayLeaders();
}

function renderHomeAwayLeaders() {
  if (!homeAwayData.length) return;
  const lang = getLang();
  const el = document.getElementById("homeaway-leaders");
  if (!el) return;

  const valid = homeAwayData.filter(p => p.homeGames >= 3 && p.awayGames >= 3);
  const bestHome = [...valid].sort((a, b) => b.homeAvg - a.homeAvg).slice(0, 5);
  const bestAway = [...valid].sort((a, b) => b.awayAvg - a.awayAvg).slice(0, 5);

  const renderCard = (title, color, icon, list, field) => {
    const rows = list.map((p, i) => {
      const teamColor = TEAM_COLORS[p.team] || "#555";
      return `<div class="leader-row">
        <span class="rank-num" style="min-width:20px;color:${color}">${i + 1}</span>
        <span class="team-color" style="background:${teamColor}"></span>
        <span style="font-weight:600">${p.web_name}</span>
        <span style="color:var(--text-dim);font-size:0.82rem">${getTeamName(p.team)} ${getPositionShort(p.element_type)}</span>
        <span style="margin-left:auto;font-weight:700;color:${color}">${p[field]} <span style="font-size:0.75rem;color:var(--text-dim)">(${p[field === 'homeAvg' ? 'homeGames' : 'awayGames']}g)</span></span>
      </div>`;
    }).join("");
    return `<div class="leader-card">
      <h3 style="color:${color}">${icon} ${title}</h3>
      ${rows}
    </div>`;
  };

  const hTitle = lang === "pl" ? "Królowie Domu (najlepsza średnia)" : "Home Kings (highest avg)";
  const aTitle = lang === "pl" ? "Specjaliści od Wyjazdów (najlepsza średnia)" : "Away Experts (highest avg)";

  el.innerHTML = `<div class="charts-row">
    ${renderCard(hTitle, "var(--green)", "🏠", bestHome, "homeAvg")}
    ${renderCard(aTitle, "var(--red)", "✈️", bestAway, "awayAvg")}
  </div>`;
}

// ===================== MY TEAM =====================

// ===================== MY TEAM — CSV IMPORT =====================

function parseMyTeamCSVRows(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ""; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === '\r') { /* skip, handled by \n */ }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ""));
}

function buildMyTeamOverride(text, alreadyDoubled) {
  const rows = parseMyTeamCSVRows(text);
  if (rows.length < 2) return null;
  const header = rows[0].map(h => h.trim().toLowerCase());
  const col = (...names) => header.findIndex(h => names.includes(h));
  const iGw = col("round", "event", "gw", "gameweek", "kolejka");
  const iSlot = col("position", "pos", "slot", "lp");
  const iPoints = col("points", "pts", "punkty");
  const iName = col("web_name", "name", "player", "zawodnik");
  const iTeam = col("team", "druzyna");
  const iCap = col("captain");
  const iVice = col("vice_captain", "vicecaptain", "vice");
  const iRole = col("field_position", "player_type", "role", "pozycja");
  if (iName < 0 || iGw < 0 || iPoints < 0) return null;

  const ROLE = { GK: 1, DEF: 2, MID: 3, FWD: 4 };
  const playerIds = new Map();
  const playerMeta = new Map();
  const teamIds = new Map();
  let nextPid = 1, nextTid = 1;
  const gwPicksData = {};
  const playerGwMap = {};
  const gwRows = {};

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const gw = parseInt(cells[iGw], 10);
    if (!gw) continue;
    (gwRows[gw] = gwRows[gw] || []).push(cells);
  }

  for (const gwKey of Object.keys(gwRows)) {
    const gw = parseInt(gwKey, 10);
    const parsed = gwRows[gw].map(cells => {
      const name = (cells[iName] || "").trim();
      if (!name) return null;
      const pointsRaw = parseFloat(cells[iPoints]) || 0;
      const slotRaw = iSlot >= 0 ? parseInt(cells[iSlot], 10) : NaN;
      const isCaptain = iCap >= 0 ? /^(true|1|tak|yes)$/i.test((cells[iCap] || "").trim()) : false;
      const isVice = iVice >= 0 ? /^(true|1|tak|yes)$/i.test((cells[iVice] || "").trim()) : false;
      const teamName = iTeam >= 0 ? (cells[iTeam] || "").trim() : "";
      const roleRaw = iRole >= 0 ? (cells[iRole] || "").trim().toUpperCase() : "";
      return { name, pointsRaw, slotRaw, isCaptain, isVice, teamName, roleRaw };
    }).filter(Boolean);

    const assign = (p) => {
      let id = playerIds.get(p.name);
      if (!id) {
        id = nextPid++;
        playerIds.set(p.name, id);
        let teamId = 0;
        if (p.teamName) {
          if (!teamIds.has(p.teamName)) teamIds.set(p.teamName, nextTid++);
          teamId = teamIds.get(p.teamName);
        }
        playerMeta.set(id, { name: p.name, element_type: ROLE[p.roleRaw] || 3, teamId, totalBase: 0 });
      }
      return id;
    };

    let si = 1, bi = 12;
    const picks = [];
    for (const p of parsed) {
      const id = assign(p);
      const base = alreadyDoubled && p.isCaptain ? p.pointsRaw / 2 : p.pointsRaw;
      playerMeta.get(id).totalBase += base;
      if (!playerGwMap[id]) playerGwMap[id] = {};
      playerGwMap[id][gw] = base;
      let position;
      if (!isNaN(p.slotRaw) && p.slotRaw >= 1) position = p.slotRaw;
      else position = (si <= 11) ? si++ : bi++;
      picks.push({ element: id, position, multiplier: p.isCaptain ? 2 : 1, is_captain: p.isCaptain, is_vice_captain: p.isVice });
    }
    const starters = picks.filter(p => p.position <= 11);
    const gwTotal = starters.reduce((s, p) => s + (playerGwMap[p.element][gw] * p.multiplier), 0);
    gwPicksData[gw] = { picks, entry_history: { points: Math.round(gwTotal) } };
  }

  const gws = Object.keys(gwPicksData).map(Number).sort((a, b) => a - b);
  if (gws.length === 0) return null;

  const elements = [];
  for (const [id, m] of playerMeta) {
    elements.push({ id, web_name: m.name, team: m.teamId, element_type: m.element_type, total_points: Math.round(m.totalBase) });
  }
  const teams = [];
  for (const [name, id] of teamIds) teams.push({ id, name, short_name: name });

  return { gwPicksData, playerGwMap, gws, syntheticBootstrap: { elements, teams } };
}

function runMyTeamCSV() {
  const ta = document.getElementById("myteam-csv-input");
  const text = ta ? ta.value : "";
  const alreadyDoubled = document.getElementById("myteam-csv-doubled")?.checked || false;
  const lang = getLang();
  const parsed = text && text.trim() ? buildMyTeamOverride(text, alreadyDoubled) : null;
  if (!parsed) {
    document.getElementById("myteam-placeholder").innerHTML = `<div class="placeholder-icon">⚠️</div>
      <div>${lang === "pl" ? "Nie rozpoznano danych w CSV." : "Could not parse the CSV."}</div>
      <div style="color:var(--text-dim);font-size:0.85rem;margin-top:4px">${lang === "pl" ? "Oczekiwane nagłówki: round, position, points, web_name, team (opcjonalnie: captain, vice_captain, field_position)." : "Expected headers: round, position, points, web_name, team (optional: captain, vice_captain, field_position)."}</div>`;
    showSection("myteam", "placeholder");
    return;
  }
  const saved = bootstrapData;
  bootstrapData = parsed.syntheticBootstrap;
  try {
    runMyTeam(parsed);
  } finally {
    bootstrapData = saved;
  }
}

async function runMyTeam(override) {
  if (!bootstrapData && !override) return;
  const rawId = document.getElementById("myteam-id").value;
  const managerId = (rawId && rawId.trim()) || managerIdForSeason(detectSeason(bootstrapData).replace("/", "-"));
  if (!managerId) return;
  const gwFilter = parseInt(document.getElementById("myteam-gw-filter").value || "0");

  showSection("myteam", "loading");
  document.getElementById("myteam-summary-cards").style.display = "none";
  document.getElementById("myteam-tabs").style.display = "none";
  document.getElementById("myteam-overview-tab").style.display = "none";
  const loadingEl = document.getElementById("myteam-loading");
  const lang = getLang();

  try {
    const allGWs = bootstrapData.events || [];
    const finishedGWs = allGWs.filter(e => e.finished);
    const maxGW = finishedGWs.length > 0 ? finishedGWs[finishedGWs.length - 1].id : 38;
    const startGW = gwFilter > 0 ? Math.max(1, maxGW - gwFilter + 1) : 1;

    let gwPicksData, playerGwMap, gws;
    let totalManagerPoints = 0;

    if (override) {
      if (!override.gws || override.gws.length === 0) {
        document.getElementById("myteam-placeholder").innerHTML = `<div class="placeholder-icon">⚠️</div><div>${lang === "pl" ? "Brak danych w CSV." : "No data in CSV."}</div>`;
        showSection("myteam", "placeholder");
        return;
      }
      gwPicksData = override.gwPicksData;
      playerGwMap = override.playerGwMap;
      gws = override.gws;
    } else {

    for (let gw = startGW; gw <= maxGW; gw++) {
      if (loadingEl) {
        const inner = loadingEl.querySelector("div:last-child");
        if (inner) inner.textContent = `${lang === "pl" ? "Pobieranie GW" : "Fetching GW"} ${gw}/${maxGW}...`;
      }
      try {
        const picksData = await getManagerPicks(managerId, gw);
        gwPicksData[gw] = picksData;
        totalManagerPoints += picksData.entry_history?.points || 0;
      } catch {}
    }

    gws = Object.keys(gwPicksData).map(Number).sort((a, b) => a - b);
    if (gws.length === 0) {
      const phSeason = seasonShort(detectSeason(bootstrapData));
      const lastSeason = prevSeasonShort(detectSeason(bootstrapData));
      document.getElementById("myteam-placeholder").innerHTML = `<div class="placeholder-icon">📋</div>
        <div>${lang === "pl" ? `Brak danych dla sezonu ${phSeason}` : `No data for the ${phSeason} season`}</div>
        <div style="color:var(--text-dim);font-size:0.85rem;margin-top:4px">${lang === "pl" ? `Sezon jeszcze się nie rozpoczął — skład będzie dostępny po starcie rozgrywek. Dane archiwalne (${lastSeason}) nie są dostępne dla tego menedżera przez API FPL.` : `The season hasn't started yet — the squad will be available once games begin. Archived data (${lastSeason}) isn't available for this manager via the FPL API.`}</div>`;
      showSection("myteam", "placeholder");
      return;
    }

    const allPlayerIds = new Set();
    for (const gw of gws) {
      for (const pick of (gwPicksData[gw].picks || [])) {
        allPlayerIds.add(pick.element);
      }
    }

    playerGwMap = {};
    for (const pid of allPlayerIds) {
      try {
        const summary = await cachedPlayerSummary(pid);
        playerGwMap[pid] = {};
        for (const h of (summary.history || [])) {
          playerGwMap[pid][h.round] = h.total_points;
        }
      } catch {}
    }
    }

    const allPlayerIds = new Set();
    for (const gw of gws) {
      for (const pick of (gwPicksData[gw].picks || [])) {
        allPlayerIds.add(pick.element);
      }
    }

    const playerStats = {};
    for (const pid of allPlayerIds) {
      playerStats[pid] = { totalPts: 0, gws: 0, selectedGws: 0 };
    }

    const gwHistory = [];
    const reserveLost = [];
    const captainData = [];

    for (const gw of gws) {
      const picksData = gwPicksData[gw];
      const picks = picksData.picks || [];
      const starting = picks.filter(p => p.position <= 11);
      const bench = picks.filter(p => p.position > 11);
      const captain = picks.find(p => p.is_captain);

      let gwPts = 0;
      let benchPts = 0;
      let captainPts = 0;
      let captainActualPts = 0;
      let captainName = "";
      let bestPlayerName = "";
      let bestPlayerPts = 0;
      let wasCaptainBest = false;
      let wasCaptainInTop3 = false;

      const playerPtsThisGW = [];

      for (const pick of picks) {
        const pts = (playerGwMap[pick.element]?.[gw] || 0) * (pick.multiplier || 1);
        const rawPts = playerGwMap[pick.element]?.[gw] || 0;
        if (pick.position <= 11) {
          gwPts += pts;
        } else {
          benchPts += rawPts;
        }
        playerPtsThisGW.push({ ...pick, pts, rawPts });
      }

      const sorted = [...playerPtsThisGW].sort((a, b) => b.rawPts - a.rawPts);
      bestPlayerName = sorted.length > 0 ? (bootstrapData.elements.find(p => p.id === sorted[0].element)?.web_name || "?") : "?";
      bestPlayerPts = sorted.length > 0 ? sorted[0].rawPts : 0;

      if (captain) {
        const capPlayer = bootstrapData.elements.find(p => p.id === captain.element);
        captainName = capPlayer?.web_name || "?";
        captainActualPts = playerGwMap[captain.element]?.[gw] || 0;
        captainPts = captainActualPts * (captain.multiplier || 1);
        wasCaptainBest = captainActualPts >= bestPlayerPts;
        const top3 = sorted.slice(0, 3).map(s => s.element);
        wasCaptainInTop3 = top3.includes(captain.element);
      }

      reserveLost.push({ gw, benchPts, benchNames: bench.map(b => bootstrapData.elements.find(p => p.id === b.element)?.web_name || "?").join(", ") });

      captainData.push({
        gw, captainName, captainPts, captainActualPts,
        bestPlayerName, bestPlayerPts, bestPlayerId: sorted.length > 0 ? sorted[0].element : 0,
        wasCaptainBest, wasCaptainInTop3,
        efficiency: captainActualPts > 0 ? ((captainPts / Math.max(bestPlayerPts * 2, 1)) * 100).toFixed(0) : 0
      });

      gwHistory.push({ gw, pts: gwPts, benchPts, total: picksData.entry_history?.points || 0 });

      for (const pick of picks) {
        const pts = (playerGwMap[pick.element]?.[gw] || 0) * (pick.multiplier || 1);
        playerStats[pick.element].totalPts += pts;
        playerStats[pick.element].gws++;
        if (pick.position <= 11) playerStats[pick.element].selectedGws++;
      }
    }

    const lastPicks = gwPicksData[gws[gws.length - 1]]?.picks || [];

    const tbody = document.getElementById("myteam-body");
    tbody.innerHTML = lastPicks.map((pick, i) => {
      const player = bootstrapData.elements.find(p => p.id === pick.element);
      if (!player) return "";
      const color = TEAM_COLORS[player.team] || "#555";
      const posClass = `pos-${getPositionShort(player.element_type).toLowerCase()}`;
      const captain = pick.is_captain ? " (C)" : pick.is_vice_captain ? " (VC)" : "";
      const pts = playerStats[pick.element]?.totalPts || 0;
      const totalPlayerPts = player.total_points || 1;
      const pct = totalPlayerPts > 0 ? ((pts / totalPlayerPts) * 100).toFixed(1) : "0.0";
      const gwsSel = playerStats[pick.element]?.selectedGws || 0;
      return `<tr>
        <td class="rank-num">${i + 1}</td>
        <td>${player.web_name}${captain}</td>
        <td><span class="team-color" style="background:${color}"></span>${getTeamName(player.team)}</td>
        <td><span class="pos-badge ${posClass}">${getPositionShort(player.element_type)}</span></td>
        <td class="stat-val">${pts}</td>
        <td class="stat-val" style="color:${parseFloat(pct) > 50 ? 'var(--green)' : 'var(--yellow)'}">${pct}%</td>
        <td style="color:var(--text-dim);font-size:0.8rem">${gwsSel} ${lang === "pl" ? "kolejek" : "GWs"}</td>
      </tr>`;
    }).join("");
    tbody.innerHTML += `<tr style="border-top:2px solid var(--border)">
      <td colspan="4" style="font-weight:600;color:var(--accent)">${lang === "pl" ? "Łącznie" : "Total"}</td>
      <td class="stat-val" style="font-weight:700;font-size:1.1rem;color:var(--accent)">${gwHistory.reduce((s, g) => s + g.pts, 0)}</td>
      <td colspan="2"></td>
    </tr>`;

    const totalBenchLost = reserveLost.reduce((s, r) => s + r.benchPts, 0);
    const bestGw = gwHistory.reduce((best, g) => g.pts > best.pts ? g : best, gwHistory[0]);
    const worstGw = gwHistory.reduce((worst, g) => g.pts < worst.pts ? g : worst, gwHistory[0]);
    const captainBestCount = captainData.filter(c => c.wasCaptainBest).length;
    const captainTop3Count = captainData.filter(c => c.wasCaptainInTop3).length;

    document.getElementById("myteam-summary-cards").style.display = "";
    document.getElementById("myteam-summary-row").innerHTML = `
      <div class="leader-card"><h3 style="color:var(--accent)">📊 ${lang === "pl" ? "Podsumowanie" : "Summary"}</h3>
        <div class="leader-row"><span>${lang === "pl" ? "Sezony" : "Gameweeks"}</span><span style="margin-left:auto;font-weight:700">${gws.length}</span></div>
        <div class="leader-row"><span>${lang === "pl" ? "Łącznie pkt" : "Total pts"}</span><span style="margin-left:auto;font-weight:700;color:var(--accent)">${gwHistory.reduce((s, g) => s + g.pts, 0)}</span></div>
        <div class="leader-row"><span>${lang === "pl" ? "Średnia" : "Average"}</span><span style="margin-left:auto;font-weight:700">${(gwHistory.reduce((s, g) => s + g.pts, 0) / gws.length).toFixed(1)}</span></div>
        <div class="leader-row"><span>${lang === "pl" ? "Najlepszy GW" : "Best GW"}</span><span style="margin-left:auto;font-weight:700;color:var(--green)">GW${bestGw.gw}: ${bestGw.pts}</span></div>
        <div class="leader-row"><span>${lang === "pl" ? "Najgorszy GW" : "Worst GW"}</span><span style="margin-left:auto;font-weight:700;color:var(--red)">GW${worstGw.gw}: ${worstGw.pts}</span></div>
      </div>
      <div class="leader-card"><h3 style="color:var(--yellow)">🪑 ${lang === "pl" ? "Rezerwowi" : "Bench"}</h3>
        <div class="leader-row"><span>${lang === "pl" ? "Stracone pkt z ławki" : "Bench pts lost"}</span><span style="margin-left:auto;font-weight:700;color:var(--red)">${totalBenchLost}</span></div>
        <div class="leader-row"><span>${lang === "pl" ? "Średnio na kolejkę" : "Avg per GW"}</span><span style="margin-left:auto;font-weight:700">${(totalBenchLost / gws.length).toFixed(1)}</span></div>
      </div>
      <div class="leader-card"><h3 style="color:var(--green)">⭐ ${lang === "pl" ? "Kapitan" : "Captain"}</h3>
        <div class="leader-row"><span>${lang === "pl" ? "Najlepszy w teamie" : "Best in team"}</span><span style="margin-left:auto;font-weight:700;color:var(--green)">${captainBestCount}/${gws.length}</span></div>
        <div class="leader-row"><span>${lang === "pl" ? "W top 3" : "In top 3"}</span><span style="margin-left:auto;font-weight:700">${captainTop3Count}/${gws.length}</span></div>
      </div>`;

    document.getElementById("myteam-tabs").style.display = "";
    document.getElementById("myteam-loading").style.display = "none";
    showSection("myteam", "table");
    document.getElementById("myteam-overview-tab").style.display = "";
    ["reserves", "captains", "gwhistory"].forEach(k => {
      document.getElementById(`myteam-${k}-tab`).style.display = "none";
    });

    // === REZERWOwi TAB ===
    try {
    const worstBench = [...reserveLost].sort((a, b) => b.benchPts - a.benchPts).slice(0, 5);
    const avgBenchPts = gws.length > 0 ? (totalBenchLost / gws.length).toFixed(1) : "0";
    const maxBenchGW = reserveLost.length > 0 ? reserveLost.reduce((m, r) => r.benchPts > m.benchPts ? r : m, reserveLost[0]) : null;
    const benchZeroCount = reserveLost.filter(r => r.benchPts === 0).length;

    const benchTableRows = gws.map(gw => {
      const picksData = gwPicksData[gw];
      const picks = picksData.picks || [];
      const bench = picks.filter(p => p.position > 11);
      const starting = picks.filter(p => p.position <= 11);
      const benchInfo = bench.map(b => {
        const player = bootstrapData.elements.find(p => p.id === b.element);
        const pts = playerGwMap[b.element]?.[gw] || 0;
        const samePosStarters = starting.filter(s => {
          const sp = bootstrapData.elements.find(p => p.id === s.element);
          return sp && sp.element_type === player?.element_type;
        }).map(s => ({
          pts: playerGwMap[s.element]?.[gw] || 0,
          name: bootstrapData.elements.find(p => p.id === s.element)?.web_name || "?"
        }));
        const worstStarter = samePosStarters.length > 0 ? samePosStarters.reduce((w, s) => s.pts < w.pts ? s : w, samePosStarters[0]) : null;
        const opportunityGain = worstStarter ? Math.max(0, pts - worstStarter.pts) : 0;
        return { name: player?.web_name || "?", pts, opportunityGain, position: player?.element_type || 0 };
      });
      const totalBenchPts = benchInfo.reduce((s, b) => s + b.pts, 0);
      const totalOppGain = benchInfo.reduce((s, b) => s + b.opportunityGain, 0);
      return { gw, benchInfo, totalBenchPts, totalOppGain };
    });

    const totalOppGain = benchTableRows.reduce((s, r) => s + r.totalOppGain, 0);

    document.getElementById("myteam-reserves-tab").innerHTML = `
      <div style="padding:8px 16px;color:var(--text-dim);font-size:0.85rem;border-bottom:1px solid var(--border)">
        ${lang === "pl"
          ? "<b>Zysk (opp. gain)</b> — dodatkowe punkty, które zyskałbyś, zamieniając rezerwowego na najsłabszego startersa z tej samej pozycji. Np. jeśli rezerwowy DEF zdobył 6 pkt, a najsłabszy starterski DEF zdobył 2 pkt, zysk = 4 pkt."
          : "<b>Opp. gain</b> — extra points you'd gain by swapping a bench player for the weakest starter in the same position. E.g. if bench DEF scored 6 pts and weakest starting DEF scored 2 pts, gain = 4 pts."}
      </div>
      <h3 style="padding:12px 16px;color:var(--yellow)">${lang === "pl" ? "TOP 5 kolejek z największą stratą na ławce" : "TOP 5 worst bench losses"}</h3>
      ${worstBench.map(r => `<div class="leader-row" style="padding:8px 16px">
        <span style="font-weight:600;min-width:50px">GW${r.gw}</span>
        <span style="color:var(--red);font-weight:700;margin-left:8px">-${r.benchPts} pkt</span>
        <span style="color:var(--text-dim);font-size:0.82rem;margin-left:auto">${r.benchNames}</span>
      </div>`).join("")}

      <h3 style="padding:12px 16px;color:var(--green);margin-top:12px">${lang === "pl" ? "Podsumowanie ławki" : "Bench summary"}</h3>
      <div style="padding:8px 16px;display:flex;flex-wrap:wrap;gap:12px">
        <div class="leader-card" style="flex:1;min-width:140px"><h3 style="color:var(--red);font-size:0.9rem">${lang === "pl" ? "Stracone" : "Lost"}</h3>
          <div style="font-size:1.3rem;font-weight:700;color:var(--red)">${totalBenchLost} pkt</div>
          <div style="color:var(--text-dim);font-size:0.8rem">${avgBenchPts} pkt/kolejkę</div></div>
        <div class="leader-card" style="flex:1;min-width:140px"><h3 style="color:var(--yellow);font-size:0.9rem">${lang === "pl" ? "Możliwe zyski" : "Opportunity gain"}</h3>
          <div style="font-size:1.3rem;font-weight:700;color:var(--yellow)">${totalOppGain} pkt</div>
          <div style="color:var(--text-dim);font-size:0.8rem">${lang === "pl" ? "gdyby zmienić ławkę" : "if bench swapped"}</div></div>
        <div class="leader-card" style="flex:1;min-width:140px"><h3 style="color:var(--green);font-size:0.9rem">${lang === "pl" ? "Kolejki bez strat" : "Zero-loss GWs"}</h3>
          <div style="font-size:1.3rem;font-weight:700;color:var(--green)">${benchZeroCount}</div>
          <div style="color:var(--text-dim);font-size:0.8rem">${lang === "pl" ? `z ${gws.length} kolejek` : `of ${gws.length} GWs`}</div></div>
        <div class="leader-card" style="flex:1;min-width:140px"><h3 style="color:var(--accent);font-size:0.9rem">${lang === "pl" ? "Najgorszy GW" : "Worst GW"}</h3>
          <div style="font-size:1.3rem;font-weight:700;color:var(--accent)">${maxBenchGW ? "GW" + maxBenchGW.gw : "-"}</div>
          <div style="color:var(--text-dim);font-size:0.8rem">${maxBenchGW ? "-" + maxBenchGW.benchPts + " pkt" : ""}</div></div>
      </div>

      <h3 style="padding:12px 16px;color:var(--yellow);margin-top:12px">${lang === "pl" ? "Szczegóły ławki — kolejkę po kolei" : "Full bench breakdown — per gameweek"}</h3>
      <div style="overflow-x:auto">
      <table><thead><tr>
        <th>GW</th>
        <th>${lang === "pl" ? "Rezerwowi (nazwa, pkt)" : "Bench players (name, pts)"}</th>
        <th>${lang === "pl" ? "Ławka suma" : "Bench total"}</th>
        <th>${lang === "pl" ? "Zysk" : "Opp. gain"}</th>
      </tr></thead><tbody>
      ${benchTableRows.map(r => {
        const players = r.benchInfo.map(b => {
          const posName = getPositionShort(b.position);
          const ptsColor = b.pts >= 5 ? "var(--green)" : b.pts >= 2 ? "var(--yellow)" : b.pts > 0 ? "var(--text-dim)" : "var(--red)";
          const gainIcon = b.opportunityGain > 0 ? `<span style="color:var(--green);font-size:0.75rem"> (+${b.opportunityGain})</span>` : "";
          return `<span style="display:inline-block;margin-right:6px;font-size:0.82rem"><span class="pos-badge pos-${posName.toLowerCase()}" style="font-size:0.7rem">${posName}</span> <b>${b.name}</b> <span style="color:${ptsColor};font-weight:600">${b.pts}</span>${gainIcon}</span>`;
        }).join("");
        const benchColor = r.totalBenchPts >= 10 ? "var(--red)" : r.totalBenchPts >= 5 ? "var(--yellow)" : "var(--text-dim)";
        const gainColor = r.totalOppGain > 0 ? "var(--green)" : "var(--text-dim)";
        return `<tr>
          <td style="font-weight:600">${r.gw}</td>
          <td>${players || "<span style='color:var(--text-dim)'>-</span>"}</td>
          <td class="stat-val" style="color:${benchColor};font-weight:700">${r.totalBenchPts}</td>
          <td class="stat-val" style="color:${gainColor};font-weight:700">${r.totalOppGain > 0 ? "+" + r.totalOppGain : "-"}</td>
        </tr>`;
      }).join("")}
      </tbody></table>
      </div>
      <div style="padding:12px 16px;color:var(--text-dim);font-size:0.85rem;border-top:1px solid var(--border)">
        ${lang === "pl" ? `Łącznie stracono ${totalBenchLost} pkt wybierając skład zamiast rezerwowych. Możliwy dodatkowy zysk: ${totalOppGain} pkt` : `Total ${totalBenchLost} pts lost. Potential gain from swaps: ${totalOppGain} pts`}
      </div>`;
    } catch(e) { document.getElementById("myteam-reserves-tab").innerHTML = `<div style="padding:16px;color:var(--red)">Błąd ładowania rezerwowych: ${e.message}</div>`; }

    // === KAPITANOWIE TAB ===
    try {
    const vcData = [];
    for (const gw of gws) {
      const picksData = gwPicksData[gw];
      const picks = picksData.picks || [];
      const vc = picks.find(p => p.is_vice_captain);
      if (vc) {
        const vcPlayer = bootstrapData.elements.find(p => p.id === vc.element);
        const vcPts = playerGwMap[vc.element]?.[gw] || 0;
        const cap = picks.find(p => p.is_captain);
        const capPts = cap ? (playerGwMap[cap.element]?.[gw] || 0) : 0;
        vcData.push({ gw, vcName: vcPlayer?.web_name || "?", vcPts, capPts, vcBetter: vcPts > capPts });
      }
    }
    const vcBetterCount = vcData.filter(v => v.vcBetter).length;
    const vcAvgPts = vcData.length > 0 ? (vcData.reduce((s, v) => s + v.vcPts, 0) / vcData.length).toFixed(1) : "0";
    const capAvgPts = captainData.length > 0 ? (captainData.reduce((s, c) => s + c.captainActualPts, 0) / captainData.length).toFixed(1) : "0";
    const capEfficiency = captainData.length > 0 ? (captainData.reduce((s, c) => s + parseInt(c.efficiency || 0), 0) / captainData.length).toFixed(0) : "0";
    const missedPicks = captainData.filter(c => !c.wasCaptainBest).sort((a, b) => b.bestPlayerPts - a.captainPts);
    const worstMiss = missedPicks.length > 0 ? missedPicks[0] : null;

    document.getElementById("myteam-captains-tab").innerHTML = `
      <div style="padding:8px 16px;color:var(--text-dim);font-size:0.85rem;border-bottom:1px solid var(--border)">
        ${lang === "pl"
          ? "<b>Strata</b> — ile punktów straciłeś wybierając C zamiast najlepszego zawodnika (2× punkty najlepszego − punkty kapitana). <b>Status C</b> = kapitan był najlepszym wyborem, <b>Top3</b> = w top 3, <b>X</b> = gorszy wybór."
          : "<b>Loss</b> — points lost by picking C instead of best player (2× best pts − captain pts). <b>Status C</b> = captain was best pick, <b>Top3</b> = in top 3, <b>X</b> = worse pick."}
      </div>
      <h3 style="padding:12px 16px;color:var(--green)">${lang === "pl" ? "Podsumowanie kapitanów" : "Captain summary"}</h3>
      <div style="padding:8px 16px;display:flex;flex-wrap:wrap;gap:12px">
        <div class="leader-card" style="flex:1;min-width:140px"><h3 style="color:var(--green);font-size:0.9rem">${lang === "pl" ? "Najlepszy wybór" : "Best pick"}</h3>
          <div style="font-size:1.3rem;font-weight:700;color:var(--green)">${captainBestCount}/${gws.length}</div>
          <div style="color:var(--text-dim);font-size:0.8rem">${((captainBestCount / gws.length) * 100).toFixed(0)}% ${lang === "pl" ? "kolejek" : "GWs"}</div></div>
        <div class="leader-card" style="flex:1;min-width:140px"><h3 style="color:var(--yellow);font-size:0.9rem">${lang === "pl" ? "W top 3" : "In top 3"}</h3>
          <div style="font-size:1.3rem;font-weight:700;color:var(--yellow)">${captainTop3Count}/${gws.length}</div>
          <div style="color:var(--text-dim);font-size:0.8rem">${((captainTop3Count / gws.length) * 100).toFixed(0)}%</div></div>
        <div class="leader-card" style="flex:1;min-width:140px"><h3 style="color:var(--accent);font-size:0.9rem">${lang === "pl" ? "Skuteczność" : "Efficiency"}</h3>
          <div style="font-size:1.3rem;font-weight:700;color:var(--accent)">${capEfficiency}%</div>
          <div style="color:var(--text-dim);font-size:0.8rem">${lang === "pl" ? "vs max możliwe" : "vs max possible"}</div></div>
        <div class="leader-card" style="flex:1;min-width:140px"><h3 style="color:var(--accent);font-size:0.9rem">${lang === "pl" ? "Średnia C" : "Avg C pts"}</h3>
          <div style="font-size:1.3rem;font-weight:700;color:var(--accent)">${capAvgPts}</div>
          <div style="color:var(--text-dim);font-size:0.8rem">${lang === "pl" ? "pkt/kolejkę" : "pts/GW"}</div></div>
      </div>

      <h3 style="padding:12px 16px;color:var(--green);margin-top:12px">${lang === "pl" ? "Analiza kapitanów kolejkę po kolei" : "Captain analysis per gameweek"}</h3>
      <div style="overflow-x:auto">
      <table><thead><tr>
        <th>GW</th><th>${lang === "pl" ? "Kapitan" : "Captain"}</th>
        <th>${lang === "pl" ? "Pkt C" : "C pts"}</th>
        <th>${lang === "pl" ? "Najlepszy w teamie" : "Best in team"}</th>
        <th>${lang === "pl" ? "Pkt najlepszego" : "Best pts"}</th>
        <th>${lang === "pl" ? "Strata" : "Loss"}</th>
        <th>${lang === "pl" ? "Status" : "Status"}</th>
      </tr></thead><tbody>
      ${captainData.map(c => {
        const statusColor = c.wasCaptainBest ? "var(--green)" : c.wasCaptainInTop3 ? "var(--yellow)" : "var(--red)";
        const statusText = c.wasCaptainBest ? "C" : c.wasCaptainInTop3 ? "Top3" : "X";
        const loss = c.wasCaptainBest ? 0 : (c.bestPlayerPts * 2 - c.captainPts);
        const lossText = loss > 0 ? `<span style="color:var(--red)">-${loss}</span>` : `<span style="color:var(--green)">0</span>`;
        return `<tr>
          <td style="font-weight:600">${c.gw}</td>
          <td><b>${c.captainName}</b> (C)</td>
          <td class="stat-val">${c.captainPts}</td>
          <td>${c.bestPlayerName}</td>
          <td class="stat-val">${c.bestPlayerPts}</td>
          <td class="stat-val">${lossText}</td>
          <td style="color:${statusColor};font-weight:600">${statusText}</td>
        </tr>`;
      }).join("")}
      </tbody></table>
      </div>

      <h3 style="padding:12px 16px;color:var(--accent);margin-top:12px">${lang === "pl" ? "Vice-Kapitan — analiza" : "Vice-Captain analysis"}</h3>
      <div style="overflow-x:auto">
      <table><thead><tr>
        <th>GW</th>
        <th>${lang === "pl" ? "Vice-Kapitan" : "Vice-Captain"}</th>
        <th>${lang === "pl" ? "Pkt VC" : "VC pts"}</th>
        <th>${lang === "pl" ? "Pkt C" : "C pts"}</th>
        <th>${lang === "pl" ? "Lepszy?" : "Better?"}</th>
      </tr></thead><tbody>
      ${vcData.map(v => {
        const color = v.vcBetter ? "var(--green)" : "var(--text-dim)";
        return `<tr>
          <td style="font-weight:600">${v.gw}</td>
          <td><b>${v.vcName}</b> (VC)</td>
          <td class="stat-val" style="color:${color}">${v.vcPts}</td>
          <td>${v.capPts}</td>
          <td style="color:${v.vcBetter ? 'var(--green)' : 'var(--red)'};font-weight:600">${v.vcBetter ? "+" : "X"}</td>
        </tr>`;
      }).join("")}
      </tbody></table>
      </div>
      <div style="padding:12px 16px;color:var(--text-dim);font-size:0.85rem;border-top:1px solid var(--border)">
        ${lang === "pl"
          ? `VC byłby lepszy od C w ${vcBetterCount} z ${vcData.length} kolejek. Średnia VC: ${vcAvgPts} pkt, Średnia C: ${capAvgPts} pkt`
          : `VC would have been better in ${vcBetterCount} of ${vcData.length} GWs. Avg VC: ${vcAvgPts} pts, Avg C: ${capAvgPts} pts`}
      </div>

      ${worstMiss ? `<div style="padding:12px 16px;border-top:1px solid var(--border)">
        <span style="color:var(--red);font-weight:600">${lang === "pl" ? "Najgorszy wybór C" : "Worst captain pick"}:</span>
        <span style="color:var(--text-dim)"> GW${worstMiss.gw} — ${worstMiss.captainName} (${worstMiss.captainPts} pkt) vs ${worstMiss.bestPlayerName} (${worstMiss.bestPlayerPts} pkt, strata ${worstMiss.bestPlayerPts * 2 - worstMiss.captainPts} pkt)</span>
      </div>` : ""}

      <h3 style="padding:12px 16px;color:var(--green);margin-top:12px;border-top:1px solid var(--border)">${lang === "pl" ? "Najlepszy zawodnik w każdym GW" : "Best player in each GW"}</h3>
      <div style="padding:8px 16px;color:var(--text-dim);font-size:0.85rem">
        ${lang === "pl" ? "Zawodnik z najwyższym wynikiem punktowym w Twoim składzie (niezależnie od roli C/VC):" : "Player with the highest point score in your squad (regardless of C/VC role):"}
      </div>
      <div style="overflow-x:auto">
      <table><thead><tr>
        <th>GW</th>
        <th>${lang === "pl" ? "Najlepszy zawodnik" : "Best player"}</th>
        <th>${lang === "pl" ? "Drużyna" : "Team"}</th>
        <th>${lang === "pl" ? "Pozycja" : "Position"}</th>
        <th>${lang === "pl" ? "Punkty" : "Points"}</th>
        <th>${lang === "pl" ? "Był kapitanem?" : "Was captain?"}</th>
      </tr></thead><tbody>
      ${captainData.map(c => {
        const wasC = c.wasCaptainBest;
        const wasVC = vcData.find(v => v.gw === c.gw && v.vcBetter && v.vcPts === c.bestPlayerPts);
        const markerColor = wasC ? "var(--green)" : wasVC ? "var(--yellow)" : "var(--text-dim)";
        const markerText = wasC ? "C" : wasVC ? "VC" : "—";
        return `<tr>
          <td style="font-weight:600">${c.gw}</td>
          <td><b>${c.bestPlayerName}</b></td>
          <td>${bootstrapData.teams?.find(t => t.id === (bootstrapData.elements.find(p => p.id === c.bestPlayerId)?.team))?.short_name || ""}</td>
          <td>${getPositionShort(bootstrapData.elements.find(p => p.id === c.bestPlayerId)?.element_type || 0)}</td>
          <td class="stat-val" style="color:var(--green);font-weight:700">${c.bestPlayerPts}</td>
          <td style="color:${markerColor};font-weight:600">${markerText}</td>
        </tr>`;
      }).join("")}
      </tbody></table>
      </div>`;
    } catch(e) { document.getElementById("myteam-captains-tab").innerHTML = `<div style="padding:16px;color:var(--red)">Błąd ładowania kapitanów: ${e.message}</div>`; }

    // === GW HISTORY TAB ===
    try {
    document.getElementById("myteam-gwhistory-tab").innerHTML = `
      <h3 style="padding:12px 16px">${lang === "pl" ? "Historia punktów w kolejce" : "Gameweek history"}</h3>
      <table><thead><tr>
        <th>GW</th>
        <th>${lang === "pl" ? "Punkty" : "Points"}</th>
        <th>${lang === "pl" ? "Ławka" : "Bench"}</th>
        <th>${lang === "pl" ? "Razem" : "Total"}</th>
        <th>${lang === "pl" ? "Kapitan" : "Captain"}</th>
      </tr></thead><tbody>
      ${gwHistory.map(g => {
        const cap = captainData.find(c => c.gw === g.gw);
        return `<tr>
          <td><b>GW${g.gw}</b></td>
          <td class="stat-val" style="color:var(--accent);font-weight:700">${g.pts}</td>
          <td class="stat-val" style="color:var(--red)">${g.benchPts}</td>
          <td class="stat-val">${g.total}</td>
          <td>${cap ? cap.captainName : "-"} (${cap ? cap.captainPts : 0})</td>
        </tr>`;
      }).join("")}
      </tbody></table>`;
    } catch(e) { document.getElementById("myteam-gwhistory-tab").innerHTML = `<div style="padding:16px;color:var(--red)">Błąd ładowania historii: ${e.message}</div>`; }
  } catch (err) {
    document.getElementById("myteam-body").innerHTML =
      `<tr><td colspan="7"><div class="error-msg">${t("common.error")}: ${err.message}</div></td></tr>`;
    showSection("myteam", "table");
  }
}

async function renderManagerSeasons(managerId) {
  const container = document.getElementById("myteam-seasons");
  if (!container) return;
  container.innerHTML = `<div style="padding:16px;color:var(--text-dim)">${t("myTeam.loadingSeasons")}</div>`;
  try {
    const hist = await getManagerHistory(managerId);
    const past = (hist.past || []).slice().sort((a, b) => String(b.season_name).localeCompare(String(a.season_name)));
    const currentHistory = hist.history || [];
    const rows = [];
    if (currentHistory && currentHistory.length) {
      const last = currentHistory[currentHistory.length - 1];
      const curName = (hist.current && hist.current.season_name) ? hist.current.season_name : (last.season_name || "");
      rows.push({
        name: curName,
        points: last.total_points,
        rank: last.rank,
        current: true
      });
    }
    past.forEach(p => rows.push({
      name: p.season_name,
      points: p.total_points,
      rank: p.rank
    }));

    if (!rows.length) {
      container.innerHTML = `<div style="padding:16px;color:var(--text-dim)">${t("myTeam.noSeasons")}</div>`;
      return;
    }

    const pointsSeries = rows.map(r => r.points);
    const maxPts = Math.max(...pointsSeries, 1);

    container.innerHTML = `
      <div style="padding:4px 16px">
        <table><thead><tr>
          <th>${t("myTeam.seasonCol")}</th>
          <th>${t("myTeam.ptsCol")}</th>
          <th>${t("myTeam.rankCol")}</th>
          <th>${t("myTeam.trendCol")}</th>
        </tr></thead><tbody>
        ${rows.map((r, i) => `<tr>
          <td style="font-weight:600">${r.name}${r.current ? " (" + t("myTeam.current") + ")" : ""}</td>
          <td class="stat-val" style="color:var(--accent);font-weight:700">${r.points}</td>
          <td>#${r.rank}</td>
          <td>${seasonTrend(pointsSeries, i, maxPts)}</td>
        </tr>`).join("")}
        </tbody></table>
      </div>`;
  } catch (e) {
    container.innerHTML = `<div style="padding:16px;color:var(--red)">${t("common.error")}: ${e.message}</div>`;
  }
}

function seasonTrend(series, idx, maxPts) {
  if (!series || series.length === 0) return "";
  const w = 200, h = 34, pad = 4;
  const min = Math.min(...series), max = Math.max(...series);
  const range = max - min || 1;
  const pts = series.map((v, i) => {
    const x = pad + (series.length === 1 ? w / 2 : (i / (series.length - 1)) * (w - 2 * pad));
    const y = h - pad - ((v - min) / range) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const lx = pad + (series.length === 1 ? w / 2 : (idx / (series.length - 1)) * (w - 2 * pad));
  const ly = h - pad - ((series[idx] - min) / range) * (h - 2 * pad);
  const barW = Math.max(2, (series[idx] / maxPts) * (w - 2 * pad));
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="vertical-align:middle">
    <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="var(--border)" stroke-width="1"/>
    <rect x="${pad}" y="${h - pad - 3}" width="${barW.toFixed(1)}" height="3" fill="var(--accent)" opacity="0.4"/>
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.5"/>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3" fill="#fff" stroke="var(--accent)" stroke-width="2"/>
  </svg>`;
}

// ===================== LEADER =====================

async function runLeader() {
  if (!bootstrapData) return;
  const leagueId = document.getElementById("leader-id").value;
  if (!leagueId) return;

  showSection("leader", "loading");

  try {
    const standings = await getLeagueStandings(leagueId);
    const results = standings.league?.standings?.results;
    if (!results || results.length === 0) throw new Error("Liga nie istnieje lub nie jest publiczna");

    const leader = results[0];
    const currentGW = bootstrapData.events?.find((e) => e.is_current)?.id || 38;
    const leaderPicksData = await getManagerPicks(leader.entry, currentGW);
    const leaderPicks = leaderPicksData.picks || [];

    const resultDiv = document.getElementById("leader-result");
    resultDiv.innerHTML = `
      <div style="padding:16px">
        <h3 style="margin-bottom:8px">${leader.entry_name || "Leader"} (${leader.player_name || ""})</h3>
        <p style="color:var(--text-dim);margin-bottom:16px">${t("leader.title")}: ${leader.total || 0} pkt</p>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>${t("ketchup.webName")}</th>
              <th>${t("ketchup.team")}</th>
              <th>${t("ketchup.position")}</th>
              <th>${t("ketchup.price")}</th>
              <th>${t("ketchup.totalPts")}</th>
            </tr>
          </thead>
          <tbody>
            ${leaderPicks.map((pick, i) => {
              const player = bootstrapData.elements.find((p) => p.id === pick.element);
              if (!player) return "";
              const color = TEAM_COLORS[player.team] || "#555";
              const posClass = `pos-${getPositionShort(player.element_type).toLowerCase()}`;
              const captain = pick.is_captain ? " (C)" : pick.is_vice_captain ? " (VC)" : "";
              return `<tr>
                <td class="rank-num">${i + 1}</td>
                <td>${player.web_name}${captain}</td>
                <td><span class="team-color" style="background:${color}"></span>${getTeamName(player.team)}</td>
                <td><span class="pos-badge ${posClass}">${getPositionShort(player.element_type)}</span></td>
                <td class="stat-val">${(player.now_cost / 10).toFixed(1)}</td>
                <td class="stat-val">${player.total_points}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;

    showSection("leader", "result");
    resultDiv.style.display = "";
    document.getElementById("leader-placeholder").style.display = "none";
  } catch (err) {
    document.getElementById("leader-result").innerHTML =
      `<div class="error-msg">${t("common.error")}: ${err.message}</div>`;
    showSection("leader", "result");
    document.getElementById("leader-result").style.display = "";
    document.getElementById("leader-placeholder").style.display = "none";
  }
}

// ===================== NA START =====================

function renderNaStart() {
  if (!bootstrapData) return;
  const lang = getLang();
  const players = bootstrapData.elements
    .filter((p) => p.now_cost > 0)
    .map((p) => ({
      ...p,
      ptsPerCost: p.now_cost > 0 ? +(p.total_points / (p.now_cost / 10)).toFixed(2) : 0,
    }));

  const dir = naStartSort.dir === "desc" ? -1 : 1;
  players.sort((a, b) => {
    const av = a[naStartSort.field] ?? 0;
    const bv = b[naStartSort.field] ?? 0;
    if (typeof av === "string") return dir * av.localeCompare(bv);
    return (bv - av) * dir;
  });

  const tbody = document.getElementById("nastart-body");
  if (!tbody) return;
  tbody.innerHTML = players.slice(0, 50).map((p, i) => {
    const color = TEAM_COLORS[p.team] || "#555";
    const posClass = `pos-${getPositionShort(p.element_type).toLowerCase()}`;
    return `<tr>
      <td class="rank-num">${i + 1}</td>
      <td>${p.web_name}</td>
      <td><span class="team-color" style="background:${color}"></span>${getTeamName(p.team)}</td>
      <td><span class="pos-badge ${posClass}">${getPositionShort(p.element_type)}</span></td>
      <td class="stat-val">${(p.now_cost / 10).toFixed(1)}</td>
      <td class="stat-val">${p.total_points}</td>
      <td class="stat-val" style="color:var(--accent)">${p.ptsPerCost}</td>
    </tr>`;
  }).join("");
}

// ===================== PRICE HISTORY =====================

let priceHistorySelectedId = null;

function initPriceHistorySearch() {
  const input = document.getElementById("pricehistory-search");
  const results = document.getElementById("pricehistory-results");

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 1) { results.classList.remove("open"); return; }
    renderPriceHistoryResults(q);
  });

  results.addEventListener("click", (e) => {
    const item = e.target.closest(".player-result-item");
    if (item) {
      priceHistorySelectedId = parseInt(item.dataset.id);
      input.value = item.textContent.trim();
      results.classList.remove("open");
      runPriceHistory();
    }
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".player-search")) results.classList.remove("open");
  });

  input.addEventListener("focus", () => {
    if (input.value.length >= 1) renderPriceHistoryResults(input.value.trim().toLowerCase());
  });

  document.getElementById("pricehistory-season").addEventListener("change", () => {
    if (priceHistorySelectedId) runPriceHistory();
  });
}

function renderPriceHistoryResults(q) {
  const results = document.getElementById("pricehistory-results");
  if (!bootstrapData) return;
  const matches = bootstrapData.elements
    .filter((p) => p.web_name.toLowerCase().includes(q))
    .slice(0, 15);
  if (matches.length === 0) { results.classList.remove("open"); return; }
  results.innerHTML = matches.map((p) => {
    const team = getTeamName(p.team);
    const pos = getPositionShort(p.element_type);
    const color = TEAM_COLORS[p.team] || "#555";
    return `<div class="player-result-item" data-id="${p.id}">
      <span class="team-color" style="background:${color}"></span>
      ${p.web_name} <span style="color:var(--text-dim);font-size:0.8rem">${team} · ${pos}</span>
    </div>`;
  }).join("");
  results.classList.add("open");
}

async function runPriceHistory() {
  if (!priceHistorySelectedId) return;
  const season = document.getElementById("pricehistory-season").value;
  const lang = getLang();

  showSection("pricehistory", "loading");
  document.getElementById("pricehistory-chart-wrap").style.display = "none";

  try {
    if (season === "all") {
      await runPriceHistoryMultiSeason();
    } else if (season === "current") {
      const summary = await cachedPlayerSummary(priceHistorySelectedId);
      const history = summary.history || [];
      if (history.length === 0) {
        const phSeason = seasonShort(detectSeason(bootstrapData));
        document.getElementById("pricehistory-placeholder").innerHTML = `
          <div class="placeholder-icon">📭</div>
          <div>${lang === "pl" ? `Brak danych dla bieżącego sezonu ${phSeason}` : `No data for the current ${phSeason} season`}</div>
          <div style="color:var(--text-dim);font-size:0.85rem;margin-top:4px">${lang === "pl" ? `Sezon jeszcze się nie rozpoczął. Wybierz sezon archiwalny (np. ${prevSeasonShort(detectSeason(bootstrapData))}) z listy powyżej.` : `The season hasn't started yet. Pick an archived season (e.g. ${prevSeasonShort(detectSeason(bootstrapData))}) from the list above.`}</div>`;
        showSection("pricehistory", "placeholder");
        return;
      }
      renderPriceHistoryChartCurrent(history, priceHistorySelectedId);
    } else {
      const player = bootstrapData.elements.find(p => p.id === priceHistorySelectedId);
      const allGWData = [];
      for (let batch = 0; batch < 8; batch++) {
        const promises = [];
        for (let b = 0; b < 5; b++) {
          const gw = batch * 5 + b + 1;
          if (gw > 38) break;
          promises.push(
            fetchVaastavGW(season, gw).then(csv => {
              const match = findVaastavRow(csv, player);
              if (match) return { gw, value: parseInt(match.value) || 0, points: parseInt(match.total_points) || 0 };
              return null;
            }).catch(() => null)
          );
        }
        const results = await Promise.all(promises);
        for (const r of results) { if (r) allGWData.push(r); }
      }
      if (allGWData.length === 0) { showSection("pricehistory", "placeholder"); return; }
      renderPriceHistoryChartCSV(allGWData, player, season);
    }
    document.getElementById("pricehistory-loading").style.display = "none";
    document.getElementById("pricehistory-placeholder").style.display = "none";
    document.getElementById("pricehistory-chart-wrap").style.display = "";
  } catch {
    showSection("pricehistory", "placeholder");
    document.getElementById("pricehistory-chart-wrap").style.display = "none";
  }
}

async function runPriceHistoryMultiSeason() {
  const player = bootstrapData.elements.find(p => p.id === priceHistorySelectedId);
  if (!player) return;
  const lang = getLang();
  const color = TEAM_COLORS[player.team] || "#555";
  const seasons = ["current", "2024-25", "2023-24", "2022-23", "2021-22"];
  const seasonColors = ["#3b82f6", "#22c55e", "#ef4444", "#eab308", "#a855f7"];
  const allSeasonData = [];

  document.getElementById("pricehistory-player-info").innerHTML = `
    <span class="team-color" style="background:${color};width:6px;height:28px;border-radius:3px;display:inline-block"></span>
    <span class="player-name">${player.web_name}</span>
    <span class="player-team">${getTeamName(player.team)}</span>
    <span class="pos-badge pos-${getPositionShort(player.element_type).toLowerCase()}">${getPositionShort(player.element_type)}</span>
    <span style="color:var(--text-dim);font-size:0.85rem">${lang === "pl" ? "Wszystkie sezony" : "All seasons"}</span>
  `;

  for (let si = 0; si < seasons.length; si++) {
    const s = seasons[si];
    try {
      if (s === "current") {
        const summary = await cachedPlayerSummary(priceHistorySelectedId);
        const history = summary.history || [];
        if (history.length > 0) {
          allSeasonData.push({
            season: lang === "pl" ? `Bieżący (${seasonShort(detectSeason(bootstrapData))})` : `Current (${seasonShort(detectSeason(bootstrapData))})`,
            color: seasonColors[si],
            data: history.map(h => ({ gw: h.round, value: (h.value || 0) / 10 }))
          });
        }
      } else {
        const gwData = [];
        for (let batch = 0; batch < 8; batch++) {
          const promises = [];
          for (let b = 0; b < 5; b++) {
            const gw = batch * 5 + b + 1;
            if (gw > 38) break;
            promises.push(
              fetchVaastavGW(s, gw).then(csv => {
                const match = findVaastavRow(csv, player);
                return match ? { gw, value: (parseInt(match.value) || 0) / 10 } : null;
              }).catch(() => null)
            );
          }
          const results = await Promise.all(promises);
          for (const r of results) { if (r) gwData.push(r); }
        }
        if (gwData.length > 0) {
          const label = s.replace("20", "");
          allSeasonData.push({
            season: lang === "pl" ? label.replace("-", "/") : label.replace("-", "/"),
            color: seasonColors[si],
            data: gwData.sort((a, b) => a.gw - b.gw)
          });
        }
      }
    } catch {}
  }

  if (allSeasonData.length === 0) return;

  const svgW = 800, svgH = 380;
  const pad = { top: 30, right: 20, bottom: 40, left: 55 };
  const chartW = svgW - pad.left - pad.right;
  const chartH = svgH - pad.top - pad.bottom;

  let allPrices = [];
  for (const sd of allSeasonData) allPrices.push(...sd.data.map(d => d.value));
  const minP = Math.min(...allPrices);
  const maxP = Math.max(...allPrices);
  const range = maxP - minP || 1;

  let paths = "";
  allSeasonData.forEach((sd, si) => {
    let d = "";
    const pts = [];
    sd.data.forEach((pt, i) => {
      const x = pad.left + ((pt.gw - 1) / 37) * chartW;
      const y = pad.top + chartH - ((pt.value - minP) / range) * chartH * 0.85 - chartH * 0.05;
      d += (i === 0 ? "M" : "L") + ` ${x} ${y}`;
      pts.push({ x, y, gw: pt.gw, value: pt.value });
    });
    const ttHtml = pts.map(pt => `<span class="tt-dim">GW${pt.gw}:</span> <span class="tt-val">${pt.value.toFixed(1)}m</span>`).join("<br>");
    const tooltipHtml = `<div class="tt-name" style="color:${sd.color}">${sd.season}</div>${ttHtml}`;
    paths += `<path class="chart-line" data-pi="${si}" d="${d}" fill="none" stroke="${sd.color}" stroke-width="2.5" opacity="0.85"/>`;
    paths += `<path class="chart-hover-line" data-pi="${si}" d="${d}" stroke-width="18"
      onmouseenter="window._chartTT.show(event, this.getAttribute('data-tt'), ${si})"
      onmouseleave="window._chartTT.hide()" data-tt="${tooltipHtml.replace(/"/g, '&quot;')}"/>`;
    pts.forEach(pt => {
      paths += `<circle class="chart-dot" data-pi="${si}" cx="${pt.x}" cy="${pt.y}" r="3" fill="${sd.color}" stroke="#0f172a" stroke-width="1.5"/>`;
      const ptTt = `<div class='tt-name' style='color:${sd.color}'>${sd.season}</div><span class='tt-dim'>GW${pt.gw}:</span> <span class='tt-val'>${pt.value.toFixed(1)}m</span>`;
      paths += `<circle class="chart-hover-dot" data-pi="${si}" cx="${pt.x}" cy="${pt.y}"
        onmouseenter="window._chartTT.show(event, this.getAttribute('data-tt'), ${si})"
        onmouseleave="window._chartTT.hide()" data-tt="${ptTt.replace(/"/g, '&quot;')}"/>`;
    });
  });

  let yTicks = "";
  for (let i = 0; i <= 5; i++) {
    const val = minP + (range / 5) * i;
    const y = pad.top + chartH - (chartH / 5) * i * 0.85 - chartH * 0.05 * (i / 5);
    yTicks += `<text class="chart-label" x="${pad.left - 6}" y="${y + 3}" text-anchor="end" font-size="10">${val.toFixed(1)}m</text>`;
  }

  document.getElementById("pricehistory-chart").innerHTML = `
    <svg class="chart-svg" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
      <line class="chart-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + chartH}"/>
      <line class="chart-axis" x1="${pad.left}" y1="${pad.top + chartH}" x2="${pad.left + chartW}" y2="${pad.top + chartH}"/>
      ${yTicks}${paths}
    </svg>`;

  renderPriceHistoryMovers();
}

async function renderPriceHistoryMovers() {
  if (!bootstrapData) return;
  const lang = getLang();
  const moversEl = document.getElementById("pricehistory-movers");
  const rowEl = document.getElementById("pricehistory-movers-row");
  if (!moversEl || !rowEl) return;

  const summary = await cachedPlayerSummary(priceHistorySelectedId).catch(() => null);
  const currentSummary = summary?.history || [];
  if (currentSummary.length < 2) { moversEl.style.display = "none"; return; }

  const startPrice = currentSummary[0].value || 0;
  const player = bootstrapData.elements.find(p => p.id === priceHistorySelectedId);
  if (!player) return;

  const color = TEAM_COLORS[player.team] || "#555";
  const endPrice = currentSummary[currentSummary.length - 1].value || 0;
  const diff = endPrice - startPrice;

  moversEl.style.display = "";
  rowEl.innerHTML = `<div class="leader-card">
    <h3 style="color:${diff >= 0 ? 'var(--green)' : 'var(--red)'}">${diff >= 0 ? '📈' : '📉'} ${lang === "pl" ? "Zmiana ceny" : "Price change"}</h3>
    <div class="leader-row"><span>${lang === "pl" ? "Cena startowa" : "Start price"}</span><span style="margin-left:auto;font-weight:700">${(startPrice / 10).toFixed(1)}m</span></div>
    <div class="leader-row"><span>${lang === "pl" ? "Cena końcowa" : "End price"}</span><span style="margin-left:auto;font-weight:700">${(endPrice / 10).toFixed(1)}m</span></div>
    <div class="leader-row"><span>${lang === "pl" ? "Zmiana" : "Change"}</span><span style="margin-left:auto;font-weight:700;color:${diff >= 0 ? 'var(--green)' : 'var(--red)'}">${diff >= 0 ? '+' : ''}${(diff / 10).toFixed(1)}m</span></div>
  </div>`;
}

function renderPriceHistoryChartHistory(history, playerId) {
  const player = bootstrapData.elements.find((p) => p.id === playerId);
  if (!player) return;
  const lang = getLang();
  const color = TEAM_COLORS[player.team] || "#555";
  const posClass = `pos-${getPositionShort(player.element_type).toLowerCase()}`;

  document.getElementById("pricehistory-player-info").innerHTML = `
    <span class="team-color" style="background:${color};width:6px;height:28px;border-radius:3px;display:inline-block"></span>
    <span class="player-name">${player.web_name}</span>
    <span class="player-team">${getTeamName(player.team)}</span>
    <span class="pos-badge ${posClass}">${getPositionShort(player.element_type)}</span>
  `;

  const prices = history.map((h) => (h.value || 0) / 10);
  const rounds = history.map((h) => h.round);
  if (prices.length === 0) return;

  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = maxP - minP || 1;

  const svgW = 800, svgH = 300;
  const pad = { top: 30, right: 20, bottom: 40, left: 55 };
  const chartW = svgW - pad.left - pad.right;
  const chartH = svgH - pad.top - pad.bottom;

  let path = "";
  let dots = "";
  let xLabels = "";

  prices.forEach((p, i) => {
    const x = pad.left + (i / Math.max(prices.length - 1, 1)) * chartW;
    const y = pad.top + chartH - ((p - minP) / range) * chartH * 0.85 - chartH * 0.05;
    if (i === 0) path = `M ${x} ${y}`;
    else path += ` L ${x} ${y}`;
    const ttHtml = `<div class="tt-name">${player.web_name}</div><span class="tt-dim">GW${rounds[i]}:</span> <span class="tt-val">${p.toFixed(1)}m</span>`;
    dots += `<circle cx="${x}" cy="${y}" r="3.5" fill="${color}" stroke="var(--bg-card)" stroke-width="2"
      onmouseenter="window._chartTT.show(event, this.getAttribute('data-tt'))"
      onmouseleave="window._chartTT.hide()" data-tt="${ttHtml.replace(/"/g, '&quot;')}"/>`;
    dots += `<circle class="chart-hover-dot" cx="${x}" cy="${y}"
      onmouseenter="window._chartTT.show(event, this.getAttribute('data-tt'))"
      onmouseleave="window._chartTT.hide()" data-tt="${ttHtml.replace(/"/g, '&quot;')}"/>`;
    if (prices.length <= 20 || i % Math.ceil(prices.length / 20) === 0) {
      xLabels += `<text class="chart-label" x="${x}" y="${pad.top + chartH + 18}" text-anchor="middle" font-size="10">${rounds[i]}</text>`;
    }
  });

  // Y axis ticks
  let yTicks = "";
  const ySteps = 5;
  for (let i = 0; i <= ySteps; i++) {
    const val = minP + (range / ySteps) * i;
    const y = pad.top + chartH - (chartH / ySteps) * i * 0.85 - chartH * 0.05 * (i / ySteps);
    yTicks += `<text class="chart-label" x="${pad.left - 6}" y="${y + 3}" text-anchor="end" font-size="10">${val.toFixed(1)}m</text>`;
    yTicks += `<line class="chart-grid" x1="${pad.left}" y1="${y}" x2="${pad.left + chartW}" y2="${y}"/>`;
  }

  const startP = prices[0];
  const endP = prices[prices.length - 1];
  const diffP = endP - startP;
  const diffColor = diffP >= 0 ? "var(--green)" : "var(--red)";

  const sumEl = document.getElementById("pricehistory-chart");
  sumEl.innerHTML = `
    <svg class="chart-svg" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <line class="chart-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + chartH}"/>
      <line class="chart-axis" x1="${pad.left}" y1="${pad.top + chartH}" x2="${pad.left + chartW}" y2="${pad.top + chartH}"/>
      ${yTicks}
      <path d="${path} L ${pad.left + chartW} ${pad.top + chartH} L ${pad.left} ${pad.top + chartH} Z" fill="url(#priceGrad)"/>
      <path class="chart-line" d="${path}" stroke="${color}"/>
      ${dots}
      ${xLabels}
    </svg>
    <div class="ketchup-summary" style="margin-top:12px">
      <div class="ketchup-stat">
        <div class="ketchup-stat-val" style="color:var(--accent)">${startP.toFixed(1)}m</div>
        <div class="ketchup-stat-label">${lang === "pl" ? "Cena startowa" : "Start price"}</div>
      </div>
      <div class="ketchup-stat">
        <div class="ketchup-stat-val" style="color:var(--accent)">${endP.toFixed(1)}m</div>
        <div class="ketchup-stat-label">${lang === "pl" ? "Cena końcowa" : "End price"}</div>
      </div>
      <div class="ketchup-stat">
        <div class="ketchup-stat-val" style="color:${diffColor}">${diffP >= 0 ? '+' : ''}${diffP.toFixed(1)}m</div>
        <div class="ketchup-stat-label">${lang === "pl" ? "Zmiana" : "Change"}</div>
      </div>
      <div class="ketchup-stat">
        <div class="ketchup-stat-val">${maxP.toFixed(1)}m</div>
        <div class="ketchup-stat-label">${lang === "pl" ? "Max" : "Max"}</div>
      </div>
      <div class="ketchup-stat">
        <div class="ketchup-stat-val">${minP.toFixed(1)}m</div>
        <div class="ketchup-stat-label">${lang === "pl" ? "Min" : "Min"}</div>
      </div>
    </div>
  `;
}

function renderPriceHistoryChartCurrent(history, playerId) {
  renderPriceHistoryChartHistory(history, playerId);
}

function renderPriceHistoryChartCSV(gwData, player, season) {
  if (!player) return;
  const lang = getLang();
  const color = TEAM_COLORS[player.team] || "#555";
  const posClass = `pos-${getPositionShort(player.element_type).toLowerCase()}`;

  document.getElementById("pricehistory-player-info").innerHTML = `
    <span class="team-color" style="background:${color};width:6px;height:28px;border-radius:3px;display:inline-block"></span>
    <span class="player-name">${player.web_name}</span>
    <span class="player-team">${getTeamName(player.team)}</span>
    <span class="pos-badge ${posClass}">${getPositionShort(player.element_type)}</span>
    <span style="color:var(--text-dim);font-size:0.85rem">${season}</span>
  `;

  const prices = gwData.map((d) => d.value / 10);
  const rounds = gwData.map((d) => d.gw);
  if (prices.length === 0) return;

  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = maxP - minP || 1;

  const svgW = 800, svgH = 300;
  const pad = { top: 30, right: 20, bottom: 40, left: 55 };
  const chartW = svgW - pad.left - pad.right;
  const chartH = svgH - pad.top - pad.bottom;

  let path = "";
  let dots = "";
  let xLabels = "";

  prices.forEach((p, i) => {
    const x = pad.left + (i / Math.max(prices.length - 1, 1)) * chartW;
    const y = pad.top + chartH - ((p - minP) / range) * chartH * 0.85 - chartH * 0.05;
    if (i === 0) path = `M ${x} ${y}`;
    else path += ` L ${x} ${y}`;
    const ttHtml = `<div class="tt-name">${player.web_name}</div><span class="tt-dim">GW${rounds[i]}:</span> <span class="tt-val">${p.toFixed(1)}m</span>`;
    dots += `<circle cx="${x}" cy="${y}" r="3.5" fill="${color}" stroke="var(--bg-card)" stroke-width="2"
      onmouseenter="window._chartTT.show(event, this.getAttribute('data-tt'))"
      onmouseleave="window._chartTT.hide()" data-tt="${ttHtml.replace(/"/g, '&quot;')}"/>`;
    dots += `<circle class="chart-hover-dot" cx="${x}" cy="${y}"
      onmouseenter="window._chartTT.show(event, this.getAttribute('data-tt'))"
      onmouseleave="window._chartTT.hide()" data-tt="${ttHtml.replace(/"/g, '&quot;')}"/>`;
    if (prices.length <= 20 || i % Math.ceil(prices.length / 20) === 0) {
      xLabels += `<text class="chart-label" x="${x}" y="${pad.top + chartH + 18}" text-anchor="middle" font-size="10">${rounds[i]}</text>`;
    }
  });

  let yTicks = "";
  const ySteps = 5;
  for (let i = 0; i <= ySteps; i++) {
    const val = minP + (range / ySteps) * i;
    const y = pad.top + chartH - (chartH / ySteps) * i * 0.85 - chartH * 0.05 * (i / ySteps);
    yTicks += `<text class="chart-label" x="${pad.left - 6}" y="${y + 3}" text-anchor="end" font-size="10">${val.toFixed(1)}m</text>`;
    yTicks += `<line class="chart-grid" x1="${pad.left}" y1="${y}" x2="${pad.left + chartW}" y2="${y}"/>`;
  }

  const startP = prices[0];
  const endP = prices[prices.length - 1];
  const diffP = endP - startP;
  const diffColor = diffP >= 0 ? "var(--green)" : "var(--red)";

  const sumEl = document.getElementById("pricehistory-chart");
  sumEl.innerHTML = `
    <svg class="chart-svg" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="priceGradCSV" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <line class="chart-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + chartH}"/>
      <line class="chart-axis" x1="${pad.left}" y1="${pad.top + chartH}" x2="${pad.left + chartW}" y2="${pad.top + chartH}"/>
      ${yTicks}
      <path d="${path} L ${pad.left + chartW} ${pad.top + chartH} L ${pad.left} ${pad.top + chartH} Z" fill="url(#priceGradCSV)"/>
      <path class="chart-line" d="${path}" stroke="${color}"/>
      ${dots}
      ${xLabels}
    </svg>
    <div class="ketchup-summary" style="margin-top:12px">
      <div class="ketchup-stat">
        <div class="ketchup-stat-val" style="color:var(--accent)">${startP.toFixed(1)}m</div>
        <div class="ketchup-stat-label">${lang === "pl" ? "Cena startowa" : "Start price"}</div>
      </div>
      <div class="ketchup-stat">
        <div class="ketchup-stat-val" style="color:var(--accent)">${endP.toFixed(1)}m</div>
        <div class="ketchup-stat-label">${lang === "pl" ? "Cena końcowa" : "End price"}</div>
      </div>
      <div class="ketchup-stat">
        <div class="ketchup-stat-val" style="color:${diffColor}">${diffP >= 0 ? '+' : ''}${diffP.toFixed(1)}m</div>
        <div class="ketchup-stat-label">${lang === "pl" ? "Zmiana" : "Change"}</div>
      </div>
      <div class="ketchup-stat">
        <div class="ketchup-stat-val">${maxP.toFixed(1)}m</div>
        <div class="ketchup-stat-label">${lang === "pl" ? "Max" : "Max"}</div>
      </div>
      <div class="ketchup-stat">
        <div class="ketchup-stat-val">${minP.toFixed(1)}m</div>
        <div class="ketchup-stat-label">${lang === "pl" ? "Min" : "Min"}</div>
      </div>
    </div>
  `;
}

// ===================== TOP 15 =====================

function populateTop15GWs() {
  const season = document.getElementById("top15-season")?.value || "2025-26";
  const isCurrentSeason = season === "current";
  let finishedGWs = [];
  if (isCurrentSeason && bootstrapData) {
    const allGWs = bootstrapData.events || [];
    finishedGWs = allGWs.filter((e) => e.finished);
  } else {
    for (let i = 1; i <= 38; i++) finishedGWs.push({ id: i });
  }
  const html = finishedGWs.map((e) => `<option value="${e.id}">GW${e.id}</option>`).join("");
  const startSel = document.getElementById("top15-gw-start");
  const endSel = document.getElementById("top15-gw-end");
  if (startSel) { startSel.innerHTML = html; if (finishedGWs.length > 0) startSel.value = finishedGWs[0].id; }
  if (endSel) { endSel.innerHTML = html; if (finishedGWs.length > 0) endSel.value = finishedGWs[finishedGWs.length - 1].id; }
}

function initTop15() {
  document.getElementById("top15-run").addEventListener("click", runTop15);
  document.getElementById("top15-season").addEventListener("change", populateTop15GWs);
  document.getElementById("top15-tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (!tab) return;
    document.querySelectorAll("#top15-tabs .tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    top15Tab = tab.dataset.tab;
    if (Object.keys(top15AllData).length > 0) renderTop15Charts();
  });
}

async function runTop15() {
  if (!bootstrapData) return;
  const startGW = parseInt(document.getElementById("top15-gw-start").value);
  let endGW = parseInt(document.getElementById("top15-gw-end").value);
  if (!startGW || !endGW || startGW > endGW) return;

  showSection("top15", "loading");
  const loadingEl = document.getElementById("top15-loading");
  const lang = getLang();
  document.getElementById("top15-chart-wrap").style.display = "none";
  document.getElementById("top15-table").style.display = "none";

  top15AllData = {};
  const season = document.getElementById("top15-season")?.value || "2025-26";

  try {
    const batchSize = 5;
    const seasonGWs = { "2025-26": 38, "2024-25": 38, "2023-24": 38, "2022-23": 38 };
    const totalGWs = seasonGWs[season] || 38;
    if (endGW > totalGWs) endGW = totalGWs;

    for (let batchStart = startGW; batchStart <= endGW; batchStart += batchSize) {
      const batchEnd = Math.min(batchStart + batchSize - 1, endGW);
      const promises = [];
      for (let gw = batchStart; gw <= batchEnd; gw++) {
        promises.push(
          fetchVaastavGW(season, gw).catch((err) => {
            console.error(`Top15 gw${gw} (${season}) fetch failed:`, err && err.message);
            return fetchVaastavGW("2024-25", gw).catch(() => []);
          })
        );
      }
      if (loadingEl) loadingEl.querySelector("div:last-child").textContent = `${lang === "pl" ? "Ładowanie" : "Loading"} GW${batchStart}–${batchEnd}...`;
      const results = await Promise.all(promises);
      results.forEach((csvData, i) => {
        const gw = batchStart + i;
        if (!csvData || csvData.length === 0) return;
        const teamNameToId = {};
        if (bootstrapData.teams) {
          for (const team of bootstrapData.teams) {
            teamNameToId[team.name] = team.id;
            teamNameToId[team.short_name] = team.id;
          }
        }
        const posMap = { "GKP": 1, "DEF": 2, "MID": 3, "FWD": 4 };

        const sumSelected = csvData.reduce((acc, r) => acc + (parseInt(r.selected) || 0), 0);
        const gwManagers = sumSelected > 0 ? Math.round(sumSelected / 15) : 0;
        top15AllData[gw] = csvData.map((r) => ({
          name: r.name || "",
          team: teamNameToId[r.team] || 0,
          position: posMap[r.position] || 0,
          points: parseInt(r.total_points) || 0,
          selected: gwManagers > 0 ? Math.round((parseInt(r.selected) || 0) / gwManagers * 1000) / 10 : parseInt(r.selected) || 0,
        }));
      });
    }

    renderTop15Charts();
    showSection("top15", "table");
  } catch {
    showSection("top15", "placeholder");
  }
}

function renderTop15Charts() {
  const container = document.getElementById("top15-chart");
  if (!container) return;
  const lang = getLang();
  const gws = Object.keys(top15AllData).map(Number).sort((a, b) => a - b);
  if (gws.length === 0) return;

  const svgW = 900, svgH = 420;
  const pad = { top: 30, right: 20, bottom: 60, left: 60 };
  const chartW = svgW - pad.left - pad.right;
  const chartH = svgH - pad.top - pad.bottom;
  const colors = ["#3b82f6","#ef4444","#22c55e","#eab308","#a855f7","#f97316","#06b6d4","#ec4899","#84cc16","#f43f5e","#6366f1","#14b8a6","#e879f9","#fb923c","#34d399"];

  if (top15Tab === "points") {
    const playerPts = {};
    for (const gw of gws) {
      const sorted = [...(top15AllData[gw] || [])].sort((a, b) => b.points - a.points).slice(0, 15);
      for (const p of sorted) {
        if (!playerPts[p.name]) playerPts[p.name] = { name: p.name, team: p.team, position: p.position, gwPts: {} };
        playerPts[p.name].gwPts[gw] = p.points;
      }
    }
    const players = Object.values(playerPts).map(p => {
      const cumulative = [];
      let sum = 0;
      for (const gw of gws) {
        const pts = p.gwPts[gw] || 0;
        sum += pts;
        cumulative.push(sum);
      }
      return { ...p, cumulative, total: sum };
    }).sort((a, b) => b.total - a.total).slice(0, 15);

    const maxVal = Math.max(...players.map(p => Math.max(...p.cumulative)), 1);
    let paths = "", xTicks = "", yTicks = "";
    const xStep = gws.length > 1 ? chartW / (gws.length - 1) : chartW;

    for (let i = 0; i <= 5; i++) {
      const val = (maxVal / 5) * i;
      const y = pad.top + chartH - (chartH / 5) * i;
      yTicks += `<text class="chart-label" x="${pad.left - 6}" y="${y + 3}" text-anchor="end" font-size="10">${Math.round(val)}</text>`;
      if (i > 0) yTicks += `<line class="chart-grid" x1="${pad.left}" y1="${y}" x2="${pad.left + chartW}" y2="${y}"/>`;
    }

    const xLabelStep = Math.max(1, Math.floor(gws.length / 15));
    for (let i = 0; i < gws.length; i += xLabelStep) {
      const x = pad.left + (gws.length > 1 ? (i / (gws.length - 1)) * chartW : chartW / 2);
      xTicks += `<text class="chart-label" x="${x}" y="${svgH - pad.bottom + 18}" text-anchor="middle" font-size="10">GW${gws[i]}</text>`;
    }

    const posNames = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };
    const ttPtsLabel = lang === "pl" ? "pkt" : "pts";
    players.forEach((p, pi) => {
      const color = colors[pi % colors.length];
      let d = "";
      const pts = [];
      for (let i = 0; i < gws.length; i++) {
        const x = pad.left + (gws.length > 1 ? (i / (gws.length - 1)) * chartW : chartW / 2);
        const y = pad.top + chartH - (p.cumulative[i] / maxVal) * chartH;
        d += (i === 0 ? "M" : "L") + ` ${x} ${y}`;
        pts.push({ x, y, gw: gws[i], cum: p.cumulative[i], gwPts: p.gwPts[gws[i]] || 0 });
      }
      const ttHtml = pts.map(pt => `<span class="tt-dim">GW${pt.gw}:</span> <span class="tt-val">${pt.cum}</span> ${ttPtsLabel} <span class="tt-dim">(+${pt.gwPts})</span>`).join("<br>");
      const tooltipHtml = `<div class="tt-name" style="color:${color}">${p.name} <span class="tt-dim">${posNames[p.position] || ""}</span></div>${ttHtml}<div class="tt-dim">Σ ${p.total} ${ttPtsLabel}</div>`;
      paths += `<path class="chart-line" data-pi="${pi}" d="${d}" fill="none" stroke="${color}" stroke-width="2.5"/>`;
      paths += `<path class="chart-hover-line" data-pi="${pi}" d="${d}" stroke-width="18"
        onmouseenter="window._chartTT.show(event, this.getAttribute('data-tt'), ${pi})"
        onmouseleave="window._chartTT.hide()" data-tt="${tooltipHtml.replace(/"/g, '&quot;')}"/>`;
      pts.forEach(pt => {
        paths += `<circle class="chart-dot" data-pi="${pi}" cx="${pt.x}" cy="${pt.y}" r="3" fill="${color}" stroke="#0f172a" stroke-width="1.5"/>`;
        const ptTt = `<div class='tt-name' style='color:${color}'>${p.name}</div><span class='tt-dim'>GW${pt.gw}:</span> <span class='tt-val'>${pt.cum}</span> ${ttPtsLabel} <span class='tt-dim'>(+${pt.gwPts})</span>`;
        paths += `<circle class="chart-hover-dot" data-pi="${pi}" cx="${pt.x}" cy="${pt.y}"
          onmouseenter="window._chartTT.show(event, this.getAttribute('data-tt'), ${pi})"
          onmouseleave="window._chartTT.hide()" data-tt="${ptTt.replace(/"/g, '&quot;')}"/>`;
      });
    });

    container.innerHTML = `
      <h3 class="chart-title" style="margin-bottom:8px">${lang === "pl" ? "Kumulatywne punkty – Top 15 strzelców" : "Cumulative Points – Top 15 Scorers"}</h3>
      <svg class="chart-svg" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg"
        onmousemove="this._ttMove(event)">
        <line class="chart-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + chartH}"/>
        <line class="chart-axis" x1="${pad.left}" y1="${pad.top + chartH}" x2="${pad.left + chartW}" y2="${pad.top + chartH}"/>
        ${yTicks}${xTicks}${paths}
      </svg>`;

  } else if (top15Tab === "ownership") {
    const playerOwn = {};
    for (const gw of gws) {
      for (const p of (top15AllData[gw] || [])) {
        if (!playerOwn[p.name]) playerOwn[p.name] = { name: p.name, team: p.team, position: p.position, gwOwn: {} };
        playerOwn[p.name].gwOwn[gw] = p.selected;
      }
    }
    const players = Object.values(playerOwn).map(p => {
      let sum = 0, count = 0;
      for (const gw of gws) {
        if (p.gwOwn[gw] !== undefined) { sum += p.gwOwn[gw]; count++; }
      }
      const avgOwn = count > 0 ? sum / count : 0;
      return { ...p, avgOwn, totalAppearances: count };
    }).sort((a, b) => b.avgOwn - a.avgOwn).slice(0, 15);

    const maxVal = 100;
    let paths = "", xTicks = "", yTicks = "";
    const xStep = gws.length > 1 ? chartW / (gws.length - 1) : chartW;

    for (let i = 0; i <= 5; i++) {
      const val = (maxVal / 5) * i;
      const y = pad.top + chartH - (chartH / 5) * i;
      yTicks += `<text class="chart-label" x="${pad.left - 6}" y="${y + 3}" text-anchor="end" font-size="10">${val.toFixed(0)}%</text>`;
      if (i > 0) yTicks += `<line class="chart-grid" x1="${pad.left}" y1="${y}" x2="${pad.left + chartW}" y2="${y}"/>`;
    }

    const xLabelStep = Math.max(1, Math.floor(gws.length / 15));
    for (let i = 0; i < gws.length; i += xLabelStep) {
      const x = pad.left + (gws.length > 1 ? (i / (gws.length - 1)) * chartW : chartW / 2);
      xTicks += `<text class="chart-label" x="${x}" y="${svgH - pad.bottom + 18}" text-anchor="middle" font-size="10">GW${gws[i]}</text>`;
    }

    players.forEach((p, pi) => {
      const color = colors[pi % colors.length];
      let d = "";
      const pts = [];
      for (let i = 0; i < gws.length; i++) {
        const x = pad.left + (gws.length > 1 ? (i / (gws.length - 1)) * chartW : chartW / 2);
        const ownVal = p.gwOwn[gws[i]];
        const y = ownVal !== undefined
          ? pad.top + chartH - (ownVal / maxVal) * chartH
          : null;
        if (y !== null) {
          d += (d === "" ? "M" : "L") + ` ${x} ${y}`;
          pts.push({ x, y, gw: gws[i], own: ownVal });
        }
      }
      if (!d) return;
      const ttHtml = pts.map(pt => `<span class="tt-dim">GW${pt.gw}:</span> <span class="tt-val">${pt.own.toFixed(1)}%</span>`).join("<br>");
      const tooltipHtml = `<div class="tt-name" style="color:${color}">${p.name}</div>${ttHtml}<div class="tt-dim">avg: ${p.avgOwn.toFixed(1)}%</div>`;
      paths += `<path class="chart-line" data-pi="${pi}" d="${d}" fill="none" stroke="${color}" stroke-width="2.5"/>`;
      paths += `<path class="chart-hover-line" data-pi="${pi}" d="${d}" stroke-width="18"
        onmouseenter="window._chartTT.show(event, this.getAttribute('data-tt'), ${pi})"
        onmouseleave="window._chartTT.hide()" data-tt="${tooltipHtml.replace(/"/g, '&quot;')}"/>`;
      pts.forEach(pt => {
        paths += `<circle class="chart-dot" data-pi="${pi}" cx="${pt.x}" cy="${pt.y}" r="3" fill="${color}" stroke="#0f172a" stroke-width="1.5"/>`;
        const ptTt = `<div class='tt-name' style='color:${color}'>${p.name}</div><span class='tt-dim'>GW${pt.gw}:</span> <span class='tt-val'>${pt.own.toFixed(1)}%</span>`;
        paths += `<circle class="chart-hover-dot" data-pi="${pi}" cx="${pt.x}" cy="${pt.y}"
          onmouseenter="window._chartTT.show(event, this.getAttribute('data-tt'), ${pi})"
          onmouseleave="window._chartTT.hide()" data-tt="${ptTt.replace(/"/g, '&quot;')}"/>`;
      });
    });

    container.innerHTML = `
      <h3 class="chart-title" style="margin-bottom:8px">${lang === "pl" ? "Posiadanie Top 15 – % menedżerów" : "Ownership % – Top 15 Most-Owned"}</h3>
      <svg class="chart-svg" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
        <line class="chart-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + chartH}"/>
        <line class="chart-axis" x1="${pad.left}" y1="${pad.top + chartH}" x2="${pad.left + chartW}" y2="${pad.top + chartH}"/>
        ${yTicks}${xTicks}${paths}
      </svg>`;

  } else if (top15Tab === "differentials") {
    const posNames = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };
    const gwTop = {};
    for (const gw of gws) {
      gwTop[gw] = (top15AllData[gw] || [])
        .filter(p => p.points > 0)
        .map(p => {
          const ownPct = p.selected > 0 ? p.selected : 0.1;
          return { ...p, diff: p.points / ownPct };
        })
        .sort((a, b) => b.diff - a.diff)
        .slice(0, 15);
    }

    const ttLang = lang === "pl" ? "pkt" : "pts";
    const modeLabels = { scatter: lang === "pl" ? "Co kolejkę" : "Per GW", cumulative: lang === "pl" ? "Kumulatywny" : "Cumulative", lines: lang === "pl" ? "Liniowy" : "Lines" };
    let modeToggles = `<div style="display:flex;gap:4px;margin-bottom:12px">`;
    for (const [mode, label] of Object.entries(modeLabels)) {
      const active = top15DiffMode === mode;
      modeToggles += `<button onclick="window._setDiffMode('${mode}')" style="padding:4px 12px;border-radius:6px;border:1px solid #334155;background:${active ? '#3b82f6' : '#1e293b'};color:#e2e8f0;cursor:pointer;font-size:12px;font-weight:${active ? 700 : 400}">${label}</button>`;
    }
    modeToggles += `</div>`;

    function buildTable(data) {
      let rows = "";
      data.forEach((r, i) => {
        const color = colors[i % colors.length];
        rows += `<tr>
          <td style="text-align:center;color:${color};font-weight:${i < 3 ? 700 : 400}">${r.gw}</td>
          <td style="text-align:center;color:${color};font-weight:${i < 3 ? 700 : 400}">${r.rank + 1}</td>
          <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle"></span>${r.name}</td>
          <td>${posNames[r.position] || ""}</td>
          <td style="text-align:center">${r.points}</td>
          <td style="text-align:center">${r.selected.toFixed(1)}%</td>
          <td style="text-align:center;font-weight:700">${r.diff.toFixed(2)}</td>
        </tr>`;
      });
      return rows;
    }

    function sortData(data) {
      const s = top15DiffTableSort;
      const sorted = [...data].sort((a, b) => {
        let va = a[s.field], vb = b[s.field];
        if (typeof va === "string") return s.dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
        return s.dir === "asc" ? va - vb : vb - va;
      });
      return sorted;
    }

    function renderTable(data) {
      const sorted = sortData(data);
      const arrows = { asc: " ↑", desc: " ↓" };
      const arrow = arrows[top15DiffTableSort.dir] || "";
      const hdr = (field, label) => `<th style="padding:6px 8px;text-align:${field === "name" || field === "position" ? "left" : "center"};border-bottom:2px solid #334155;cursor:pointer;user-select:none" onclick="window._sortDiffTable('${field}')">${label}${top15DiffTableSort.field === field ? arrow : ""}</th>`;
      const thGW = hdr("gw", lang === "pl" ? "Kolejka" : "GW");
      const thRank = hdr("rank", "#");
      const thName = hdr("name", lang === "pl" ? "Zawodnik" : "Player");
      const thPos = hdr("position", lang === "pl" ? "Poz" : "Pos");
      const thPts = hdr("points", lang === "pl" ? "Pkt" : "Pts");
      const thOwn = hdr("selected", "%");
      const thDiff = hdr("diff", "Pkt/%");
      return `<div style="margin-top:16px;max-height:400px;overflow-y:auto">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="position:sticky;top:0;background:#1e293b;z-index:1">${thGW}${thRank}${thName}${thPos}${thPts}${thOwn}${thDiff}</tr></thead>
          <tbody>${buildTable(sorted)}</tbody>
        </table>
      </div>`;
    }

    let gwSvg = "";
    const svgW = 900, svgH = 420;
    const pad = { top: 30, right: 20, bottom: 60, left: 60 };
    const chartW = svgW - pad.left - pad.right;
    const chartH = svgH - pad.top - pad.bottom;

    function renderAxes(maxV, yFmt) {
      let yT = "", xT = "";
      for (let i = 0; i <= 5; i++) {
        const val = (maxV / 5) * i;
        const y = pad.top + chartH - (chartH / 5) * i;
        yT += `<text class="chart-label" x="${pad.left - 6}" y="${y + 3}" text-anchor="end" font-size="10">${yFmt(val)}</text>`;
        if (i > 0) yT += `<line class="chart-grid" x1="${pad.left}" y1="${y}" x2="${pad.left + chartW}" y2="${y}"/>`;
      }
      const xStep = Math.max(1, Math.floor(gws.length / 15));
      for (let i = 0; i < gws.length; i++) {
        if (i % xStep === 0 || gws.length <= 20) {
          const x = pad.left + (gws.length > 1 ? (i / (gws.length - 1)) * chartW : chartW / 2);
          xT += `<text class="chart-label" x="${x}" y="${svgH - pad.bottom + 18}" text-anchor="middle" font-size="10">GW${gws[i]}</text>`;
        }
      }
      return { yTicks: yT, xTicks: xT };
    }

    function avoidLabelCollisions(labels) {
      labels.sort((a, b) => a.x - b.x || a.y - b.y);
      for (let i = 1; i < labels.length; i++) {
        for (let j = Math.max(0, i - 3); j < i; j++) {
          if (Math.abs(labels[i].x - labels[j].x) < 50 && Math.abs(labels[i].y - labels[j].y) < 11) {
            labels[i].y = labels[j].y + (labels[i].y >= labels[j].y ? 11 : -11);
          }
        }
      }
      return labels;
    }

    if (top15DiffMode === "cumulative") {
      const playerDiff = {};
      for (const gw of gws) {
        for (const p of (top15AllData[gw] || [])) {
          if (p.points <= 0) continue;
          const ownPct = p.selected > 0 ? p.selected : 0.1;
          const diff = p.points / ownPct;
          if (!playerDiff[p.name]) playerDiff[p.name] = { name: p.name, team: p.team, position: p.position, gwPts: {}, gwOwn: {}, gwDiff: {}, cumulative: [] };
          playerDiff[p.name].gwPts[gw] = p.points;
          playerDiff[p.name].gwOwn[gw] = p.selected;
          playerDiff[p.name].gwDiff[gw] = diff;
        }
      }
      const players = Object.values(playerDiff).map(p => {
        let sum = 0;
        const cum = [];
        let totalPts = 0, totalOwn = 0, ownCount = 0;
        for (const gw of gws) {
          const d = p.gwDiff[gw] || 0;
          sum += d;
          cum.push(sum);
          if (p.gwPts[gw] !== undefined) totalPts += p.gwPts[gw];
          if (p.gwOwn[gw] !== undefined) { totalOwn += p.gwOwn[gw]; ownCount++; }
        }
        p.cumulative = cum;
        p.total = sum;
        p.totalPts = totalPts;
        p.avgOwn = ownCount > 0 ? totalOwn / ownCount : 0;
        return p;
      }).sort((a, b) => b.total - a.total).slice(0, 15);

      const maxVal = Math.max(...players.map(p => Math.max(...p.cumulative)), 1);
      const { yTicks, xTicks } = renderAxes(maxVal, v => v.toFixed(1));

      let paths = "";
      const labelCandidates = [];
      players.forEach((p, pi) => {
        const color = colors[pi % colors.length];
        let d = "";
        const pts = [];
        for (let i = 0; i < gws.length; i++) {
          const x = pad.left + (gws.length > 1 ? (i / (gws.length - 1)) * chartW : chartW / 2);
          const y = pad.top + chartH - (p.cumulative[i] / maxVal) * chartH;
          d += (i === 0 ? "M" : "L") + ` ${x} ${y}`;
          pts.push({ x, y, gw: gws[i], cum: p.cumulative[i], gwPts: p.gwPts[gws[i]] || 0, gwOwn: p.gwOwn[gws[i]], gwDiff: p.gwDiff[gws[i]] });
        }
        const ttHtml = pts.map(pt => {
          const ownStr = pt.gwOwn !== undefined ? `${pt.gwOwn.toFixed(1)}%` : "-";
          const diffStr = pt.gwDiff !== undefined ? pt.gwDiff.toFixed(2) : "-";
          return `<span class="tt-dim">GW${pt.gw}:</span> <span class="tt-val">${pt.cum.toFixed(1)}</span> <span class="tt-dim">(+${pt.gwPts}${ttLang} / ${ownStr} = ${diffStr})</span>`;
        }).join("<br>");
        const tooltipHtml = `<div class="tt-name" style="color:${color}">${p.name} <span class="tt-dim">${posNames[p.position] || ""}</span></div>${ttHtml}<div class="tt-dim">Σ ${p.total.toFixed(1)} diff | ${p.totalPts} ${ttLang} | avg ${p.avgOwn.toFixed(1)}%</div>`;
        paths += `<path class="chart-line" d="${d}" fill="none" stroke="${color}" stroke-width="2.5"/>`;
        paths += `<path class="chart-hover-line" d="${d}" stroke-width="18"
          onmouseenter="window._chartTT.show(event, this.getAttribute('data-tt'), ${pi})"
          onmouseleave="window._chartTT.hide()" data-tt="${tooltipHtml.replace(/"/g, '&quot;')}"/>`;
        pts.forEach(pt => {
          paths += `<circle class="chart-dot" cx="${pt.x}" cy="${pt.y}" r="3" fill="${color}" stroke="#0f172a" stroke-width="1.5"/>`;
          const ptTt = `<div class='tt-name' style='color:${color}'>${p.name}</div><span class='tt-dim'>GW${pt.gw}:</span> <span class='tt-val'>${pt.cum.toFixed(1)}</span> <span class='tt-dim'>(+${pt.gwPts}${ttLang} / ${pt.gwOwn !== undefined ? pt.gwOwn.toFixed(1) + "%" : "-"} = ${pt.gwDiff !== undefined ? pt.gwDiff.toFixed(2) : "-"})</span>`;
          paths += `<circle class="chart-hover-dot" cx="${pt.x}" cy="${pt.y}"
            onmouseenter="window._chartTT.show(event, this.getAttribute('data-tt'), ${pi})"
            onmouseleave="window._chartTT.hide()" data-tt="${ptTt.replace(/"/g, '&quot;')}"/>`;
        });
        const lastX = pad.left + (gws.length > 1 ? ((gws.length - 1) / (gws.length - 1)) * chartW : chartW / 2);
        labelCandidates.push({ x: lastX, y: pts[pts.length - 1].y, name: p.name, color });
      });
      avoidLabelCollisions(labelCandidates);
      labelCandidates.forEach(l => {
        paths += `<text x="${l.x + 4}" y="${l.y + 3}" font-size="9" fill="${l.color}" font-weight="600" opacity="0.9">${l.name}</text>`;
      });

      const title = lang === "pl" ? "Różnice kumulatywnie – kto budował przewagę?" : "Cumulative Differentials – who built the edge?";
      const desc = lang === "pl" ? "Linie pokazują narastającą sumę pkt/posiadanie. Hover by zobaczyć szczegóły" : "Lines show growing sum of pts/ownership. Hover for details";
      gwSvg = `<svg class="chart-svg" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg" onmousemove="this._ttMove(event)">
        <line class="chart-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + chartH}"/>
        <line class="chart-axis" x1="${pad.left}" y1="${pad.top + chartH}" x2="${pad.left + chartW}" y2="${pad.top + chartH}"/>
        ${yTicks}${xTicks}${paths}</svg>`;
      container.innerHTML = `
        <h3 class="chart-title" style="margin-bottom:4px">${title}</h3>
        <p class="chart-desc" style="margin-bottom:4px;font-size:12px;color:#94a3b8">${desc}</p>
        ${modeToggles}${gwSvg}`;

      top15DiffData = [];
      gws.forEach((gw, gi) => { gwTop[gw].forEach((p, rank) => { top15DiffData.push({ gw: gi + 1, rank, name: p.name, position: p.position, points: p.points, selected: p.selected, diff: p.diff }); }); });
      container.innerHTML += renderTable(top15DiffData);

    } else {
      const allDiffs = gws.flatMap(gw => gwTop[gw].map(p => p.diff));
      const maxDiff = Math.max(...allDiffs, 1);
      const { yTicks, xTicks } = renderAxes(maxDiff, v => v.toFixed(1));
      let dots = "", labelsSvg = "";
      const playerColorMap = {};
      let ci = 0;

      gws.forEach((gw, i) => {
        const x = pad.left + (gws.length > 1 ? (i / (gws.length - 1)) * chartW : chartW / 2);
        const ranked = gwTop[gw];
        if (!ranked || ranked.length === 0) return;

        if (top15DiffMode === "lines") {
          ranked.forEach((p) => {
            if (!playerColorMap[p.name]) { playerColorMap[p.name] = colors[ci % colors.length]; ci++; }
          });
        }

        ranked.forEach((p, rank) => {
          const y = pad.top + chartH - (p.diff / maxDiff) * chartH;
          if (!playerColorMap[p.name]) { playerColorMap[p.name] = colors[ci % colors.length]; ci++; }
          const col = playerColorMap[p.name];
          const r = rank === 0 ? 5 : rank < 3 ? 4 : 3;
          const opacity = rank === 0 ? 1 : rank < 3 ? 0.85 : 0.6;
          const ptTt = `<div class='tt-name' style='color:${col}'>${p.name} <span class="tt-dim">${posNames[p.position] || ""}</span></div><span class="tt-dim">GW${gw} #${rank + 1}</span><br><span class="tt-val">${p.diff.toFixed(2)}</span> = ${p.points}${ttLang} / ${p.selected.toFixed(1)}%`;
          dots += `<circle cx="${x}" cy="${y}" r="${r}" fill="${col}" stroke="#0f172a" stroke-width="1.5" opacity="${opacity}"
            onmouseenter="window._chartTT.show(event, this.getAttribute('data-tt'), ${rank})"
            onmouseleave="window._chartTT.hide()" data-tt="${ptTt.replace(/"/g, '&quot;')}"/>`;
        });

        if (ranked.length > 0) {
          const top = ranked[0];
          const topY = pad.top + chartH - (top.diff / maxDiff) * chartH;
          const shortName = top.name.length > 14 ? top.name.split(" ").pop() : top.name;
          const col = playerColorMap[top.name] || colors[0];
          labelsSvg += `<text x="${x}" y="${topY - 9}" text-anchor="middle" font-size="8" fill="${col}" font-weight="600" opacity="0.9">${shortName}</text>`;
        }
      });

      if (top15DiffMode === "lines") {
        const lineByPlayer = {};
        gws.forEach((gw, i) => {
          const x = pad.left + (gws.length > 1 ? (i / (gws.length - 1)) * chartW : chartW / 2);
          (gwTop[gw] || []).forEach((p, rank) => {
            if (!lineByPlayer[p.name]) lineByPlayer[p.name] = [];
            const y = pad.top + chartH - (p.diff / maxDiff) * chartH;
            lineByPlayer[p.name].push({ x, y, gw, p, rank });
          });
        });
        let lpi = 0;
        Object.entries(lineByPlayer).forEach(([name, lpts]) => {
          if (lpts.length < 2) return;
          const col = playerColorMap[name] || "#888";
          let d = "";
          lpts.forEach((pt, j) => { d += (j === 0 ? "M" : "L") + ` ${pt.x} ${pt.y}`; });
          const ttHtml = lpts.map(pt => `<span class="tt-dim">GW${pt.gw}:</span> <span class="tt-val">${pt.p.diff.toFixed(2)}</span> <span class="tt-dim">(${pt.p.points}${ttLang} / ${pt.p.selected.toFixed(1)}%)</span>`).join("<br>");
          const toolHtml = `<div class="tt-name" style="color:${col}">${name}</div>${ttHtml}`;
          dots += `<path class="chart-line" data-pi="${lpi}" d="${d}" fill="none" stroke="${col}" stroke-width="2.5"/>`;
          dots += `<path class="chart-hover-line" data-pi="${lpi}" d="${d}" stroke-width="16"
            onmouseenter="window._chartTT.show(event, this.getAttribute('data-tt'), ${lpi})"
            onmouseleave="window._chartTT.hide()" data-tt="${toolHtml.replace(/"/g, '&quot;')}"/>`;
          lpts.forEach(pt => {
            dots += `<circle class="chart-dot" data-pi="${lpi}" cx="${pt.x}" cy="${pt.y}" r="3" fill="${col}" stroke="#0f172a" stroke-width="1.5"/>`;
          });
          lpi++;
        });
      }

      const title = lang === "pl" ? "Różnice – Punkty / Posiadanie" : "Differentials – Points / Ownership";
      const desc = lang === "pl" ? "Każda kolumna to jedna kolejka. Hover by zobaczyć Top 15 różnic" : "Each column = one GW. Hover to see Top 15 differentials";
      gwSvg = `<svg class="chart-svg" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg" onmousemove="this._ttMove(event)">
        <line class="chart-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + chartH}"/>
        <line class="chart-axis" x1="${pad.left}" y1="${pad.top + chartH}" x2="${pad.left + chartW}" y2="${pad.top + chartH}"/>
        ${yTicks}${xTicks}${dots}${labelsSvg}</svg>`;
      container.innerHTML = `
        <h3 class="chart-title" style="margin-bottom:4px">${title}</h3>
        <p class="chart-desc" style="margin-bottom:4px;font-size:12px;color:#94a3b8">${desc}</p>
        ${modeToggles}${gwSvg}`;

      top15DiffData = [];
      gws.forEach((gw, gi) => { gwTop[gw].forEach((p, rank) => { top15DiffData.push({ gw: gi + 1, rank, name: p.name, position: p.position, points: p.points, selected: p.selected, diff: p.diff }); }); });
      container.innerHTML += renderTable(top15DiffData);

      const popTitle = lang === "pl" ? "Różnice wśród popularnych – czy ktoś się wyróżniał?" : "Differentials among popular – anyone stand out?";
      const popDesc = lang === "pl" ? "Top 30 najpopularniejszych (śr. posiadanie) — czy dało się zyskać nawet na liderach?" : "Top 30 most owned (avg) — could you gain even from the stars?";
      const popPlayers = {};
      for (const gw of gws) {
        for (const p of (top15AllData[gw] || [])) {
          if (p.points <= 0 || p.selected <= 0) continue;
          if (!popPlayers[p.name]) popPlayers[p.name] = { name: p.name, team: p.team, position: p.position, gwPts: {}, gwOwn: {}, gwDiff: {} };
          popPlayers[p.name].gwPts[gw] = p.points;
          popPlayers[p.name].gwOwn[gw] = p.selected;
          popPlayers[p.name].gwDiff[gw] = p.points / p.selected;
        }
      }
      const popular = Object.values(popPlayers).map(p => {
        let totalOwn = 0, cnt = 0, totalPts = 0, totalDiff = 0, diffCnt = 0;
        for (const gw of gws) {
          if (p.gwOwn[gw] !== undefined) { totalOwn += p.gwOwn[gw]; cnt++; }
          if (p.gwDiff[gw] !== undefined) { totalDiff += p.gwDiff[gw]; diffCnt++; }
          if (p.gwPts[gw] !== undefined) totalPts += p.gwPts[gw];
        }
        p.avgOwn = cnt > 0 ? totalOwn / cnt : 0;
        p.totalPts = totalPts;
        p.avgDiff = diffCnt > 0 ? totalDiff / diffCnt : 0;
        return p;
      }).filter(p => p.avgOwn >= 5).sort((a, b) => b.avgOwn - a.avgOwn).slice(0, 30);

      if (popular.length > 0) {
        const popAllDiffs = gws.flatMap(gw => popular.map(p => p.gwDiff[gw] || 0).filter(v => v > 0));
        const popMaxDiff = Math.max(...popAllDiffs, 1);
        let popYTicks = "", popXTicks = "", popDots = "", popLabels = "";
        for (let i = 0; i <= 5; i++) {
          const val = (popMaxDiff / 5) * i;
          const y = pad.top + chartH - (chartH / 5) * i;
          popYTicks += `<text class="chart-label" x="${pad.left - 6}" y="${y + 3}" text-anchor="end" font-size="10">${val.toFixed(1)}</text>`;
          if (i > 0) popYTicks += `<line class="chart-grid" x1="${pad.left}" y1="${y}" x2="${pad.left + chartW}" y2="${y}"/>`;
        }
        const xStep = Math.max(1, Math.floor(gws.length / 15));
        for (let i = 0; i < gws.length; i++) {
          if (i % xStep === 0 || gws.length <= 20) {
            const x = pad.left + (gws.length > 1 ? (i / (gws.length - 1)) * chartW : chartW / 2);
            popXTicks += `<text class="chart-label" x="${x}" y="${svgH - pad.bottom + 18}" text-anchor="middle" font-size="10">GW${gws[i]}</text>`;
          }
        }

        const popPlayerColors = {};
        let pci = 0;
        gws.forEach((gw, i) => {
          const x = pad.left + (gws.length > 1 ? (i / (gws.length - 1)) * chartW : chartW / 2);
          popular.forEach(p => {
            const diff = p.gwDiff[gw];
            if (diff === undefined) return;
            if (!popPlayerColors[p.name]) { popPlayerColors[p.name] = colors[pci % colors.length]; pci++; }
            const col = popPlayerColors[p.name];
            const y = pad.top + chartH - (diff / popMaxDiff) * chartH;
            const ptTt = `<div class='tt-name' style='color:${col}'>${p.name} <span class="tt-dim">${posNames[p.position] || ""} | avg ${p.avgOwn.toFixed(0)}%</span></div><span class="tt-dim">GW${gw}</span><br><span class="tt-val">${diff.toFixed(2)}</span> = ${p.gwPts[gw]}${ttLang} / ${p.gwOwn[gw].toFixed(1)}%`;
            popDots += `<circle cx="${x}" cy="${y}" r="3.5" fill="${col}" stroke="#0f172a" stroke-width="1.5"
              onmouseenter="window._chartTT.show(event, this.getAttribute('data-tt'))"
              onmouseleave="window._chartTT.hide()" data-tt="${ptTt.replace(/"/g, '&quot;')}"/>`;
          });
        });
        const popLabelCandidates = [];
        popular.forEach(p => {
          if (!popPlayerColors[p.name]) return;
          let bestDiff = -1, bestX = pad.left, bestY = pad.top + chartH;
          gws.forEach((gw, i) => {
            if (p.gwDiff[gw] !== undefined && p.gwDiff[gw] > bestDiff) {
              bestDiff = p.gwDiff[gw];
              bestX = pad.left + (gws.length > 1 ? (i / (gws.length - 1)) * chartW : chartW / 2);
              bestY = pad.top + chartH - (bestDiff / popMaxDiff) * chartH;
            }
          });
          if (bestDiff >= 0) popLabelCandidates.push({ x: bestX, y: bestY - 6, name: p.name, color: popPlayerColors[p.name] });
        });
        avoidLabelCollisions(popLabelCandidates);
        popLabelCandidates.forEach(l => {
          popLabels += `<text x="${l.x + 4}" y="${l.y + 3}" font-size="8" fill="${l.color}" font-weight="600" opacity="0.9">${l.name}</text>`;
        });

        const popSvg = `<svg class="chart-svg" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg" onmousemove="this._ttMove(event)">
          <line class="chart-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + chartH}"/>
          <line class="chart-axis" x1="${pad.left}" y1="${pad.top + chartH}" x2="${pad.left + chartW}" y2="${pad.top + chartH}"/>
          ${popYTicks}${popXTicks}${popDots}${popLabels}</svg>`;

        let popTableRows = "";
        const popSorted = [...popular].sort((a, b) => {
          let va = a[popTableSort.field], vb = b[popTableSort.field];
          if (typeof va === "string") return popTableSort.dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
          return popTableSort.dir === "asc" ? va - vb : vb - va;
        });
        const popArrow = popTableSort.dir === "asc" ? " ↑" : " ↓";
        const popHdr = (field, label) => `<th style="padding:6px 8px;text-align:${field === "name" || field === "position" ? "left" : "center"};border-bottom:2px solid #334155;cursor:pointer;user-select:none" onclick="window._sortPopTable('${field}')">${label}${popTableSort.field === field ? popArrow : ""}</th>`;
        popSorted.forEach((p, pi) => {
          const origIdx = popular.indexOf(p);
          const col = popPlayerColors[p.name] || colors[origIdx % colors.length];
          popTableRows += `<tr>
            <td style="text-align:center;color:${col}">${pi + 1}</td>
            <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col};margin-right:6px;vertical-align:middle"></span>${p.name}</td>
            <td>${posNames[p.position] || ""}</td>
            <td style="text-align:center">${p.avgOwn.toFixed(1)}%</td>
            <td style="text-align:center">${p.totalPts}</td>
            <td style="text-align:center;font-weight:700;color:${p.avgDiff > 0.5 ? '#22c55e' : p.avgDiff > 0.2 ? '#eab308' : '#94a3b8'}">${p.avgDiff.toFixed(2)}</td>
          </tr>`;
        });

        container.innerHTML += `
          <div style="margin-top:24px;padding-top:16px;border-top:1px solid #334155">
            <h3 class="chart-title" style="margin-bottom:4px">${popTitle}</h3>
            <p class="chart-desc" style="margin-bottom:8px;font-size:12px;color:#94a3b8">${popDesc}</p>
            <div class="top15-chart" style="overflow-x:auto">${popSvg}</div>
            <div style="margin-top:12px;max-height:300px;overflow-y:auto">
              <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead><tr style="position:sticky;top:0;background:#1e293b;z-index:1">
                  ${popHdr("rank", "#")}
                  ${popHdr("name", lang === "pl" ? "Zawodnik" : "Player")}
                  ${popHdr("position", lang === "pl" ? "Poz" : "Pos")}
                  ${popHdr("avgOwn", lang === "pl" ? "Śr. posiadanie" : "Avg ownership")}
                  ${popHdr("totalPts", lang === "pl" ? "Suma pkt" : "Total pts")}
                  ${popHdr("avgDiff", "Śr. Pkt/%")}
                </tr></thead>
                <tbody>${popTableRows}</tbody>
              </table>
            </div>
          </div>`;
      }
    }
  }

  document.getElementById("top15-chart-wrap").style.display = "";
}

// ===================== SQUAD BUILDER (WEIGHTED) =====================

let top15DiffMode = "scatter";
let top15DiffTableSort = { field: "diff", dir: "desc" };
let top15DiffData = [];
let popTableSort = { field: "avgOwn", dir: "desc" };

let squadBuilderSort = { field: "compositeScore", dir: "desc" };
let squadBuilderSquad = [];
let squadBuilderFixtures = [];
let squadBuilderBudget = 1000;
let squadBuilderFDRCount = 5;

function initSquadBuilder() {
  document.querySelectorAll(".weight-slider").forEach((slider) => {
    const valEl = slider.parentElement.querySelector(".weight-val");
    slider.addEventListener("input", () => { valEl.textContent = slider.value; });
  });
  document.getElementById("squadbuilder-run").addEventListener("click", runSquadBuilder);
  const budgetSlider = document.getElementById("squadbuilder-budget-slider");
  const budgetVal = document.getElementById("squadbuilder-budget-val");
  if (budgetSlider && budgetVal) {
    const updBudget = () => { budgetVal.textContent = (parseFloat(budgetSlider.value)).toFixed(1) + "m"; };
    budgetSlider.addEventListener("input", updBudget);
    updBudget();
  }
  populateSquadBuilderGWs();
  document.querySelectorAll("[data-fdrcount]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-fdrcount]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      squadBuilderFDRCount = parseInt(btn.dataset.fdrcount);
    });
  });
}

function populateSquadBuilderGWs() {
  if (!bootstrapData) return;
  const allGWs = bootstrapData.events || [];
  const finishedGWs = allGWs.filter((e) => e.finished);
  const html = finishedGWs.map((e) => `<option value="${e.id}">GW${e.id}</option>`).join("");
  const sel = document.getElementById("squadbuilder-gw");
  if (sel) { sel.innerHTML = html; if (finishedGWs.length > 0) sel.value = finishedGWs[finishedGWs.length - 1].id; }
}

function getWeights() {
  const weights = {};
  document.querySelectorAll(".weight-slider").forEach((slider) => {
    weights[slider.dataset.weight] = parseInt(slider.value) / 100;
  });
  return weights;
}

function renderFormExplanation(weights, teamFDR) {
  const lang = getLang();
  const el = document.getElementById("squadbuilder-form-explanation");
  if (!el) return;
  const parts = [];
  if (weights.form > 0) parts.push(`<b>${lang === "pl" ? "Forma" : "Form"}</b>: ${lang === "pl" ? "Współczynnik formy z API FPL (0–15). Normalizowany względem najlepszego zawodnika." : "FPL form rating (0–15). Normalized vs best player."}`);
  if (weights.fixture > 0) parts.push(`<b>${lang === "pl" ? "Terminarz" : "Fixtures"}</b>: ${lang === "pl" ? "Średni FDR nadchodzących meczów drużynowych. Niższy = łatwiejszy terminarz." : "Avg FDR of remaining fixtures. Lower = easier schedule."}`);
  if (weights.homeaway > 0) parts.push(`<b>${lang === "pl" ? "Dom/Wyjazd" : "Home/Away"}</b>: ${lang === "pl" ? "Kombinacja formy i xP jako proxy przewagi meczów domowych." : "Combo of form + xP as proxy for home advantage."}`);
  if (weights.xpts > 0) parts.push(`<b>xP</b>: ${lang === "pl" ? "(xG + xA) / max — oczekiwane zaangażowanie bramkowe z oficjalnych danych." : "(xG + xA) / max — expected goal involvement from official data."}`);
  if (weights.minutes > 0) parts.push(`<b>${lang === "pl" ? "Minuty" : "Minutes"}</b>: ${lang === "pl" ? "Rozegrane minuty / max — preferuje regularnych graczy." : "Minutes played / max — favors regular starters."}`);
  if (weights.distance > 0) parts.push(`<b>${lang === "pl" ? "Dystans" : "Distance"}</b>: ${lang === "pl" ? "1 − (śr. dystans wyjazdowy / max). Krótsze podróże = wyższy wynik." : "1 − (avg away dist / max). Shorter travel = higher score."}`);
  if (weights.epnext > 0) parts.push(`<b>${lang === "pl" ? "Ep Next" : "Ep Next"}</b>: ${lang === "pl" ? "Oczekiwane punkty w najbliższej kolejce (ep_next z API FPL). Wyższe = lepszy." : "Expected points next GW (ep_next from FPL API). Higher = better."}`);
  if (weights.chance > 0) parts.push(`<b>${lang === "pl" ? "Szansa gry" : "Play Chance"}</b>: ${lang === "pl" ? "Prawdopodobieństwo gry w najbliższej kolejce (0–100%). 100% = pewny występ." : "Probability of playing next GW (0–100%). 100% = guaranteed starter."}`);

  if (parts.length > 0) {
    el.style.display = "";
    el.innerHTML = `<div class="form-explanation-box">${parts.join("<br>")}</div>`;
  } else {
    el.style.display = "none";
  }
}

async function runSquadBuilder() {
  if (!bootstrapData) return;
  const weights = getWeights();
  const lang = getLang();
  const targetGW = parseInt(document.getElementById("squadbuilder-gw")?.value) || 0;
  const fdrCount = squadBuilderFDRCount;

  showSection("squadbuilder", "loading");
  document.getElementById("squadbuilder-charts").style.display = "none";
  document.getElementById("squadbuilder-map-wrap").style.display = "none";
  document.getElementById("squadbuilder-fixtures").style.display = "none";
  const budgetInitEl = document.getElementById("squadbuilder-budget");
  if (budgetInitEl) budgetInitEl.style.display = "none";

  try {
    await loadAllFixtures();

    const allPlayers = bootstrapData.elements.filter((p) => p.now_cost > 0);

    const maxForm = Math.max(...allPlayers.map((p) => parseFloat(p.form) || 0), 1);
    const maxXPts = Math.max(...allPlayers.map((p) => (parseFloat(p.expected_goals) || 0) + (parseFloat(p.expected_assists) || 0)), 0.01);
    const maxMinutes = Math.max(...allPlayers.map((p) => p.minutes || 0), 1);
    const maxEpNext = Math.max(...allPlayers.map((p) => parseFloat(p.ep_next) || 0), 0.01);

    const teamAvgFDR = {};
    for (const team of bootstrapData.teams || []) {
      teamAvgFDR[team.id] = getTeamAvgFDR(team.id, fdrCount);
    }
    const maxFDR = Math.max(...Object.values(teamAvgFDR), 5);
    const minFDR = Math.min(...Object.values(teamAvgFDR), 1);
    const fdrRange = maxFDR - minFDR || 1;

    renderFormExplanation(weights, teamAvgFDR);

    const scored = allPlayers.map((p) => {
      const form = (parseFloat(p.form) || 0) / maxForm;
      const fdr = teamAvgFDR[p.team] || 3;
      const fixture = 1 - ((fdr - minFDR) / fdrRange);
      const xGI = (parseFloat(p.expected_goals) || 0) + (parseFloat(p.expected_assists) || 0);
      const xpts = xGI / maxXPts;
      const mins = (p.minutes || 0) / maxMinutes;
      const homeaway = form * 0.5 + xpts * 0.5;
      const epNext = (parseFloat(p.ep_next) || 0) / maxEpNext;
      const chanceRaw = p.chance_of_playing_next_round;
      let chance = 1;
      if (chanceRaw !== null && chanceRaw !== undefined) {
        chance = chanceRaw / 100;
      } else if (p.status === "d") {
        chance = 0.5;
      } else if (p.status === "i" || p.status === "s" || p.status === "u") {
        chance = 0;
      }

      let avgDist = 0;
      let distCount = 0;
      for (const oppId of Object.keys(TEAM_COORDS).map(Number)) {
        if (oppId === p.team) continue;
        avgDist += travelDistance(p.team, oppId);
        distCount++;
      }
      avgDist = distCount > 0 ? avgDist / distCount : 0;
      const distance = 1 - Math.min(avgDist / 400, 1);

      const composite =
        (weights.form || 0) * form +
        (weights.fixture || 0) * fixture +
        (weights.homeaway || 0) * homeaway +
        (weights.xpts || 0) * xpts +
        (weights.minutes || 0) * mins +
        (weights.distance || 0) * distance +
        (weights.epnext || 0) * epNext +
        (weights.chance || 0) * chance;

      return {
        ...p,
        compositeScore: +composite.toFixed(4),
        avgAwayDist: Math.round(avgDist),
        epNext: parseFloat(p.ep_next) || 0,
        chanceNext: p.chance_of_playing_next_round,
        xgi: +xGI.toFixed(2),
        avgFDR: +fdr.toFixed(1),
      };
    });

    const maxPerTeam = 3;
    const limits = { 1: 2, 2: 5, 3: 5, 4: 3 };
    const squad = [];
    const teamCount = {};
    let totalCost = 0;

    const budgetM = parseFloat(document.getElementById("squadbuilder-budget-slider")?.value) || 100;
    const squadBudget = Math.round(budgetM * 10);
    squadBuilderBudget = squadBudget;

    // Phase 1: build a minimum-cost valid squad (guarantees all 15 slots filled, always within budget)
    for (const pos of [1, 2, 3, 4]) {
      const candidates = scored.filter((p) => p.element_type === pos && p.now_cost > 0).sort((a, b) => a.now_cost - b.now_cost);
      let picked = 0;
      for (const p of candidates) {
        if (picked >= limits[pos]) break;
        if (squad.find((s) => s.id === p.id)) continue;
        if ((teamCount[p.team] || 0) >= maxPerTeam) continue;
        squad.push({ ...p });
        teamCount[p.team] = (teamCount[p.team] || 0) + 1;
        totalCost += p.now_cost;
        picked++;
      }
    }
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < squad.length; i++) {
        const cur = squad[i];
        const pos = cur.element_type;
        const candidates = scored.filter((p) => p.element_type === pos && p.id !== cur.id && p.compositeScore > cur.compositeScore && !squad.find((s) => s.id === p.id)).sort((a, b) => b.compositeScore - a.compositeScore);
        for (const c of candidates) {
          const costDiff = c.now_cost - cur.now_cost;
          if (totalCost + costDiff > squadBudget) continue;
          if (cur.team !== c.team && (teamCount[c.team] || 0) >= maxPerTeam) continue;
          if (cur.team !== c.team) {
            teamCount[cur.team] = (teamCount[cur.team] || 1) - 1;
            teamCount[c.team] = (teamCount[c.team] || 0) + 1;
          }
          squad[i] = { ...c };
          totalCost += costDiff;
          improved = true;
          break;
        }
      }
    }

    squadBuilderSquad = squad;

    const fixtureTeams = [...new Set(squad.map((p) => p.team))];
    const fixtureEl = document.getElementById("squadbuilder-fixtures");
    if (fixtureEl && fixtureTeams.length > 0) {
      let fhtml = `<h3 style="font-size:0.95rem;margin-bottom:10px;color:var(--text)">${lang === "pl" ? `Nadchodzące ${fdrCount} kolejek` : `Next ${fdrCount} gameweeks`}</h3>`;
      for (const teamId of fixtureTeams) {
        const color = TEAM_COLORS[teamId] || "#555";
        fhtml += `<div class="fdr-row"><span class="team-color" style="background:${color}"></span><span style="font-weight:600;min-width:90px">${getTeamName(teamId)}</span><div class="fdr-badges">${renderFixtureStrip(teamId, fdrCount, lang)}</div></div>`;
      }
      fixtureEl.innerHTML = fhtml;
      fixtureEl.style.display = "";
    }

    renderSquadBuilder();
    showSection("squadbuilder", "table");
    document.getElementById("squadbuilder-charts").style.display = "";
    try { renderSquadBuilderCharts(); } catch (e) { console.error("squadBuilder charts error:", e); }
    try { renderSquadBuilderMap(); } catch (e) { console.error("squadBuilder map error:", e); }
  } catch (err) {
    console.error("runSquadBuilder error:", err);
    document.getElementById("squadbuilder-charts").style.display = "none";
    document.getElementById("squadbuilder-map-wrap").style.display = "none";
    document.getElementById("squadbuilder-fixtures").style.display = "none";
    showSection("squadbuilder", "placeholder");
  }
}

function renderSquadBuilderMap() {
  const container = document.getElementById("squadbuilder-map");
  if (!container || squadBuilderSquad.length === 0) return;
  const mapWrap = document.getElementById("squadbuilder-map-wrap");
  if (typeof L === "undefined") { mapWrap.style.display = "none"; return; }
  mapWrap.style.display = "";

  if (squadMap) { squadMap.remove(); squadMap = null; }
  const map = L.map(container, { scrollWheelZoom: true }).setView([53.0, -1.5], 6);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; OSM &copy; CARTO', maxZoom: 18,
  }).addTo(map);

  const teamIds = [...new Set(squadBuilderSquad.map((p) => p.team))];
  const posColors = { 1: "#fbbf24", 2: "#3b82f6", 3: "#22c55e", 4: "#ef4444" };
  const bounds = [];

  for (const tid of teamIds) {
    const tc = TEAM_COORDS[tid];
    if (!tc) continue;
    const marker = L.circleMarker(tc.stadium, {
      radius: 10, fillColor: TEAM_COLORS[tid] || "#555", color: "#fff", weight: 2, fillOpacity: 0.9,
    }).addTo(map);
    const players = squadBuilderSquad.filter((p) => p.team === tid);
    const plist = players.map((p) => `<span style="color:${posColors[p.element_type]}">${getPositionShort(p.element_type)}</span> ${p.web_name}`).join("<br>");
    marker.bindPopup(`<div style="font-weight:700;color:${TEAM_COLORS[tid]}">${tc.name}</div><div style="font-size:0.85rem">${plist}</div>`);
    bounds.push(tc.stadium);
  }

  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) {
      const t1 = TEAM_COORDS[teamIds[i]];
      const t2 = TEAM_COORDS[teamIds[j]];
      if (!t1 || !t2) continue;
      if (teamIds[i] !== teamIds[j]) {
        L.polyline([t1.stadium, t2.stadium], { color: "#3b82f6", weight: 1, opacity: 0.3, dashArray: "5 5" }).addTo(map);
      }
    }
  }

  if (bounds.length > 0) {
    map.fitBounds(bounds, { padding: [30, 30] });
  }
  setTimeout(() => map.invalidateSize(), 100);
}

function renderSquadBuilder() {
  const lang = getLang();
  const dir = squadBuilderSort.dir === "desc" ? -1 : 1;
  const sorted = [...squadBuilderSquad].sort((a, b) => {
    const av = a[squadBuilderSort.field] ?? 0;
    const bv = b[squadBuilderSort.field] ?? 0;
    if (typeof av === "string") return dir * av.localeCompare(bv);
    return (bv - av) * dir;
  });

  const totalPts = sorted.reduce((s, p) => s + p.total_points, 0);
  const totalCost = sorted.reduce((s, p) => s + p.now_cost, 0);

  const tbody = document.getElementById("squadbuilder-body");
  tbody.innerHTML = sorted.map((p, i) => {
    const color = TEAM_COLORS[p.team] || "#555";
    const posClass = `pos-${getPositionShort(p.element_type).toLowerCase()}`;
    const epColor = p.epNext >= 4 ? "var(--green)" : p.epNext >= 2 ? "var(--yellow)" : "var(--text-dim)";
    let chanceHtml = "—";
    if (p.chanceNext !== null && p.chanceNext !== undefined) {
      const ch = parseInt(p.chanceNext);
      const chClass = ch >= 75 ? "chance-ok" : ch >= 50 ? "chance-doubt" : "chance-out";
      chanceHtml = `<span class="chance-badge ${chClass}">${ch}%</span>`;
    } else if (p.status === "a") {
      chanceHtml = `<span class="chance-badge chance-ok">100%</span>`;
    }
    const fdrColor = p.avgFDR <= 2 ? "var(--green)" : p.avgFDR <= 3 ? "var(--yellow)" : "var(--red)";
    return `<tr>
      <td class="rank-num">${i + 1}</td>
      <td>${p.web_name}</td>
      <td><span class="team-color" style="background:${color}"></span>${getTeamName(p.team)}</td>
      <td><span class="pos-badge ${posClass}">${getPositionShort(p.element_type)}</span></td>
      <td class="stat-val">${(p.now_cost / 10).toFixed(1)}</td>
      <td class="stat-val">${p.total_points}</td>
      <td class="stat-val" style="color:${epColor}">${p.epNext.toFixed(1)}</td>
      <td class="stat-val">${chanceHtml}</td>
      <td class="stat-val">${p.xgi.toFixed(1)}</td>
      <td class="stat-val" style="color:${fdrColor}">${p.avgFDR}</td>
      <td class="stat-val" style="color:var(--text-dim)">${p.avgAwayDist || 0} km</td>
      <td class="stat-val" style="color:var(--accent)">${p.compositeScore.toFixed(3)}</td>
    </tr>`;
  }).join("") + `<tr class="optimizer-summary-row">
    <td colspan="5" style="font-weight:700;color:var(--accent)">${lang === "pl" ? "Podsumowanie" : "Summary"}</td>
    <td class="stat-val" style="font-weight:700;color:var(--accent)">${totalPts}</td>
    <td class="stat-val" style="color:var(--accent)">${(sorted.reduce((s, p) => s + p.epNext, 0) / Math.max(sorted.length, 1)).toFixed(1)}</td>
    <td></td><td></td><td></td>
    <td class="stat-val" style="font-weight:600">${(sorted.reduce((s, p) => s + (p.avgAwayDist || 0), 0) / Math.max(sorted.length, 1)).toFixed(0)} km</td>
    <td class="stat-val" style="font-weight:700;color:var(--accent)">${(totalCost / 10).toFixed(1)}m</td>
  </tr>`;

  const budgetEl = document.getElementById("squadbuilder-budget");
  if (budgetEl) {
    budgetEl.style.display = "flex";
    const totalM = totalCost / 10;
    const budgetM = squadBuilderBudget / 10;
    const remaining = budgetM - totalM;
    const fits = remaining >= 0;
    const remainingTxt = (fits ? (lang === "pl" ? "Zostało" : "Left") : (lang === "pl" ? "Przekroczenie" : "Over")) + `: ${remaining >= 0 ? "" : "-"}${Math.abs(remaining).toFixed(1)}m`;
    budgetEl.className = "squadbuilder-budget " + (fits ? "budget-ok" : "budget-over");
    budgetEl.innerHTML = `
      <span class="budget-label">${lang === "pl" ? "Suma składu" : "Squad total"}:</span>
      <span class="budget-total">${totalM.toFixed(1)}m</span>
      <span class="budget-sep">/</span>
      <span class="budget-label">${lang === "pl" ? "Budżet" : "Budget"}:</span>
      <span class="budget-budget">${budgetM.toFixed(1)}m</span>
      <span class="budget-remaining">(${remainingTxt})</span>
      <span class="budget-status">${fits ? (lang === "pl" ? "✓ Mieści się" : "✓ Fits") : (lang === "pl" ? "✗ Powyżej budżetu" : "✗ Over budget")}</span>
    `;
  }
}

function renderSquadBuilderCharts() {
  renderSquadDistChart();
  renderSquadScoreChart();
}

function renderSquadDistChart() {
  const container = document.getElementById("squadbuilder-dist-chart");
  if (!container || !bootstrapData) return;
  const lang = getLang();

  // Average away distance per team
  const teamDist = {};
  const teamIds = Object.keys(TEAM_COORDS).map(Number);
  for (const tid of teamIds) {
    let total = 0, count = 0;
    for (const oppId of teamIds) {
      if (oppId === tid) continue;
      total += travelDistance(tid, oppId);
      count++;
    }
    teamDist[tid] = count > 0 ? total / count : 0;
  }

  const teams = teamIds
    .map((tid) => ({ tid, name: getTeamName(tid), dist: teamDist[tid], color: TEAM_COLORS[tid] || "#555" }))
    .sort((a, b) => b.dist - a.dist);

  const maxDist = Math.max(...teams.map((t) => t.dist), 1);
  const svgW = 800;
  const svgH = Math.max(300, teams.length * 22 + 40);
  const pad = { top: 10, right: 30, bottom: 20, left: 70 };
  const chartW = svgW - pad.left - pad.right;
  const chartH = svgH - pad.top - pad.bottom;
  const barH = Math.floor(chartH / teams.length) - 2;

  let bars = "";
  teams.forEach((t, i) => {
    const y = pad.top + i * (barH + 2);
    const w = (t.dist / maxDist) * chartW;
    bars += `<rect x="${pad.left}" y="${y}" width="${w}" height="${barH}" fill="${t.color}" rx="2" opacity="0.75">
      <title>${t.name}: ${t.dist.toFixed(0)} km</title>
    </rect>`;
    bars += `<text x="${pad.left - 4}" y="${y + barH / 2 + 4}" text-anchor="end" font-size="10" fill="var(--text-dim)" font-family="sans-serif">${t.name}</text>`;
    bars += `<text x="${pad.left + w + 4}" y="${y + barH / 2 + 4}" text-anchor="start" font-size="9" fill="var(--text-dim)" font-family="sans-serif">${t.dist.toFixed(0)} km</text>`;
  });

  container.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
    <line class="chart-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + chartH}"/>
    ${bars}
  </svg>`;
}

function renderSquadScoreChart() {
  const container = document.getElementById("squadbuilder-score-chart");
  if (!container || squadBuilderSquad.length === 0) return;

  const sorted = [...squadBuilderSquad].sort((a, b) => b.compositeScore - a.compositeScore);
  const maxScore = Math.max(...sorted.map((p) => p.compositeScore), 0.01);

  const svgW = 800;
  const svgH = 300;
  const pad = { top: 20, right: 20, bottom: 50, left: 50 };
  const chartW = svgW - pad.left - pad.right;
  const chartH = svgH - pad.top - pad.bottom;
  const barW = Math.floor(chartW / 15) - 4;
  const gap = 4;

  const posColors = { 1: "#fbbf24", 2: "#3b82f6", 3: "#22c55e", 4: "#ef4444" };

  let bars = "";
  sorted.forEach((p, i) => {
    const x = pad.left + i * (barW + gap);
    const h = (p.compositeScore / maxScore) * chartH;
    const y = pad.top + chartH - h;
    const color = posColors[p.element_type] || "#555";
    bars += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${color}" rx="2" opacity="0.85">
      <title>${p.web_name} — ${p.compositeScore.toFixed(3)}</title>
    </rect>`;
    bars += `<text class="chart-label" x="${x + barW / 2}" y="${pad.top + chartH + 14}" text-anchor="middle" font-size="9">${p.web_name}</text>`;
    if (barW > 16) {
      bars += `<text class="chart-value" x="${x + barW / 2}" y="${y - 4}" text-anchor="middle" font-size="9" fill="var(--text-dim)">${p.compositeScore.toFixed(2)}</text>`;
    }
  });

  let yTicks = "";
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const val = (maxScore / steps) * i;
    const y = pad.top + chartH - (chartH / steps) * i;
    yTicks += `<text class="chart-label" x="${pad.left - 6}" y="${y + 3}" text-anchor="end" font-size="10">${val.toFixed(2)}</text>`;
    if (i > 0) yTicks += `<line class="chart-grid" x1="${pad.left}" y1="${y}" x2="${pad.left + chartW}" y2="${y}"/>`;
  }

  container.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
    <line class="chart-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + chartH}"/>
    <line class="chart-axis" x1="${pad.left}" y1="${pad.top + chartH}" x2="${pad.left + chartW}" y2="${pad.top + chartH}"/>
    ${yTicks}
    ${bars}
  </svg>`;
}

// ===================== STADIUMS =====================

let stadiumsTab = "map";

function initStadiums() {
  document.getElementById("stadiums-tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (!tab) return;
    document.querySelectorAll("#stadiums-tabs .tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    stadiumsTab = tab.dataset.tab;
    renderStadiums();
  });
}

function renderStadiums() {
  if (!bootstrapData) return;
  document.getElementById("stadiums-map-tab").style.display = stadiumsTab === "map" ? "" : "none";
  document.getElementById("stadiums-regions-tab").style.display = stadiumsTab === "regions" ? "" : "none";
  document.getElementById("stadiums-distances-tab").style.display = stadiumsTab === "distances" ? "" : "none";

  if (stadiumsTab === "map") renderStadiumsMap();
  else if (stadiumsTab === "regions") renderStadiumsRegions();
  else renderStadiumsDistances();
}

async function computePLStandings() {
  if (!bootstrapData) return { standings: {}, sorted: [], posHistory: {} };
  const teams = bootstrapData.teams || [];
  const standings = {};
  for (const t of teams) {
    standings[t.id] = { id: t.id, name: t.name, short_name: t.short_name, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
  }
  const allGWs = bootstrapData.events || [];
  const finishedGWs = allGWs.filter(e => e.finished).map(e => e.id).sort((a, b) => a - b);

  let fixtures = [];
  try {
    fixtures = await fetchFPL("fixtures/");
  } catch {}

  // Compute final standings
  for (const f of fixtures) {
    if (!finishedGWs.includes(f.event)) continue;
    if (f.team_h_score == null || f.team_a_score == null) continue;
    const h = standings[f.team_h];
    const a = standings[f.team_a];
    if (!h || !a) continue;
    h.p++; a.p++;
    h.gf += f.team_h_score; h.ga += f.team_a_score;
    a.gf += f.team_a_score; a.ga += f.team_h_score;
    h.gd = h.gf - h.ga;
    a.gd = a.gf - a.ga;
    if (f.team_h_score > f.team_a_score) { h.w++; h.pts += 3; a.l++; }
    else if (f.team_h_score < f.team_a_score) { a.w++; a.pts += 3; h.l++; }
    else { h.d++; a.d++; h.pts++; a.pts++; }
  }
  const sorted = Object.values(standings).sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);

  // Compute per-GW position history
  const posHistory = {};
  for (const t of teams) { posHistory[t.id] = []; }
  const running = {};
  for (const t of teams) { running[t.id] = { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 }; }
  for (const gwId of finishedGWs) {
    const gwFixtures = fixtures.filter(f => f.event === gwId && f.team_h_score != null && f.team_a_score != null);
    for (const f of gwFixtures) {
      const h = running[f.team_h];
      const a = running[f.team_a];
      if (!h || !a) continue;
      h.p++; a.p++;
      h.gf += f.team_h_score; h.ga += f.team_a_score;
      a.gf += f.team_a_score; a.ga += f.team_h_score;
      h.gd = h.gf - h.ga; a.gd = a.gf - a.ga;
      if (f.team_h_score > f.team_a_score) { h.w++; h.pts += 3; a.l++; }
      else if (f.team_h_score < f.team_a_score) { a.w++; a.pts += 3; h.l++; }
      else { h.d++; a.d++; h.pts++; a.pts++; }
    }
    const gwSorted = Object.entries(running).map(([id, s]) => ({ id: parseInt(id), ...s }))
      .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
    for (let i = 0; i < gwSorted.length; i++) {
      if (posHistory[gwSorted[i].id]) posHistory[gwSorted[i].id].push({ gw: gwId, pos: i + 1 });
    }
  }
  return { standings, sorted, posHistory };
}

let stadiumsMapData = null;
let stadiumsMapTab = "standings";

function renderStadiumsMap() {
  const container = document.getElementById("stadiums-map");
  if (!container) return;
  if (typeof L === "undefined") return;

  if (window._stadiumsMap) { window._stadiumsMap.remove(); window._stadiumsMap = null; }

  const mapTabsEl = document.getElementById("stadiums-map-tabs");
  if (mapTabsEl && !mapTabsEl._bound) {
    mapTabsEl._bound = true;
    mapTabsEl.addEventListener("click", (e) => {
      const tab = e.target.closest("[data-maptab]");
      if (!tab) return;
      mapTabsEl.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      stadiumsMapTab = tab.dataset.maptab;
      const formToggle = document.getElementById("stadiums-form-toggle");
      if (formToggle) formToggle.style.display = stadiumsMapTab === "form" ? "block" : "none";
      renderStadiumsMap();
    });
  }

  const doInit = () => {
    requestAnimationFrame(() => {
      setTimeout(initMapNow, 60);
    });
  };

  function initMapNow() {
    if (!container.offsetWidth) { setTimeout(initMapNow, 50); return; }

    const map = L.map(container, { scrollWheelZoom: true }).setView([53.0, -1.5], 6);
    window._stadiumsMap = map;
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 18,
    }).addTo(map);

    const lang = getLang();
    const seasons = ["2025-26", "2024-25", "2023-24", "2022-23"];
    const seasonNames = { "2025-26": "25/26", "2024-25": "24/25", "2023-24": "23/24", "2022-23": "22/23" };

    async function ensureData() {
      if (!stadiumsMapData) {
        stadiumsMapData = await computePLStandings();
      }
      await loadAllFixtures();
      return stadiumsMapData;
    }

    ensureData().then(({ standings, sorted, posHistory }) => {

    const badgeLayer = L.layerGroup().addTo(map);
    const markerLayer = L.layerGroup().addTo(map);

    function clearLayers() {
      markerLayer.clearLayers();
      badgeLayer.clearLayers();
    }

    function renderStandingsView() {
      clearLayers();
      const maxPts = Math.max(...sorted.map(s => s.pts || 0), 1);
      for (const [id, t] of Object.entries(TEAM_COORDS)) {
        const tid = parseInt(id);
        const teamColor = TEAM_COLORS[tid] || "#555";
        const st = standings[tid];
        const pos = sorted.findIndex(s => s.id === tid) + 1;
        const pts = st?.pts || 0;
        const radius = 5 + (pts / maxPts) * 12;

        const marker = L.circleMarker(t.stadium, {
          radius, fillColor: teamColor, color: "#fff", weight: 1, fillOpacity: 0.9
        }).addTo(markerLayer);

        marker.bindPopup(`
          <div style="min-width:180px">
            <div style="font-weight:700;color:${teamColor};font-size:1.1rem">${pos}. ${t.name}</div>
            <div style="font-size:0.85rem;color:#888;margin-bottom:6px">${t.stadiumName}</div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px;text-align:center;margin:8px 0;font-size:0.8rem">
              <div><div style="color:#22c55e;font-weight:700">${st?.w || 0}</div><div>W</div></div>
              <div><div style="color:#f59e0b;font-weight:700">${st?.d || 0}</div><div>R</div></div>
              <div><div style="color:#ef4444;font-weight:700">${st?.l || 0}</div><div>P</div></div>
              <div><div style="font-weight:700">${st?.gf || 0}:${st?.ga || 0}</div><div>GD ${st?.gd > 0 ? "+" : ""}${st?.gd || 0}</div></div>
            </div>
            <div style="font-weight:700;color:${teamColor};font-size:1.1rem;text-align:center">${pts} pkt</div>
          </div>
        `, { maxWidth: 280 });
      }
    }

    let formGWCount = 5;

    function renderFormView() {
      clearLayers();
      const allFormPts = [];
      for (const [id] of Object.entries(TEAM_COORDS)) {
        const tid = parseInt(id);
        const hist = posHistory[tid] || [];
        const lastN = hist.slice(-formGWCount);
        if (lastN.length > 0) allFormPts.push(lastN.reduce((s, h) => s + h.pos, 0) / lastN.length);
      }
      const bestForm = allFormPts.length > 0 ? Math.min(...allFormPts) : 1;
      const worstForm = allFormPts.length > 0 ? Math.max(...allFormPts) : 20;

      for (const [id, t] of Object.entries(TEAM_COORDS)) {
        const tid = parseInt(id);
        const teamColor = TEAM_COLORS[tid] || "#555";
        const hist = posHistory[tid] || [];
        const lastN = hist.slice(-formGWCount);
        const avgPos = lastN.length > 0 ? lastN.reduce((s, h) => s + h.pos, 0) / lastN.length : 10;
        const radius = 6 + ((worstForm - avgPos) / Math.max(worstForm - bestForm, 1)) * 12;
        const formTrend = lastN.length >= 2 ? (lastN[lastN.length - 1].pos < lastN[0].pos ? "+" : lastN[lastN.length - 1].pos > lastN[0].pos ? "-" : "=") : "";
        const trendColor = formTrend === "+" ? "#22c55e" : formTrend === "-" ? "#ef4444" : "#aaa";

        const marker = L.circleMarker(t.stadium, {
          radius, fillColor: teamColor, color: "#fff", weight: 1, fillOpacity: 0.9
        }).addTo(markerLayer);

        marker.bindPopup(`
          <div style="min-width:180px">
            <div style="font-weight:700;color:${teamColor};font-size:1.1rem">${t.name}</div>
            <div style="font-size:0.85rem;color:#888">${t.stadiumName}</div>
            <div style="margin:8px 0;font-size:0.9rem">
              ${lang === "pl" ? "Forma (ostatnie " + formGWCount + " GW)" : "Form (last " + formGWCount + " GW)"}
              <span style="color:${trendColor};font-weight:700;font-size:1.1rem;margin-left:6px">${formTrend === "+" ? "▲" : formTrend === "-" ? "▼" : "—"}</span>
            </div>
            <div style="font-size:0.8rem;color:#aaa;line-height:1.6">
              ${lastN.map(h => `<div>GW${h.gw}: <span style="color:${h.pos <= 4 ? '#22c55e' : h.pos <= 10 ? '#f59e0b' : '#ef4444'}; font-weight:600">#${h.pos}</span></div>`).join("")}
            </div>
            <div style="border-top:1px solid #333;padding-top:6px;margin-top:6px;font-size:0.85rem">
              ${lang === "pl" ? "Śr. pozycja: " : "Avg position: "}<b>${avgPos.toFixed(1)}</b>
            </div>
            <div style="border-top:1px solid #333;padding-top:6px;margin-top:6px;font-size:0.8rem">
              <div style="margin-bottom:4px;font-weight:600">${lang === "pl" ? "Terminarz (5 kolejek)" : "Fixtures (5 GW)"}</div>
              <div style="display:flex;flex-wrap:wrap;gap:4px">${renderFixtureStrip(tid, 5, lang)}</div>
            </div>
          </div>
        `, { maxWidth: 280 });
      }

      setTimeout(() => {
        const formToggleEl = document.getElementById("stadiums-form-toggle");
        if (formToggleEl && !formToggleEl._bound) {
          formToggleEl._bound = true;
          formToggleEl.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-formgw]");
            if (!btn) return;
            formToggleEl.querySelectorAll("button").forEach(b => { b.style.background = "transparent"; b.style.color = ""; });
            btn.style.background = "var(--accent)";
            btn.style.color = "#fff";
            formGWCount = parseInt(btn.dataset.formgw);
            renderFormView();
          });
        }
      }, 100);
    }

    function renderHistoryView() {
      clearLayers();
      for (const [id, t] of Object.entries(TEAM_COORDS)) {
        const tid = parseInt(id);
        const teamColor = TEAM_COLORS[tid] || "#555";
        const hist = posHistory[tid] || [];
        const pos = sorted.findIndex(s => s.id === tid) + 1;
        const posTrend = hist.map(h => h.pos);
        const high = Math.min(...posTrend);
        const low = Math.max(...posTrend);

        const marker = L.circleMarker(t.stadium, {
          radius: 8, fillColor: teamColor, color: "#fff", weight: 1, fillOpacity: 0.9
        }).addTo(markerLayer);

        marker.bindPopup(`
          <div style="min-width:200px">
            <div style="font-weight:700;color:${teamColor};font-size:1.1rem">${pos}. ${t.name}</div>
            <div style="font-size:0.85rem;color:#888">${t.stadiumName}</div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;text-align:center;margin:8px 0;font-size:0.8rem">
              <div><div style="color:#22c55e;font-weight:700">#${high}</div><div style="color:#aaa">${lang === "pl" ? "Najw." : "Best"}</div></div>
              <div><div style="font-weight:700">#${pos}</div><div style="color:#aaa">${lang === "pl" ? "Teraz" : "Now"}</div></div>
              <div><div style="color:#ef4444;font-weight:700">#${low}</div><div style="color:#aaa">${lang === "pl" ? "Najn." : "Worst"}</div></div>
            </div>
            <div style="border-top:1px solid #333;padding-top:6px;font-size:0.75rem;color:#888;line-height:1.5">
              ${hist.slice(-15).map(h => `<span style="display:inline-block;width:36px;text-align:center;margin:1px;padding:2px 0;border-radius:3px;background:${h.pos <= 4 ? '#22c55e33' : h.pos <= 10 ? '#f59e0b33' : '#ef444433'};color:${h.pos <= 4 ? '#22c55e' : h.pos <= 10 ? '#f59e0b' : '#ef4444'}">${h.pos}</span>`).join(" ")}
            </div>
            <div style="font-size:0.7rem;color:#666;margin-top:4px">${lang === "pl" ? "Ostatnie 15 kolejek" : "Last 15 gameweeks"}</div>
          </div>
        `, { maxWidth: 280 });
      }
    }

    async function renderSeasonsView() {
      clearLayers();
      const teamFullNameMap = {};
      for (const t of bootstrapData.teams || []) { teamFullNameMap[t.id] = t.name; }

      for (const [id, t] of Object.entries(TEAM_COORDS)) {
        const tid = parseInt(id);
        const teamColor = TEAM_COLORS[tid] || "#555";
        const pos = sorted.findIndex(s => s.id === tid) + 1;

        const marker = L.circleMarker(t.stadium, {
          radius: 8, fillColor: teamColor, color: "#fff", weight: 1, fillOpacity: 0.9
        }).addTo(markerLayer);

        marker.bindPopup(`
          <div style="min-width:180px">
            <div style="font-weight:700;color:${teamColor};font-size:1.1rem">${t.name}</div>
            <div style="font-size:0.85rem;color:#888">${t.stadiumName}</div>
            <div style="margin:8px 0;font-size:0.85rem;color:#aaa">${lang === "pl" ? "Ładowanie danych..." : "Loading..."}</div>
          </div>
        `, { maxWidth: 280 });

        marker.on("click", async () => {
          const teamName = teamFullNameMap[tid] || "";
          const seasonResults = [];
          for (const season of seasons) {
            try {
              const rows = await fetchVaastavGW(season, "38");
              if (!rows || !rows.length) continue;
              const teamPlayers = rows.filter(r => r.team === teamName);
              if (teamPlayers.length > 0) {
                const totalPts = teamPlayers.reduce((s, r) => s + (parseInt(r.total_points) || 0), 0);
                seasonResults.push({ season: seasonNames[season], pts: totalPts });
              }
            } catch {}
          }
          const sortedSeasons = [...seasonResults].sort((a, b) => b.pts - a.pts);
          marker.setPopupContent(`
            <div style="min-width:180px">
              <div style="font-weight:700;color:${teamColor};font-size:1.1rem">${t.name}</div>
              <div style="font-size:0.85rem;color:#888">${t.stadiumName}</div>
              <div style="border-top:1px solid #333;padding-top:6px;margin-top:6px">
                <div style="font-size:0.85rem;color:#aaa;margin-bottom:4px">${lang === "pl" ? "Sezony (suma pkt)" : "Seasons (total pts)"}</div>
                <div style="font-weight:700;color:${teamColor};margin-bottom:4px">${lang === "pl" ? "Bieżący: " : "Current: "}${standings[tid]?.pts || 0} pkt</div>
                ${seasonResults.map((s, i) => `<div style="display:flex;justify-content:space-between;font-size:0.8rem;color:#ccc;padding:2px 0;${i === 0 && s.pts === sortedSeasons[0]?.pts ? 'font-weight:700;color:#ffd700' : ''}">
                  <span>${s.season}</span><span style="font-weight:700;color:${teamColor}">${s.pts} pkt</span>
                </div>`).join("")}
                ${seasonResults.length === 0 ? `<div style="font-size:0.75rem;color:#666">${lang === "pl" ? "Brak danych" : "No data"}</div>` : ""}
              </div>
            </div>
          `);
        });
      }
    }

    function renderFixturesView() {
      clearLayers();
      loadStadiumsFixtures(map);
    }

    const views = { standings: renderStandingsView, form: renderFormView, history: renderHistoryView, seasons: renderSeasonsView, fixtures: renderFixturesView };
    const viewFn = views[stadiumsMapTab] || renderStandingsView;
    viewFn();

    setTimeout(() => { if (window._stadiumsMap) window._stadiumsMap.invalidateSize(); }, 300);
    setTimeout(() => { if (window._stadiumsMap) window._stadiumsMap.invalidateSize(); }, 800);
    }); // end ensureData.then
  };
  requestAnimationFrame(doInit);
}

async function loadStadiumsFixtures(map) {
  if (!bootstrapData) return;
  const lang = getLang();
  const events = bootstrapData.events || [];
  const finished = events.filter(e => e.finished);
  if (finished.length === 0) return;
  const lastGW = finished[finished.length - 1].id;

  try {
    const fixtures = await fetchFPL(`fixtures/?event=${lastGW}`);
    if (!fixtures || !fixtures.length) return;

    const teamIdToCoord = {};
    for (const [id, t] of Object.entries(TEAM_COORDS)) {
      teamIdToCoord[parseInt(id)] = t.stadium;
    }

    const fixtureLayer = L.layerGroup().addTo(map);
    for (const f of fixtures) {
      const homeCoord = teamIdToCoord[f.team_h];
      const awayCoord = teamIdToCoord[f.team_a];
      if (!homeCoord || !awayCoord) continue;
      const homeTeam = bootstrapData.teams.find(t => t.id === f.team_h);
      const awayTeam = bootstrapData.teams.find(t => t.id === f.team_a);
      const hs = f.team_h_score ?? "?";
      const as = f.team_a_score ?? "?";
      const line = L.polyline([homeCoord, awayCoord], { color: "#ffffff44", weight: 1, dashArray: "6 4" }).addTo(fixtureLayer);
      const midLat = (homeCoord[0] + awayCoord[0]) / 2;
      const midLng = (homeCoord[1] + awayCoord[1]) / 2;
      L.marker([midLat, midLng], {
        icon: L.divIcon({ className: "", html: `<div style="font-size:10px;font-weight:700;color:#fff;background:#1a1d27cc;padding:1px 5px;border-radius:3px;white-space:nowrap">${homeTeam?.short_name || "?"} ${hs} - ${as} ${awayTeam?.short_name || "?"}</div>`, iconSize: [0, 0] })
      }).addTo(fixtureLayer);
    }

    const fixtureBtn = document.createElement("div");
    fixtureBtn.innerHTML = `<div style="padding:6px 12px;background:#1a1d27ee;border-radius:6px;position:absolute;top:10px;left:10px;z-index:1000;font-size:0.8rem;color:#aaa">${lang === "pl" ? "Mecze GW" + lastGW : "Fixtures GW" + lastGW} <button id="stadiums-toggle-fixtures" style="margin-left:6px;background:none;border:1px solid #555;color:#fff;border-radius:3px;padding:1px 6px;cursor:pointer;font-size:0.75rem">${lang === "pl" ? "Ukryj" : "Hide"}</button></div>`;
    map.getContainer().appendChild(fixtureBtn);
    setTimeout(() => {
      const toggleBtn = document.getElementById("stadiums-toggle-fixtures");
      if (toggleBtn) toggleBtn.addEventListener("click", () => {
        if (map.hasLayer(fixtureLayer)) { map.removeLayer(fixtureLayer); toggleBtn.textContent = lang === "pl" ? "Pokaż" : "Show"; }
        else { map.addLayer(fixtureLayer); toggleBtn.textContent = lang === "pl" ? "Ukryj" : "Hide"; }
      });
    }, 100);
  } catch {}
}

function renderStadiumsRegions() {
  const container = document.getElementById("stadiums-regions-tab");
  if (!container) return;
  const lang = getLang();

  let html = `<div class="stadiums-regions-grid">`;
  for (const [regionKey, region] of Object.entries(REGIONS)) {
    const teams = region.teams.map((tid) => TEAM_COORDS[tid]).filter(Boolean);
    const totalDist = [];
    for (const t of teams) {
      for (const [oppId, opp] of Object.entries(TEAM_COORDS)) {
        if (parseInt(oppId) === t) continue;
        totalDist.push(travelDistance(t, parseInt(oppId)));
      }
    }
    const avgDist = totalDist.length > 0 ? (totalDist.reduce((a, b) => a + b, 0) / totalDist.length).toFixed(0) : 0;

    html += `<div class="region-card">
      <h3 class="region-title" style="color:var(--accent)">${region.name} (${region.teams.length})</h3>
      <div style="font-size:0.8rem;color:var(--text-dim);margin-bottom:8px">${lang === "pl" ? "Śr. dystans podróży" : "Avg travel distance"}: ${avgDist} km</div>
      <div class="region-teams">`;
    for (const tid of region.teams) {
      const t = TEAM_COORDS[tid];
      const color = TEAM_COLORS[tid] || "#555";
      html += `<div class="region-team"><span class="team-color" style="background:${color}"></span>${t.name} <span style="color:var(--text-dim);font-size:0.8rem">${t.stadiumName}</span></div>`;
    }
    html += `</div></div>`;
  }
  html += `</div>`;
  container.innerHTML = html;
}

function renderStadiumsDistances() {
  const container = document.getElementById("stadiums-distances-tab");
  if (!container) return;
  const lang = getLang();
  const teamIds = Object.keys(TEAM_COORDS).map(Number);

  const distances = [];
  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) {
      distances.push({ from: teamIds[i], to: teamIds[j], dist: travelDistance(teamIds[i], teamIds[j]) });
    }
  }
  distances.sort((a, b) => a.dist - b.dist);

  const longest = distances.slice(-5).reverse();
  const shortest = distances.slice(0, 5);

  let html = `<div class="charts-row">
    <div class="chart-box"><h3 class="chart-title">${lang === "pl" ? "Najkrótsze dystanse" : "Shortest distances"}</h3>
      <table><thead><tr><th>${lang === "pl" ? "Z" : "From"}</th><th>${lang === "pl" ? "Do" : "To"}</th><th>km</th></tr></thead><tbody>
      ${shortest.map((d) => {
        const c1 = TEAM_COLORS[d.from] || "#555";
        const c2 = TEAM_COLORS[d.to] || "#555";
        return `<tr><td><span class="team-color" style="background:${c1}"></span>${TEAM_COORDS[d.from].name}</td><td><span class="team-color" style="background:${c2}"></span>${TEAM_COORDS[d.to].name}</td><td class="stat-val">${d.dist.toFixed(0)}</td></tr>`;
      }).join("")}
      </tbody></table>
    </div>
    <div class="chart-box"><h3 class="chart-title">${lang === "pl" ? "Najdłuższe dystanse" : "Longest distances"}</h3>
      <table><thead><tr><th>${lang === "pl" ? "Z" : "From"}</th><th>${lang === "pl" ? "Do" : "To"}</th><th>km</th></tr></thead><tbody>
      ${longest.map((d) => {
        const c1 = TEAM_COLORS[d.from] || "#555";
        const c2 = TEAM_COLORS[d.to] || "#555";
        return `<tr><td><span class="team-color" style="background:${c1}"></span>${TEAM_COORDS[d.from].name}</td><td><span class="team-color" style="background:${c2}"></span>${TEAM_COORDS[d.to].name}</td><td class="stat-val">${d.dist.toFixed(0)}</td></tr>`;
      }).join("")}
      </tbody></table>
    </div>
  </div>`;

  const teamDist = {};
  for (const tid of teamIds) {
    let total = 0, count = 0;
    for (const oppId of teamIds) {
      if (oppId === tid) continue;
      total += travelDistance(tid, oppId);
      count++;
    }
    teamDist[tid] = count > 0 ? total / count : 0;
  }
  const sorted = teamIds.map((t) => ({ t, dist: teamDist[t] })).sort((a, b) => b.dist - a.dist);
  const maxDist = Math.max(...sorted.map((s) => s.dist), 1);
  const svgW = 800, padL = 80, padR = 60, chartW = svgW - padL - padR;
  const barH = 20, svgH = sorted.length * (barH + 3) + 30;
  let bars = "";
  sorted.forEach((s, i) => {
    const y = i * (barH + 3) + 10;
    const w = (s.dist / maxDist) * chartW;
    const color = TEAM_COLORS[s.t] || "#555";
    bars += `<rect x="${padL}" y="${y}" width="${w}" height="${barH}" fill="${color}" rx="3" opacity="0.8"><title>${TEAM_COORDS[s.t].name}: ${s.dist.toFixed(0)} km avg</title></rect>`;
    bars += `<text x="${padL - 4}" y="${y + barH / 2 + 4}" text-anchor="end" font-size="10" fill="var(--text-dim)">${TEAM_COORDS[s.t].name}</text>`;
    bars += `<text x="${padL + w + 4}" y="${y + barH / 2 + 4}" font-size="9" fill="var(--text-dim)">${s.dist.toFixed(0)} km</text>`;
  });

  html += `<div class="chart-box" style="margin-top:16px"><h3 class="chart-title">${lang === "pl" ? "Średni dystans podróży" : "Avg travel distance per team"}</h3>
    <svg class="chart-svg" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">${bars}</svg></div>`;

  container.innerHTML = html;
}

// ===================== ARCHIVE (SEASON GAMEWEEKS) =====================

let archiveState = { season: "2025-26", gw: 1, loaded: false, data: null };

const ARCHIVE_SEASONS = [
  { v: "2025-26", l: "25/26" },
  { v: "2024-25", l: "24/25" },
  { v: "2023-24", l: "23/24" },
  { v: "2022-23", l: "22/23" },
];

function initArchive() {
  const seasonSel = document.getElementById("archive-season");
  const gwSel = document.getElementById("archive-gw");
  if (!seasonSel || !gwSel) return;

  seasonSel.innerHTML = ARCHIVE_SEASONS.map((o) => `<option value="${o.v}">${o.l}</option>`).join("");
  seasonSel.value = archiveState.season;

  seasonSel.addEventListener("change", async () => {
    archiveState.season = seasonSel.value;
    archiveState.loaded = false;
    await loadArchiveSeason();
    renderArchive();
  });

  gwSel.addEventListener("change", () => {
    archiveState.gw = parseInt(gwSel.value) || 1;
    renderArchive();
  });

  const runBtn = document.getElementById("archive-run");
  if (runBtn) runBtn.addEventListener("click", renderArchive);
}

async function loadArchiveSeason() {
  const lang = getLang();
  showArchiveState("loading");
  try {
    archiveState.data = await getVaastavSeason(archiveState.season);
    const events = archiveState.data.fixtures
      .map((f) => parseInt(f.event, 10))
      .filter((n) => n > 0);
    const maxGW = events.length ? Math.max(...events) : 38;
    const gwSel = document.getElementById("archive-gw");
    let opts = "";
    for (let g = 1; g <= maxGW; g++) opts += `<option value="${g}">GW ${g}</option>`;
    gwSel.innerHTML = opts;
    archiveState.gw = maxGW;
    gwSel.value = String(maxGW);
    archiveState.loaded = true;
  } catch (err) {
    showArchiveState("error", err.message);
  }
}

function showArchiveState(state, msg) {
  const loading = document.getElementById("archive-loading");
  const placeholder = document.getElementById("archive-placeholder");
  const results = document.getElementById("archive-results");
  if (loading) loading.style.display = state === "loading" ? "" : "none";
  if (placeholder) placeholder.style.display = state === "error" ? "" : "none";
  if (results) results.style.display = state === "results" ? "" : "none";
  if (state === "error" && placeholder) {
    let errEl = placeholder.querySelector(".error-msg");
    if (!errEl) {
      errEl = document.createElement("div");
      errEl.className = "error-msg";
      placeholder.appendChild(errEl);
    }
    errEl.textContent = `${t("common.error")}: ${msg || ""}`;
  }
}

async function renderArchive() {
  if (!archiveState.loaded || !archiveState.data) {
    await loadArchiveSeason();
    if (!archiveState.loaded) return;
  }
  const lang = getLang();
  const season = archiveState.season;
  const gw = archiveState.gw;
  const data = archiveState.data;

  const fixtures = data.fixtures.filter((f) => parseInt(f.event, 10) === gw);
  const cum = await getVaastavCumulative(season, gw);

  let rows = [];
  try { rows = await fetchVaastavGW(season, gw); } catch {}

  renderArchiveFixtures(fixtures, data.teamMap, lang);
  renderArchiveStandings(cum, data.teamMap, gw, lang);
  renderArchiveTopPerformers(rows, data.teamMap, lang);

  showArchiveState("results");
}

function renderArchiveFixtures(fixtures, teamMap, lang) {
  const el = document.getElementById("archive-fixtures");
  if (!el) return;
  if (!fixtures.length) {
    el.innerHTML = `<h3>${t("archive.fixtures")}</h3><div class="placeholder">${t("common.noData")}</div>`;
    return;
  }
  const rowsHtml = fixtures.map((f) => {
    const hId = f.team_h, aId = f.team_a;
    const h = teamMap[hId] || { name: hId, short_name: hId };
    const a = teamMap[aId] || { name: aId, short_name: aId };
    const finished = f.finished === "True" || f.finished === true;
    const score = finished ? `${f.team_h_score} - ${f.team_a_score}` : "vs";
    const hColor = TEAM_COLORS[hId] || "#555";
    const aColor = TEAM_COLORS[aId] || "#555";
    return `<div class="fixture-row">
      <span class="team-color" style="background:${hColor}"></span>
      <span class="fixture-team">${h.short_name || h.name}</span>
      <span class="fixture-score">${score}</span>
      <span class="fixture-team" style="text-align:right">${a.short_name || a.name}</span>
      <span class="team-color" style="background:${aColor}"></span>
    </div>`;
  }).join("");
  el.innerHTML = `<h3>${t("archive.fixtures")}</h3>${rowsHtml}`;
}

function renderArchiveStandings(cum, teamMap, gw, lang) {
  const el = document.getElementById("archive-standings");
  if (!el) return;
  const teams = Object.keys(cum)
    .map((tid) => ({
      id: tid,
      name: teamMap[tid]?.name || tid,
      short: teamMap[tid]?.short_name || tid,
      pts: cum[tid] || 0,
    }))
    .sort((a, b) => b.pts - a.pts);
  const rows = teams.map((tm, i) => {
    const color = TEAM_COLORS[tm.id] || "#555";
    return `<tr>
      <td class="rank-num${i < 3 ? ` rank-${i + 1}` : ""}">${i + 1}</td>
      <td><span class="team-color" style="background:${color}"></span>${tm.name}</td>
      <td class="stat-val">${tm.pts}</td>
    </tr>`;
  }).join("");
  el.innerHTML = `<h3>${t("archive.standings")} ${gw}</h3>
    <table class="archive-table"><thead><tr>
      <th>#</th><th>${t("archive.team")}</th><th>${t("archive.pts")}</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

function renderArchiveTopPerformers(rows, teamMap, lang) {
  const el = document.getElementById("archive-top");
  if (!el) return;
  const players = rows
    .map((r) => ({ ...r, pts: parseInt(r.total_points, 10) || 0 }))
    .sort((a, b) => b.pts - a.pts)
    .slice(0, 25);
  const rowsHtml = players.map((p, i) => {
    const tid = vaastavTeamId(data, p.team);
    const color = TEAM_COLORS[tid] || "#555";
    const team = teamMap[tid]?.short_name || tid;
    const opp = teamMap[p.opponent_team]?.short_name || p.opponent_team;
    const isHome = p.was_home === "True" || p.was_home === true;
    const ha = isHome ? t("archive.home") : t("archive.away");
    const g = parseInt(p.goals_scored, 10) || 0;
    const a = parseInt(p.assists, 10) || 0;
    const cs = parseInt(p.clean_sheets, 10) || 0;
    const bonus = parseInt(p.bonus, 10) || 0;
    const minutes = parseInt(p.minutes, 10) || 0;
    const xP = computeExpectedPoints(p);
    const value = (parseFloat(p.value) || 0) / 10;
    return `<tr>
      <td class="rank-num">${i + 1}</td>
      <td>${p.name}</td>
      <td><span class="team-color" style="background:${color}"></span>${team}</td>
      <td style="color:var(--text-dim)">${ha} ${opp}</td>
      <td class="stat-val">${minutes}'</td>
      <td class="stat-val">${g}</td>
      <td class="stat-val">${a}</td>
      <td class="stat-val">${cs}</td>
      <td class="stat-val">${bonus}</td>
      <td class="stat-val" style="color:var(--yellow)">${xP.toFixed(1)}</td>
      <td class="stat-val" style="font-weight:700">${p.pts}</td>
      <td style="color:var(--text-dim);font-size:0.8rem">${value.toFixed(1)}m</td>
    </tr>`;
  }).join("");
  el.innerHTML = `<h3>${t("archive.top")}</h3>
    <table class="archive-table"><thead><tr>
      <th>#</th><th>${t("archive.player")}</th><th>${t("archive.team")}</th>
      <th>${t("archive.opp")}</th><th>'</th><th>G</th><th>A</th><th>CS</th><th>B</th>
      <th>xP</th><th>${t("archive.pts")}</th><th></th>
    </tr></thead><tbody>${rowsHtml}</tbody></table>`;
}

// ===================== NAV =====================

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
    if (item.dataset.page === "stadiums" && bootstrapData) {
      setTimeout(() => renderStadiums(), 50);
    }
    if (item.dataset.page === "archive") {
      if (!archiveState.loaded) loadArchiveSeason().then(renderArchive);
      else renderArchive();
    }
    if (item.dataset.page === "myteam") {
      const tabs = document.getElementById("myteam-tabs");
      if (tabs) tabs.style.display = "";
      const idEl = document.getElementById("myteam-id");
      const mid = idEl && idEl.value ? idEl.value.trim()
        : managerIdForSeason(detectSeason(bootstrapData).replace("/", "-"));
      if (mid) renderManagerSeasons(mid);
    }
  });
}

function initLang() {
  const btn = document.getElementById("lang-btn");
  btn.textContent = getLang() === "pl" ? "EN" : "PL";
  btn.addEventListener("click", () => {
    setLang(getLang() === "pl" ? "en" : "pl");
    btn.textContent = getLang() === "pl" ? "EN" : "PL";
    applyTranslations();
    if (bootstrapData) {
      updateSeasonBanner(bootstrapData);
      renderRankings();
      renderNaStart();
      populateKetchupPlayers();
      if (homeAwayData.length > 0) renderHomeAway();
      if (Object.keys(top15AllData).length > 0) renderTop15Charts();
      if (squadBuilderSquad.length > 0) renderSquadBuilder();
      renderStadiums();
    }
  });
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

function initTableSort(tableId, sortState, renderFn, allowedFields) {
  const table = document.querySelector(`#${tableId} thead tr`);
  if (!table || table._sortBound) return;
  table._sortBound = true;
  table.addEventListener("click", (e) => {
    const th = e.target.closest("th");
    if (!th || !th.dataset.sort) return;
    const field = th.dataset.sort;
    if (!allowedFields.includes(field)) return;
    if (sortState.field === field) {
      sortState.dir = sortState.dir === "desc" ? "asc" : "desc";
    } else {
      sortState.field = field;
      sortState.dir = "desc";
    }
    table.querySelectorAll("th").forEach((h) => h.classList.remove("sort-asc", "sort-desc"));
    th.classList.add(sortState.dir === "asc" ? "sort-asc" : "sort-desc");
    renderFn();
  });
  const defaultTh = table.querySelector(`th[data-sort="${sortState.field}"]`);
  if (defaultTh) defaultTh.classList.add(sortState.dir === "asc" ? "sort-asc" : "sort-desc");
}

function initOptimizer() {
  const slider = document.getElementById("optimizer-budget");
  const display = document.getElementById("optimizer-budget-display");
  slider.addEventListener("input", () => {
    display.textContent = (slider.value / 10).toFixed(1);
  });
  document.getElementById("optimizer-run").addEventListener("click", () => {
    if (bootstrapData) runOptimizer();
  });
  const viewToggle = document.querySelector("#optimizer-pitch-wrap .optimizer-view-toggle");
  if (viewToggle && !viewToggle._bound) {
    viewToggle._bound = true;
    viewToggle.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-optview]");
      if (!btn) return;
      viewToggle.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const view = btn.dataset.optview;
      document.getElementById("optimizer-pitch").style.display = view === "pitch" ? "" : "none";
      document.getElementById("optimizer-pitch-table").style.display = view === "table" ? "" : "none";
    });
  }
  document.getElementById("optimizer-add-locked").addEventListener("click", () => {
    if (bootstrapData) addLockedPlayerRow();
  });
}

function addLockedPlayerRow() {
  const list = document.getElementById("optimizer-locked-list");
  const allPlayers = bootstrapData.elements.filter(p => p.now_cost > 0);
  const usedIds = new Set(optimizerLockedIds);
  const available = allPlayers.filter(p => !usedIds.has(p.id)).sort((a, b) => b.total_points - a.total_points);

  const row = document.createElement("div");
  row.className = "optimizer-locked-row";
  row.innerHTML = `
    <input type="text" class="optimizer-locked-input" list="optimizer-locked-datalist" placeholder="${getLang() === "pl" ? "Szukaj zawodnika..." : "Search player..."}" autocomplete="off" style="flex:1;max-width:360px;padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:0.82rem" />
    <span class="optimizer-locked-cost" style="font-size:0.8rem;color:var(--text-dim);min-width:40px"></span>
    <button class="optimizer-locked-remove" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:1.1rem;padding:2px 6px;display:none" title="Usuń">✕</button>`;
  list.appendChild(row);

  let datalist = document.getElementById("optimizer-locked-datalist");
  if (!datalist) {
    datalist = document.createElement("datalist");
    datalist.id = "optimizer-locked-datalist";
    document.body.appendChild(datalist);
  }
  datalist.innerHTML = available.map(p => {
    const teamName = getTeamName(p.team);
    const pos = getPositionShort(p.element_type);
    return `<option value="${p.web_name} (${teamName} ${pos})" data-id="${p.id}">${(p.now_cost / 10).toFixed(1)}m</option>`;
  }).join("");

  const input = row.querySelector("input");
  const costSpan = row.querySelector(".optimizer-locked-cost");
  const removeBtn = row.querySelector(".optimizer-locked-remove");

  function commitSelection() {
    const val = input.value.trim();
    const match = available.find(p => {
      const teamName = getTeamName(p.team);
      const pos = getPositionShort(p.element_type);
      return `${p.web_name} (${teamName} ${pos})` === val;
    });
    if (!match) { input.value = ""; return; }
    const pid = match.id;
    const player = match;
    optimizerLockedIds.push(pid);
    costSpan.textContent = `${(player.now_cost / 10).toFixed(1)}m`;
    input.disabled = true;
    removeBtn.style.display = "";
    updateLockedInfo();
    setTimeout(() => addLockedPlayerRow(), 0);
  }

  input.addEventListener("change", commitSelection);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commitSelection(); }
  });

  removeBtn.addEventListener("click", () => {
    const val = input.value.trim();
    const match = available.find(p => {
      const teamName = getTeamName(p.team);
      const pos = getPositionShort(p.element_type);
      return `${p.web_name} (${teamName} ${pos})` === val;
    });
    if (match) {
      optimizerLockedIds = optimizerLockedIds.filter(id => id !== match.id);
    }
    row.remove();
    updateLockedInfo();
  });

  input.focus();
}

function updateLockedInfo() {
  const lang = getLang();
  const info = document.getElementById("optimizer-locked-info");
  if (optimizerLockedIds.length === 0) {
    info.textContent = "";
    return;
  }
  const allPlayers = getOptimizedPlayers();
  const lockedCost = optimizerLockedIds.reduce((s, id) => {
    const p = allPlayers.find(x => x.id === id);
    return s + (p ? p.now_cost : 0);
  }, 0);
  info.textContent = `${optimizerLockedIds.length} ${lang === "pl" ? "zaw." : "players"} · ${(lockedCost / 10).toFixed(1)}m`;
}

function initKetchup() {
  initKetchupSearch();
  document.getElementById("ketchup-gw-count").addEventListener("change", () => {
    if (bootstrapData && ketchupSelectedId) runKetchup();
  });
  const seasonSel = document.getElementById("ketchup-season");
  if (seasonSel) seasonSel.addEventListener("change", async () => {
    try { await renderKetchupLeaders(); }
    catch (e) { console.error("Ketchup leaders render failed:", e); }
    if (!ketchupSelectedId && bootstrapData) {
      const top = bootstrapData.elements.slice().sort((a, b) => (b.total_points || 0) - (a.total_points || 0))[0];
      if (top) ketchupSelectedId = top.id;
    }
    if (bootstrapData && ketchupSelectedId) runKetchup();
  });
}

function initHomeAway() {
  document.getElementById("homeaway-run").addEventListener("click", () => {
    if (bootstrapData) runHomeAway();
  });
}

function initMyTeam() {
  const idEl = document.getElementById("myteam-id");
  if (idEl && !idEl.value && bootstrapData) {
    idEl.value = managerIdForSeason(detectSeason(bootstrapData).replace("/", "-"));
  }
  document.getElementById("myteam-run").addEventListener("click", () => {
    if (bootstrapData) runMyTeam();
  });
  document.getElementById("myteam-tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (!tab) return;
    document.querySelectorAll("#myteam-tabs .tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const tabKey = tab.dataset.tab;
    ["overview", "reserves", "captains", "gwhistory", "seasons"].forEach(k => {
      const el = document.getElementById(`myteam-${k}-tab`);
      if (el) el.style.display = k === tabKey ? "" : "none";
    });
    if (tabKey === "seasons") {
      const idEl = document.getElementById("myteam-id");
      const mid = (idEl && idEl.value && idEl.value.trim())
        ? idEl.value.trim()
        : managerIdForSeason(detectSeason(bootstrapData).replace("/", "-"));
      if (mid) renderManagerSeasons(mid);
    }
  });
  const csvRun = document.getElementById("myteam-csv-run");
  if (csvRun) csvRun.addEventListener("click", runMyTeamCSV);
  const csvFile = document.getElementById("myteam-csv-file");
  if (csvFile) csvFile.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const ta = document.getElementById("myteam-csv-input");
      if (ta) ta.value = String(reader.result || "");
    };
    reader.readAsText(file);
  });
}

function initLeader() {
  document.getElementById("leader-run").addEventListener("click", () => {
    if (bootstrapData) runLeader();
  });
}

// ===================== H2H LEAGUE =====================

let h2hTab = "standings";
let h2hLeagueId = null;
let h2hData = null;
let h2hMatches = [];
let h2hPicksCache = {};
let h2hLiveCache = {};
const H2H_CACHE_KEY = "fpl_h2h_archive";
const H2H_CACHE_VERSION = 1;

function initH2H() {
  document.getElementById("h2h-run").addEventListener("click", () => {
    if (bootstrapData) runH2H();
  });
  document.getElementById("h2h-tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (!tab) return;
    document.querySelectorAll("#h2h-tabs .tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    h2hTab = tab.dataset.tab;
    if (h2hData) renderH2HTab();
  });
}

function h2hLSKey(leagueId, gw) { return `${H2H_CACHE_KEY}_${leagueId}_gw${gw}`; }

function archiveH2HData(leagueId, gw, standingsSnapshot, matchesSnapshot) {
  try {
    const key = h2hLSKey(leagueId, gw);
    localStorage.setItem(key, JSON.stringify({ v: H2H_CACHE_VERSION, ts: Date.now(), standings: standingsSnapshot, matches: matchesSnapshot }));
  } catch {}
}

function loadH2HArchive(leagueId) {
  const archive = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(`${H2H_CACHE_KEY}_${leagueId}_gw`)) {
      const gw = parseInt(k.split("_gw")[1]);
      try { archive[gw] = JSON.parse(localStorage.getItem(k)); } catch {}
    }
  }
  return archive;
}

async function fetchH2HStandings(leagueId) {
  return fetchFPL(`leagues-h2h/${leagueId}/standings/`);
}

async function fetchH2HMatches(leagueId, page = 1) {
  return fetchFPL(`leagues-h2h-matches/league/${leagueId}/?page=${page}`);
}

async function fetchH2HLive(gw) {
  return fetchFPL(`event/${gw}/live/`);
}

async function fetchManagerPicksH2H(managerId, gw) {
  const cacheKey = `${managerId}_${gw}`;
  if (h2hPicksCache[cacheKey]) return h2hPicksCache[cacheKey];
  const data = await getManagerPicks(managerId, gw);
  h2hPicksCache[cacheKey] = data;
  return data;
}

async function runH2H() {
  const leagueId = document.getElementById("h2h-id").value?.trim();
  if (!leagueId) return;
  h2hLeagueId = leagueId;

  showSection("h2h", "loading");
  document.getElementById("h2h-table").style.display = "none";

  try {
    const standingsResp = await fetchH2HStandings(leagueId);
    const league = standingsResp.league;
    const standings = standingsResp.standings?.results || [];
    if (standings.length === 0) throw new Error("Liga nie istnieje lub nie jest publiczna");

    let allMatches = [];
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const pageResp = await fetchH2HMatches(leagueId, page);
      const pageMatches = pageResp.matches_info || [];
      allMatches = allMatches.concat(pageMatches);
      hasMore = pageMatches.length > 0 && page < (pageResp.total_pages || 1);
      page++;
    }

    const events = bootstrapData.events || [];
    const finishedGWs = events.filter(e => e.finished);
    const currentGW = events.find(e => e.is_current)?.id || 0;
    const lastFinishedGW = finishedGWs.length > 0 ? finishedGWs[finishedGWs.length - 1].id : 0;

    const managerIds = standings.map(s => s.league_entry || s.entry).filter(Boolean);

    const gwsWithMatches = [...new Set(allMatches.map(m => m.event))].sort((a, b) => a - b);

    const archive = loadH2HArchive(leagueId);
    const gwSnapshots = {};
    for (const gw of gwsWithMatches) {
      if (archive[gw]) {
        gwSnapshots[gw] = archive[gw];
      }
    }

    const gwPoints = {};
    for (const m of allMatches) {
      const gw = m.event;
      if (!gwPoints[gw]) gwPoints[gw] = {};
      const entry1 = m.league_entry_1;
      const entry2 = m.league_entry_2;
      gwPoints[gw][entry1] = (m.team_h_score ?? 0) + (m.league_entry_1_points || 0);
      gwPoints[gw][entry2] = (m.team_a_score ?? 0) + (m.league_entry_2_points || 0);
    }

    h2hData = {
      league,
      standings,
      matches: allMatches,
      gwsWithMatches,
      gwPoints,
      archive: gwSnapshots,
      managerIds,
      lastFinishedGW,
      currentGW,
    };

    const lastSnapGW = Math.max(...Object.keys(h2hData.archive).map(Number), 0);
    if (lastFinishedGW > lastSnapGW) {
      archiveH2HData(leagueId, lastFinishedGW, standings.map(s => ({
        id: s.league_entry || s.entry,
        pts: s.total ?? 0,
        rank: s.rank,
        played: s.matches_played ?? 0,
        won: s.matches_won ?? 0,
        drawn: s.matches_drawn ?? 0,
        lost: s.matches_lost ?? 0,
        pf: s.points_for ?? 0,
        pa: s.points_against ?? 0,
      })), allMatches);
    }

    document.getElementById("h2h-table").style.display = "";
    showSection("h2h", "table");
    renderH2HTab();
  } catch (err) {
    showSection("h2h", "placeholder");
    document.getElementById("h2h-placeholder").innerHTML = `<div class="placeholder-icon">⚠️</div><div style="color:var(--red)">${err.message}</div>`;
  }
}

function renderH2HTab() {
  if (!h2hData) return;
  const tabRenderers = {
    standings: renderH2HStandings,
    expected: renderH2HExpected,
    form: renderH2HForm,
    charts: renderH2HCharts,
    luck: renderH2HLuck,
    upsets: renderH2HUpsets,
    matchday: renderH2HMatchday,
    headtohead: renderH2HHeadToHead,
    fixtures: renderH2HFixtures,
    live: renderH2HLive,
    captains: renderH2HCaptains,
    variance: renderH2HVariance,
    streaks: renderH2HStreaks,
  };
  ["standings", "expected", "form", "charts", "luck", "upsets", "matchday", "headtohead", "fixtures", "live", "captains", "variance", "streaks"].forEach(k => {
    const el = document.getElementById(`h2h-${k}-tab`);
    if (el) el.style.display = k === h2hTab ? "" : "none";
  });
  const renderer = tabRenderers[h2hTab];
  if (renderer) {
    const result = renderer();
    if (result && typeof result.then === "function") result.catch(() => {});
  }
}

function h2hManagerName(entryId) {
  const s = h2hData?.standings.find(x => (x.league_entry || x.entry) === entryId);
  return s?.entry_name || s?.player_name || `Manager ${entryId}`;
}

function h2hManagerShort(entryId) {
  const name = h2hManagerName(entryId);
  return name.length > 14 ? name.substring(0, 12) + "…" : name;
}

// === 1. STANDINGS TABLE ===
function renderH2HStandings() {
  const { standings, matches, lastFinishedGW } = h2hData;
  const lang = getLang();

  const totalMatches = matches.length;
  const totalPoints = standings.reduce((s, x) => s + (x.points_for || 0), 0);
  const avgPts = totalMatches > 0 ? (totalPoints * 2 / totalMatches).toFixed(1) : "0";

  document.getElementById("h2h-standings-summary").innerHTML = `
    <div class="optimizer-stat-box"><div class="optimizer-stat-val">${standings.length}</div><div class="optimizer-stat-label">${lang === "pl" ? "Uczestników" : "Managers"}</div></div>
    <div class="optimizer-stat-box"><div class="optimizer-stat-val">${totalMatches}</div><div class="optimizer-stat-label">${lang === "pl" ? "Meczów rozegranych" : "Matches played"}</div></div>
    <div class="optimizer-stat-box"><div class="optimizer-stat-val">${avgPts}</div><div class="optimizer-stat-label">${lang === "pl" ? "Śr. pkt FPL/zawodnika" : "Avg FPL pts/player"}</div></div>
    <div class="optimizer-stat-box"><div class="optimizer-stat-val">GW${lastFinishedGW}</div><div class="optimizer-stat-label">${lang === "pl" ? "Ostatnia kolejka" : "Last GW"}</div></div>`;

  const tbody = document.getElementById("h2h-standings-body");
  const sorted = [...standings].sort((a, b) => (b.total ?? 0) - (a.total ?? 0) || ((b.points_for ?? 0) - (b.points_against ?? 0)) - ((a.points_for ?? 0) - (a.points_against ?? 0)));
  tbody.innerHTML = sorted.map((s, i) => {
    const entry = s.league_entry || s.entry;
    const pf = s.points_for ?? 0;
    const pa = s.points_against ?? 0;
    const diff = pf - pa;
    const diffColor = diff > 0 ? "var(--green)" : diff < 0 ? "var(--red)" : "var(--text-dim)";
    return `<tr>
      <td class="rank-num">${i + 1}</td>
      <td style="font-weight:600">${s.entry_name || "?"}</td>
      <td class="stat-val">${s.matches_played ?? 0}</td>
      <td class="stat-val" style="color:var(--green)">${s.matches_won ?? 0}</td>
      <td class="stat-val" style="color:var(--yellow)">${s.matches_drawn ?? 0}</td>
      <td class="stat-val" style="color:var(--red)">${s.matches_lost ?? 0}</td>
      <td class="stat-val">${pf}</td>
      <td class="stat-val">${pa}</td>
      <td class="stat-val" style="color:${diffColor};font-weight:700">${diff > 0 ? "+" : ""}${diff}</td>
      <td class="stat-val" style="font-weight:700;color:var(--accent);font-size:1.05rem">${s.total ?? 0}</td>
    </tr>`;
  }).join("");
}

// === 2. EXPECTED TABLE ===
function renderH2HExpected() {
  const { standings, gwPoints, gwsWithMatches, lastFinishedGW } = h2hData;
  const lang = getLang();

  const expected = standings.map(s => {
    const entry = s.league_entry || s.entry;
    let totalFPL = 0;
    let gwCount = 0;
    let bestGW = 0;
    let worstGW = 999;
    for (const gw of gwsWithMatches) {
      const pts = h2hData.gwPoints[gw]?.[entry] || 0;
      totalFPL += pts;
      gwCount++;
      if (pts > bestGW) bestGW = pts;
      if (pts < worstGW && pts > 0) worstGW = pts;
    }
    return {
      ...s,
      entry,
      totalFPL,
      avgFPL: gwCount > 0 ? (totalFPL / gwCount).toFixed(1) : "0",
      bestGW,
      worstGW: worstGW === 999 ? 0 : worstGW,
      ladderRank: standings.indexOf(s) + 1,
    };
  }).sort((a, b) => b.totalFPL - a.totalFPL);

  expected.forEach((e, i) => { e.expectedRank = i + 1; });

  const tbody = document.getElementById("h2h-expected-body");
  tbody.innerHTML = expected.map((e, i) => {
    const rankDiff = e.ladderRank - e.expectedRank;
    const diffColor = rankDiff > 0 ? "var(--green)" : rankDiff < 0 ? "var(--red)" : "var(--text-dim)";
    const diffText = rankDiff > 0 ? `▲${rankDiff}` : rankDiff < 0 ? `▼${Math.abs(rankDiff)}` : "—";
    return `<tr>
      <td class="rank-num">${i + 1}</td>
      <td style="font-weight:600">${e.entry_name || "?"}</td>
      <td class="stat-val" style="font-weight:700;color:var(--accent)">${e.totalFPL}</td>
      <td class="stat-val">${e.avgFPL}</td>
      <td class="stat-val" style="color:var(--green)">${e.bestGW}</td>
      <td class="stat-val" style="color:var(--red)">${e.worstGW}</td>
      <td class="stat-val" style="color:${diffColor};font-weight:600">${diffText}</td>
    </tr>`;
  }).join("");
}

// === 3. FORM ===
function renderH2HForm() {
  const { matches, standings } = h2hData;
  const lang = getLang();
  const container = document.getElementById("h2h-form-cards");

  const formMap = {};
  for (const s of standings) {
    const entry = s.league_entry || s.entry;
    formMap[entry] = [];
  }

  const sortedMatches = [...matches].sort((a, b) => (a.event || 0) - (b.event || 0));
  for (const m of sortedMatches) {
    const e1 = m.league_entry_1;
    const e2 = m.league_entry_2;
    const s1 = m.team_h_score ?? 0;
    const s2 = m.team_a_score ?? 0;
    const pts1 = m.league_entry_1_points ?? 0;
    const pts2 = m.league_entry_2_points ?? 0;
    if (formMap[e1]) {
      if (pts1 > pts2) formMap[e1].push("W");
      else if (pts1 < pts2) formMap[e1].push("L");
      else formMap[e1].push("D");
    }
    if (formMap[e2]) {
      if (pts2 > pts1) formMap[e2].push("W");
      else if (pts2 < pts1) formMap[e2].push("L");
      else formMap[e2].push("D");
    }
  }

  const formColors = { W: "var(--green)", D: "var(--yellow)", L: "var(--red)" };
  container.innerHTML = standings.map(s => {
    const entry = s.league_entry || s.entry;
    const form = formMap[entry] || [];
    const last5 = form.slice(-5);
    const formBadges = last5.map(f => `<span style="display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;border-radius:4px;font-weight:700;font-size:0.75rem;color:#fff;background:${formColors[f]}">${f}</span>`).join("");
    const wins = last5.filter(f => f === "W").length;
    const formPts = wins * 3 + last5.filter(f => f === "D").length;
    return `<div class="leader-card" style="min-width:200px">
      <div style="font-weight:600;margin-bottom:6px">${s.entry_name || "?"}</div>
      <div style="display:flex;gap:3px">${formBadges || `<span style="color:var(--text-dim);font-size:0.8rem">${lang === "pl" ? "brak danych" : "no data"}</span>`}</div>
      <div style="font-size:0.8rem;color:var(--text-dim);margin-top:4px">${lang === "pl" ? "Ostatnie 5:" : "Last 5:"} <b style="color:var(--accent)">${formPts}</b> pkt ligowych</div>
    </div>`;
  }).join("");
}

// === 4. CHARTS ===
function renderH2HCharts() {
  renderH2HCumulativeChart();
  renderH2HAdvantageChart();
}

function renderH2HCumulativeChart() {
  const container = document.getElementById("h2h-chart-cumulative");
  if (!container) return;
  const { standings, gwsWithMatches, gwPoints } = h2hData;
  const lang = getLang();

  const managers = standings.map(s => ({ id: s.league_entry || s.entry, name: s.entry_name || "?" }));
  const gws = gwsWithMatches;
  if (gws.length < 2) {
    container.innerHTML = `<div style="padding:20px;color:var(--text-dim);text-align:center">${lang === "pl" ? "Za mało kolejek do wykresu" : "Not enough GWs for chart"}</div>`;
    return;
  }

  const svgW = 700;
  const svgH = 350;
  const pad = { top: 20, right: 130, bottom: 40, left: 50 };
  const chartW = svgW - pad.left - pad.right;
  const chartH = svgH - pad.top - pad.bottom;

  const cumulative = {};
  for (const m of managers) {
    cumulative[m.id] = [];
    let total = 0;
    for (const gw of gws) {
      total += h2hData.gwPoints[gw]?.[m.id] || 0;
      cumulative[m.id].push(total);
    }
  }

  const allVals = Object.values(cumulative).flat();
  const maxVal = Math.max(...allVals, 1);
  const minVal = Math.min(...allVals, 0);
  const range = maxVal - minVal || 1;

  const colors = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316", "#10b981", "#6366f1", "#14b8a6", "#e11d48", "#84cc16", "#a855f7", "#f43f5e", "#0ea5e9", "#eab308", "#d946ef", "#fb923c", "#2dd4bf"];

  let yTicks = "";
  const ySteps = 5;
  for (let i = 0; i <= ySteps; i++) {
    const val = minVal + (range / ySteps) * i;
    const y = pad.top + chartH - (chartH / ySteps) * i;
    yTicks += `<text class="chart-label" x="${pad.left - 6}" y="${y + 3}" text-anchor="end" font-size="10">${Math.round(val)}</text>`;
    if (i > 0) yTicks += `<line class="chart-grid" x1="${pad.left}" y1="${y}" x2="${pad.left + chartW}" y2="${y}"/>`;
  }

  let xLabels = "";
  for (let i = 0; i < gws.length; i++) {
    const x = pad.left + (i / (gws.length - 1)) * chartW;
    if (i % Math.max(1, Math.floor(gws.length / 8)) === 0 || i === gws.length - 1) {
      xLabels += `<text class="chart-label" x="${x}" y="${pad.top + chartH + 18}" text-anchor="middle" font-size="10">GW${gws[i]}</text>`;
    }
  }

  let lines = "";
  let legend = "";
  managers.forEach((m, idx) => {
    const pts = cumulative[m.id] || [];
    const color = colors[idx % colors.length];
    let path = "";
    pts.forEach((v, i) => {
      const x = pad.left + (i / (gws.length - 1)) * chartW;
      const y = pad.top + chartH - ((v - minVal) / range) * chartH;
      path += (i === 0 ? "M" : " L") + ` ${x} ${y}`;
    });
    lines += `<path d="${path}" fill="none" stroke="${color}" stroke-width="2" opacity="0.85"/>`;
    const ly = pad.top + 14 + idx * 16;
    const lastVal = pts[pts.length - 1] || 0;
    legend += `<text x="${pad.left + chartW + 8}" y="${ly}" font-size="9" fill="${color}" font-weight="600">${h2hManagerShort(m.id)} (${lastVal})</text>`;
  });

  container.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
    <line class="chart-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + chartH}"/>
    <line class="chart-axis" x1="${pad.left}" y1="${pad.top + chartH}" x2="${pad.left + chartW}" y2="${pad.top + chartH}"/>
    ${yTicks}${xLabels}${lines}${legend}
  </svg>`;
}

function renderH2HAdvantageChart() {
  const container = document.getElementById("h2h-chart-advantage");
  if (!container) return;
  const { standings, matches, gwsWithMatches } = h2hData;
  const lang = getLang();
  const managers = standings.map(s => ({ id: s.league_entry || s.entry, name: s.entry_name || "?" }));

  if (gwsWithMatches.length < 2) {
    container.innerHTML = `<div style="padding:20px;color:var(--text-dim);text-align:center">${lang === "pl" ? "Za mało kolejek" : "Not enough GWs"}</div>`;
    return;
  }

  const svgW = 700;
  const svgH = 350;
  const pad = { top: 20, right: 130, bottom: 40, left: 50 };
  const chartW = svgW - pad.left - pad.right;
  const chartH = svgH - pad.top - pad.bottom;

  const margins = {};
  for (const m of managers) margins[m.id] = [];
  const sortedM = [...matches].sort((a, b) => (a.event || 0) - (b.event || 0));
  for (const m of sortedM) {
    const e1 = m.league_entry_1;
    const e2 = m.league_entry_2;
    const s1 = m.team_h_score ?? 0;
    const s2 = m.team_a_score ?? 0;
    const pts1 = m.league_entry_1_points ?? 0;
    const pts2 = m.league_entry_2_points ?? 0;
    if (margins[e1]) margins[e1].push(pts1 - pts2);
    if (margins[e2]) margins[e2].push(pts2 - pts1);
  }

  const cumulativeMargins = {};
  for (const m of managers) {
    cumulativeMargins[m.id] = [];
    let total = 0;
    for (const v of (margins[m.id] || [])) {
      total += v;
      cumulativeMargins[m.id].push(total);
    }
  }

  const allVals = Object.values(cumulativeMargins).flat();
  const maxVal = Math.max(...allVals, 1);
  const minVal = Math.min(...allVals, -1);
  const range = maxVal - minVal || 1;

  const colors = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316", "#10b981", "#6366f1", "#14b8a6", "#e11d48", "#84cc16", "#a855f7", "#f43f5e", "#0ea5e9", "#eab308", "#d946ef", "#fb923c", "#2dd4bf"];

  let yTicks = "";
  const ySteps = 5;
  for (let i = 0; i <= ySteps; i++) {
    const val = minVal + (range / ySteps) * i;
    const y = pad.top + chartH - (chartH / ySteps) * i;
    yTicks += `<text class="chart-label" x="${pad.left - 6}" y="${y + 3}" text-anchor="end" font-size="10">${Math.round(val)}</text>`;
    if (i > 0) yTicks += `<line class="chart-grid" x1="${pad.left}" y1="${y}" x2="${pad.left + chartW}" y2="${y}"/>`;
  }

  const maxLen = Math.max(...managers.map(m => (cumulativeMargins[m.id] || []).length), 1);
  let lines = "";
  let legend = "";
  managers.forEach((m, idx) => {
    const pts = cumulativeMargins[m.id] || [];
    const color = colors[idx % colors.length];
    let path = "";
    pts.forEach((v, i) => {
      const x = pad.left + (i / (maxLen - 1)) * chartW;
      const y = pad.top + chartH - ((v - minVal) / range) * chartH;
      path += (i === 0 ? "M" : " L") + ` ${x} ${y}`;
    });
    lines += `<path d="${path}" fill="none" stroke="${color}" stroke-width="2" opacity="0.85"/>`;
    const ly = pad.top + 14 + idx * 16;
    legend += `<text x="${pad.left + chartW + 8}" y="${ly}" font-size="9" fill="${color}" font-weight="600">${h2hManagerShort(m.id)}</text>`;
  });

  const zeroY = pad.top + chartH - ((0 - minVal) / range) * chartH;

  container.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
    <line class="chart-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + chartH}"/>
    <line class="chart-axis" x1="${pad.left}" y1="${pad.top + chartH}" x2="${pad.left + chartW}" y2="${pad.top + chartH}"/>
    <line x1="${pad.left}" y1="${zeroY}" x2="${pad.left + chartW}" y2="${zeroY}" stroke="#555" stroke-width="1" stroke-dasharray="4 3"/>
    ${yTicks}${lines}${legend}
  </svg>`;
}

// === 5. LUCK LEAGUE ===
function renderH2HLuck() {
  const { standings, matches } = h2hData;
  const lang = getLang();

  const luckData = standings.map(s => {
    const entry = s.league_entry || s.entry;
    const wins = [];
    for (const m of matches) {
      const isE1 = m.league_entry_1 === entry;
      const isE2 = m.league_entry_2 === entry;
      if (!isE1 && !isE2) continue;
      const myPts = isE1 ? (m.league_entry_1_points ?? 0) : (m.league_entry_2_points ?? 0);
      const oppPts = isE1 ? (m.league_entry_2_points ?? 0) : (m.league_entry_1_points ?? 0);
      if (myPts > oppPts) wins.push(myPts - oppPts);
    }
    const avgMargin = wins.length > 0 ? (wins.reduce((a, b) => a + b, 0) / wins.length) : 999;
    const closestWin = wins.length > 0 ? Math.min(...wins) : 999;
    const luckScore = wins.length > 0 ? (1 / (avgMargin + 1)) * 100 : 0;
    return { ...s, entry, wins: wins.length, avgMargin, closestWin, luckScore };
  }).sort((a, b) => b.luckScore - a.luckScore);

  const tbody = document.getElementById("h2h-luck-body");
  tbody.innerHTML = luckData.map((l, i) => {
    const avgColor = l.avgMargin <= 5 ? "var(--green)" : l.avgMargin <= 15 ? "var(--yellow)" : "var(--text-dim)";
    return `<tr>
      <td class="rank-num">${i + 1}</td>
      <td style="font-weight:600">${l.entry_name || "?"}</td>
      <td class="stat-val">${l.wins}</td>
      <td class="stat-val" style="color:${avgColor}">${l.avgMargin < 999 ? l.avgMargin.toFixed(1) : "—"}</td>
      <td class="stat-val" style="color:var(--green)">${l.closestWin < 999 ? l.closestWin : "—"}</td>
      <td class="stat-val" style="font-weight:700;color:var(--accent)">${l.luckScore.toFixed(1)}</td>
    </tr>`;
  }).join("");
}

// === 6. UPSETS ===
function renderH2HUpsets() {
  const { standings, matches } = h2hData;
  const lang = getLang();

  const totalPts = {};
  for (const s of standings) {
    const entry = s.league_entry || s.entry;
    totalPts[entry] = s.total ?? 0;
  }

  const upsets = [];
  for (const m of matches) {
    const e1 = m.league_entry_1;
    const e2 = m.league_entry_2;
    const pts1 = m.league_entry_1_points ?? 0;
    const pts2 = m.league_entry_2_points ?? 0;
    if (pts1 === pts2) continue;

    const rank1 = standings.findIndex(s => (s.league_entry || s.entry) === e1);
    const rank2 = standings.findIndex(s => (s.league_entry || s.entry) === e2);
    const winner = pts1 > pts2 ? e1 : e2;
    const loser = pts1 > pts2 ? e2 : e1;
    const winnerRank = pts1 > pts2 ? rank1 : rank2;
    const loserRank = pts1 > pts2 ? rank2 : rank1;

    if (winnerRank > loserRank) {
      const size = winnerRank - loserRank;
      upsets.push({ gw: m.event, winner, loser, score: `${pts1} - ${pts2}`, size });
    }
  }

  upsets.sort((a, b) => b.size - a.size);
  const tbody = document.getElementById("h2h-upsets-body");
  tbody.innerHTML = upsets.slice(0, 20).map(u => {
    const sizeColor = u.size >= 5 ? "var(--red)" : u.size >= 3 ? "var(--yellow)" : "var(--text-dim)";
    return `<tr>
      <td style="font-weight:600">GW${u.gw}</td>
      <td style="font-weight:600;color:var(--green)">${h2hManagerName(u.winner)}</td>
      <td style="color:var(--red)">${h2hManagerName(u.loser)}</td>
      <td class="stat-val">${u.score}</td>
      <td class="stat-val" style="color:${sizeColor};font-weight:700">${lang === "pl" ? `▲${u.size} miejsc` : `▲${u.size} spots`}</td>
    </tr>`;
  }).join("");
}

// === 7. MATCH OF THE GW ===
function renderH2HMatchday() {
  const { matches, gwsWithMatches } = h2hData;
  const lang = getLang();
  const container = document.getElementById("h2h-matchday-cards");

  const gwBest = [];
  for (const gw of gwsWithMatches) {
    const gwMatches = matches.filter(m => m.event === gw);
    let best = null;
    let bestTotal = -1;
    for (const m of gwMatches) {
      const total = (m.team_h_score ?? 0) + (m.team_a_score ?? 0);
      if (total > bestTotal) { bestTotal = total; best = m; }
    }
    if (best) gwBest.push({ gw, match: best, total: bestTotal });
  }

  container.innerHTML = gwBest.map(g => {
    const e1 = g.match.league_entry_1;
    const e2 = g.match.league_entry_2;
    const pts1 = g.match.team_h_score ?? 0;
    const pts2 = g.match.team_a_score ?? 0;
    const barMax = Math.max(pts1, pts2, 1);
    return `<div style="margin-bottom:12px;padding:10px;background:var(--bg);border-radius:8px">
      <div style="font-weight:600;color:var(--accent);margin-bottom:6px">GW${g.ww} — ${lang === "pl" ? "Mecz kolejki" : "Match of the GW"} (${g.total} ${lang === "pl" ? "pkt łącznie" : "total pts"})</div>
      <div style="display:flex;align-items:center;gap:10px">
        <div style="flex:1;text-align:right;font-weight:600">${h2hManagerShort(e1)}</div>
        <div style="flex:3;display:flex;align-items:center;gap:6px">
          <div style="flex:1;height:20px;background:var(--bg-alt);border-radius:4px;overflow:hidden;display:flex;justify-content:flex-end"><div style="width:${(pts1 / barMax) * 100}%;height:100%;background:var(--accent);border-radius:4px"></div></div>
          <div style="min-width:30px;text-align:center;font-weight:700">${pts1} - ${pts2}</div>
          <div style="flex:1;height:20px;background:var(--bg-alt);border-radius:4px;overflow:hidden"><div style="width:${(pts2 / barMax) * 100}%;height:100%;background:var(--red);border-radius:4px"></div></div>
        </div>
        <div style="flex:1;font-weight:600">${h2hManagerShort(e2)}</div>
      </div>
    </div>`;
  }).join("");
}

// === 8. HEAD-TO-HEAD HISTORY ===
function renderH2HHeadToHead() {
  const { matches } = h2hData;
  const lang = getLang();
  const container = document.getElementById("h2h-headtohead-content");

  const pairMap = {};
  for (const m of matches) {
    const e1 = m.league_entry_1;
    const e2 = m.league_entry_2;
    const key = [Math.min(e1, e2), Math.max(e1, e2)].join("-");
    if (!pairMap[key]) pairMap[key] = { e1, e2, results: [] };
    pairMap[key].results.push({
      gw: m.event,
      pts1: m.league_entry_1_points ?? 0,
      pts2: m.league_entry_2_points ?? 0,
    });
  }

  const multiPairs = Object.values(pairMap).filter(p => p.results.length > 1).sort((a, b) => b.results.length - a.results.length);

  if (multiPairs.length === 0) {
    container.innerHTML = `<div style="color:var(--text-dim);text-align:center;padding:20px">${lang === "pl" ? "Brak par, które grały ze sobą więcej niż raz" : "No pairs played each other more than once yet"}</div>`;
    return;
  }

  container.innerHTML = `<table><thead><tr>
    <th>${lang === "pl" ? "Zawodnicy" : "Players"}</th>
    <th>${lang === "pl" ? "Mecze" : "Matches"}</th>
    <th>${lang === "pl" ? "Bilans" : "Record"}</th>
    <th>${lang === "pl" ? "Szczegóły" : "Details"}</th>
  </tr></thead><tbody>
  ${multiPairs.map(p => {
    let w1 = 0, w2 = 0, d = 0;
    const details = p.results.map(r => {
      if (r.pts1 > r.pts2) w1++;
      else if (r.pts2 > r.pts1) w2++;
      else d++;
      return `GW${r.gw}: ${r.pts1}-${r.pts2}`;
    });
    return `<tr>
      <td style="font-weight:600">${h2hManagerShort(p.e1)} vs ${h2hManagerShort(p.e2)}</td>
      <td class="stat-val">${p.results.length}</td>
      <td class="stat-val" style="font-weight:700">${w1} - ${d} - ${w2}</td>
      <td style="font-size:0.8rem;color:var(--text-dim)">${details.join(", ")}</td>
    </tr>`;
  }).join("")}
  </tbody></table>`;
}

// === 9. FIXTURES ===
function renderH2HFixtures() {
  const { standings, gwsWithMatches, matches } = h2hData;
  const lang = getLang();
  const container = document.getElementById("h2h-fixtures-content");

  const events = bootstrapData.events || [];
  const allGWs = events.map(e => e.id).sort((a, b) => a - b);
  const playedGWs = new Set(matches.map(m => m.event));

  const matchByGW = {};
  for (const m of matches) {
    if (!matchByGW[m.event]) matchByGW[m.event] = [];
    matchByGW[m.event].push(m);
  }

  const upcomingGWs = allGWs.filter(gw => !playedGWs.has(gw)).slice(0, 5);
  const recentGWs = allGWs.filter(gw => playedGWs.has(gw)).slice(-3);

  let html = "";

  if (recentGWs.length > 0) {
    html += `<h3 style="margin-bottom:8px;color:var(--text-dim)">${lang === "pl" ? "Ostatnie kolejki" : "Recent GWs"}</h3>`;
    for (const gw of recentGWs) {
      const gwMatches = matchByGW[gw] || [];
      html += `<div style="margin-bottom:12px"><div style="font-weight:600;margin-bottom:4px">GW${gw}</div>`;
      for (const m of gwMatches) {
        const pts1 = m.team_h_score ?? 0;
        const pts2 = m.team_a_score ?? 0;
        const w1 = pts1 > pts2 ? "font-weight:700;color:var(--green)" : pts1 < pts2 ? "color:var(--text-dim)" : "color:var(--yellow)";
        const w2 = pts2 > pts1 ? "font-weight:700;color:var(--green)" : pts2 < pts1 ? "color:var(--text-dim)" : "color:var(--yellow)";
        html += `<div style="padding:4px 8px;font-size:0.85rem;display:flex;gap:8px;align-items:center">
          <span style="${w1}">${h2hManagerShort(m.league_entry_1)}</span>
          <span style="font-weight:700">${pts1} - ${pts2}</span>
          <span style="${w2}">${h2hManagerShort(m.league_entry_2)}</span>
        </div>`;
      }
      html += `</div>`;
    }
  }

  if (upcomingGWs.length > 0) {
    html += `<h3 style="margin:12px 0 8px;color:var(--accent)">${lang === "pl" ? "Nadchodzące kolejki" : "Upcoming GWs"}</h3>`;
    for (const gw of upcomingGWs) {
      const gwMatches = matchByGW[gw] || [];
      if (gwMatches.length === 0) {
        html += `<div style="padding:4px 8px;font-size:0.85rem;color:var(--text-dim)">GW${gw}: ${lang === "pl" ? "brak przypisanych meczów" : "no matches assigned"}</div>`;
      } else {
        html += `<div style="margin-bottom:8px"><div style="font-weight:600;margin-bottom:4px">GW${gw}</div>`;
        for (const m of gwMatches) {
          html += `<div style="padding:4px 8px;font-size:0.85rem">${h2hManagerShort(m.league_entry_1)} vs ${h2hManagerShort(m.league_entry_2)}</div>`;
        }
        html += `</div>`;
      }
    }
  }

  container.innerHTML = html || `<div style="color:var(--text-dim);text-align:center;padding:20px">${lang === "pl" ? "Brak danych o terminarzu" : "No fixture data"}</div>`;
}

// === 10. LIVE TRACKER ===
function renderH2HLive() {
  const { standings, currentGW, gwsWithMatches, matches } = h2hData;
  const lang = getLang();
  const container = document.getElementById("h2h-live-content");

  if (!currentGW || currentGW === 0) {
    container.innerHTML = `<div style="color:var(--text-dim);text-align:center;padding:20px">${lang === "pl" ? "Brak trwającej kolejki" : "No active gameweek"}</div>`;
    return;
  }

  const liveMatches = matches.filter(m => m.event === currentGW);
  if (liveMatches.length === 0) {
    container.innerHTML = `<div style="color:var(--text-dim);text-align:center;padding:20px">${lang === "pl" ? `Brak meczów H2H w GW${currentGW}` : `No H2H matches in GW${currentGW}`}</div>`;
    return;
  }

  container.innerHTML = `<div style="margin-bottom:8px;font-weight:600;color:var(--accent)">GW${currentGW} — ${lang === "pl" ? "Na żywo" : "Live"}</div>` +
    liveMatches.map(m => {
      const pts1 = m.team_h_score ?? 0;
      const pts2 = m.team_a_score ?? 0;
      const leader1 = pts1 > pts2;
      const leader2 = pts2 > pts1;
      const draw = pts1 === pts2 && pts1 > 0;
      return `<div style="padding:8px 12px;margin-bottom:6px;background:var(--bg);border-radius:8px;display:flex;align-items:center;justify-content:space-between">
        <span style="font-weight:600;${leader1 ? 'color:var(--green)' : ''}">${h2hManagerShort(m.league_entry_1)}</span>
        <span style="font-size:1.1rem;font-weight:700;color:var(--accent)">${pts1} - ${pts2}</span>
        <span style="font-weight:600;${leader2 ? 'color:var(--green)' : ''}">${h2hManagerShort(m.league_entry_2)}</span>
      </div>`;
    }).join("");
}

// === 11. CAPTAINS H2H ===
async function renderH2HCaptains() {
  const { matches, gwsWithMatches } = h2hData;
  const lang = getLang();
  const tbody = document.getElementById("h2h-captains-body");
  const sortedM = [...matches].sort((a, b) => (a.event || 0) - (b.event || 0));

  const rows = [];
  for (const m of sortedM) {
    const e1 = m.league_entry_1;
    const e2 = m.league_entry_2;
    const gw = m.event;

    let cap1Name = "?", cap1Pts = 0, cap2Name = "?", cap2Pts = 0;
    try {
      const picks1 = await fetchManagerPicksH2H(e1, gw);
      const picks2 = await fetchManagerPicksH2H(e2, gw);
      const cap1 = (picks1.picks || []).find(p => p.is_captain);
      const cap2 = (picks2.picks || []).find(p => p.is_captain);
      if (cap1) {
        const p1 = bootstrapData.elements.find(p => p.id === cap1.element);
        cap1Name = p1?.web_name || "?";
        cap1Pts = (picks1.entry_history?.points || 0);
      }
      if (cap2) {
        const p2 = bootstrapData.elements.find(p => p.id === cap2.element);
        cap2Name = p2?.web_name || "?";
        cap2Pts = (picks2.entry_history?.points || 0);
      }
    } catch {}

    const winner = cap1Pts > cap2Pts ? h2hManagerShort(e1) : cap2Pts > cap1Pts ? h2hManagerShort(e2) : "—";
    const winnerColor = cap1Pts > cap2Pts ? "var(--green)" : cap2Pts > cap1Pts ? "var(--green)" : "var(--yellow)";

    rows.push(`<tr>
      <td style="font-weight:600">GW${gw}</td>
      <td>${h2hManagerShort(e1)} vs ${h2hManagerShort(e2)}</td>
      <td>${cap1Name}</td>
      <td class="stat-val">${cap1Pts}</td>
      <td>${cap2Name}</td>
      <td class="stat-val">${cap2Pts}</td>
      <td style="color:${winnerColor};font-weight:600">${winner}</td>
    </tr>`);
  }

  tbody.innerHTML = rows.join("");
}

// === 12. VARIANCE ===
function renderH2HVariance() {
  const { standings, gwsWithMatches, gwPoints } = h2hData;
  const lang = getLang();

  const variance = standings.map(s => {
    const entry = s.league_entry || s.entry;
    const positions = [];
    const sortedGWs = [...gwsWithMatches].sort((a, b) => a - b);
    for (const gw of sortedGWs) {
      const gwMatch = h2hData.matches.filter(m => m.event === gw);
      const gwStandings = standings.map(st => ({
        id: st.league_entry || st.entry,
        pts: h2hData.gwPoints[gw]?.[st.league_entry || st.entry] || 0,
      }));
      gwStandings.sort((a, b) => b.pts - a.pts);
      const pos = gwStandings.findIndex(x => x.id === entry) + 1;
      positions.push(pos);
    }

    let maxJump = 0, maxDrop = 0, totalChange = 0;
    for (let i = 1; i < positions.length; i++) {
      const diff = positions[i - 1] - positions[i];
      if (diff > maxJump) maxJump = diff;
      if (diff < maxDrop) maxDrop = diff;
      totalChange += Math.abs(diff);
    }
    const avgChange = positions.length > 1 ? (totalChange / (positions.length - 1)).toFixed(1) : "0";
    const stability = positions.length > 1 ? (100 / (parseFloat(avgChange) + 1)).toFixed(0) : "100";

    return { ...s, entry, maxJump, maxDrop: Math.abs(maxDrop), avgChange: parseFloat(avgChange), stability: parseFloat(stability) };
  }).sort((a, b) => b.avgChange - a.avgChange);

  const tbody = document.getElementById("h2h-variance-body");
  tbody.innerHTML = variance.map((v, i) => {
    const stabColor = v.stability >= 80 ? "var(--green)" : v.stability >= 50 ? "var(--yellow)" : "var(--red)";
    return `<tr>
      <td class="rank-num">${i + 1}</td>
      <td style="font-weight:600">${v.entry_name || "?"}</td>
      <td class="stat-val" style="color:var(--green)">▲${v.maxJump}</td>
      <td class="stat-val" style="color:var(--red)">▼${v.maxDrop}</td>
      <td class="stat-val">${v.avgChange}</td>
      <td class="stat-val" style="color:${stabColor};font-weight:700">${v.stability}%</td>
    </tr>`;
  }).join("");
}

// === 13. STREAKS ===
function renderH2HStreaks() {
  const { standings, matches, gwsWithMatches } = h2hData;
  const lang = getLang();
  const container = document.getElementById("h2h-streaks-content");

  const sortedM = [...matches].sort((a, b) => (a.event || 0) - (b.event || 0));
  const entryResults = {};
  for (const s of standings) {
    const entry = s.league_entry || s.entry;
    entryResults[entry] = [];
  }

  for (const m of sortedM) {
    const e1 = m.league_entry_1;
    const e2 = m.league_entry_2;
    const pts1 = m.league_entry_1_points ?? 0;
    const pts2 = m.league_entry_2_points ?? 0;
    if (entryResults[e1]) entryResults[e1].push(pts1 > pts2 ? "W" : pts1 < pts2 ? "L" : "D");
    if (entryResults[e2]) entryResults[e2].push(pts2 > pts1 ? "W" : pts2 < pts1 ? "L" : "D");
  }

  function longestStreak(arr, val) {
    let max = 0, cur = 0;
    for (const v of arr) {
      if (v === val) { cur++; if (cur > max) max = cur; }
      else cur = 0;
    }
    return max;
  }

  function longestAtFirst(entryId) {
    const sortedGWs = [...gwsWithMatches].sort((a, b) => a - b);
    let max = 0, cur = 0;
    for (const gw of sortedGWs) {
      const gwStandings = standings.map(s => ({
        id: s.league_entry || s.entry,
        pts: h2hData.gwPoints[gw]?.[s.league_entry || s.entry] || 0,
      }));
      gwStandings.sort((a, b) => b.pts - a.pts);
      if (gwStandings[0]?.id === entryId) { cur++; if (cur > max) max = cur; }
      else cur = 0;
    }
    return max;
  }

  const streaks = standings.map(s => {
    const entry = s.league_entry || s.entry;
    const results = entryResults[entry] || [];
    return {
      ...s, entry,
      longestWin: longestStreak(results, "W"),
      longestLoss: longestStreak(results, "L"),
      longestTop1: longestAtFirst(entry),
    };
  }).sort((a, b) => b.longestWin - a.longestWin);

  container.innerHTML = `
    <h3 style="color:var(--green);margin-bottom:8px">${lang === "pl" ? "Najdłuższa passa zwycięstw" : "Longest win streak"}</h3>
    <table><thead><tr>
      <th>#</th><th>${lang === "pl" ? "Zawodnik" : "Manager"}</th><th>${lang === "pl" ? "Seria W" : "W Streak"}</th><th>${lang === "pl" ? "Seria P" : "L Streak"}</th>
    </tr></thead><tbody>
    ${streaks.map((s, i) => `<tr>
      <td class="rank-num">${i + 1}</td>
      <td style="font-weight:600">${s.entry_name || "?"}</td>
      <td class="stat-val" style="color:var(--green);font-weight:700">${s.longestWin}</td>
      <td class="stat-val" style="color:var(--red)">${s.longestLoss}</td>
    </tr>`).join("")}
    </tbody></table>

    <h3 style="color:var(--accent);margin:16px 0 8px">${lang === "pl" ? "Najdłuższy pobyt na 1. miejscu" : "Longest time at #1"}</h3>
    <table><thead><tr>
      <th>#</th><th>${lang === "pl" ? "Zawodnik" : "Manager"}</th><th>${lang === "pl" ? "Kolejek na 1." : "GWs at #1"}</th>
    </tr></thead><tbody>
    ${[...streaks].sort((a, b) => b.longestTop1 - a.longestTop1).map((s, i) => `<tr>
      <td class="rank-num">${i + 1}</td>
      <td style="font-weight:600">${s.entry_name || "?"}</td>
      <td class="stat-val" style="color:var(--accent);font-weight:700">${s.longestTop1}</td>
    </tr>`).join("")}
    </tbody></table>`;
}

renderH2HMatchday = function() {
  const { matches, gwsWithMatches } = h2hData;
  const lang = getLang();
  const container = document.getElementById("h2h-matchday-cards");
  const gwBest = [];
  for (const gw of gwsWithMatches) {
    const gwMatches = matches.filter(m => m.event === gw);
    let best = null;
    let bestTotal = -1;
    for (const m of gwMatches) {
      const total = (m.team_h_score ?? 0) + (m.team_a_score ?? 0);
      if (total > bestTotal) { bestTotal = total; best = m; }
    }
    if (best) gwBest.push({ gw, match: best, total: bestTotal });
  }
  container.innerHTML = gwBest.map(g => {
    const e1 = g.match.league_entry_1;
    const e2 = g.match.league_entry_2;
    const pts1 = g.match.team_h_score ?? 0;
    const pts2 = g.match.team_a_score ?? 0;
    const barMax = Math.max(pts1, pts2, 1);
    return `<div style="margin-bottom:12px;padding:10px;background:var(--bg);border-radius:8px">
      <div style="font-weight:600;color:var(--accent);margin-bottom:6px">GW${g.gw} — ${lang === "pl" ? "Mecz kolejki" : "Match of the GW"} (${g.total} ${lang === "pl" ? "pkt łącznie" : "total pts"})</div>
      <div style="display:flex;align-items:center;gap:10px">
        <div style="flex:1;text-align:right;font-weight:600">${h2hManagerShort(e1)}</div>
        <div style="flex:3;display:flex;align-items:center;gap:6px">
          <div style="flex:1;height:20px;background:var(--bg-alt);border-radius:4px;overflow:hidden;display:flex;justify-content:flex-end"><div style="width:${(pts1 / barMax) * 100}%;height:100%;background:var(--accent);border-radius:4px"></div></div>
          <div style="min-width:30px;text-align:center;font-weight:700">${pts1} - ${pts2}</div>
          <div style="flex:1;height:20px;background:var(--bg-alt);border-radius:4px;overflow:hidden"><div style="width:${(pts2 / barMax) * 100}%;height:100%;background:var(--red);border-radius:4px"></div></div>
        </div>
        <div style="flex:1;font-weight:600">${h2hManagerShort(e2)}</div>
      </div>
    </div>`;
  }).join("");
};

document.addEventListener("DOMContentLoaded", () => {
  initNav();
  initLang();
  applyTranslations();
  initRankingsTabs();
  initTableSort("rankings-table", currentRankingsSort, renderRankings, ["teamName", "totalPoints", "avgPoints", "playerCount"]);
  initTableSort("optimizer-table", optimizerSort, renderOptimizer, ["web_name", "now_cost", "total_points"]);
  initTableSort("homeaway-table", homeAwaySort, renderHomeAway, ["homeAvg", "awayAvg", "diff"]);
  initTableSort("nastart-table", naStartSort, renderNaStart, ["web_name", "team", "element_type", "now_cost", "total_points", "ptsPerCost"]);
  initTableSort("squadbuilder-table", squadBuilderSort, renderSquadBuilder, ["web_name", "now_cost", "total_points", "epNext", "chanceNext", "xgi", "avgFDR", "avgAwayDist", "compositeScore"]);
  initOptimizer();
  initKetchup();
  initHomeAway();
  initMyTeam();
  initLeader();
  initPriceHistorySearch();
  initTop15();
  initSquadBuilder();
  initStadiums();
  initArchive();
  initH2H();
  loadData();
  loadAllFixtures();
});
