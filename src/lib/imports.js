/** Competition of an imported tournament (older files only name it). */
export function importCompetitionId(doc) {
  if (doc && doc.competitionId) return doc.competitionId;
  const c = String(doc?.competition || "").toLowerCase();
  if (c.includes("πρωταθλ")) return "final-phase";
  return "cup";
}

/** The organiser's original sheets of an imported tournament. Firestore does
 * not accept arrays inside arrays, so the grid is stored as JSON text
 * (sourceSheetsJson); parsed once per document and cached. */
export const SOURCE_SHEETS_CACHE = new Map();
export function sourceSheetsOf(doc) {
  if (!doc) return [];
  if (Array.isArray(doc.sourceSheets)) return doc.sourceSheets;
  const txt = doc.sourceSheetsJson;
  if (!txt) return [];
  if (!SOURCE_SHEETS_CACHE.has(txt)) {
    try {
      SOURCE_SHEETS_CACHE.set(txt, JSON.parse(txt));
    } catch {
      SOURCE_SHEETS_CACHE.set(txt, []);
    }
  }
  return SOURCE_SHEETS_CACHE.get(txt);
}

/** Season of an imported tournament: explicit (national competitions follow
 * their own year, e.g. the 2025 final played in January 2026), otherwise
 * the calendar year of its date. */
export function importSeason(doc) {
  if (doc && Number(doc.seasonYear)) return Number(doc.seasonYear);
  const y = Number(String(doc?.date || "").slice(0, 4));
  return y || null;
}

/** "2026-10-02" -> ISO at local noon (for sorting with our tournaments). */
export function importDateIso(ymd) {
  const [y, m, d] = String(ymd || "").split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12).toISOString();
}

export function validateImport(doc) {
  const problems = [];
  if (!doc || doc.format !== "bgfed-import/1") return { problems: ["Το αρχείο δεν είναι αρχείο εισαγωγής της εφαρμογής (bgfed-import/1)."], summary: null };
  const players = new Set(doc.players || []);
  const wins = {};
  const losses = {};
  const byRound = {};
  (doc.matches || []).forEach((m) => {
    const key = `${m.bracket}|${m.round}`;
    byRound[key] = byRound[key] || new Set();
    [m.p1, m.p2].filter(Boolean).forEach((p) => {
      if (!players.has(p)) problems.push(`Γύρος ${m.round}: άγνωστος παίκτης «${p}».`);
      if (byRound[key].has(p)) problems.push(`Γύρος ${m.round}: ο «${p}» παίζει δύο φορές.`);
      byRound[key].add(p);
    });
    if (m.winner !== m.p1 && m.winner !== m.p2) problems.push(`Γύρος ${m.round}: ο νικητής δεν είναι ένας από τους δύο παίκτες.`);
    wins[m.winner] = (wins[m.winner] || 0) + 1;
    if (m.p2 && m.method !== "bye") {
      const loser = m.winner === m.p1 ? m.p2 : m.p1;
      losses[loser] = (losses[loser] || 0) + 1;
    }
  });
  (doc.placements || []).forEach((p) => {
    if ((wins[p.name] || 0) !== p.wins) problems.push(`Νίκες «${p.name}»: ${wins[p.name] || 0} από τους αγώνες, ${p.wins} στην κατάταξη της πηγής.`);
  });
  const real = (doc.matches || []).filter((m) => m.method !== "bye");
  if (doc.seasonYear != null && !Number(doc.seasonYear)) problems.push("Μη έγκυρη σεζόν.");
  return {
    problems,
    summary: {
      players: players.size,
      matches: real.length,
      byes: (doc.matches || []).length - real.length,
      rounds: Math.max(0, ...(doc.matches || []).map((m) => m.round)),
      winner: doc.placements && doc.placements[0] ? doc.placements[0].name : "—",
    },
  };
}
