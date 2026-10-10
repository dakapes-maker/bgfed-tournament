import { isoToLocalYMD } from "./seasons.js";
import { DEFAULT_COMPETITION_ID, competitionName } from "./competitions.js";

/* ---- Season calendar (Build 3B2) ---------------------------------------
 * Stored in the system document as seasonCalendars: { "2027": [entry] },
 * entry = { id, date: "YYYY-MM-DD", competitionId, note, tournamentId? }.
 * A tournament is linked to an entry either by the entry's tournamentId
 * (filled from existing tournaments) or by the tournament's own
 * calendarEntryId (tournaments created from the calendar). A linked
 * tournament that is moved to the trash simply stops counting. */
export function newCalendarEntryId() {
  return `cal_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function todayYMD() {
  return isoToLocalYMD(new Date().toISOString());
}

/** The calendar of a season, ordered and enriched for display:
 * { ...entry, day (Premier League only), tournament, status, effectiveDate }. */
export function buildCalendarView(sys, year, archive) {
  const entries = ((sys && sys.seasonCalendars && sys.seasonCalendars[String(year)]) || []).map((e) => {
    const t =
      (e.tournamentId && archive.find((a) => a.id === e.tournamentId)) ||
      archive.find((a) => a.calendarEntryId === e.id) ||
      null;
    const effectiveDate = t ? isoToLocalYMD(t.date) || e.date : e.date;
    let status;
    if (t) status = t.status === "Completed" ? "done" : "live";
    else status = effectiveDate < todayYMD() ? "missed" : "scheduled";
    return { ...e, tournament: t, status, effectiveDate };
  });
  entries.sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : 0));
  let n = 0;
  entries.forEach((e) => {
    if ((e.competitionId || DEFAULT_COMPETITION_ID) === DEFAULT_COMPETITION_ID) e.day = ++n;
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

export function calendarEntryTitle(entry, year, competitions) {
  if (entry.day) return `Backgammon Premier League ${year} - Ημέρα ${entry.day}`;
  return `${competitionName(competitions, entry.competitionId)} ${year}`;
}

export const CAL_STATUS_LABEL = { done: "Ολοκληρώθηκε", live: "Σε εξέλιξη", scheduled: "Προγραμματισμένη", missed: "Χωρίς τουρνουά" };

export function formatYMD(ymd) {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("el-GR", { weekday: "long", day: "numeric", month: "numeric", year: "numeric" });
}
