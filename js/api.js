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
