import { saveSeason, loadSeasonStrict } from "../firebase.js";

import { normalizeName, displayNameFor } from "./persons.js";

export async function pushSeasonUpdate(year, tournamentId, tournamentName, date, playersList) {
  // Strict read: if the season cannot be read, write nothing. Writing onto
  // an empty stand-in would replace the whole season with this tournament.
  let season;
  try {
    season = await loadSeasonStrict(year);
  } catch {
    return false;
  }
  playersList.forEach((p) => {
    const key = normalizeName(p.name);
    if (!season.players[key]) season.players[key] = { name: displayNameFor(key, p.name), entries: {} };
    season.players[key].name = displayNameFor(key, p.name); // keep the person's current name
    const wins = p.matchLog.filter((m) => m.method === "normal" && m.result === "win").length;
    const aa = p.matchLog.filter((m) => m.method === "retirement_win").length;
    const bye = p.matchLog.filter((m) => m.method === "bye").length;
    // Retirement wins don't count toward the winner's matches-played total
    // (they get the standings point, but the match itself doesn't "count"
    // for them); a retirement loss, a double retirement, and every normal
    // match do count, for whoever played them.
    const matches = p.matchLog.filter((m) => m.method !== "bye" && m.method !== "retirement_win").length;
    // Matches actually decided on the board — excludes bye AND any match
    // ended by a retirement, whether won or lost. Used for the win % only.
    const normalMatches = p.matchLog.filter((m) => m.method === "normal").length;
    season.players[key].entries[tournamentId] = {
      tournamentName, date, points: p.wins, wins, aa, bye, matches, normalMatches,
    };
  });
  const ok = await saveSeason(year, season);
  return ok;
}

export function computeSeasonStandings(season, bestOf) {
  return Object.values(season.players)
    .map((p) => {
      const entries = Object.entries(p.entries).map(([tid, e]) => ({ tournamentId: tid, ...e }));
      const sorted = [...entries].sort((a, b) => b.points - a.points);
      const counted = sorted.slice(0, bestOf);
      const countedIds = new Set(counted.map((e) => e.tournamentId));
      const total = counted.reduce((s, e) => s + e.points, 0);
      const sumAll = entries.reduce((s, e) => s + e.points, 0);
      const normalWinsOnly = entries.reduce((s, e) => s + (e.wins ?? e.points ?? 0), 0);
      const totalMatches = entries.reduce((s, e) => s + (e.matches ?? 0), 0);
      // % = regular wins ÷ total matches (the same numbers already shown in
      // the Wins and Matches columns). A player who retires still has that
      // match counted against them in Matches, so it drags their % down —
      // deliberately, so retiring isn't "free" for the percentage.
      const pct = totalMatches > 0 ? Math.round((normalWinsOnly / totalMatches) * 1000) / 10 : null;
      return { name: p.name, entries: sorted, countedIds, total, sumAll, totalWins: normalWinsOnly, totalMatches, pct, eventsPlayed: entries.length };
    })
    .sort((a, b) => b.total - a.total || (b.pct ?? -1) - (a.pct ?? -1) || a.name.localeCompare(b.name, "el"));
}

/** "YYYY-MM-DD" of an ISO timestamp, in the browser's local time (Athens). */
export function isoToLocalYMD(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Moves an ISO timestamp to another calendar day, keeping its time of day
 * (so tournaments on the same day keep their original order). */
export function withLocalDate(iso, ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const base = iso ? new Date(iso) : new Date();
  const t = isNaN(base.getTime()) ? new Date() : base;
  return new Date(y, m - 1, d, t.getHours(), t.getMinutes(), t.getSeconds(), t.getMilliseconds()).toISOString();
}

/** The season a tournament date belongs to. The 2026 season is a one-off
 * that runs from 27/9/2025 to 31/12/2026; from 2027 a season is the
 * calendar year. Returns null for a date before the first season. */
export function seasonForDate(iso) {
  const ymd = isoToLocalYMD(iso);
  if (!ymd) return null;
  if (ymd >= "2027-01-01") return Number(ymd.slice(0, 4));
  if (ymd >= "2025-09-27") return 2026;
  return null;
}

/* ---- Season rules (Build 3A) ------------------------------------------
 * Each season keeps its own standings rules, set once a year from the
 * season's announcement: how many best results count, and the
 * qualification cut-offs. A season with no rules of its own inherits the
 * closest earlier season's — so changing next year's rules can never
 * rewrite a past season. Stored in the system document (seasonRules). */
export const DEFAULT_SEASON_RULES = { bestOf: 12, cutoffR32: 5, cutoffR48: 16 };

export function rulesForSeason(sys, year) {
  const all = (sys && sys.seasonRules) || {};
  const y = Number(year);
  if (all[String(y)]) return { ...DEFAULT_SEASON_RULES, ...all[String(y)], inherited: false, from: y };
  const earlier = Object.keys(all).map(Number).filter((k) => !isNaN(k) && k < y).sort((a, b) => b - a);
  if (earlier.length) return { ...DEFAULT_SEASON_RULES, ...all[String(earlier[0])], inherited: true, from: earlier[0] };
  return { ...DEFAULT_SEASON_RULES, inherited: true, from: null };
}

/* ---- Season closing (Build 3D) ------------------------------------------
 * seasonLocks: { "2026": { lockedAt } } in the system document. A locked
 * season's rules and calendar are read-only, changes to its tournaments
 * need an explicit per-tournament unlock, and a Recompute that would change
 * its standings stops and asks first. */
export function seasonLocked(sys, year) {
  return !!(sys && sys.seasonLocks && sys.seasonLocks[String(year)]);
}

/** Comparable fingerprint of a season's standings data (names ignored). */
export function seasonFingerprint(season) {
  const out = {};
  Object.keys((season && season.players) || {}).sort().forEach((k) => {
    const entries = season.players[k].entries || {};
    const keys = Object.keys(entries).sort();
    if (keys.length === 0) return;
    out[k] = keys.map((id) => {
      const e = entries[id];
      return [id, e.points, e.wins, e.matches, e.normalMatches ?? null];
    });
  });
  return JSON.stringify(out);
}

/** Statistics period filter (Build 3C): "all" or a season year. */
export function tournamentInScope(t, scope) {
  if (scope === "all") return true;
  return (Number(t.seasonYear) || seasonForDate(t.date)) === Number(scope);
}

export function scopeLabel(scope) {
  return scope === "all" ? "Όλες οι σεζόν" : `Σεζόν ${scope}`;
}

/** Human-readable range of a season, for warnings. */
export function seasonRangeLabel(year) {
  if (year === 2026) return "27/9/2025 – 31/12/2026";
  return `1/1/${year} – 31/12/${year}`;
}
