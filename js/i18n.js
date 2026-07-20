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
      avgPoints: "Śr. pkt/zaw.",
      playerCount: "Zawodników",
      noData: "Brak danych",
    },
    ketchup: {
      title: "Keczup",
      description: "Zawodnicy na progu formy — wysokie xP, niskie realne punkty",
      placeholder: "Wkrótce — wymaga pobrania element-summary dla zawodników",
      webName: "Zawodnik",
      team: "Drużyna",
      position: "Poz",
      price: "Cena",
      totalPts: "Pkt",
      expectedPts: "xP",
      diff: "Różnica",
      form: "Forma",
    },
    optimizer: {
      title: "Optymalizator budżetowy",
      description: "Suwak budżetu → automatyczny dobór składu",
      placeholder: "Wkrótce — solver doboru składu",
      budget: "Budżet",
      calculate: "Oblicz",
      squad: "Optymalny skład",
      overlap: "Pokrycie z Twoim składem",
    },
    homeAway: {
      title: "Dom / Wyjazd",
      description: "Zawodnicy z różnicą w punktowaniu mecz domowy vs wyjazdowy",
      placeholder: "Wkrótce — analiza was_home z historii",
      home: "Dom",
      away: "Wyjazd",
      diff: "Różnica",
    },
    squadBuilder: {
      title: "Buduj skład",
      description: "Rozszerzony optymalizator z filtrami",
      placeholder: "Wkrótce — budowa składu na podstawie filtrów",
    },
    myTeam: {
      title: "Mój skład",
      description: "Porównaj swój skład z optymalnym",
      placeholder: "Wkrótce — wpisz ID menedżera by zobaczyć skład",
      managerId: "ID menedżera",
      load: "Pobierz skład",
    },
    leader: {
      title: "Naśladuj lidera",
      description: "Porównanie z liderem ligi i sugestie transferów",
      placeholder: "Wkrótce — porównanie z liderem ligi",
      leagueId: "ID ligi",
      load: "Pobierz tabelę",
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
      noData: "Brak danych",
      players: "zawodników",
      seasonFinished: "Sezon zakończony",
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
      noData: "No data",
    },
    ketchup: {
      title: "Ketchup",
      description: "Players on the verge of form — high xP, low actual points",
      placeholder: "Coming soon — requires element-summary for players",
      webName: "Player",
      team: "Team",
      position: "Pos",
      price: "Price",
      totalPts: "Pts",
      expectedPts: "xP",
      diff: "Diff",
      form: "Form",
    },
    optimizer: {
      title: "Budget Optimizer",
      description: "Budget slider → automatic squad selection",
      placeholder: "Coming soon — squad selection solver",
      budget: "Budget",
      calculate: "Calculate",
      squad: "Optimal squad",
      overlap: "Overlap with your squad",
    },
    homeAway: {
      title: "Home / Away",
      description: "Players with home vs away scoring difference",
      placeholder: "Coming soon — was_home history analysis",
      home: "Home",
      away: "Away",
      diff: "Diff",
    },
    squadBuilder: {
      title: "Build Squad",
      description: "Extended optimizer with filters",
      placeholder: "Coming soon — squad builder with filters",
    },
    myTeam: {
      title: "My Team",
      description: "Compare your squad with the optimal one",
      placeholder: "Coming soon — enter manager ID to see squad",
      managerId: "Manager ID",
      load: "Load squad",
    },
    leader: {
      title: "Follow Leader",
      description: "Compare with league leader and transfer suggestions",
      placeholder: "Coming soon — compare with league leader",
      leagueId: "League ID",
      load: "Load standings",
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
      noData: "No data",
      players: "players",
      seasonFinished: "Season finished",
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
