import { getBootstrapStatic, getPlayerSummary, getManagerPicks, getLeagueStandings } from "./api.js";
import { t, setLang, getLang } from "./i18n.js";

let bootstrapData = null;
let currentRankingsTab = "gk";
let currentRankingsSort = { field: "totalPoints", dir: "desc" };
let homeAwaySort = { field: "diff", dir: "desc" };
let homeAwayData = [];
let myTeamData = null;

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
const LS_TTL = { bootstrap: 60 * 60 * 1000, element: 30 * 60 * 1000 };

function lsGet(key) {
  try {
    const raw = localStorage.getItem(`${LS_PREFIX}-${key}`);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    return entry;
  } catch { return null; }
}

function lsSet(key, data, ttlMs) {
  try {
    localStorage.setItem(`${LS_PREFIX}-${key}`, JSON.stringify({ data, ts: Date.now(), ttl: ttlMs }));
  } catch { /* quota exceeded, ignore */ }
}

function lsValid(entry) {
  return entry && entry.data && entry.ts && Date.now() - entry.ts < (entry.ttl || Infinity);
}

async function cachedBootstrap() {
  const cached = lsGet("bootstrap");
  if (lsValid(cached)) return cached.data;
  const data = await getBootstrapStatic();
  lsSet("bootstrap", data, LS_TTL.bootstrap);
  return data;
}

async function cachedPlayerSummary(id) {
  const cached = lsGet(`elem-${id}`);
  if (lsValid(cached)) return cached.data;
  const data = await getPlayerSummary(id);
  lsSet(`elem-${id}`, data, LS_TTL.element);
  return data;
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
    bootstrapData = await cachedBootstrap();
    updateSeasonBanner(bootstrapData);
    renderRankings();
    renderNaStart();
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
      const summary = await cachedPlayerSummary(p.id);
      const history = summary.history || [];
      const relevant = history.filter((h) => h.round >= startGW && h.round <= currentGW);
      if (relevant.length === 0) continue;

      const totalActual = relevant.reduce((s, h) => s + h.total_points, 0);
      const totalExpected = relevant.reduce((s, h) => s + (parseFloat(h.expected_goals) || 0) + (parseFloat(h.expected_assists) || 0), 0);
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
      // skip
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

let optimizerSort = { field: "total_points", dir: "desc" };
let optimizerSquad = [];

function runOptimizer() {
  if (!bootstrapData) return;
  const budget = parseInt(document.getElementById("optimizer-budget").value);
  const allPlayers = bootstrapData.elements.filter((p) => p.minutes > 0 || p.total_points > 0);
  const maxPerTeam = 3;
  const limits = { 1: 2, 2: 5, 3: 5, 4: 3 };

  const byPos = { 1: [], 2: [], 3: [], 4: [] };
  for (const p of allPlayers) byPos[p.element_type]?.push(p);
  for (const pos of Object.keys(byPos)) {
    byPos[pos].sort((a, b) => b.total_points - a.total_points);
  }

  const squad = [];
  const teamCount = {};

  // Phase 1: cheapest at each position
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

  // Phase 2: upgrade within budget
  let improved = true;
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
        if (costDiff > remaining) continue;
        if (candidate.total_points <= cur.total_points) continue;
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

  optimizerSquad = squad;
  renderOptimizer();
  showSection("optimizer", "table");
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

  const tbody = document.getElementById("optimizer-body");
  tbody.innerHTML = `<tr><td colspan="6" style="padding:8px 12px;color:var(--accent);font-weight:600">
    ${t("optimizer.squad")}: ${totalPts} pkt · ${(totalCost / 10).toFixed(1)}m
  </td></tr>` + sorted.map((p, i) => {
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
      valuePerPoint: p.total_points > 0 ? +((p.now_cost / 10) / p.total_points * 10).toFixed(2) : 999,
      ptsPerCost: p.now_cost > 0 ? +(p.total_points / (p.now_cost / 10)).toFixed(2) : 0,
    }))
    .sort((a, b) => b.ptsPerCost - a.ptsPerCost);

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
  initTableSort("rankings-table", currentRankingsSort, renderRankings, ["totalPoints", "avgPoints", "playerCount"]);
  initTableSort("optimizer-table", optimizerSort, renderOptimizer, ["web_name", "now_cost", "total_points"]);
  initTableSort("homeaway-table", homeAwaySort, renderHomeAway, ["homeAvg", "awayAvg", "diff"]);
  initOptimizer();
  initKetchup();
  initHomeAway();
  initMyTeam();
  initLeader();
  loadData();
});
