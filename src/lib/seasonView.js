import { competitionsFrom, competitionHasStandings, countsTowardStandings } from "./competitions.js";
import { seasonsOfCompetition, currentSeasonId } from "./seasonRegistry.js";
import { seasonForDate } from "./seasons.js";
import { importCountsInStandings, importSeason } from "./imports.js";
import { SEASON_VIEW_KEY } from "../config/constants.js";

/* ---------------------------------------------------------------------- */
/* Season standings page: filter, link, remembered choice (2026-10-15)     */
/* ---------------------------------------------------------------------- */

/** Link name of a competition: its optional `slug`, else its id. */
export function competitionSlug(c) {
  return (c && c.slug) || (c && c.id) || "";
}

/** A slug: Latin lower-case letters, digits and dashes. */
export function isValidSlug(s) {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(s || ""));
}

/** Problem with a slug for competition `compId`, or null if it may be used.
 * Empty = no slug (the id is used). Unique against the slugs AND ids of the
 * other competitions, since a missing slug falls back to the id. */
export function slugProblem(sys, compId, slug) {
  const s = String(slug || "").trim();
  if (!s) return null;
  if (!isValidSlug(s)) return "Μόνο λατινικά πεζά, αριθμοί και παύλες (π.χ. trikala, premier-league).";
  const taken = competitionsFrom(sys).filter((c) => c.id !== compId).some((c) => c.id === s || c.slug === s);
  return taken ? "Το όνομα συνδέσμου χρησιμοποιείται ήδη από άλλη διοργάνωση." : null;
}

/** Competitions shown on the standings page. */
export function standingsCompetitions(sys) {
  return competitionsFrom(sys).filter(competitionHasStandings);
}

/** "#season/<slug>" or "#season/<slug>/<season name>" → { slug, seasonName }. */
export function parseSeasonHash(hash) {
  const h = String(hash || "").replace(/^#/, "");
  if (!h.startsWith("season/")) return null;
  const parts = h.slice("season/".length).split("/").map((x) => {
    try {
      return decodeURIComponent(x);
    } catch {
      return x;
    }
  });
  if (!parts[0]) return null;
  return { slug: parts[0], seasonName: parts.slice(1).join("/") || null };
}

/** Shareable link of a competition (and season) on the standings page. */
export function seasonPageLink(comp, seasonName) {
  const base = `${window.location.origin}${window.location.pathname}`;
  const s = seasonName ? `/${encodeURIComponent(seasonName)}` : "";
  return `${base}#season/${encodeURIComponent(competitionSlug(comp))}${s}`;
}

/** Season of an in-app tournament (catalogue entry). */
function seasonOfEntry(t) {
  return Number(t.seasonYear) || seasonForDate(t.date);
}

/** Does a season have standings: at least one official in-app tournament
 * that counts toward standings, or (2026-10-24.01) an imported tournament
 * with countsInStandings (`imports`: documents in memory). No extra read. */
export function seasonHasStandings(archive, seasonId, imports = []) {
  const id = Number(seasonId);
  return (archive || []).some((t) => countsTowardStandings(t) && seasonOfEntry(t) === id)
    || (imports || []).some((d) => importCountsInStandings(d) && importSeason(d) === id);
}

/** Seasons offered on the standings page for a competition, newest first:
 * every season with standings, the current season, any later season, and
 * the one being shown (reached by a link or a remembered choice). Past
 * seasons without standings are left out. */
export function standingsSeasonOptions(sys, compId, extraIds, archive, selectedId, imports = []) {
  const current = currentSeasonId(sys, compId, extraIds);
  return seasonsOfCompetition(sys, compId, extraIds)
    .filter((s) => s.id === current || s.id === Number(selectedId) || s.id > current || seasonHasStandings(archive, s.id, imports))
    .sort((a, b) => b.id - a.id);
}

/** Remembered choice of this browser: { comp, season } or null. */
export function loadSeasonView() {
  try {
    const v = JSON.parse(window.localStorage.getItem(SEASON_VIEW_KEY) || "null");
    return v && typeof v.comp === "string" && Number(v.season) ? { comp: v.comp, season: Number(v.season) } : null;
  } catch {
    return null;
  }
}

export function saveSeasonView(comp, season) {
  try {
    window.localStorage.setItem(SEASON_VIEW_KEY, JSON.stringify({ comp, season: Number(season) }));
  } catch {
    // localStorage unavailable (private mode, etc.) — nothing is remembered.
  }
}

/** Initial choice of the standings page, once the settings are loaded:
 * a link (#season/<slug>[/<season name>]) wins, then the remembered choice;
 * null = use the default of today. A choice is used only while its
 * competition still keeps standings and the season still belongs to it. */
export function initialSeasonView(sys, extraIds, link, saved) {
  const comps = standingsCompetitions(sys);
  if (link) {
    const comp = comps.find((c) => competitionSlug(c) === link.slug) || comps.find((c) => c.id === link.slug);
    if (comp) {
      const seasons = seasonsOfCompetition(sys, comp.id, extraIds);
      const want = link.seasonName ? link.seasonName.trim().toLowerCase() : null;
      const byName = want ? seasons.find((s) => s.name.trim().toLowerCase() === want || String(s.id) === want) : null;
      return { comp: comp.id, season: byName ? byName.id : currentSeasonId(sys, comp.id, extraIds) };
    }
  }
  if (saved && comps.some((c) => c.id === saved.comp)) {
    const seasons = seasonsOfCompetition(sys, saved.comp, extraIds);
    if (seasons.some((s) => s.id === saved.season)) return { comp: saved.comp, season: saved.season };
  }
  return null;
}
