import { getBootstrapStatic, getPlayerSummary, getManagerPicks, getLeagueStandings, getEntry } from "./api.js";
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

function getTeamName(id) {
  const team = bootstrapData?.teams?.find((t) => t.id === id);
  return team?.short_name || team?.name || "?";
}

function getPositionShort(type) {
  return { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" }[type] || "?";
}

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
  const el = document.getElementById("season-banner");
  if (!el || !data) return;
  const gw = data.events?.find((e) => e.is_current) || data.events?.[data.events.length - 1];
  const season = detectSeason(data);
  const lang = getLang();
  const finished = gw?.finished;
  const statusText = finished ? t("common.seasonFinished") : `GW${gw?.id ?? "?"}`;
  el.textContent = `${lang === "pl" ? "Sezon" : "Season"} ${season} · ${statusText} · ${data.elements?.length ?? "?"} ${t("common.players")}`;
}

function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    const val = t(key);
    if (val !== key) el.textContent = val;
  });
}

function showSection(sectionId, state) {
  const loading = document.getElementById(`${sectionId}-loading`);
  const placeholder = document.getElementById(`${sectionId}-placeholder`);
  const table = document.getElementById(`${sectionId}-table`);
  const result = document.getElementById(`${sectionId}-result`);
  if (loading) loading.style.display = state === "loading" ? "" : "none";
  if (placeholder) placeholder.style.display = state === "placeholder" ? "" : "none";
  if (table) table.style.display = state === "table" ? "" : "none";
  if (result && state !== "result") result.style.display = "none";
}

