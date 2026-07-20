import { getBootstrapStatic, getPlayerSummary, getManagerPicks, getLeagueStandings, getEntry } from "./api.js";
import { t, setLang, getLang } from "./i18n.js";

let bootstrapData = null;
let currentRankingsTab = "gk";
let currentRankingsSort = { field: "totalPoints", dir: "desc" };
let homeAwaySort = { field: "diff", dir: "desc" };
let homeAwayData = [];

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

// ===================== KETCHUP =====================

async function runKetchup() {
  if (!bootstrapData) return;
  const gwCount = parseInt(document.getElementById("ketchup-gw-count").value);
  const allGWs = bootstrapData.events || [];
  const finishedGWs = allGWs.filter((e) => e.finished);
  const lastGW = finishedGWs.length > 0 ? finishedGWs[finishedGWs.length - 1] : allGWs[allGWs.length - 1];
  const currentGW = lastGW?.id || 38;
  const startGW = Math.max(1, currentGW - gwCount + 1);

  showSection("ketchup", "loading");
  const loadingEl = document.getElementById("ketchup-loading");
  const lang = getLang();

  const candidates = bootstrapData.elements.filter((p) => p.minutes > 0 && p.element_type !== 1);
  const results = [];
  const total = candidates.length;

  for (let i = 0; i < total; i++) {
    const p = candidates[i];
    if (i % 10 === 0 && loadingEl) {
      const inner = loadingEl.querySelector("div:last-child");
      if (inner) inner.textContent = `${lang === "pl" ? "Pobieranie" : "Fetching"} ${i + 1}/${total}...`;
    }
    try {
      const summary = await getPlayerSummary(p.id);
      const history = summary.history || [];
      const relevant = history.filter((h) => h.round >= startGW && h.round <= currentGW);
      if (relevant.length === 0) continue;

      const totalActual = relevant.reduce((s, h) => s + h.total_points, 0);
      const totalExpected = relevant.reduce((s, h) => s + (h.expected_goals || 0) + (h.expected_assists || 0), 0);
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
        gamesPlayed: relevant.length,
      });
    } catch {
      // skip failed fetches
    }
  }

  const sortBy = document.getElementById("ketchup-sort").value;
  results.sort((a, b) => (sortBy === "diff" ? b.diff - a.diff : b.expectedPts - a.expectedPts));

  const tbody = document.getElementById("ketchup-body");
  tbody.innerHTML = results.slice(0, 40).map((r, i) => {
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
  const allPlayers = bootstrapData.elements.filter((p) => p.minutes > 0 || p.total_points > 0);
  const maxPerTeam = 3;
  const limits = { 1: 2, 2: 5, 3: 5, 4: 3 };

  // Sort each position by points descending
  const byPos = { 1: [], 2: [], 3: [], 4: [] };
  for (const p of allPlayers) byPos[p.element_type]?.push(p);
  for (const pos of Object.keys(byPos)) {
    byPos[pos].sort((a, b) => b.total_points - a.total_points);
  }

  // Greedy: fill cheapest possible at each position first, then upgrade
  const squad = [];
  const teamCount = {};

  // Phase 1: pick cheapest available at each position slot
  for (const pos of [1, 2, 3, 4]) {
    const sorted = [...byPos[pos]].sort((a, b) => a.now_cost - b.now_cost);
    let picked = 0;
    for (const p of sorted) {
      if (picked >= limits[pos]) break;
      if ((teamCount[p.team] || 0) >= maxPerTeam) continue;
      squad.push({ ...p });
      teamCount[p.team] = (teamCount[p.team] || 0) + 1;
      picked++;
    }
  }

  let totalCost = squad.reduce((s, p) => s + p.now_cost, 0);

  // Phase 2: upgrade players if budget allows — try to swap cheapest for best affordable
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < squad.length; i++) {
      const cur = squad[i];
      const pos = cur.element_type;
      // Find best player in this position not in squad that we can afford
      for (const candidate of byPos[pos]) {
        if (candidate.id === cur.id) continue;
        if (squad.find((s) => s.id === candidate.id)) continue;
        if ((teamCount[candidate.team] || 0) >= maxPerTeam && (teamCount[candidate.team] || 0) - (cur.team === candidate.team ? 1 : 0) >= maxPerTeam) continue;
        const costDiff = candidate.now_cost - cur.now_cost;
        if (costDiff <= 0 && candidate.total_points <= cur.total_points) continue;
        if (costDiff > 0 && costDiff > (budget - totalCost)) continue;
        if (candidate.total_points > cur.total_points) {
          // Accept swap
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
  }

  // Phase 3: if budget still has room, try upgrading further
  improved = true;
  while (improved) {
    improved = false;
    const remaining = budget - totalCost;
    for (let i = 0; i < squad.length; i++) {
      const cur = squad[i];
      const pos = cur.element_type;
      for (const candidate of byPos[pos]) {
        if (candidate.id === cur.id) continue;
        if (squad.find((s) => s.id === candidate.id)) continue;
        const costDiff = candidate.now_cost - cur.now_cost;
        if (costDiff <= 0 || costDiff > remaining) continue;
        if (candidate.total_points <= cur.total_points) continue;
        if ((teamCount[candidate.team] || 0) >= maxPerTeam && cur.team !== candidate.team) continue;
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

  const finalPts = squad.reduce((s, p) => s + p.total_points, 0);

  const tbody = document.getElementById("optimizer-body");
  tbody.innerHTML = `<tr><td colspan="6" style="padding:8px 12px;color:var(--accent);font-weight:600">
    ${t("optimizer.squad")}: ${finalPts} pkt · ${(totalCost / 10).toFixed(1)}m / ${(budget / 10).toFixed(1)}m
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
  const loadingEl = document.getElementById("homeaway-loading");
  const lang = getLang();

  homeAwayData = [];
  for (let i = 0; i < sample.length; i++) {
    const p = sample[i];
    if (i % 10 === 0 && loadingEl) {
      const inner = loadingEl.querySelector("div:last-child");
      if (inner) inner.textContent = `${lang === "pl" ? "Pobieranie" : "Fetching"} ${i + 1}/${sample.length}...`;
    }
    try {
      const summary = await getPlayerSummary(p.id);
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
    } catch {
      // skip
    }
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

    // Fetch picks for all finished gameweeks
    const playerMinutes = {};
    const playerPoints = {};
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
          const player = bootstrapData.elements.find((p) => p.id === pick.element);
          if (!player) continue;
          const multiplier = pick.is_captain ? 2 : 1;
          const pts = (pick.points || 0) * multiplier;
          if (!playerMinutes[pick.element]) {
            playerMinutes[pick.element] = 0;
            playerPoints[pick.element] = 0;
          }
          playerMinutes[pick.element] += 1;
          playerPoints[pick.element] += pts;
          totalManagerPoints += pts;
        }
      } catch {
        // skip failed GWs
      }
    }

    // Build current squad from last GW
    const lastPicksData = await getManagerPicks(managerId, maxGW);
    const lastPicks = lastPicksData.picks || [];

    const tbody = document.getElementById("myteam-body");
    tbody.innerHTML = lastPicks.map((pick, i) => {
      const player = bootstrapData.elements.find((p) => p.id === pick.element);
      if (!player) return "";
      const color = TEAM_COLORS[player.team] || "#555";
      const posClass = `pos-${getPositionShort(player.element_type).toLowerCase()}`;
      const captain = pick.is_captain ? " (C)" : pick.is_vice_captain ? " (VC)" : "";
      const ptsWhenSelected = playerPoints[pick.element] || 0;
      const gwsWhenSelected = playerMinutes[pick.element] || 0;
      const pct = totalManagerPoints > 0 ? ((ptsWhenSelected / totalManagerPoints) * 100).toFixed(1) : "0.0";
      return `<tr>
        <td class="rank-num">${i + 1}</td>
        <td>${player.web_name}${captain}</td>
        <td><span class="team-color" style="background:${color}"></span>${getTeamName(player.team)}</td>
        <td><span class="pos-badge ${posClass}">${getPositionShort(player.element_type)}</span></td>
        <td class="stat-val">${ptsWhenSelected}</td>
        <td class="stat-val" style="color:var(--accent)">${pct}%</td>
        <td style="color:var(--text-dim);font-size:0.8rem">${gwsWhenSelected} ${lang === "pl" ? "kolejek" : "GWs"}</td>
      </tr>`;
    }).join("");

    // Add summary row
    const summaryRow = `<tr style="border-top:2px solid var(--border)">
      <td colspan="5" style="font-weight:600;color:var(--accent)">${lang === "pl" ? "Łącznie zdobyte punkty" : "Total points earned"}</td>
      <td class="stat-val" style="font-weight:700;font-size:1.1rem;color:var(--accent)">${totalManagerPoints}</td>
      <td></td>
    </tr>`;
    tbody.innerHTML += summaryRow;

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
    if (currentRankingsSort.field === field) {
      currentRankingsSort.dir = currentRankingsSort.dir === "desc" ? "asc" : "desc";
    } else {
      currentRankingsSort = { field, dir: "desc" };
    }
    table.querySelectorAll("th").forEach((h) => h.classList.remove("sort-asc", "sort-desc"));
    th.classList.add(currentRankingsSort.dir === "asc" ? "sort-asc" : "sort-desc");
    renderRankings();
  });
}

function initHomeAwaySort() {
  const table = document.querySelector("#homeaway-table thead tr");
  table.addEventListener("click", (e) => {
    const th = e.target.closest("th");
    if (!th) return;
    const cols = ["rank", "web_name", "team", "element_type", "homeAvg", "awayAvg", "diff"];
    const idx = [...table.children].indexOf(th);
    const field = cols[idx];
    if (!field || field === "rank" || field === "web_name" || field === "team" || field === "element_type") return;
    if (homeAwaySort.field === field) {
      homeAwaySort.dir = homeAwaySort.dir === "desc" ? "asc" : "desc";
    } else {
      homeAwaySort = { field, dir: "desc" };
    }
    table.querySelectorAll("th").forEach((h) => h.classList.remove("sort-asc", "sort-desc"));
    th.classList.add(homeAwaySort.dir === "asc" ? "sort-asc" : "sort-desc");
    renderHomeAway();
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
  initHomeAwaySort();
  initOptimizer();
  initKetchup();
  initHomeAway();
  initMyTeam();
  initLeader();
  loadData();
});
