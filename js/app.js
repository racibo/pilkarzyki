import { getBootstrapStatic, getPlayerSummary, getManagerPicks, getLeagueStandings, getFixtures, fetchVaastavGW } from "./api.js";
import { t, setLang, getLang } from "./i18n.js";
import { TEAM_COORDS, travelDistance } from "./stadiums.js";

let bootstrapData = null;
let currentRankingsTab = "gk";
let currentRankingsSort = { field: "totalPoints", dir: "desc" };
let homeAwaySort = { field: "diff", dir: "desc" };
let homeAwayData = [];
let myTeamData = null;
let naStartSort = { field: "ptsPerCost", dir: "desc" };

const TEAM_COLORS = {
  1: "#e30613", 2: "#0057a8", 3: "#ee2737", 4: "#6c1d45",
  5: "#f0102c", 6: "#c8102e", 7: "#003090", 8: "#f78f1e",
  9: "#e03a3e", 10: "#da291c", 11: "#132257", 12: "#ec1c24",
  13: "#ee2523", 14: "#c8102e", 15: "#000000", 16: "#1b1d21",
  17: "#7b2d26", 18: "#132257", 19: "#fdb913", 20: "#e4d28a",
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
const LS_VERSION = 3;
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
      id: p.id, web_name: p.web_name, team: p.team, element_type: p.element_type,
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

function updateSeasonBanner(data) {
  const banner = document.getElementById("season-banner");
  if (!banner || !data) return;
  const gw = data.events?.find((e) => e.is_current) || data.events?.[data.events.length - 1];
  const season = detectSeason(data);
  const lang = getLang();
  const finished = gw?.finished;
  const now = new Date();
  const timeStr = now.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  const dateStr = now.toLocaleDateString("pl-PL");
  const statusLine = finished
    ? `<strong>${t("common.seasonFinished")}</strong> — ${lang === "pl" ? "Dane z" : "Data from"} ${season}`
    : `GW${gw?.id ?? "?"} · ${lang === "pl" ? "Dane aktualne" : "Current data"}`;
  banner.innerHTML = `${lang === "pl" ? "Sezon" : "Season"} ${season} · ${statusLine} · ${data.elements?.length ?? "?"} ${t("common.players")} · <span style="opacity:0.6">${lang === "pl" ? "Pobrano" : "Fetched"}: ${dateStr} ${timeStr}</span>`;
}

function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    const val = t(key);
    if (val !== key) el.textContent = val;
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
  if (chartWrap && state !== "chart") chartWrap.style.display = "none";
}

async function loadData() {
  showSection("rankings", "loading");
  try {
    bootstrapData = await cachedBootstrap();
    updateSeasonBanner(bootstrapData);
    renderRankings();
    renderNaStart();
    populateKetchupPlayers();
    populateTop15GWs();
  } catch (err) {
    const body = document.getElementById("rankings-body");
    body.innerHTML = `<tr><td colspan="5"><div class="error-msg">${t("common.error")}: ${err.message}</div></td></tr>`;
    showSection("rankings", "table");
  }
}

// ===================== RANKINGS =====================

