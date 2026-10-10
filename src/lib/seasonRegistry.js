import { DEFAULT_COMPETITION_ID } from "./competitions.js";
import { seasonForDate } from "./seasons.js";

/* ---------------------------------------------------------------------- */
/* Seasons of competitions (Build 5B.2α)                                  */
/* ---------------------------------------------------------------------- */
/* A season belongs to one competition and has a free name ("2026",
 * "2026–27"); it is NOT tied to dates — a tournament names its season
 * explicitly. A season is identified by an integer id, which is also the id
 * of its standings document (seasons/{id}) and the key of its rules,
 * calendar and lock in the system document. The seasons opened before 5B
 * use the year as id (2026) and belong to the home competition (Premier
 * League); seasons opened from 5B.2β on get ids from NEW_SEASON_ID_BASE up.
 * Optional catalogue in the system document:
 *   seasons: { "<id>": { competitionId, name, createdAt } }
 * An id with no catalogue entry is a pre-5B season: home competition, name
 * = the year. So existing data needs no migration. */

export const NEW_SEASON_ID_BASE = 100000;

function implicitIds(sys) {
  const keys = new Set();
  ["seasonRules", "seasonCalendars", "seasonsOpened", "seasonLocks", "seasons"].forEach((f) => {
    Object.keys((sys && sys[f]) || {}).forEach((k) => keys.add(k));
  });
  return [...keys].map(Number).filter((n) => Number.isInteger(n) && n > 0);
}

export function seasonInfo(sys, id) {
  const n = Number(id);
  const entry = sys && sys.seasons && sys.seasons[String(n)];
  return {
    id: n,
    competitionId: (entry && entry.competitionId) || DEFAULT_COMPETITION_ID,
    name: (entry && entry.name) || String(n),
    createdAt: (entry && entry.createdAt) || null,
  };
}

export function seasonName(sys, id) {
  return seasonInfo(sys, id).name;
}

export function seasonCompetitionId(sys, id) {
  return seasonInfo(sys, id).competitionId;
}

/** Every known season, oldest first (ids grow with creation order).
 * extraIds: ids known from elsewhere (e.g. the standings documents). */
export function seasonsFrom(sys, extraIds = []) {
  const ids = new Set([...implicitIds(sys), ...extraIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)]);
  return [...ids].sort((a, b) => a - b).map((id) => seasonInfo(sys, id));
}

export function seasonsOfCompetition(sys, competitionId, extraIds = []) {
  const comp = competitionId || DEFAULT_COMPETITION_ID;
  return seasonsFrom(sys, extraIds).filter((s) => s.competitionId === comp);
}

/** Current season of a competition: the oldest one not yet closed (locked);
 * if all are closed, the newest. Before any season exists, the pre-5B
 * season of today's date. */
export function currentSeasonId(sys, competitionId, extraIds = []) {
  const list = seasonsOfCompetition(sys, competitionId, extraIds);
  const locks = (sys && sys.seasonLocks) || {};
  const open = list.filter((s) => !locks[String(s.id)]);
  if (open.length) return open[0].id;
  if (list.length) return list[list.length - 1].id;
  return seasonForDate(new Date().toISOString()) || new Date().getFullYear();
}

/** Next id for a new season (5B.2β). */
export function nextSeasonId(sys, extraIds = []) {
  const ids = seasonsFrom(sys, extraIds).map((s) => s.id).filter((n) => n >= NEW_SEASON_ID_BASE);
  return ids.length ? Math.max(...ids) + 1 : NEW_SEASON_ID_BASE + 1;
}
