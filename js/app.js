import { getBootstrapStatic, getPlayerSummary, getManagerPicks, getLeagueStandings, getFixtures, fetchVaastavGW, fetchFPL } from "./api.js";
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

function updateOptimizerSlider() {
  if (!bootstrapData) return;
  const allPlayers = bootstrapData.elements.filter((p) => p.minutes > 0 || p.total_points > 0);
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
    updateSeasonBanner(bootstrapData);
    renderRankings();
    renderNaStart();
    populateKetchupPlayers();
    populateTop15GWs();
    updateOptimizerSlider();
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
let ketchupLeadersShowCount = { underrated: 5, overrated: 5 };
let ketchupFilterState = { pos: "0", team: "0", gws: "10" };

function populateKetchupPlayers() {
  if (!bootstrapData) return;
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

function getKetchupLeadersData() {
  if (!bootstrapData) return [];
  const posFilter = parseInt(ketchupFilterState.pos);
  const teamFilter = parseInt(ketchupFilterState.team);
  const gwFilter = parseInt(ketchupFilterState.gws);

  const allGWs = bootstrapData.events || [];
  const finishedGWs = allGWs.filter(e => e.finished);
  const maxGW = finishedGWs.length > 0 ? finishedGWs[finishedGWs.length - 1].id : 38;

  let players = bootstrapData.elements.filter(p => p.minutes > 0 && p.total_points > 0);
  if (posFilter > 0) players = players.filter(p => p.element_type === posFilter);
  if (teamFilter > 0) players = players.filter(p => p.team === teamFilter);

  if (gwFilter > 0) {
    return players.map(p => {
      const xGI_all = (parseFloat(p.expected_goals) || 0) + (parseFloat(p.expected_assists) || 0);
      const xPts_all = xGI_all * 4;
      const seasonPts = p.total_points;
      const scale = gwFilter / Math.max(finishedGWs.length, 1);
      const approxPts = Math.round(seasonPts * scale);
      const approxXPts = xPts_all * scale;
      const diff = approxPts - approxXPts;
      return { ...p, xPts: approxXPts, diff, pts: approxPts };
    });
  }

  return players.map(p => {
    const xGI = (parseFloat(p.expected_goals) || 0) + (parseFloat(p.expected_assists) || 0);
    const xPts = xGI * 4;
    const diff = p.total_points - xPts;
    return { ...p, xPts, diff, pts: p.total_points };
  });
}

function renderKetchupLeaders() {
  const lang = getLang();
  const el = document.getElementById("ketchup-leaders");
  if (!el) return;

  populateKetchupTeamFilter();

  const scored = getKetchupLeadersData();
  const totalFiltered = scored.length;
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
        <span style="margin-left:auto;font-weight:700;color:${color}">${p.diff >= 0 ? '+' : ''}${p.diff.toFixed(1)}</span>
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

  const uTitle = lang === "pl" ? "Niedoszacowani (grają ponad xP)" : "Underrated (overperforming xP)";
  const oTitle = lang === "pl" ? "Przeszacowani (grają poniżej xP)" : "Overrated (underperforming xP)";

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

  const result = solveOptimizerFull(budget, allPlayers, maxPerTeam, limits);
  optimizerSquad = result.squad;

  if (!result.success) {
    const lang = getLang();
    const tbody = document.getElementById("optimizer-body");
    tbody.innerHTML = `<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--red)">
      <div style="font-size:1.1rem;font-weight:600;margin-bottom:6px">${lang === "pl" ? "Za mały budżet" : "Budget too low"}</div>
      <div style="font-size:0.9rem;color:var(--text-dim)">${lang === "pl" ? "Nie udało się wybrać 15 zawodników w tym budżecie. Zwiększ budżet na suwaku." : "Could not select 15 players within this budget. Increase the budget slider."}</div>
    </td></tr>`;
    showSection("optimizer", "table");
    document.getElementById("optimizer-charts").style.display = "none";
    return;
  }

  renderOptimizer();
  showSection("optimizer", "table");
  document.getElementById("optimizer-charts").style.display = "";
  renderOptimizerCharts();
}

function solveOptimizerFull(budget, allPlayers, maxPerTeam, limits) {
  const byPos = { 1: [], 2: [], 3: [], 4: [] };
  for (const p of allPlayers) {
    if (p.element_type in byPos) byPos[p.element_type].push(p);
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
  const teamCount = {};
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
    <td colspan="2" style="color:var(--text-dim);font-size:0.82rem">${lang === "pl" ? "Pozostało" : "Remaining"}: ${remaining}m</td>
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

async function runMyTeam() {
  if (!bootstrapData) return;
  const managerId = document.getElementById("myteam-id").value;
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

    const gwPicksData = {};
    let totalManagerPoints = 0;

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

    const gws = Object.keys(gwPicksData).map(Number).sort((a, b) => a - b);
    if (gws.length === 0) {
      showSection("myteam", "placeholder");
      return;
    }

    const allPlayerIds = new Set();
    for (const gw of gws) {
      for (const pick of (gwPicksData[gw].picks || [])) {
        allPlayerIds.add(pick.element);
      }
    }

    const playerGwMap = {};
    for (const pid of allPlayerIds) {
      try {
        const summary = await cachedPlayerSummary(pid);
        playerGwMap[pid] = {};
        for (const h of (summary.history || [])) {
          playerGwMap[pid][h.round] = h.total_points;
        }
      } catch {}
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
        bestPlayerName, bestPlayerPts,
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

    // === REZERWOwi TAB — full per-GW bench breakdown ===
    const worstBench = [...reserveLost].sort((a, b) => b.benchPts - a.benchPts).slice(0, 5);
    const avgBenchPts = gws.length > 0 ? (totalBenchLost / gws.length).toFixed(1) : "0";
    const maxBenchGW = reserveLost.length > 0 ? reserveLost.reduce((m, r) => r.benchPts > m.benchPts ? r : m, reserveLost[0]) : null;
    const benchZeroCount = reserveLost.filter(r => r.benchPts === 0).length;
    const benchPositiveGWs = reserveLost.filter(r => r.benchPts > 0);

    // Per-GW full bench breakdown
    const benchTableRows = gws.map(gw => {
      const picksData = gwPicksData[gw];
      const picks = picksData.picks || [];
      const bench = picks.filter(p => p.position > 11);
      const starting = picks.filter(p => p.position <= 11);
      const benchInfo = bench.map(b => {
        const player = bootstrapData.elements.find(p => p.id === b.element);
        const pts = playerGwMap[b.element]?.[gw] || 0;
        // find cheapest starter in same position that bench player could replace
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
      <h3 style="padding:12px 16px;color:var(--yellow)">${lang === "pl" ? "TOP 5 kolejek z największą stratą na ławce" : "TOP 5 worst bench losses"}</h3>
      ${worstBench.map(r => `<div class="leader-row" style="padding:8px 16px">
        <span style="font-weight:600;min-width:50px">GW${r.gw}</span>
        <span style="color:var(--red);font-weight:700;margin-left:8px">-${r.benchPts} pkt</span>
        <span style="color:var(--text-dim);font-size:0.82rem;margin-left:auto">${r.benchNames}</span>
      </div>`).join("")}

      <h3 style="padding:12px 16px;color:var(--green);margin-top:12px">${lang === "pl" ? "Podsumowanie ławki" : "Bench summary"}</h3>
      <div style="padding:8px 16px;display:flex;flex-wrap:wrap;gap:12px">
        <div class="leader-card" style="flex:1;min-width:140px"><h3 style="color:var(--red);font-size:0.9rem">🪑 ${lang === "pl" ? "Stracone" : "Lost"}</h3>
          <div style="font-size:1.3rem;font-weight:700;color:var(--red)">${totalBenchLost} pkt</div>
          <div style="color:var(--text-dim);font-size:0.8rem">${avgBenchPts} pkt/kolejkę</div></div>
        <div class="leader-card" style="flex:1;min-width:140px"><h3 style="color:var(--yellow);font-size:0.9rem">🔄 ${lang === "pl" ? "Możliwe zyski" : "Opportunity gain"}</h3>
          <div style="font-size:1.3rem;font-weight:700;color:var(--yellow)">${totalOppGain} pkt</div>
          <div style="color:var(--text-dim);font-size:0.8rem">${lang === "pl" ? "gdyby zmienić ławkę" : "if bench swapped"}</div></div>
        <div class="leader-card" style="flex:1;min-width:140px"><h3 style="color:var(--green);font-size:0.9rem">🎯 ${lang === "pl" ? "Kolejki bez strat" : "Zero-loss GWs"}</h3>
          <div style="font-size:1.3rem;font-weight:700;color:var(--green)">${benchZeroCount}</div>
          <div style="color:var(--text-dim);font-size:0.8rem">${lang === "pl" ? `z ${gws.length} kolejek` : `of ${gws.length} GWs`}</div></div>
        <div class="leader-card" style="flex:1;min-width:140px"><h3 style="color:var(--accent);font-size:0.9rem">📊 ${lang === "pl" ? "Najgorszy GW" : "Worst GW"}</h3>
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

    // === KAPITANOWIE TAB — expanded analysis ===
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
      <h3 style="padding:12px 16px;color:var(--green)">${lang === "pl" ? "Podsumowanie kapitanów" : "Captain summary"}</h3>
      <div style="padding:8px 16px;display:flex;flex-wrap:wrap;gap:12px">
        <div class="leader-card" style="flex:1;min-width:140px"><h3 style="color:var(--green);font-size:0.9rem">✅ ${lang === "pl" ? "Najlepszy wybór" : "Best pick"}</h3>
          <div style="font-size:1.3rem;font-weight:700;color:var(--green)">${captainBestCount}/${gws.length}</div>
          <div style="color:var(--text-dim);font-size:0.8rem">${((captainBestCount / gws.length) * 100).toFixed(0)}% ${lang === "pl" ? "kolejek" : "GWs"}</div></div>
        <div class="leader-card" style="flex:1;min-width:140px"><h3 style="color:var(--yellow);font-size:0.9rem">🟡 ${lang === "pl" ? "W top 3" : "In top 3"}</h3>
          <div style="font-size:1.3rem;font-weight:700;color:var(--yellow)">${captainTop3Count}/${gws.length}</div>
          <div style="color:var(--text-dim);font-size:0.8rem">${((captainTop3Count / gws.length) * 100).toFixed(0)}%</div></div>
        <div class="leader-card" style="flex:1;min-width:140px"><h3 style="color:var(--accent);font-size:0.9rem">🎯 ${lang === "pl" ? "Skuteczność" : "Efficiency"}</h3>
          <div style="font-size:1.3rem;font-weight:700;color:var(--accent)">${capEfficiency}%</div>
          <div style="color:var(--text-dim);font-size:0.8rem">${lang === "pl" ? "vs max możliwe" : "vs max possible"}</div></div>
        <div class="leader-card" style="flex:1;min-width:140px"><h3 style="color:var(--blue);font-size:0.9rem">📊 ${lang === "pl" ? "Średnia C" : "Avg C pts"}</h3>
          <div style="font-size:1.3rem;font-weight:700;color:var(--blue)">${capAvgPts}</div>
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
        const statusText = c.wasCaptainBest ? "✅ C" : c.wasCaptainInTop3 ? "🟡 Top3" : "❌";
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

      <h3 style="padding:12px 16px;color:var(--blue);margin-top:12px">${lang === "pl" ? "Vice-Kapitan — analiza" : "Vice-Captain analysis"}</h3>
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
          <td style="color:${v.vcBetter ? 'var(--green)' : 'var(--red)'};font-weight:600">${v.vcBetter ? "✅" : "❌"}</td>
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
        <span style="color:var(--red);font-weight:600">💀 ${lang === "pl" ? "Najgorszy wybór C" : "Worst captain pick"}:</span>
        <span style="color:var(--text-dim)"> GW${worstMiss.gw} — ${worstMiss.captainName} (${worstMiss.captainPts} pkt) vs ${worstMiss.bestPlayerName} (${worstMiss.bestPlayerPts} pkt, strata ${worstMiss.bestPlayerPts * 2 - worstMiss.captainPts} pkt)</span>
      </div>` : ""}`;

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

    document.getElementById("myteam-loading").style.display = "none";
    showSection("myteam", "table");
    document.getElementById("myteam-overview-tab").style.display = "";
    ["reserves", "captains", "gwhistory"].forEach(k => {
      document.getElementById(`myteam-${k}-tab`).style.display = "none";
    });
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
  document.getElementById("pricehistory-chart-wrap").style.display = "none";

  try {
    if (season === "all") {
      await runPriceHistoryMultiSeason();
    } else if (season === "current") {
      const summary = await cachedPlayerSummary(priceHistorySelectedId);
      const history = summary.history || [];
      if (history.length === 0) { showSection("pricehistory", "placeholder"); return; }
      renderPriceHistoryChartCurrent(history, priceHistorySelectedId);
    } else {
      const player = bootstrapData.elements.find(p => p.id === priceHistorySelectedId);
      const playerName = player?.web_name || player?.first_name || "";
      const allGWData = [];
      for (let batch = 0; batch < 8; batch++) {
        const promises = [];
        for (let b = 0; b < 5; b++) {
          const gw = batch * 5 + b + 1;
          if (gw > 38) break;
          promises.push(
            fetchVaastavGW(season, gw).then(csv => {
              const match = csv.find(r =>
                r.name && (r.name.toLowerCase().includes(playerName.toLowerCase()) ||
                (player?.first_name && r.name.toLowerCase().includes(player.first_name.toLowerCase())))
              );
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
            season: lang === "pl" ? "25/26" : "25/26",
            color: seasonColors[si],
            data: history.map(h => ({ gw: h.round, value: (h.value || 0) / 10 }))
          });
        }
      } else {
        const playerName = player.web_name || "";
        const gwData = [];
        for (let batch = 0; batch < 8; batch++) {
          const promises = [];
          for (let b = 0; b < 5; b++) {
            const gw = batch * 5 + b + 1;
            if (gw > 38) break;
            promises.push(
              fetchVaastavGW(s, gw).then(csv => {
                const match = csv.find(r => r.name && r.name.toLowerCase().includes(playerName.toLowerCase()));
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
  for (const sd of allSeasonData) {
    let d = "";
    sd.data.forEach((pt, i) => {
      const x = pad.left + ((pt.gw - 1) / 37) * chartW;
      const y = pad.top + chartH - ((pt.value - minP) / range) * chartH * 0.85 - chartH * 0.05;
      d += (i === 0 ? "M" : "L") + ` ${x} ${y}`;
    });
    paths += `<path d="${d}" fill="none" stroke="${sd.color}" stroke-width="2.5" opacity="0.85"><title>${sd.season}</title></path>`;
  }

  let yTicks = "";
  for (let i = 0; i <= 5; i++) {
    const val = minP + (range / 5) * i;
    const y = pad.top + chartH - (chartH / 5) * i * 0.85 - chartH * 0.05 * (i / 5);
    yTicks += `<text class="chart-label" x="${pad.left - 6}" y="${y + 3}" text-anchor="end" font-size="10">${val.toFixed(1)}m</text>`;
  }

  let legend = `<g transform="translate(${pad.left}, 8)">`;
  allSeasonData.forEach((sd, i) => {
    const lx = i * 80;
    legend += `<rect x="${lx}" y="0" width="16" height="3" fill="${sd.color}" rx="1"/>`;
    legend += `<text x="${lx + 20}" y="6" font-size="10" fill="var(--text-dim)" font-family="sans-serif">${sd.season}</text>`;
  });
  legend += `</g>`;

  document.getElementById("pricehistory-chart").innerHTML = `
    <svg class="chart-svg" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
      <line class="chart-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + chartH}"/>
      <line class="chart-axis" x1="${pad.left}" y1="${pad.top + chartH}" x2="${pad.left + chartW}" y2="${pad.top + chartH}"/>
      ${yTicks}${paths}${legend}
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

function populateTop15GWs() {
  if (!bootstrapData) return;
  const allGWs = bootstrapData.events || [];
  const finishedGWs = allGWs.filter((e) => e.finished);
  const html = finishedGWs.map((e) => `<option value="${e.id}">GW${e.id}</option>`).join("");
  const startSel = document.getElementById("top15-gw-start");
  const endSel = document.getElementById("top15-gw-end");
  if (startSel) { startSel.innerHTML = html; if (finishedGWs.length > 0) startSel.value = finishedGWs[0].id; }
  if (endSel) { endSel.innerHTML = html; if (finishedGWs.length > 0) endSel.value = finishedGWs[finishedGWs.length - 1].id; }
}

function initTop15() {
  document.getElementById("top15-run").addEventListener("click", runTop15);
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
  const endGW = parseInt(document.getElementById("top15-gw-end").value);
  if (!startGW || !endGW || startGW > endGW) return;

  showSection("top15", "loading");
  const loadingEl = document.getElementById("top15-loading");
  const lang = getLang();
  document.getElementById("top15-chart-wrap").style.display = "none";
  document.getElementById("top15-table").style.display = "none";

  top15AllData = {};
  const season = detectSeason(bootstrapData);
  const seasonKey = season.replace("/", "-");

  try {
    const batchSize = 5;
    for (let batchStart = startGW; batchStart <= endGW; batchStart += batchSize) {
      const batchEnd = Math.min(batchStart + batchSize - 1, endGW);
      const promises = [];
      for (let gw = batchStart; gw <= batchEnd; gw++) {
        promises.push(
          fetchVaastavGW(seasonKey, gw).catch(() => {
            return fetchVaastavGW("2024-25", gw).catch(() => []);
          })
        );
      }
      if (loadingEl) loadingEl.querySelector("div:last-child").textContent = `${lang === "pl" ? "Ładowanie" : "Loading"} GW${batchStart}–${batchEnd}...`;
      const results = await Promise.all(promises);
      results.forEach((csvData, i) => {
        const gw = batchStart + i;
        const teamNameToId = {};
        if (bootstrapData.teams) {
          for (const team of bootstrapData.teams) {
            teamNameToId[team.name] = team.id;
            teamNameToId[team.short_name] = team.id;
          }
        }
        const posMap = { "GKP": 1, "DEF": 2, "MID": 3, "FWD": 4 };
        top15AllData[gw] = csvData.map((r) => ({
          name: r.name || "",
          team: teamNameToId[r.team] || 0,
          position: posMap[r.position] || 0,
          points: parseInt(r.total_points) || 0,
          selected: parseInt(r.selected) || 0,
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

    players.forEach((p, pi) => {
      const color = colors[pi % colors.length];
      let d = "";
      for (let i = 0; i < gws.length; i++) {
        const x = pad.left + (gws.length > 1 ? (i / (gws.length - 1)) * chartW : chartW / 2);
        const y = pad.top + chartH - (p.cumulative[i] / maxVal) * chartH;
        d += (i === 0 ? "M" : "L") + ` ${x} ${y}`;
      }
      paths += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2"><title>${p.name} (${p.total} ${lang === "pl" ? " pkt" : " pts"})</title></path>`;
      const lastX = pad.left + (gws.length > 1 ? chartW : chartW / 2);
      const lastY = pad.top + chartH - (p.cumulative[gws.length - 1] / maxVal) * chartH;
      paths += `<circle cx="${lastX}" cy="${lastY}" r="3" fill="${color}"/>`;
    });

    let legend = `<g transform="translate(${pad.left}, 8)">`;
    players.forEach((p, i) => {
      const lx = i * 60;
      legend += `<rect x="${lx}" y="0" width="10" height="10" fill="${colors[i % colors.length]}" rx="2"/>`;
      legend += `<text x="${lx + 14}" y="9" font-size="8" fill="var(--text-dim)" font-family="sans-serif">${p.name}</text>`;
    });
    legend += `</g>`;

    container.innerHTML = `
      <h3 class="chart-title" style="margin-bottom:8px">${lang === "pl" ? "Kumulatywne punkty – Top 15 strzelców" : "Cumulative Points – Top 15 Scorers"}</h3>
      <svg class="chart-svg" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
        <line class="chart-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + chartH}"/>
        <line class="chart-axis" x1="${pad.left}" y1="${pad.top + chartH}" x2="${pad.left + chartW}" y2="${pad.top + chartH}"/>
        ${yTicks}${xTicks}${paths}${legend}
      </svg>`;

  } else {
    const playerOwn = {};
    for (const gw of gws) {
      const sorted = [...(top15AllData[gw] || [])].sort((a, b) => b.selected - a.selected).slice(0, 15);
      for (const p of sorted) {
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
      for (let i = 0; i < gws.length; i++) {
        const x = pad.left + (gws.length > 1 ? (i / (gws.length - 1)) * chartW : chartW / 2);
        const ownVal = p.gwOwn[gws[i]];
        const y = ownVal !== undefined
          ? pad.top + chartH - (ownVal / maxVal) * chartH
          : null;
        if (y !== null) d += (d === "" ? "M" : "L") + ` ${x} ${y}`;
      }
      if (d) paths += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2"><title>${p.name} (avg: ${p.avgOwn.toFixed(1)}%)</title></path>`;
      const lastGW = gws[gws.length - 1];
      const lastOwn = p.gwOwn[lastGW];
      if (lastOwn !== undefined) {
        const lastX = pad.left + (gws.length > 1 ? chartW : chartW / 2);
        const lastY = pad.top + chartH - (lastOwn / maxVal) * chartH;
        paths += `<circle cx="${lastX}" cy="${lastY}" r="3" fill="${color}"/>`;
      }
    });

    let legend = `<g transform="translate(${pad.left}, 8)">`;
    players.forEach((p, i) => {
      const lx = i * 60;
      legend += `<rect x="${lx}" y="0" width="10" height="10" fill="${colors[i % colors.length]}" rx="2"/>`;
      legend += `<text x="${lx + 14}" y="9" font-size="8" fill="var(--text-dim)" font-family="sans-serif">${p.name}</text>`;
    });
    legend += `</g>`;

    container.innerHTML = `
      <h3 class="chart-title" style="margin-bottom:8px">${lang === "pl" ? "Posiadanie Top 15 – % menedżerów" : "Ownership % – Top 15 Most-Owned"}</h3>
      <svg class="chart-svg" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
        <line class="chart-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + chartH}"/>
        <line class="chart-axis" x1="${pad.left}" y1="${pad.top + chartH}" x2="${pad.left + chartW}" y2="${pad.top + chartH}"/>
        ${yTicks}${xTicks}${paths}${legend}
      </svg>`;
  }

  document.getElementById("top15-chart-wrap").style.display = "";
}

// ===================== SQUAD BUILDER (WEIGHTED) =====================

let squadBuilderSort = { field: "compositeScore", dir: "desc" };
let squadBuilderSquad = [];
let squadBuilderFixtures = [];

function initSquadBuilder() {
  document.querySelectorAll(".weight-slider").forEach((slider) => {
    const valEl = slider.parentElement.querySelector(".weight-val");
    slider.addEventListener("input", () => { valEl.textContent = slider.value; });
  });
  document.getElementById("squadbuilder-run").addEventListener("click", runSquadBuilder);
  populateSquadBuilderGWs();
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

  showSection("squadbuilder", "loading");
  document.getElementById("squadbuilder-charts").style.display = "none";
  document.getElementById("squadbuilder-map-wrap").style.display = "none";
  document.getElementById("squadbuilder-fixtures").style.display = "none";

  try {
    let fixtures = [];
    try { fixtures = await getFixtures(); } catch {}

    const allPlayers = bootstrapData.elements.filter((p) => p.minutes > 0 || p.total_points > 0);

    const maxForm = Math.max(...allPlayers.map((p) => parseFloat(p.form) || 0), 1);
    const maxXPts = Math.max(...allPlayers.map((p) => (parseFloat(p.expected_goals) || 0) + (parseFloat(p.expected_assists) || 0)), 0.01);
    const maxMinutes = Math.max(...allPlayers.map((p) => p.minutes || 0), 1);

    const teamFDR = {};
    const teamNextFixtures = {};
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

      if (targetGW) {
        for (const f of fixtures) {
          if (f.event !== targetGW) continue;
          if (f.team_h) {
            if (!teamNextFixtures[f.team_h]) teamNextFixtures[f.team_h] = [];
            const opp = bootstrapData.teams?.find((t) => t.id === f.team_a);
            teamNextFixtures[f.team_h].push({ opp: opp?.short_name || f.team_a, home: true, diff: f.team_h_difficulty });
          }
          if (f.team_a) {
            if (!teamNextFixtures[f.team_a]) teamNextFixtures[f.team_a] = [];
            const opp = bootstrapData.teams?.find((t) => t.id === f.team_h);
            teamNextFixtures[f.team_a].push({ opp: opp?.short_name || f.team_h, home: false, diff: f.team_a_difficulty });
          }
        }
      }
    }
    const maxFDR = Math.max(...Object.values(teamFDR), 5);
    const minFDR = Math.min(...Object.values(teamFDR), 1);
    const fdrRange = maxFDR - minFDR || 1;

    renderFormExplanation(weights, teamFDR);

    const scored = allPlayers.map((p) => {
      const form = (parseFloat(p.form) || 0) / maxForm;
      const fdr = teamFDR[p.team] || 3;
      const fixture = 1 - ((fdr - minFDR) / fdrRange);
      const xGI = (parseFloat(p.expected_goals) || 0) + (parseFloat(p.expected_assists) || 0);
      const xpts = xGI / maxXPts;
      const mins = (p.minutes || 0) / maxMinutes;
      const homeaway = form * 0.5 + xpts * 0.5;

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
        (weights.distance || 0) * distance;

      return { ...p, compositeScore: +composite.toFixed(4), avgAwayDist: Math.round(avgDist) };
    });

    const maxPerTeam = 3;
    const limits = { 1: 2, 2: 5, 3: 5, 4: 3 };
    const squad = [];
    const teamCount = {};

    for (const pos of [1, 2, 3, 4]) {
      const candidates = scored.filter((p) => p.element_type === pos && p.now_cost > 0).sort((a, b) => b.compositeScore - a.compositeScore);
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

    const squadBudget = 1000;
    let totalCost = squad.reduce((s, p) => s + p.now_cost, 0);
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < squad.length; i++) {
        const cur = squad[i];
        const pos = cur.element_type;
        const candidates = scored.filter((p) => p.element_type === pos && p.id !== cur.id && p.compositeScore > cur.compositeScore && !squad.find((s) => s.id === p.id)).sort((a, b) => b.compositeScore - a.compositeScore);
        for (const c of candidates) {
          const costDiff = c.now_cost - cur.now_cost;
          if (costDiff > (squadBudget - totalCost)) continue;
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

    if (targetGW && teamNextFixtures && Object.keys(teamNextFixtures).length > 0) {
      const fixtureTeams = [...new Set(squad.map((p) => p.team))];
      const fixtureEl = document.getElementById("squadbuilder-fixtures");
      if (fixtureEl) {
        const diffColor = (d) => d <= 2 ? "var(--green)" : d === 3 ? "var(--yellow)" : "var(--red)";
        let fhtml = `<h3 style="font-size:0.95rem;margin-bottom:10px;color:var(--text)">${lang === "pl" ? `Terminarz na GW${targetGW}` : `Fixtures for GW${targetGW}`}</h3><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px">`;
        for (const teamId of fixtureTeams) {
          const fixtures = teamNextFixtures[teamId] || [];
          const color = TEAM_COLORS[teamId] || "#555";
          for (const fx of fixtures) {
            const vsLabel = fx.home ? `vs ${fx.opp}` : `@ ${fx.opp}`;
            const badge = fx.home ? "🏠" : "✈️";
            fhtml += `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg);border-radius:6px;font-size:0.85rem">
              <span class="team-color" style="background:${color}"></span>
              <span style="font-weight:600">${getTeamName(teamId)}</span>
              <span style="color:${diffColor(fx.diff)};font-weight:700">${badge} ${vsLabel}</span>
              <span style="color:var(--text-dim);font-size:0.8rem;margin-left:auto">FDR ${fx.diff}</span>
            </div>`;
          }
        }
        fhtml += `</div>`;
        fixtureEl.innerHTML = fhtml;
        fixtureEl.style.display = "";
      }
    }

    renderSquadBuilder();
    showSection("squadbuilder", "table");
    document.getElementById("squadbuilder-charts").style.display = "";
    renderSquadBuilderCharts();
    renderSquadBuilderMap();
  } catch {
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

function renderStadiumsMap() {
  const container = document.getElementById("stadiums-map");
  if (!container) return;
  if (typeof L === "undefined") return;

  if (window._stadiumsMap) { window._stadiumsMap.remove(); window._stadiumsMap = null; }

  const doInit = () => {
    if (!container.offsetWidth) {
      setTimeout(doInit, 100);
      return;
    }
    const map = L.map(container, { scrollWheelZoom: true }).setView([53.0, -1.5], 6);
    window._stadiumsMap = map;
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 18,
    }).addTo(map);

    const regionColors = { london: "#f59e0b", north: "#3b82f6", midlands: "#a855f7", south: "#22c55e", east: "#ef4444" };
    const lang = getLang();

    computePLStandings().then(({ standings, sorted, posHistory }) => {
    for (const [id, t] of Object.entries(TEAM_COORDS)) {
      const tid = parseInt(id);
      const color = regionColors[t.region] || "#888";
      const teamColor = TEAM_COLORS[tid] || "#555";
      const st = standings[tid];
      const pos = sorted.findIndex(s => s.id === tid) + 1;
      const hist = posHistory[tid] || [];
      const prevPos = hist.length >= 2 ? hist[hist.length - 2].pos : null;
      const trend = prevPos ? (pos < prevPos ? "▲" : pos > prevPos ? "▼" : "=") : "";
      const trendColor = pos < prevPos ? "var(--green)" : pos > prevPos ? "var(--red)" : "var(--text-dim)";

      const posBadge = `<div style="position:absolute;top:-8px;right:-8px;background:${teamColor};color:#fff;font-weight:700;font-size:0.7rem;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #1a1d27;z-index:10">${pos}</div>`;

      const marker = L.circleMarker(t.stadium, {
        radius: 8, fillColor: teamColor, color: color, weight: 2, fillOpacity: 0.9,
        className: "stadium-marker"
      }).addTo(map);

      // Per-GW position sparkline as text
      const posTrend = hist.slice(-10).map(h => h.pos).join(" → ");
      const formGWs = hist.slice(-5);
      const formPts = formGWs.map(h => h.pos);
      const formTrend = formPts.length >= 2 ? (formPts[formPts.length - 1] < formPts[0] ? "↑" : formPts[formPts.length - 1] > formPts[0] ? "↓" : "→") : "";

      marker.bindPopup(`
        <div style="min-width:180px">
          <div style="font-weight:700;color:${teamColor};font-size:1.1rem">${t.name}</div>
          <div style="font-size:0.85rem;color:#888;margin-bottom:6px">${t.stadiumName} · ${REGIONS[t.region]?.name || t.region}</div>
          <div style="display:flex;gap:8px;align-items:center;margin:6px 0">
            <div style="background:${teamColor};color:#fff;font-weight:700;font-size:1.2rem;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center">${pos}</div>
            <div>
              <div style="font-weight:600">${lang === "pl" ? "Pozycja" : "Position"} <span style="color:${trendColor};font-weight:700">${pos}/20 ${trend}</span></div>
              <div style="color:var(--text-dim);font-size:0.8rem">${st?.p || 0} ${lang === "pl" ? "meków" : "games"} · ${st?.pts || 0} ${lang === "pl" ? "pkt" : "pts"}</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px;text-align:center;margin:8px 0;font-size:0.8rem">
            <div><div style="color:var(--green);font-weight:700">${st?.w || 0}</div><div style="color:var(--text-dim)">${lang === "pl" ? "W" : "W"}</div></div>
            <div><div style="color:var(--yellow);font-weight:700">${st?.d || 0}</div><div style="color:var(--text-dim)">${lang === "pl" ? "R" : "D"}</div></div>
            <div><div style="color:var(--red);font-weight:700">${st?.l || 0}</div><div style="color:var(--text-dim)">${lang === "pl" ? "P" : "L"}</div></div>
            <div><div style="font-weight:700">${st?.gf || 0}:${st?.ga || 0}</div><div style="color:var(--text-dim)">GD ${st?.gd > 0 ? "+" : ""}${st?.gd || 0}</div></div>
          </div>
          ${hist.length > 0 ? `<div style="border-top:1px solid #333;padding-top:6px;margin-top:6px">
            <div style="font-size:0.8rem;color:#aaa;margin-bottom:3px">${lang === "pl" ? "Pozycja w sezonie" : "Season position"} ${formTrend}</div>
            <div style="font-size:0.75rem;color:#888">${posTrend}</div>
          </div>` : ""}
        </div>
      `);

      // Add position badge as HTML overlay near marker
      const badgeIcon = L.divIcon({
        className: "",
        html: posBadge,
        iconSize: [18, 18],
        iconAnchor: [9, 9]
      });
      L.marker(t.stadium, { icon: badgeIcon, interactive: false }).addTo(map);
    }

    const regionLegend = Object.entries(regionColors).map(([k, c]) =>
      `<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.8rem"><span style="width:10px;height:10px;border-radius:50%;background:${c};display:inline-block"></span>${REGIONS[k]?.name || k}</span>`
    ).join("  ");
    const legendDiv = document.createElement("div");
    legendDiv.innerHTML = `<div style="padding:8px 12px;background:#1a1d27ee;border-radius:6px;position:absolute;bottom:20px;left:20px;z-index:1000;display:flex;gap:12px;flex-wrap:wrap">${regionLegend}</div>`;
    container.appendChild(legendDiv);

    setTimeout(() => { if (window._stadiumsMap) window._stadiumsMap.invalidateSize(); }, 300);
    setTimeout(() => { if (window._stadiumsMap) window._stadiumsMap.invalidateSize(); }, 800);
    setTimeout(() => { if (window._stadiumsMap) window._stadiumsMap.invalidateSize(); }, 1500);
    loadStadiumsFixtures(map);
    }); // end computePLStandings.then
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
    container.appendChild(fixtureBtn);
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
  document.getElementById("myteam-tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (!tab) return;
    document.querySelectorAll("#myteam-tabs .tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const tabKey = tab.dataset.tab;
    ["overview", "reserves", "captains", "gwhistory"].forEach(k => {
      const el = document.getElementById(`myteam-${k}-tab`);
      if (el) el.style.display = k === tabKey ? "" : "none";
    });
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
  initTableSort("squadbuilder-table", squadBuilderSort, renderSquadBuilder, ["web_name", "now_cost", "total_points", "avgAwayDist", "compositeScore"]);
  initOptimizer();
  initKetchup();
  initHomeAway();
  initMyTeam();
  initLeader();
  initPriceHistorySearch();
  initTop15();
  initSquadBuilder();
  initStadiums();
  loadData();
});
