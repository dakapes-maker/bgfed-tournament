import { fetchTournamentData, fetchTournamentDataStrict } from "../firebase.js";
import { normalizeName } from "./persons.js";
import { countsTowardStandings } from "./competitions.js";
import { seasonForDate } from "./seasons.js";

/* ---- Head-to-head in a season (tie-break 4, build 2026-10-18.01) --------
 * Wins of each player against the other in the official tournaments that
 * count toward a season's standings. A win = a regular win or a win by
 * retirement; a double retirement and a bye count for no one. */

/** Adds one tournament's matches to an accumulator { "keyA|keyB": wins of A over B }. */
export function addTournamentHeadToHead(acc, players) {
  const keyOf = {};
  (players || []).forEach((p) => { keyOf[p.id] = normalizeName(p.name); });
  (players || []).forEach((p) => {
    const me = keyOf[p.id];
    (p.matchLog || []).forEach((m) => {
      if (m.result !== "win" || (m.method !== "normal" && m.method !== "retirement_win")) return;
      const opp = keyOf[m.opponentId];
      if (!opp || opp === me) return;
      const k = `${me}|${opp}`;
      acc[k] = (acc[k] || 0) + 1;
    });
  });
  return acc;
}

/** The headToHead(keyA, keyB) → { winsA, winsB } function of an accumulator. */
export function headToHeadFrom(acc) {
  return (a, b) => ({ winsA: acc[`${a}|${b}`] || 0, winsB: acc[`${b}|${a}`] || 0 });
}

/** The catalogue entries whose tournaments make up a season's standings
 * (the same filter as the standings Recompute). */
export function standingsTournamentsOf(index, seasonId) {
  const id = Number(seasonId);
  const seen = new Set();
  return (index || []).filter((t) => {
    if (seen.has(t.id) || !countsTowardStandings(t) || (Number(t.seasonYear) || seasonForDate(t.date)) !== id) return false;
    seen.add(t.id);
    return true;
  });
}

/** Builds headToHead for a season: reads each counting tournament with
 * `load(id)` (finished ones only, as the Recompute). `skipId` leaves one
 * tournament out (the recap's «before» standings). Throws if `load` throws. */
export async function buildSeasonHeadToHead(index, seasonId, load, skipId = null) {
  const acc = {};
  for (const t of standingsTournamentsOf(index, seasonId)) {
    if (t.id === skipId) continue;
    const data = await load(t.id);
    if (!data || !data.players || data.phase !== "finished") continue;
    addTournamentHeadToHead(acc, data.players);
  }
  return headToHeadFrom(acc);
}

/** Read for display: the visit's cache, else a strict read (so a failed
 * read throws instead of looking like a missing tournament). */
export async function loadTournamentForDisplay(id) {
  const d = await fetchTournamentData(id);
  return d || (await fetchTournamentDataStrict(id));
}
