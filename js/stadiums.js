// PL stadium coordinates (lat, lng) — 2025/26 season
// Keyed by FPL team ID. "base" = team's home city (approx), "stadium" = venue coordinates.
// Travel distance = haversine(away_base, home_stadium)

export const TEAM_COORDS = {
  1:  { name: "Arsenal",              base: [51.5549, -0.1084], stadium: [51.5549, -0.1084], region: "london", stadiumName: "Emirates Stadium" },
  2:  { name: "Aston Villa",          base: [52.5092, -1.8847], stadium: [52.5092, -1.8847], region: "midlands", stadiumName: "Villa Park" },
  3:  { name: "Bournemouth",          base: [50.7352, -1.8384], stadium: [50.7352, -1.8384], region: "south", stadiumName: "Vitality Stadium" },
  4:  { name: "Brentford",            base: [51.4907, -0.2889], stadium: [51.4907, -0.2889], region: "london", stadiumName: "Gtech Community Stadium" },
  5:  { name: "Brighton",             base: [50.8616, -0.0837], stadium: [50.8616, -0.0837], region: "south", stadiumName: "Amex Stadium" },
  6:  { name: "Chelsea",              base: [51.4817, -0.1910], stadium: [51.4817, -0.1910], region: "london", stadiumName: "Stamford Bridge" },
  7:  { name: "Crystal Palace",       base: [51.3983, -0.0856], stadium: [51.3983, -0.0856], region: "london", stadiumName: "Selhurst Park" },
  8:  { name: "Everton",              base: [53.4151, -2.9980], stadium: [53.4151, -2.9980], region: "north", stadiumName: "Bramley-Moore Dock" },
  9:  { name: "Fulham",               base: [51.4750, -0.1920], stadium: [51.4750, -0.1920], region: "london", stadiumName: "Craven Cottage" },
  10: { name: "Ipswich Town",         base: [52.0541,  1.1453], stadium: [52.0541,  1.1453], region: "east", stadiumName: "Portman Road" },
  11: { name: "Leicester City",       base: [52.6204, -1.1422], stadium: [52.6204, -1.1422], region: "midlands", stadiumName: "King Power Stadium" },
  12: { name: "Liverpool",            base: [53.4315, -2.9608], stadium: [53.4315, -2.9608], region: "north", stadiumName: "Anfield" },
  13: { name: "Manchester City",      base: [53.4831, -2.2004], stadium: [53.4831, -2.2004], region: "north", stadiumName: "Etihad Stadium" },
  14: { name: "Manchester United",    base: [53.4631, -2.2913], stadium: [53.4631, -2.2913], region: "north", stadiumName: "Old Trafford" },
  15: { name: "Newcastle United",     base: [54.9756, -1.6217], stadium: [54.9756, -1.6217], region: "north", stadiumName: "St James' Park" },
  16: { name: "Nottingham Forest",    base: [52.9400, -1.1323], stadium: [52.9400, -1.1323], region: "midlands", stadiumName: "City Ground" },
  17: { name: "Southampton",          base: [50.9058, -1.3910], stadium: [50.9058, -1.3910], region: "south", stadiumName: "St Mary's Stadium" },
  18: { name: "Tottenham Hotspur",    base: [51.6042, -0.0662], stadium: [51.6042, -0.0662], region: "london", stadiumName: "Tottenham Hotspur Stadium" },
  19: { name: "West Ham United",      base: [51.5387, -0.0166], stadium: [51.5387, -0.0166], region: "london", stadiumName: "London Stadium" },
  20: { name: "Wolverhampton",        base: [52.5903, -2.1306], stadium: [52.5903, -2.1306], region: "midlands", stadiumName: "Molineux Stadium" },
};

export const REGIONS = {
  london: { name: "Londyn", teams: [1, 4, 6, 7, 9, 18, 19] },
  north: { name: "Północ", teams: [8, 12, 13, 14, 15] },
  midlands: { name: "Midlands", teams: [2, 11, 16, 20] },
  south: { name: "Południe", teams: [3, 5, 17] },
  east: { name: "Wschód", teams: [10] },
};

// Haversine distance in km between two [lat, lng] points
export function haversine([lat1, lng1], [lat2, lng2]) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Distance (km) that away team travels to home team's stadium
export function travelDistance(awayTeamId, homeTeamId) {
  const away = TEAM_COORDS[awayTeamId];
  const home = TEAM_COORDS[homeTeamId];
  if (!away || !home) return 0;
  return haversine(away.base, home.stadium);
}
