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

function parseCSV(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const vals = line.split(",");
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i]?.trim() ?? ""; });
    return obj;
  });
}

export async function fetchVaastavGW(season, gw) {
  const url = `${VAASTAV_BASE}/${season}/gws/gw${gw}.csv`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CSV fetch error: ${res.status}`);
  const text = await res.text();
  return parseCSV(text);
}
