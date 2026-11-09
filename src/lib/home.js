/* ---------------------------------------------------------------------- */
/* Αρχική (build 2026-11-09.05): βοηθητικά μόνο για εμφάνιση.             */
/* ---------------------------------------------------------------------- */
import { buildCalendarView, calendarEntryTitle } from "./calendar.js";
import { seasonCompetitionId } from "./seasonRegistry.js";

/** "YYYY-MM-DD" of today (local). */
export function todayLocalYMD(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Whole days from `from` to `to` (both "YYYY-MM-DD"). */
export function daysBetween(from, to) {
  const a = new Date(`${from}T12:00:00`);
  const b = new Date(`${to}T12:00:00`);
  return Math.round((b - a) / 86400000);
}

/** The next calendar days of every competition (still without a tournament,
 * today or later), soonest first: [{ id, seasonId, date, title, competitionId }]. */
export function upcomingCalendarEntries(sys, archive, imports, competitions, today, limit = 4) {
  const out = [];
  Object.keys((sys && sys.seasonCalendars) || {}).forEach((seasonId) => {
    buildCalendarView(sys, seasonId, archive, imports).forEach((e) => {
      if (e.status !== "scheduled" || !e.effectiveDate || e.effectiveDate < today) return;
      out.push({
        id: `${seasonId}:${e.id}`,
        seasonId,
        date: e.effectiveDate,
        title: calendarEntryTitle(e, seasonId, competitions, sys),
        competitionId: e.competitionId || seasonCompetitionId(sys, seasonId),
      });
    });
  });
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).slice(0, limit);
}

/** Done / total calendar days of a season ("13 από 16"). */
export function seasonProgress(sys, seasonId, archive, imports) {
  const view = buildCalendarView(sys, seasonId, archive, imports);
  return { done: view.filter((e) => e.status === "done").length, total: view.length };
}

/** Which state the hero panel shows: "live" > "recent" (≤ 3 days) > "next". */
export function pickHeroState({ live, recent, today }) {
  if (live) return "live";
  if (recent && recent.date && daysBetween(recent.date, today) <= 3) return "recent";
  return "next";
}