function buildRankingsData(posKey) {
  if (!bootstrapData) return [];
  const posType = { gk: 1, def: 2, mid: 3, fwd: 4 }[posKey];
  const players = bootstrapData.elements.filter((p) => p.element_type === posType && p.minutes > 0);
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

function populateKetchupPlayers() {
  if (!bootstrapData) return;
  const lang = getLang();
  ketchupPlayersList = bootstrapData.elements
    .filter((p) => p.minutes > 0)
    .sort((a, b) => b.total_points - a.total_points)
    .map((p) => ({
      id: p.id,
      name: p.web_name,
      team: getTeamName(p.team),
      pos: getPositionShort(p.element_type),
      pts: p.total_points,
    }));
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

  const gwCount = parseInt(document.getElementById("ketchup-gw-count").value);
  const allGWs = bootstrapData.events || [];
  const finishedGWs = allGWs.filter((e) => e.finished);
  const lastGW = finishedGWs.length > 0 ? finishedGWs[finishedGWs.length - 1] : allGWs[allGWs.length - 1];
  const maxGW = lastGW?.id || 38;
  const startGW = Math.max(1, maxGW - gwCount + 1);

  showSection("ketchup", "loading");

  try {
    const summary = await cachedPlayerSummary(ketchupSelectedId);
    const history = summary.history || [];
    const relevant = history
      .filter((h) => h.round >= startGW && h.round <= maxGW)
      .sort((a, b) => a.round - b.round);

    if (relevant.length === 0) {
      document.getElementById("ketchup-placeholder").style.display = "";
      document.getElementById("ketchup-chart-wrap").style.display = "none";
      showSection("ketchup", "placeholder");
      return;
    }

    const player = bootstrapData.elements.find((p) => p.id === ketchupSelectedId);
    renderKetchupChart(player, relevant, startGW, maxGW);
    showSection("ketchup", "table");
    document.getElementById("ketchup-chart-wrap").style.display = "";
    document.getElementById("ketchup-placeholder").style.display = "none";
  } catch (err) {
    document.getElementById("ketchup-placeholder").style.display = "";
    document.getElementById("ketchup-chart-wrap").style.display = "none";
    showSection("ketchup", "placeholder");
  }
}

function renderKetchupChart(player, data, startGW, maxGW) {
  const lang = getLang();
  const color = TEAM_COLORS[player.team] || "#555";
  const posClass = `pos-${getPositionShort(player.element_type).toLowerCase()}`;

  // Player info
  const infoEl = document.getElementById("ketchup-player-info");
  infoEl.innerHTML = `
    <span class="team-color" style="background:${color};width:6px;height:28px;border-radius:3px;display:inline-block"></span>
    <span class="player-name">${player.web_name}</span>
    <span class="player-team">${getTeamName(player.team)}</span>
    <span class="pos-badge ${posClass}">${getPositionShort(player.element_type)}</span>
    <span style="color:var(--text-dim);font-size:0.85rem">${(player.now_cost / 10).toFixed(1)}m · ${player.total_points} pkt</span>
  `;

  // Convert xGI to FPL points: xG*5 + xA*3 (approximate FPL scoring)
  const dataWithXP = data.map((d) => {
    const xGI = parseFloat(d.expected_goal_involvements) || 0;
    const xPts = xGI * 4; // average ~4 pts per goal involvement (blended 5+3)
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

    actualDots += `<circle cx="${x}" cy="${yActual}" r="4" fill="#3b82f6" stroke="var(--bg-card)" stroke-width="2">
      <title>GW${d.round}: ${d.total_points} pkt (${d.goals_scored || 0}G ${d.assists || 0}A)</title>
    </circle>`;

    xpDots += `<circle cx="${x}" cy="${yXP}" r="4" fill="${XP_COLOR}" stroke="var(--bg-card)" stroke-width="2">
      <title>GW${d.round}: ~${d.xPts.toFixed(1)} pkt (xP)</title>
    </circle>`;

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
  const tipExpected = lang === "pl" ? "Suma oczekiwanych punktów (xP) na podstawie modelu xG. xP to oczekiwane zaangażowanie w gole (xG + xA) przeliczone na przybliżone punkty FPL (~4 pkt za involvement)" : "Sum of expected points (xP) based on the xG model. xP is expected goal involvements (xG + xA) converted to approximate FPL pts (~4 pts per involvement)";
  const tipDiff = lang === "pl" ? "Różnica między rzeczywistymi a oczekiwanymi pkt. Dodatnia = zawodnik gra lepiej niż wskazuje xP (niedoszacowany). Ujemna = gra gorzej (przeszacowany)" : "Difference between actual and expected pts. Positive = player overperforming xP (undervalued). Negative = underperforming (overvalued)";
  const tipGA = lang === "pl" ? "Łączna liczba goli (G) i asyst (A) w wybranych kolejkach" : "Total goals (G) and assists (A) in selected gameweeks";
  const tipXP = lang === "pl" ? "Expected Points — oczekiwane punkty na podstawie modelu xG. Suma xG (oczekiwane gole) i xA (oczekiwane asysty) przeliczone na punkty FPL" : "Expected Points — expected points based on the xG model. Sum of xG (expected goals) and xA (expected assists) converted to FPL points";
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

function runOptimizer() {
  if (!bootstrapData) return;
  const budget = parseInt(document.getElementById("optimizer-budget").value);
  const allPlayers = bootstrapData.elements.filter((p) => p.minutes > 0 || p.total_points > 0);
  const maxPerTeam = 3;
  const limits = { 1: 2, 2: 5, 3: 5, 4: 3 };

  optimizerSquad = solveOptimizerFull(budget, allPlayers, maxPerTeam, limits);
  renderOptimizer();
  showSection("optimizer", "table");
  document.getElementById("optimizer-charts").style.display = "";
  renderOptimizerCharts();
}

function solveOptimizerFull(budget, allPlayers, maxPerTeam, limits) {
  const byPos = { 1: [], 2: [], 3: [], 4: [] };
  for (const p of allPlayers) byPos[p.element_type]?.push(p);

  // Value-based greedy: pick best pts/m for each slot
  const squad = [];
  const teamCount = {};
  const slotsNeeded = { 1: limits[1], 2: limits[2], 3: limits[3], 4: limits[4] };

  for (const pos of [1, 2, 3, 4]) {
    const candidates = byPos[pos]
      .filter((p) => p.now_cost > 0 && p.total_points > 0)
      .map((p) => ({ ...p, ptsPerM: p.total_points / (p.now_cost / 10) }))
      .sort((a, b) => b.ptsPerM - a.ptsPerM);

    let picked = 0;
    for (const p of candidates) {
      if (picked >= slotsNeeded[pos]) break;
      if (squad.find((s) => s.id === p.id)) continue;
      if ((teamCount[p.team] || 0) >= maxPerTeam) continue;
      squad.push({ ...p });
      teamCount[p.team] = (teamCount[p.team] || 0) + 1;
      picked++;
    }
  }

  let totalCost = squad.reduce((s, p) => s + p.now_cost, 0);

  // Upgrade phase: try to swap each slot for a better player within budget
  let improved = true;
  while (improved) {
    improved = false;
    const remaining = budget - totalCost;
    for (let i = 0; i < squad.length; i++) {
      const cur = squad[i];
      const pos = cur.element_type;
      // Sort candidates by ptsPerM descending
      const candidates = byPos[pos]
        .filter((p) => p.id !== cur.id && p.total_points > cur.total_points && !squad.find((s) => s.id === p.id))
        .sort((a, b) => {
          const aVal = a.total_points / Math.max(a.now_cost, 1);
          const bVal = b.total_points / Math.max(b.now_cost, 1);
          return bVal - aVal;
        });

      for (const candidate of candidates) {
        const costDiff = candidate.now_cost - cur.now_cost;
        if (costDiff > remaining) continue;
        if (cur.team !== candidate.team && (teamCount[candidate.team] || 0) >= maxPerTeam) continue;
        if (cur.team !== candidate.team) {
          teamCount[cur.team] = (teamCount[cur.team] || 1) - 1;
          teamCount[candidate.team] = (teamCount[candidate.team] || 0) + 1;
        }
        squad[i] = { ...candidate };
        totalCost += costDiff;
        improved = true;
        break;
      }
    }
  }

  return squad;
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

  const tbody = document.getElementById("optimizer-body");
  tbody.innerHTML = sorted.map((p, i) => {
    const color = TEAM_COLORS[p.team] || "#555";
    const posClass = `pos-${getPositionShort(p.element_type).toLowerCase()}`;
    return `<tr>
      <td class="rank-num">${i + 1}</td>
      <td>${p.web_name}</td>
      <td><span class="team-color" style="background:${color}"></span>${getTeamName(p.team)}</td>
      <td><span class="pos-badge ${posClass}">${getPositionShort(p.element_type)}</span></td>
      <td class="stat-val">${(p.now_cost / 10).toFixed(1)}</td>
      <td class="stat-val">${p.total_points}</td>
    </tr>`;
  }).join("") + `<tr class="optimizer-summary-row">
    <td colspan="4" style="font-weight:700;color:var(--accent)">${lang === "pl" ? "Podsumowanie" : "Summary"}</td>
    <td class="stat-val" style="font-weight:700;color:var(--accent)">${(totalCost / 10).toFixed(1)}m</td>
    <td class="stat-val" style="font-weight:700;color:var(--accent)">${totalPts}</td>
  </tr>
  <tr class="optimizer-summary-detail">
    <td colspan="2" style="color:var(--text-dim);font-size:0.82rem">${posCounts[1]}GK · ${posCounts[2]}DEF · ${posCounts[3]}MID · ${posCounts[4]}FWD</td>
    <td colspan="2" style="color:var(--text-dim);font-size:0.82rem">${lang === "pl" ? "Śr. cena" : "Avg price"}: ${avgCost}m · ${lang === "pl" ? "Śr. pkt" : "Avg pts"}: ${avgPts}</td>
    <td colspan="2" style="color:var(--text-dim);font-size:0.82rem">${lang === "pl" ? "Pozostało" : "Remaining"}: ${((1000 - totalCost) / 10).toFixed(1)}m</td>
  </tr>`;
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

  const budgets = [30, 35, 40, 45, 50, 55, 60, 65];
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
    dots += `<circle class="chart-dot" cx="${p.x}" cy="${p.y}" r="4">
      <title>Budżet: ${p.budget}m → ${p.pts} pkt</title>
    </circle>`;
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
  const allPlayers = bootstrapData.elements.filter((p) => p.minutes > 0 || p.total_points > 0);
  const maxPerTeam = 3;
  const limits = { 1: 2, 2: 5, 3: 5, 4: 3 };
  const squad = solveOptimizerFull(budget, allPlayers, maxPerTeam, limits);
  return {
    totalPts: squad.reduce((s, p) => s + p.total_points, 0),
    totalCost: squad.reduce((s, p) => s + p.now_cost, 0),
  };
}

// ===================== HOME / AWAY =====================

async function runHomeAway() {
  if (!bootstrapData) return;
  const posFilter = parseInt(document.getElementById("homeaway-position").value);
  const players = bootstrapData.elements
    .filter((p) => p.minutes > 0)
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
}

// ===================== MY TEAM =====================

async function runMyTeam() {
  if (!bootstrapData) return;
  const managerId = document.getElementById("myteam-id").value;
  if (!managerId) return;

  showSection("myteam", "loading");
  const loadingEl = document.getElementById("myteam-loading");
  const lang = getLang();

  try {
    const allGWs = bootstrapData.events || [];
    const finishedGWs = allGWs.filter((e) => e.finished);
    const lastGW = finishedGWs.length > 0 ? finishedGWs[finishedGWs.length - 1] : allGWs[allGWs.length - 1];
    const maxGW = lastGW?.id || 38;

    // player_id → { gw: points }
    const playerGwPoints = {};
    // player_id → times selected
    const playerSelectedCount = {};
    // player_id → points earned when selected
    const playerPtsEarned = {};
    let totalManagerPoints = 0;

    for (let gw = 1; gw <= maxGW; gw++) {
      if (loadingEl) {
        const inner = loadingEl.querySelector("div:last-child");
        if (inner) inner.textContent = `${lang === "pl" ? "Pobieranie GW" : "Fetching GW"} ${gw}/${maxGW}...`;
      }
      try {
        const picksData = await getManagerPicks(managerId, gw);
        const picks = picksData.picks || [];
        for (const pick of picks) {
          if (!playerSelectedCount[pick.element]) {
            playerSelectedCount[pick.element] = 0;
            playerPtsEarned[pick.element] = 0;
          }
          playerSelectedCount[pick.element]++;
          // We'll calculate points after fetching element summaries
        }
        // Store GW points from entry_history
        totalManagerPoints += picksData.entry_history?.points || 0;
      } catch {
        // skip failed GWs
      }
    }

    // Get current squad
    const lastPicksData = await getManagerPicks(managerId, maxGW);
    const lastPicks = lastPicksData.picks || [];
    const currentSquadIds = lastPicks.map((p) => p.element);

    // Fetch element-summary for current squad to get per-GW points
    const playerGwMap = {};
    for (const pid of currentSquadIds) {
      try {
        const summary = await cachedPlayerSummary(pid);
        playerGwMap[pid] = {};
        for (const h of (summary.history || [])) {
          playerGwMap[pid][h.round] = h.total_points;
        }
      } catch {}
    }

    // Now recalculate: for each GW, get picks and calculate points earned
    const playerActualPts = {};
    let recalcTotal = 0;
    for (let gw = 1; gw <= maxGW; gw++) {
      try {
        const picksData = await getManagerPicks(managerId, gw);
        for (const pick of (picksData.picks || [])) {
          const gwPts = playerGwMap[pick.element]?.[gw] || 0;
          const earned = gwPts * (pick.multiplier || 1);
          if (!playerActualPts[pick.element]) playerActualPts[pick.element] = 0;
          playerActualPts[pick.element] += earned;
          recalcTotal += earned;
        }
      } catch {}
    }

    const tbody = document.getElementById("myteam-body");
    tbody.innerHTML = lastPicks.map((pick, i) => {
      const player = bootstrapData.elements.find((p) => p.id === pick.element);
      if (!player) return "";
      const color = TEAM_COLORS[player.team] || "#555";
      const posClass = `pos-${getPositionShort(player.element_type).toLowerCase()}`;
      const captain = pick.is_captain ? " (C)" : pick.is_vice_captain ? " (VC)" : "";
      const ptsEarned = playerActualPts[pick.element] || 0;
      const totalPlayerPts = player.total_points || 1;
      const pct = totalPlayerPts > 0 ? ((ptsEarned / totalPlayerPts) * 100).toFixed(1) : "0.0";
      const gwsSelected = playerSelectedCount[pick.element] || 0;
      return `<tr>
        <td class="rank-num">${i + 1}</td>
        <td>${player.web_name}${captain}</td>
        <td><span class="team-color" style="background:${color}"></span>${getTeamName(player.team)}</td>
        <td><span class="pos-badge ${posClass}">${getPositionShort(player.element_type)}</span></td>
        <td class="stat-val">${ptsEarned}</td>
        <td class="stat-val" style="color:${parseFloat(pct) > 50 ? 'var(--green)' : 'var(--yellow)'}">${pct}%</td>
        <td style="color:var(--text-dim);font-size:0.8rem">${gwsSelected} ${lang === "pl" ? "kolejek" : "GWs"}</td>
      </tr>`;
    }).join("");

    tbody.innerHTML += `<tr style="border-top:2px solid var(--border)">
      <td colspan="5" style="font-weight:600;color:var(--accent)">${lang === "pl" ? "Łącznie zdobyte punkty" : "Total points earned"}</td>
      <td class="stat-val" style="font-weight:700;font-size:1.1rem;color:var(--accent)">${recalcTotal}</td>
      <td></td>
    </tr>`;

    showSection("myteam", "table");
  } catch (err) {
    document.getElementById("myteam-body").innerHTML =
      `<tr><td colspan="7"><div class="error-msg">${t("common.error")}: ${err.message}</div></td></tr>`;
    showSection("myteam", "table");
  }
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
    .filter((p) => p.minutes > 0)
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
  // Also hide chart-wrap during loading
  document.getElementById("pricehistory-chart-wrap").style.display = "none";

  try {
    if (season === "current") {
      const summary = await cachedPlayerSummary(priceHistorySelectedId);
      const history = summary.history || [];
      if (history.length === 0) {
        showSection("pricehistory", "placeholder");
        return;
      }
      renderPriceHistoryChartCurrent(history, priceHistorySelectedId);
    } else {
      const player = bootstrapData.elements.find((p) => p.id === priceHistorySelectedId);
      // Try to find by name in CSV
      const playerName = player?.web_name || player?.first_name || "";
      const allGWData = [];
      // Fetch in parallel batches of 5 for speed
      for (let batch = 0; batch < 8; batch++) {
        const promises = [];
        for (let b = 0; b < 5; b++) {
          const gw = batch * 5 + b + 1;
          if (gw > 38) break;
          promises.push(
            fetchVaastavGW(season, gw).then((csv) => {
              const match = csv.find((r) =>
                r.name && (r.name.toLowerCase().includes(playerName.toLowerCase()) ||
                (player?.first_name && r.name.toLowerCase().includes(player.first_name.toLowerCase())))
              );
              if (match) return { gw, value: parseInt(match.value) || 0, points: parseInt(match.total_points) || 0 };
              return null;
            }).catch(() => null)
          );
        }
        const results = await Promise.all(promises);
        for (const r of results) {
          if (r) allGWData.push(r);
        }
      }
      if (allGWData.length === 0) {
        showSection("pricehistory", "placeholder");
        return;
      }
      renderPriceHistoryChartCSV(allGWData, player, season);
    }
    // Show chart, hide loading/placeholder
    document.getElementById("pricehistory-loading").style.display = "none";
    document.getElementById("pricehistory-placeholder").style.display = "none";
    document.getElementById("pricehistory-chart-wrap").style.display = "";
  } catch {
    showSection("pricehistory", "placeholder");
    document.getElementById("pricehistory-chart-wrap").style.display = "none";
  }
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
    dots += `<circle cx="${x}" cy="${y}" r="3.5" fill="${color}" stroke="var(--bg-card)" stroke-width="2">
      <title>GW${rounds[i]}: ${p.toFixed(1)}m</title>
    </circle>`;
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
    dots += `<circle cx="${x}" cy="${y}" r="3.5" fill="${color}" stroke="var(--bg-card)" stroke-width="2">
      <title>GW${rounds[i]}: ${p.toFixed(1)}m</title>
    </circle>`;
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

let top15Tab = "points";
let top15Data = [];

function populateTop15GWs() {
  const gwSelect = document.getElementById("top15-gw");
  if (!bootstrapData) return;
  const allGWs = bootstrapData.events || [];
  const finishedGWs = allGWs.filter((e) => e.finished);
  gwSelect.innerHTML = finishedGWs.map((e) =>
    `<option value="${e.id}">GW${e.id}</option>`
  ).join("");
  if (finishedGWs.length > 0) {
    gwSelect.value = finishedGWs[finishedGWs.length - 1].id;
  }
}

function initTop15() {
  document.getElementById("top15-run").addEventListener("click", runTop15);

  document.getElementById("top15-tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (!tab) return;
    document.querySelectorAll("#top15-tabs .tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    top15Tab = tab.dataset.tab;
    renderTop15();
  });
}

async function runTop15() {
  if (!bootstrapData) return;
  const gw = parseInt(document.getElementById("top15-gw").value);
  if (!gw) return;

  showSection("top15", "loading");
  const loadingEl = document.getElementById("top15-loading");
  const lang = getLang();

  try {
    // Get points from bootstrap element data (all players have total_points)
    // For per-GW points, we'd need element-summary, but that's expensive.
    // Instead, use vaastav CSV which has both points and selected (ownership) per GW
    const season = detectSeason(bootstrapData);
    const seasonKey = season.replace("/", "-"); // "25/26" → "25-26"
    // Try to get data for2025-26 or2024-25
    let csvData;
    try {
      csvData = await fetchVaastavGW(seasonKey, gw);
    } catch {
      // Try previous season format
      try {
        csvData = await fetchVaastavGW("2024-25", gw);
      } catch {
        csvData = [];
      }
    }

    if (csvData.length === 0) {
      showSection("top15", "placeholder");
      return;
    }

    // Map team names to IDs
    const teamNameToId = {};
    if (bootstrapData.teams) {
      for (const team of bootstrapData.teams) {
        teamNameToId[team.name] = team.id;
        teamNameToId[team.short_name] = team.id;
      }
    }

    // Map position numbers
    const posMap = { "GKP": 1, "DEF": 2, "MID": 3, "FWD": 4 };

    top15Data = csvData.map((r) => {
      const teamId = teamNameToId[r.team] || teamNameToId[r.name?.split(" ").pop()] || 0;
      const posId = posMap[r.position] || 0;
      return {
        name: r.name || "",
        team: teamId,
        position: posId,
        points: parseInt(r.total_points) || 0,
        selected: parseInt(r.selected) || 0,
        value: parseInt(r.value) || 0,
      };
    });

    renderTop15();
    showSection("top15", "table");
  } catch {
    showSection("top15", "placeholder");
  }
}

function renderTop15() {
  const lang = getLang();
  const header = document.getElementById("top15-metric-header");

  let sorted;
  if (top15Tab === "points") {
    sorted = [...top15Data].sort((a, b) => b.points - a.points).slice(0, 15);
    header.textContent = lang === "pl" ? "Pkt" : "Pts";
  } else {
    sorted = [...top15Data].sort((a, b) => b.selected - a.selected).slice(0, 15);
    header.textContent = lang === "pl" ? "Właściciele" : "Owners";
  }

  const tbody = document.getElementById("top15-body");
  tbody.innerHTML = sorted.map((r, i) => {
    const color = TEAM_COLORS[r.team] || "#555";
    const posClass = `pos-${getPositionShort(r.position).toLowerCase()}`;
    const metric = top15Tab === "points" ? r.points : r.selected.toLocaleString();
    return `<tr>
      <td class="rank-num">${i + 1}</td>
      <td>${r.name}</td>
      <td><span class="team-color" style="background:${color}"></span>${getTeamName(r.team) || r.team}</td>
      <td><span class="pos-badge ${posClass}">${getPositionShort(r.position)}</span></td>
      <td class="stat-val">${metric}</td>
    </tr>`;
  }).join("");
}

// ===================== SQUAD BUILDER (WEIGHTED) =====================

let squadBuilderSort = { field: "compositeScore", dir: "desc" };
let squadBuilderSquad = [];

function initSquadBuilder() {
  // Weight slider live update
  document.querySelectorAll(".weight-slider").forEach((slider) => {
    const valEl = slider.parentElement.querySelector(".weight-val");
    slider.addEventListener("input", () => {
      valEl.textContent = slider.value;
    });
  });

  document.getElementById("squadbuilder-run").addEventListener("click", runSquadBuilder);
}

function getWeights() {
  const weights = {};
  document.querySelectorAll(".weight-slider").forEach((slider) => {
    weights[slider.dataset.weight] = parseInt(slider.value) / 100;
  });
  return weights;
}

async function runSquadBuilder() {
  if (!bootstrapData) return;
  const weights = getWeights();
  const lang = getLang();

  showSection("squadbuilder", "loading");
  const loadingEl = document.getElementById("squadbuilder-loading");
  document.getElementById("squadbuilder-charts").style.display = "none";

  try {
    // Fetch fixtures for fixture difficulty
    let fixtures = [];
    try {
      fixtures = await getFixtures();
    } catch {}

    // Get all players with minutes
    const allPlayers = bootstrapData.elements.filter((p) => p.minutes > 0 || p.total_points > 0);

    // Normalize each factor across all players (0-1 scale)
    const maxForm = Math.max(...allPlayers.map((p) => parseFloat(p.form) || 0), 1);
    const maxXPts = Math.max(...allPlayers.map((p) => (parseFloat(p.expected_goals) || 0) + (parseFloat(p.expected_assists) || 0)), 0.01);
    const maxMinutes = Math.max(...allPlayers.map((p) => p.minutes || 0), 1);

    // Calculate fixture difficulty per team (average of all fixtures)
    const teamFDR = {};
    if (Array.isArray(fixtures)) {
      const fdrCounts = {};
      const fdrSums = {};
      for (const f of fixtures) {
        if (f.team_h && f.team_h_difficulty) {
          fdrCounts[f.team_h] = (fdrCounts[f.team_h] || 0) + 1;
          fdrSums[f.team_h] = (fdrSums[f.team_h] || 0) + f.team_h_difficulty;
        }
        if (f.team_a && f.team_a_difficulty) {
          fdrCounts[f.team_a] = (fdrCounts[f.team_a] || 0) + 1;
          fdrSums[f.team_a] = (fdrSums[f.team_a] || 0) + f.team_a_difficulty;
        }
      }
      for (const teamId of Object.keys(fdrCounts)) {
        teamFDR[teamId] = fdrSums[teamId] / fdrCounts[teamId];
      }
    }
    const maxFDR = Math.max(...Object.values(teamFDR), 5);
    const minFDR = Math.min(...Object.values(teamFDR), 1);
    const fdrRange = maxFDR - minFDR || 1;

    // Calculate composite score for each player
    const scored = allPlayers.map((p) => {
      const form = (parseFloat(p.form) || 0) / maxForm;
      const fdr = teamFDR[p.team] || 3;
      const fixture = 1 - ((fdr - minFDR) / fdrRange); // lower FDR = better = higher score
      const xGI = (parseFloat(p.expected_goals) || 0) + (parseFloat(p.expected_assists) || 0);
      const xpts = xGI / maxXPts;
      const mins = (p.minutes || 0) / maxMinutes;

      // Home/Away: estimate from total_points and home/away bias
      // Use selected_by_percent as a proxy for "good away team" (teams with good away records attract more owners)
      // Actually, just use form + xGI combo as home/away proxy since we can't easily get per-player home/away without element-summary
      const homeaway = form * 0.5 + xpts * 0.5; // combined proxy

      // Distance: lower is better. Calculate avg away travel for team's remaining fixtures
      // For simplicity: use team's avg distance to all other PL stadiums
      let avgDist = 0;
      let distCount = 0;
      for (const oppId of Object.keys(TEAM_COORDS).map(Number)) {
        if (oppId === p.team) continue;
        const d = travelDistance(p.team, oppId);
        avgDist += d;
        distCount++;
      }
      avgDist = distCount > 0 ? avgDist / distCount : 0;
      const maxDist = 400; // rough max avg in PL
      const distance = 1 - Math.min(avgDist / maxDist, 1);

      const composite =
        (weights.form || 0) * form +
        (weights.fixture || 0) * fixture +
        (weights.homeaway || 0) * homeaway +
        (weights.xpts || 0) * xpts +
        (weights.minutes || 0) * mins +
        (weights.distance || 0) * distance;

      return { ...p, compositeScore: +composite.toFixed(4), avgAwayDist: Math.round(avgDist) };
    });

    // Greedy squad selection
    const maxPerTeam = 3;
    const limits = { 1: 2, 2: 5, 3: 5, 4: 3 };
    const squad = [];
    const teamCount = {};

    for (const pos of [1, 2, 3, 4]) {
      const candidates = scored
        .filter((p) => p.element_type === pos && p.now_cost > 0)
        .sort((a, b) => b.compositeScore - a.compositeScore);

      let picked = 0;
      for (const p of candidates) {
        if (picked >= limits[pos]) break;
        if (squad.find((s) => s.id === p.id)) continue;
        if ((teamCount[p.team] || 0) >= maxPerTeam) continue;
        squad.push({ ...p });
        teamCount[p.team] = (teamCount[p.team] || 0) + 1;
        picked++;
      }
    }

    // Upgrade phase
    let totalCost = squad.reduce((s, p) => s + p.now_cost, 0);
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < squad.length; i++) {
        const cur = squad[i];
        const pos = cur.element_type;
        const candidates = scored
          .filter((p) => p.element_type === pos && p.id !== cur.id && p.compositeScore > cur.compositeScore && !squad.find((s) => s.id === p.id))
          .sort((a, b) => b.compositeScore - a.compositeScore);

        for (const c of candidates) {
          const costDiff = c.now_cost - cur.now_cost;
          if (costDiff > (1000 - totalCost)) continue;
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
    renderSquadBuilder();
    showSection("squadbuilder", "table");
    document.getElementById("squadbuilder-charts").style.display = "";
    renderSquadBuilderCharts();
  } catch {
    document.getElementById("squadbuilder-charts").style.display = "none";
    showSection("squadbuilder", "placeholder");
  }
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
    return `<tr>
      <td class="rank-num">${i + 1}</td>
      <td>${p.web_name}</td>
      <td><span class="team-color" style="background:${color}"></span>${getTeamName(p.team)}</td>
      <td><span class="pos-badge ${posClass}">${getPositionShort(p.element_type)}</span></td>
      <td class="stat-val">${(p.now_cost / 10).toFixed(1)}</td>
      <td class="stat-val">${p.total_points}</td>
      <td class="stat-val" style="color:var(--text-dim)">${p.avgAwayDist || 0} km</td>
      <td class="stat-val" style="color:var(--accent)">${p.compositeScore.toFixed(3)}</td>
    </tr>`;
  }).join("") + `<tr class="optimizer-summary-row">
    <td colspan="5" style="font-weight:700;color:var(--accent)">${lang === "pl" ? "Podsumowanie" : "Summary"}</td>
    <td class="stat-val" style="font-weight:700;color:var(--accent)">${totalPts}</td>
    <td class="stat-val" style="font-weight:600">${(sorted.reduce((s, p) => s + (p.avgAwayDist || 0), 0) / Math.max(sorted.length, 1)).toFixed(0)} km</td>
    <td class="stat-val" style="font-weight:700;color:var(--accent)">${(totalCost / 10).toFixed(1)}m</td>
  </tr>`;
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
      if (top15Data.length > 0) renderTop15();
      if (squadBuilderSquad.length > 0) renderSquadBuilder();
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
  if (!table) return;
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
}

function initKetchup() {
  initKetchupSearch();
  document.getElementById("ketchup-gw-count").addEventListener("change", () => {
    if (bootstrapData && ketchupSelectedId) runKetchup();
  });
}

function initHomeAway() {
  document.getElementById("homeaway-run").addEventListener("click", () => {
    if (bootstrapData) runHomeAway();
  });
}

function initMyTeam() {
  document.getElementById("myteam-run").addEventListener("click", () => {
    if (bootstrapData) runMyTeam();
  });
}

function initLeader() {
  document.getElementById("leader-run").addEventListener("click", () => {
    if (bootstrapData) runLeader();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initNav();
  initLang();
  applyTranslations();
  initRankingsTabs();
  initTableSort("rankings-table", currentRankingsSort, renderRankings, ["teamName", "totalPoints", "avgPoints", "playerCount"]);
  initTableSort("optimizer-table", optimizerSort, renderOptimizer, ["web_name", "now_cost", "total_points"]);
  initTableSort("homeaway-table", homeAwaySort, renderHomeAway, ["homeAvg", "awayAvg", "diff"]);
  initTableSort("nastart-table", naStartSort, renderNaStart, ["web_name", "team", "element_type", "now_cost", "total_points", "ptsPerCost"]);
  initOptimizer();
  initKetchup();
  initHomeAway();
  initMyTeam();
  initLeader();
  initPriceHistorySearch();
  initTop15();
  initSquadBuilder();
  loadData();
});
