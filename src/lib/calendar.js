import { isoToLocalYMD } from "./seasons.js";
import { DEFAULT_COMPETITION_ID, competitionName } from "./competitions.js";
import { seasonCompetitionId, seasonName } from "./seasonRegistry.js";

/* ---- Season calendar (Build 3B2) ---------------------------------------
 * Stored in the system document as seasonCalendars: { "2027": [entry] },
 * entry = { id, date: "YYYY-MM-DD", competitionId, note, tournamentId? }.
 * A tournament is linked to an entry either by the entry's tournamentId
 * (filled from existing tournaments) or by the tournament's own
 * calendarEntryId (tournaments created from the calendar). A linked
 * tournament that is moved to the trash simply stops counting.
 * Since 2026-10-24.01 an imported tournament can be linked too, by its own
 * calendarEntryId (chosen in the import preview): `imports` = [{ id, name,
 * date (ISO), calendarEntryId }] — it shows as a finished tournament with
 * `imported: true`. */
export function newCalendarEntryId() {
  return `cal_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Calendar links of the tournaments of an import bundle (2026-10-24.01).
 * `view` = buildCalendarView of the chosen season; items: [{ doc, replaceId,
 * calendarChoice }] — calendarChoice undefined = the suggestion (an open day
 * on the import's own date), "" = no link, else an entry id. Open days are
 * those without a tournament (or linked to an import this bundle replaces).
 * Returns { options, links: [entryId | null], duplicates: bool }. */
export function importCalendarLinks(view, items) {
  const replaced = new Set((items || []).map((it) => it.replaceId).filter(Boolean));
  const options = (view || []).filter((e) => !e.tournament || (e.tournament.imported && replaced.has(e.tournament.id)));
  const chosen = new Set((items || []).map((it) => it.calendarChoice).filter(Boolean));
  const used = new Set();
  let duplicates = false;
  const links = (items || []).map((it) => {
    let id = null;
    if (it.calendarChoice !== undefined) id = it.calendarChoice || null;
    else {
      const sug = options.find((e) => e.date === (it.doc && it.doc.date) && !used.has(e.id) && !chosen.has(e.id));
      id = sug ? sug.id : null;
    }
    if (id && used.has(id)) duplicates = true;
    if (id) used.add(id);
    return id;
  });
  return { options, links, duplicates };
}

export function todayYMD() {
  return isoToLocalYMD(new Date().toISOString());
}

/** The calendar of a season, ordered and enriched for display:
 * { ...entry, day (Premier League only), tournament, status, effectiveDate }. */
export function buildCalendarView(sys, year, archive, imports = []) {
  const entries = ((sys && sys.seasonCalendars && sys.seasonCalendars[String(year)]) || []).map((e) => {
    const imp = (imports || []).find((i) => i.calendarEntryId === e.id);
    const t =
      (e.tournamentId && archive.find((a) => a.id === e.tournamentId)) ||
      archive.find((a) => a.calendarEntryId === e.id) ||
      (imp ? { ...imp, status: "Completed", imported: true } : null);
    const effectiveDate = t ? isoToLocalYMD(t.date) || e.date : e.date;
    let status;
    if (t) status = t.status === "Completed" ? "done" : "live";
    else status = effectiveDate < todayYMD() ? "missed" : "scheduled";
    return { ...e, tournament: t, status, effectiveDate };
  });
  entries.sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : 0));
  // Numbered match days: the entries of the season's own competition (for the
  // Premier League exactly as before; since Σ3 also for other competitions).
  const own = seasonCompetitionId(sys, year);
  let n = 0;
  entries.forEach((e) => {
    if ((e.competitionId || own) === own) e.day = ++n;
  });
  return entries;
}

/** Progress of a season's Premier League calendar. */
export function calendarProgress(view) {
  const league = view.filter((e) => e.day);
  const done = league.filter((e) => e.status === "done").length;
  const next = league.find((e) => e.status === "live") || league.find((e) => e.status === "scheduled") || null;
  return { total: league.length, done, next };
}

/** Σ3: uses the season's NAME (not its id) and numbers the match days of
 * every competition; the Premier League keeps its established title. */
export function calendarEntryTitle(entry, year, competitions, sys) {
  const label = sys ? seasonName(sys, year) : String(year);
  const compId = entry.competitionId || (sys ? seasonCompetitionId(sys, year) : DEFAULT_COMPETITION_ID);
  if (entry.day && compId === DEFAULT_COMPETITION_ID) return `Backgammon Premier League ${label} - Ημέρα ${entry.day}`;
  const base = `${competitionName(competitions, compId)} ${label}`;
  return entry.day ? `${base} - Αγωνιστική ${entry.day}` : base;
}

export const CAL_STATUS_LABEL = { done: "Ολοκληρώθηκε", live: "Σε εξέλιξη", scheduled: "Προγραμματισμένη", missed: "Χωρίς τουρνουά" };

export function formatYMD(ymd) {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("el-GR", { weekday: "long", day: "numeric", month: "numeric", year: "numeric" });
}
