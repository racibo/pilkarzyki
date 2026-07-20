export const translations = {
  pl: {
    title: "FPL Scout",
    subtitle: "Narzędzie do Fantasy Premier League",
    nav: {
      rankings: "Rankingi drużyn",
      ketchup: "Keczup",
      optimizer: "Optymalizator",
      homeAway: "Dom / Wyjazd",
      squadBuilder: "Buduj skład",
      myTeam: "Mój skład",
      leader: "Naśladuj lidera",
    },
    rankings: {
      title: "Rankingi drużyn per linia",
      description: "Suma punktów drużyn pogrupowanych według pozycji na boisku",
      gk: "Bramkarze",
      def: "Obrońcy",
      mid: "Pomocnicy",
      fwd: "Napastnicy",
      team: "Drużyna",
      totalPoints: "Suma pkt",
      avgPoints: "Śr. pkt/zawodnika",
      playerCount: "Zawodników",
    },
    common: {
      loading: "Ładowanie danych...",
      error: "Błąd ładowania danych",
      refresh: "Odśwież dane",
      lastUpdate: "Ostatnia aktualizacja",
      language: "Język",
      filter: "Filtruj",
      sort: "Sortuj",
      all: "Wszystkie",
    },
  },
  en: {
    title: "FPL Scout",
    subtitle: "Fantasy Premier League Tool",
    nav: {
      rankings: "Team Rankings",
      ketchup: "Ketchup",
      optimizer: "Optimizer",
      homeAway: "Home / Away",
      squadBuilder: "Build Squad",
      myTeam: "My Team",
      leader: "Follow Leader",
    },
    rankings: {
      title: "Team Rankings by Position",
      description: "Sum of team points grouped by on-field position",
      gk: "Goalkeepers",
      def: "Defenders",
      mid: "Midfielders",
      fwd: "Forwards",
      team: "Team",
      totalPoints: "Total Pts",
      avgPoints: "Avg Pts/Player",
      playerCount: "Players",
    },
    common: {
      loading: "Loading data...",
      error: "Error loading data",
      refresh: "Refresh data",
      lastUpdate: "Last update",
      language: "Language",
      filter: "Filter",
      sort: "Sort",
      all: "All",
    },
  },
};

let currentLang = localStorage.getItem("fpl-lang") || "pl";

export function t(path) {
  const keys = path.split(".");
  let val = translations[currentLang];
  for (const k of keys) {
    val = val?.[k];
  }
  return val ?? path;
}

export function setLang(lang) {
  currentLang = lang;
  localStorage.setItem("fpl-lang", lang);
  document.documentElement.lang = lang;
}

export function getLang() {
  return currentLang;
}