async function loadData() {
  showSection("rankings", "loading");
  try {
    bootstrapData = await getBootstrapStatic();
    updateSeasonBanner(bootstrapData);
    renderRankings();
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
  const dir = currentSortDir === "desc" ? -1 : 1;
  result.sort((a, b) => (b[currentSortField] - a[currentSortField]) * dir);
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

// ===================== KETCHUP =====================

async function runKetchup() {
  if (!bootstrapData) return;
  const gwCount = parseInt(document.getElementById("ketchup-gw-count").value);
  const currentGW = bootstrapData.events?.find((e) => e.is_current)?.id || 38;
  const startGW = Math.max(1, currentGW - gwCount + 1);

  showSection("ketchup", "loading");

  const candidates = bootstrapData.elements.filter((p) => p.minutes > 0 && p.element_type !== 1);
  const results = [];

  for (let i = 0; i < candidates.length; i++) {
    const p = candidates[i];
    try {
      const summary = await getPlayerSummary(p.id);
      const history = summary.history?.filter((h) => h.round >= startGW && h.round <= currentGW) || [];
      if (history.length === 0) continue;

      const totalActual = history.reduce((s, h) => s + h.total_points, 0);
      const totalExpected = history.reduce((s, h) => s + (h.expected_goals || 0) + (h.expected_assists || 0), 0);
      const diff = totalExpected - totalActual;

      results.push({
        id: p.id,
        web_name: p.web_name,
        team: p.team,
        element_type: p.element_type,
        now_cost: p.now_cost,
        totalPts: totalActual,
        expectedPts: +totalExpected.toFixed(1),
        diff: +diff.toFixed(1),
      });
    } catch {
      // skip failed fetches
    }
  }

  const sortBy = document.getElementById("ketchup-sort").value;
  results.sort((a, b) => (sortBy === "diff" ? b.diff - a.diff : b.expectedPts - a.expectedPts));

  const tbody = document.getElementById("ketchup-body");
  tbody.innerHTML = results.slice(0, 30).map((r, i) => {
    const color = TEAM_COLORS[r.team] || "#555";
    const posClass = `pos-${getPositionShort(r.element_type).toLowerCase()}`;
    return `<tr>
      <td class="rank-num">${i + 1}</td>
      <td>${r.web_name}</td>
      <td><span class="team-color" style="background:${color}"></span>${getTeamName(r.team)}</td>
      <td><span class="pos-badge ${posClass}">${getPositionShort(r.element_type)}</span></td>
      <td class="stat-val">${(r.now_cost / 10).toFixed(1)}</td>
      <td class="stat-val">${r.totalPts}</td>
      <td class="stat-val">${r.expectedPts}</td>
      <td class="stat-val" style="color:${r.diff > 0 ? 'var(--green)' : 'var(--red)'}">${r.diff > 0 ? '+' : ''}${r.diff}</td>
    </tr>`;
  }).join("");

  showSection("ketchup", "table");
}

// ===================== OPTIMIZER =====================

function runOptimizer() {
  if (!bootstrapData) return;
  const budget = parseInt(document.getElementById("optimizer-budget").value);
  const players = bootstrapData.elements.filter((p) => p.minutes > 0);
  const byPos = { 1: [], 2: [], 3: [], 4: [] };
  for (const p of players) byPos[p.element_type]?.push(p);
  for (const pos of Object.keys(byPos)) {
    byPos[pos].sort((a, b) => b.total_points - a.total_points);
  }

  const limits = { 1: 2, 2: 5, 3: 5, 4: 3 };
  const maxPerTeam = 3;
  const teamCount = {};
  const squad = [];

  for (const pos of [1, 2, 3, 4]) {
    const candidates = byPos[pos];
    let picked = 0;
    for (const p of candidates) {
      if (picked >= limits[pos]) break;
      if (squad.length >= 15) break;
      teamCount[p.team] = (teamCount[p.team] || 0);
      if (teamCount[p.team] >= maxPerTeam) continue;
      squad.push(p);
      teamCount[p.team]++;
      picked++;
    }
  }

  // Greedy budget optimization: try to maximize points within budget
  // Sort by points per cost ratio and fill remaining budget
  const totalCost = squad.reduce((s, p) => s + p.now_cost, 0);
  const remaining = budget - totalCost;

  // Try swaps to improve points within budget
  if (remaining > 0) {
    for (let i = 0; i < squad.length; i++) {
      const pos = squad[i].element_type;
      const current = squad[i];
      const better = byPos[pos].find((p) =>
        p.id !== current.id &&
        !squad.find((s) => s.id === p.id) &&
        (teamCount[p.team] || 0) < maxPerTeam &&
        p.now_cost <= current.now_cost + remaining &&
        p.total_points > current.total_points
      );
      if (better) {
        const costDiff = better.now_cost - current.now_cost;
        if (costDiff <= remaining) {
          teamCount[current.team]--;
          squad[i] = better;
          teamCount[better.team] = (teamCount[better.team] || 0) + 1;
        }
      }
    }
  }

  const finalCost = squad.reduce((s, p) => s + p.now_cost, 0);
  const finalPts = squad.reduce((s, p) => s + p.total_points, 0);

  const tbody = document.getElementById("optimizer-body");
  tbody.innerHTML = `<tr><td colspan="6" style="padding:8px 12px;color:var(--accent);font-weight:600">
    ${t("optimizer.squad")}: ${finalPts} pkt · ${(finalCost / 10).toFixed(1)}m / ${(budget / 10).toFixed(1)}m
  </td></tr>` + squad.map((p, i) => {
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
  }).join("");

  showSection("optimizer", "table");
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

  const results = [];
  for (const p of sample) {
    try {
      const summary = await getPlayerSummary(p.id);
      const history = summary.history || [];
      let homePts = 0, awayPts = 0, homeGames = 0, awayGames = 0;
      for (const h of history) {
        if (h.was_home) { homePts += h.total_points; homeGames++; }
        else { awayPts += h.total_points; awayGames++; }
      }
      results.push({
        id: p.id,
        web_name: p.web_name,
        team: p.team,
        element_type: p.element_type,
        homePts: homeGames > 0 ? +(homePts / homeGames).toFixed(1) : 0,
        awayPts: awayGames > 0 ? +(awayPts / awayGames).toFixed(1) : 0,
        homeGames,
        awayGames,
        diff: homeGames > 0 && awayGames > 0 ? +((homePts / homeGames) - (awayPts / awayGames)).toFixed(1) : 0,
      });
    } catch {
      // skip
    }
  }

  results.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  const tbody = document.getElementById("homeaway-body");
  tbody.innerHTML = results.slice(0, 30).map((r, i) => {
    const color = TEAM_COLORS[r.team] || "#555";
    const posClass = `pos-${getPositionShort(r.element_type).toLowerCase()}`;
    return `<tr>
      <td class="rank-num">${i + 1}</td>
      <td>${r.web_name}</td>
      <td><span class="team-color" style="background:${color}"></span>${getTeamName(r.team)}</td>
      <td><span class="pos-badge ${posClass}">${getPositionShort(r.element_type)}</span></td>
      <td class="stat-val">${r.homePts} <span style="color:var(--text-dim);font-size:0.75rem">(${r.homeGames}g)</span></td>
      <td class="stat-val">${r.awayPts} <span style="color:var(--text-dim);font-size:0.75rem">(${r.awayGames}g)</span></td>
      <td class="stat-val" style="color:${r.diff > 0 ? 'var(--green)' : 'var(--red)'}">${r.diff > 0 ? '+' : ''}${r.diff}</td>
    </tr>`;
  }).join("");

  showSection("homeaway", "table");
}

// ===================== MY TEAM =====================

async function runMyTeam() {
  if (!bootstrapData) return;
  const managerId = document.getElementById("myteam-id").value;
  if (!managerId) return;

  showSection("myteam", "loading");

  try {
    const currentGW = bootstrapData.events?.find((e) => e.is_current)?.id || 38;
    const picksData = await getManagerPicks(managerId, currentGW);
    const picks = picksData.picks || [];

    const tbody = document.getElementById("myteam-body");
    tbody.innerHTML = picks.map((pick, i) => {
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
    }).join("");

    showSection("myteam", "table");
  } catch (err) {
    document.getElementById("myteam-body").innerHTML =
      `<tr><td colspan="6"><div class="error-msg">${t("common.error")}: ${err.message}</div></td></tr>`;
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
    const leader = standings.league?.standings?.results?.[0];
    if (!leader) throw new Error("No leader found");

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

function initRankingsSort() {
  const table = document.querySelector("#rankings-table thead tr");
  table.addEventListener("click", (e) => {
    const th = e.target.closest("th");
    if (!th || !th.dataset.sort) return;
    const field = th.dataset.sort;
    if (field === "rank" || field === "team") return;
    if (currentSortField === field) {
      currentSortDir = currentSortDir === "desc" ? "asc" : "desc";
    } else {
      currentSortField = field;
      currentSortDir = "desc";
    }
    table.querySelectorAll("th").forEach((h) => h.classList.remove("sort-asc", "sort-desc"));
    th.classList.add(currentSortDir === "asc" ? "sort-asc" : "sort-desc");
    renderRankings();
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
  document.getElementById("ketchup-run").addEventListener("click", () => {
    if (bootstrapData) runKetchup();
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
  initRankingsSort();
  initOptimizer();
  initKetchup();
  initHomeAway();
  initMyTeam();
  initLeader();
  loadData();
});
