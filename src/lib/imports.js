import { isMatchlist } from "./matchlists.js";
import { competitionById, competitionHasStandings } from "./competitions.js";
export { validateMatchlist, isMatchlist, MATCHLIST_FORMAT } from "./matchlists.js";

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
  if (isMatchlist(doc)) return null; // a match list has no season
  if (doc && Number(doc.seasonYear)) return Number(doc.seasonYear);
  const y = Number(String(doc?.date || "").slice(0, 4));
  return y || null;
}

/** countsInStandings (build 2026-10-24.01): an imported tournament counts
 * toward its season's standings only when the flag is set (absence = false,
 * so every earlier import stays out), it is not a match list, its
 * competition keeps standings and — with `matchedOnly` — every player is
 * matched (personMap). Works on a document or on an entry of sys-imports. */
export function importCountsInStandings(doc, { matchedOnly = false } = {}) {
  if (!doc || doc.countsInStandings !== true || isMatchlist(doc)) return false;
  if (!competitionHasStandings(competitionById(importCompetitionId(doc)))) return false;
  if (matchedOnly && (!doc.personMap || (doc.players || []).some((n) => !doc.personMap[n]))) return false;
  return true;
}

/** How many imported tournaments of the list (sys-imports) belong to a
 * competition — and, if seasonId is given, to that season of it (a match
 * list counts as one, in no season). */
export function importsCountFor(list, compId, seasonId) {
  return (list || []).filter((t) => importCompetitionId(t) === compId && (seasonId == null || importSeason(t) === Number(seasonId))).length;
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

/* ---- Import bundles (bgfed-import-bundle/1) -----------------------------
 * { format, title?, tournaments: [<bgfed-import/1>, …], matching?: <bgfed-matching/1> }
 * A single bgfed-import/1 file is read as a bundle of one. */
export const IMPORT_BUNDLE_FORMAT = "bgfed-import-bundle/1";

/** Validates every tournament of a bundle (validateImport, unchanged).
 * Returns { items: [{ doc, problems, summary }], matching, title, problems }
 * — problems: those of the bundle itself (format, duplicates). */
export function validateImportBundle(input) {
  const bundle = input && input.format === "bgfed-import/1" ? { format: IMPORT_BUNDLE_FORMAT, tournaments: [input] } : input;
  if (!bundle || bundle.format !== IMPORT_BUNDLE_FORMAT || !Array.isArray(bundle.tournaments) || bundle.tournaments.length === 0) {
    return { items: [], matching: null, title: "", problems: ["Το αρχείο δεν είναι αρχείο εισαγωγής της εφαρμογής (bgfed-import/1 ή bgfed-import-bundle/1)."] };
  }
  const items = bundle.tournaments.map((doc) => ({ doc, ...validateImport(doc) }));
  const problems = [];
  const seen = new Map();
  items.forEach((it, i) => {
    const url = it.doc && it.doc.sourceUrl;
    if (!url) return;
    if (seen.has(url)) problems.push(`Τα τουρνουά ${seen.get(url) + 1} και ${i + 1} έχουν το ίδιο link πηγής.`);
    else seen.set(url, i);
  });
  let matching = null;
  if (bundle.matching) {
    if (bundle.matching.format === "bgfed-matching/1") matching = bundle.matching;
    else problems.push("Οι αποφάσεις αντιστοίχισης του πακέτου δεν είναι σε μορφή bgfed-matching/1.");
  }
  return { items, matching, title: bundle.title || "", problems };
}

/** Saves the tournaments of a bundle one after the other, every one with the
 * chosen competition and season, then the list of imports ONCE at the end
 * (on a failure: the list with the ones saved so far, so none is left
 * outside it). items: [{ doc, summary, replaceId }].
 * io: { newId(), now(), saveDoc(id, doc) → bool, saveList(list) → bool,
 *       onProgress(k, n) }.
 * Returns { ok, saved: [names], failed: name | null, listSaved, list }. */
export async function saveImportBundle(items, { competitionId, seasonYear, countsInStandings, importsList }, io) {
  let list = [...(importsList || [])];
  const saved = [];
  let failed = null;
  for (let k = 0; k < items.length; k++) {
    const { doc, summary, replaceId, calendarEntryId } = items[k];
    io.onProgress(k + 1, items.length);
    const id = replaceId || io.newId();
    // The file's own countsInStandings / calendarEntryId never pass through
    // unchecked: the preview's choices replace them.
    const { countsInStandings: _c, calendarEntryId: _e, ...rest } = doc;
    const extra = { countsInStandings: !!countsInStandings, ...(calendarEntryId ? { calendarEntryId } : {}) };
    const stored = { ...rest, competitionId, seasonYear: Number(seasonYear), ...extra, importedAt: io.now() };
    if (!(await io.saveDoc(id, stored))) {
      failed = doc.name || `#${k + 1}`;
      break;
    }
    saved.push(doc.name);
    const entry = {
      id, name: doc.name, date: doc.date || "", dateEnd: doc.dateEnd || "", dateAssumed: !!doc.dateAssumed,
      competition: doc.competition || "", organiser: doc.organiser || "", sourceUrl: doc.sourceUrl || "",
      competitionId, seasonYear: Number(seasonYear), ...extra,
      players: summary.players, matches: summary.matches, winner: summary.winner, importedAt: stored.importedAt,
    };
    list = [...list.filter((t) => t.id !== id), entry];
  }
  const listSaved = saved.length > 0 ? await io.saveList(list) : true;
  return { ok: !failed && listSaved, saved, failed, listSaved, list };
}
