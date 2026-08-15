const PROXY_BASE = "/.netlify/functions/fpl-proxy";

export async function fetchFPL(path) {
  const url = `${PROXY_BASE}?path=${encodeURIComponent(path)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function getBootstrapStatic() {
  return fetchFPL("bootstrap-static");
}

export async function getFixtures() {
  return fetchFPL("fixtures");
}

export async function getPlayerSummary(playerId) {
  return fetchFPL(`element-summary/${playerId}`);
}

export async function getManagerPicks(managerId, gw) {
  return fetchFPL(`entry/${managerId}/event/${gw}/picks`);
}

export async function getLeagueStandings(leagueId) {
  return fetchFPL(`leagues-classic/${leagueId}/standings`);
}

export async function getEntry(managerId) {
  return fetchFPL(`entry/${managerId}`);
}

// ---- Vaastav FPL GitHub CSV helpers ----

const VAASTAV_BASE = "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data";
const VAASTAV_PROXY = "/.netlify/functions/fpl-proxy?vpath=";

// Quote-aware CSV parser (handles commas/quotes inside fields).
function parseCSV(text) {
  const lines = [];
  let field = "", row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); lines.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); lines.push(row); }
  if (lines.length < 2) return [];
  const headers = lines[0].map((h) => h.trim());
  return lines.slice(1).map((vals) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] || "").trim(); });
    return obj;
  });
}

// Estimate expected points (xP) from FPL's expected stats.
// vaastav's own `xP` column is empty (0 for all players), so we derive it:
// appearance points + attacking (xG*posWeight + xA*3) + clean-sheet probability (e^-xGC).
export function computeExpectedPoints(row) {
  const xG = parseFloat(row.expected_goals) || 0;
  const xA = parseFloat(row.expected_assists) || 0;
  const xGC = parseFloat(row.expected_goals_conceded) || 0;
  const mins = parseFloat(row.minutes) || 0;
  const pos = String(row.position || "").toUpperCase();
  const goalW = pos === "FWD" ? 4 : pos === "MID" ? 5 : 6; // GK/DEF 6, MID 5, FWD 4
  const appearance = Math.min(mins / 60, 1); // 1 pt for 60+ minutes
  const attacking = xG * goalW + xA * 3;
  const csEligible = pos === "GK" || pos === "DEF" || pos === "MID";
  const cs = csEligible ? Math.exp(-Math.max(xGC, 0)) * appearance : 0;
  return appearance + attacking + cs;
}

export async function fetchVaastavGW(season, gw) {
  const vpath = `${season}/gws/gw${gw}.csv`;
  const proxyUrl = `${VAASTAV_PROXY}${encodeURIComponent(vpath)}`;
  let res = null;
  try {
    res = await fetch(proxyUrl);
    // fetch does not reject on 4xx/5xx — treat a non-OK proxy response as a
    // failure so we fall back to direct GitHub (see diagnosis re: silent 400).
    if (res && !res.ok) res = null;
  } catch (e) {
    res = null;
  }
  if (!res) {
    try {
      res = await fetch(`${VAASTAV_BASE}/${vpath}`);
    } catch (e) {
      console.error(`fetchVaastavGW ${vpath} failed:`, e && e.message);
      throw new Error(`CSV fetch error for ${vpath}: ${e && e.message}`);
    }
  }
  if (!res.ok) {
    console.error(`fetchVaastavGW ${vpath} returned ${res.status}`);
    throw new Error(`CSV fetch error: ${res.status}`);
  }
  const text = await res.text();
  return parseCSV(text);
}

async function fetchVaastavFile(vpath) {
  const proxyUrl = `${VAASTAV_PROXY}${encodeURIComponent(vpath)}`;
  let res = null;
  try {
    res = await fetch(proxyUrl);
    if (res && !res.ok) res = null;
  } catch (e) {
    res = null;
  }
  if (!res) {
    try {
      res = await fetch(`${VAASTAV_BASE}/${vpath}`);
    } catch (e) {
      console.error(`fetchVaastavFile ${vpath} failed:`, e && e.message);
      throw new Error(`CSV fetch error for ${vpath}: ${e && e.message}`);
    }
  }
  if (!res.ok) {
    console.error(`fetchVaastavFile ${vpath} returned ${res.status}`);
    throw new Error(`CSV fetch error: ${res.status}`);
  }
  return parseCSV(await res.text());
}

export async function fetchVaastavTeams(season) {
  return fetchVaastavFile(`${season}/teams.csv`);
}

export async function fetchVaastavFixtures(season) {
  return fetchVaastavFile(`${season}/fixtures.csv`);
}

const vaastavSeasonCache = {};

export async function getVaastavSeason(season) {
  if (vaastavSeasonCache[season]) return vaastavSeasonCache[season];
  const [teams, fixtures] = await Promise.all([
    fetchVaastavTeams(season),
    fetchVaastavFixtures(season),
  ]);
  const teamMap = {};
  const nameToId = {};
  teams.forEach((t) => { teamMap[t.id] = t; nameToId[t.name] = t.id; });
  const data = { season, teams, teamMap, nameToId, fixtures, cum: null, playerCum: null };
  vaastavSeasonCache[season] = data;
  return data;
}

export function vaastavTeamId(data, teamField) {
  if (teamField == null) return teamField;
  const asStr = String(teamField);
  if (data.teamMap[asStr]) return asStr;
  if (data.nameToId[teamField]) return data.nameToId[teamField];
  return teamField;
}

export async function getVaastavCumulative(season, upToGW) {
  const data = await getVaastavSeason(season);
  if (!data.cum) data.cum = [];
  const needed = [];
  for (let gw = 1; gw <= upToGW; gw++) {
    if (!data.cum[gw]) needed.push(gw);
  }
  if (needed.length) {
    const fetched = await fetchGWBatch(season, needed);
    for (const gw of needed.sort((a, b) => a - b)) {
      const rows = fetched[gw] || [];
      const prev = data.cum[gw - 1] || {};
      const cur = { ...prev };
      for (const r of rows) {
        const rawTeam = r.team;
        if (!rawTeam) continue;
        const tid = vaastavTeamId(data, rawTeam);
        cur[tid] = (cur[tid] || 0) + (parseInt(r.total_points, 10) || 0);
      }
      data.cum[gw] = cur;
    }
  }
  return data.cum[upToGW] || {};
}

// Fetch vaastav GW CSVs in small batches (browsers limit ~6 parallel
// connections per host; GitHub CDN can throttle sudden bursts).
export async function fetchGWBatch(season, gws, batchSize = 5, delayMs = 100) {
  const out = {};
  for (let i = 0; i < gws.length; i += batchSize) {
    const batch = gws.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((gw) =>
        fetchVaastavGW(season, gw)
          .then((rows) => ({ gw, rows }))
          .catch((err) => {
            console.error(`vaastav gw${gw} (${season}) fetch failed:`, err && err.message);
            return { gw, rows: [] };
          })
      )
    );
    for (const r of results) out[r.gw] = r.rows;
    if (i + batchSize < gws.length && delayMs) await new Promise((res) => setTimeout(res, delayMs));
  }
  return out;
}

const VAASTAV_POS_TO_TYPE = { GK: 1, DEF: 2, MID: 3, FWD: 4 };

const vaastavPlayerCumCache = {};
const vaastavTeamMapCache = {};
const VAASTAV_LS_PREFIX = "fpl-vaastav-player-v2-";

function vaastavLsGet(season) {
  try {
    const raw = localStorage.getItem(VAASTAV_LS_PREFIX + season);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}

function vaastavLsSet(season, cum) {
  try { localStorage.setItem(VAASTAV_LS_PREFIX + season, JSON.stringify(cum)); } catch (e) {}
}

async function getVaastavTeamMaps(season) {
  if (vaastavTeamMapCache[season]) return vaastavTeamMapCache[season];
  let maps = { teamMap: {}, nameToId: {} };
  try {
    const teams = await fetchVaastavTeams(season);
    teams.forEach((t) => { maps.teamMap[t.id] = t; maps.nameToId[t.name] = t.id; });
  } catch {
    maps = { teamMap: {}, nameToId: {} };
  }
  vaastavTeamMapCache[season] = maps;
  return maps;
}

export async function getVaastavPlayerCumulative(season, upToGW) {
  const cum = vaastavPlayerCumCache[season] = vaastavPlayerCumCache[season] || [];
  if (!cum._loaded) {
    const ls = vaastavLsGet(season);
    if (ls) {
      for (let i = 0; i < ls.length; i++) cum[i] = ls[i];
      cum._loaded = true;
    }
  }
  const needed = [];
  for (let gw = 1; gw <= upToGW; gw++) {
    if (!cum[gw]) needed.push(gw);
  }
  if (needed.length) {
    const fetched = await fetchGWBatch(season, needed);
    const tm = await getVaastavTeamMaps(season);
    for (const gw of needed.sort((a, b) => a - b)) {
      const rows = fetched[gw] || [];
      // Don't cache an empty/failed result as "done" — `{}` is truthy, so the
      // `if (!cum[gw])` check above would skip re-fetching forever (stale cache).
      if (rows.length === 0) continue;
      const prev = cum[gw - 1] || {};
      const cur = {};
      for (const id in prev) cur[id] = { ...prev[id] };
      for (const r of rows) {
        const rawId = r.element;
        if (!rawId) continue;
        const id = String(rawId);
        const xP = computeExpectedPoints(r);
        const tp = parseInt(r.total_points, 10) || 0;
        let team = r.team;
        if (tm.nameToId[team]) team = tm.nameToId[team];
        if (!cur[id]) {
          cur[id] = {
            name: r.name || "",
            team,
            position: r.position || "",
            xPts: 0,
            total_points: 0,
          };
        }
        cur[id].xPts += xP;
        cur[id].total_points += tp;
      }
      cum[gw] = cur;
    }
    vaastavLsSet(season, cum);
    cum._loaded = true;
  }
  return cum[upToGW] || {};
}
