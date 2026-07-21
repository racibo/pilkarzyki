// PL stadium coordinates (lat, lng) — 2025/26 season
// Keyed by FPL team ID. "base" = team's home city (approx), "stadium" = venue coordinates.
// Travel distance = haversine(away_base, home_stadium)

export const TEAM_COORDS = {
  1:  { name: "Arsenal",              base: [51.5549, -0.1084], stadium: [51.5549, -0.1084] },   // Emirates
  2:  { name: "Aston Villa",          base: [52.5092, -1.8847], stadium: [52.5092, -1.8847] },   // Villa Park
  3:  { name: "Bournemouth",          base: [50.7352, -1.8384], stadium: [50.7352, -1.8384] },   // Vitality
  4:  { name: "Brentford",            base: [51.4907, -0.2889], stadium: [51.4907, -0.2889] },   // Gtech
  5:  { name: "Brighton",             base: [50.8616, -0.0837], stadium: [50.8616, -0.0837] },   // Amex
  6:  { name: "Chelsea",              base: [51.4817, -0.1910], stadium: [51.4817, -0.1910] },   // Stamford Bridge
  7:  { name: "Crystal Palace",       base: [51.3983, -0.0856], stadium: [51.3983, -0.0856] },   // Selhurst Park
  8:  { name: "Everton",              base: [53.4151, -2.9980], stadium: [53.4151, -2.9980] },   // Bramley-Moore Dock
  9:  { name: "Fulham",               base: [51.4750, -0.1920], stadium: [51.4750, -0.1920] },   // Craven Cottage
  10: { name: "Ipswich Town",         base: [52.0541,  1.1453], stadium: [52.0541,  1.1453] },   // Portman Road
  11: { name: "Leicester City",       base: [52.6204, -1.1422], stadium: [52.6204, -1.1422] },   // King Power
  12: { name: "Liverpool",            base: [53.4315, -2.9608], stadium: [53.4315, -2.9608] },   // Anfield
  13: { name: "Manchester City",      base: [53.4831, -2.2004], stadium: [53.4831, -2.2004] },   // Etihad
  14: { name: "Manchester United",    base: [53.4631, -2.2913], stadium: [53.4631, -2.2913] },   // Old Trafford
  15: { name: "Newcastle United",     base: [54.9756, -1.6217], stadium: [54.9756, -1.6217] },   // St James'
  16: { name: "Nottingham Forest",    base: [52.9400, -1.1323], stadium: [52.9400, -1.1323] },   // City Ground
  17: { name: "Southampton",          base: [50.9058, -1.3910], stadium: [50.9058, -1.3910] },   // St Mary's
  18: { name: "Tottenham Hotspur",    base: [51.6042, -0.0662], stadium: [51.6042, -0.0662] },   // THS
  19: { name: "West Ham United",      base: [51.5387, -0.0166], stadium: [51.5387, -0.0166] },   // London Stadium
  20: { name: "Wolverhampton",        base: [52.5903, -2.1306], stadium: [52.5903, -2.1306] },   // Molineux
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
