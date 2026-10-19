import { saveSeason, loadSeasonStrict } from "../firebase.js";

import { normalizeName, displayNameFor } from "./persons.js";
import { DEFAULT_COMPETITION_ID } from "./competitions.js";

/** Writes this tournament's entries into the season (one entry per player,
 * keyed by tournamentId — so a later write replaces the earlier one).
 * `opts.live`: a «live» write while the tournament runs (2026-10-19) — marks
 * the tournament in `season.live` with the time of the write (the «● Live»
 * sign of the Standings page); any other write clears that mark. */
export async function pushSeasonUpdate(year, tournamentId, tournamentName, date, playersList, opts = {}) {
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
    // ended by a retirement, whether won or lost. Kept in the season data
    // only; not used for the win % since build 2026-09-22.07 (% = wins ÷
    // matches).
    const normalMatches = p.matchLog.filter((m) => m.method === "normal").length;
    season.players[key].entries[tournamentId] = {
      tournamentName, date, points: p.wins, wins, aa, bye, matches, normalMatches,
    };
  });
  const live = { ...(season.live || {}) };
  if (opts.live) live[tournamentId] = new Date().toISOString();
  else delete live[tournamentId];
  if (Object.keys(live).length > 0) season.live = live;
  else delete season.live;
  const ok = await saveSeason(year, season);
  return ok;
}

const ratio = (w, m) => (m > 0 ? w / m : null);
const entryPct = (e) => ratio(e.wins ?? e.points ?? 0, e.matches ?? 0);

/** Season standings, in official order. Main order: points in the best N
 * (`total`). Tie-breaks between players with the same total, in order:
 * 1) points in all tournaments (`sumAll`), 2) win % in all tournaments,
 * 3) win % in the best N only (both % compared EXACTLY, not rounded),
 * 4) head-to-head in the season — only when exactly two players are still
 * level after 1–3, and only when `headToHead(keyA, keyB) → { winsA, winsB }`
 * is given. A tie that remains is a full tie: the name below keeps the
 * table's order stable and is NOT a criterion (never shown as one).
 * Each row gets `tie`: null, or { withNames, decidedBy, detail: { above, below } }
 * — how the row compares with its tied neighbours (decidedBy 1..4 or "full"). */
export function computeSeasonStandings(season, bestOf, headToHead = null) {
  // Σ1: the name shown is the person's CURRENT name in the registry (the
  // stored copy may be older, e.g. after a rename) — no Recompute needed.
  const rows = Object.entries(season.players)
    .map(([key, p]) => {
      const entries = Object.entries(p.entries).map(([tid, e]) => ({ tournamentId: tid, ...e }));
      // Best N: on equal points, the tournament with the higher win % and
      // then the more recent one counts (deterministic, in the player's favour).
      const sorted = [...entries].sort((a, b) =>
        b.points - a.points
        || (entryPct(b) ?? -1) - (entryPct(a) ?? -1)
        || String(b.date || "").localeCompare(String(a.date || "")));
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
      const pctExact = ratio(normalWinsOnly, totalMatches);
      const pct = pctExact !== null ? Math.round(pctExact * 1000) / 10 : null;
      const bestWins = counted.reduce((s, e) => s + (e.wins ?? e.points ?? 0), 0);
      const bestMatches = counted.reduce((s, e) => s + (e.matches ?? 0), 0);
      const pctBestExact = ratio(bestWins, bestMatches);
      const pctBest = pctBestExact !== null ? Math.round(pctBestExact * 1000) / 10 : null;
      return {
        key, name: displayNameFor(key, p.name), entries: sorted, countedIds, total, sumAll,
        totalWins: normalWinsOnly, totalMatches, pct, pctExact, pctBest, pctBestExact, eventsPlayed: entries.length, tie: null,
      };
    });

  // Criteria 1–3: the first that tells a and b apart (> 0: a ahead), else 0.
  const crit = [
    (a, b) => b.sumAll - a.sumAll,
    (a, b) => (b.pctExact ?? -1) - (a.pctExact ?? -1),
    (a, b) => (b.pctBestExact ?? -1) - (a.pctBestExact ?? -1),
  ];
  const firstDiff = (a, b) => {
    for (let i = 0; i < crit.length; i++) {
      const d = crit[i](a, b);
      if (d !== 0) return { by: i + 1, d };
    }
    return null;
  };
  const byName = (a, b) => a.name.localeCompare(b.name, "el");

  const out = [];
  const byTotal = {};
  rows.forEach((r) => { (byTotal[r.total] = byTotal[r.total] || []).push(r); });
  Object.keys(byTotal).map(Number).sort((a, b) => b - a).forEach((total) => {
    const group = byTotal[total].sort((a, b) => (firstDiff(a, b)?.d ?? 0) || byName(a, b));
    // Players still level after 1–3: head-to-head only for exactly two.
    const sub = [];
    group.forEach((r) => {
      const last = sub[sub.length - 1];
      if (last && !firstDiff(last[0], r)) last.push(r);
      else sub.push([r]);
    });
    const h2h = new Map(); // row → { winsA (its own), winsB (the other's) }
    sub.forEach((s) => {
      if (s.length !== 2 || !headToHead) return;
      const [a, b] = s;
      const { winsA, winsB } = headToHead(a.key, b.key);
      h2h.set(a, { own: winsA, other: winsB });
      h2h.set(b, { own: winsB, other: winsA });
      if (winsB > winsA) s.reverse();
    });
    const ordered = sub.flat();
    if (ordered.length > 1) {
      const compare = (r, o, sideAbove) => {
        const f = firstDiff(r, o);
        const values = { sumAll: [r.sumAll, o.sumAll], pct: [r.pctExact, o.pctExact], pctBest: [r.pctBestExact, o.pctBestExact] };
        if (f) return { name: o.name, ahead: !sideAbove, decidedBy: f.by, values };
        const hh = h2h.get(r);
        if (hh && hh.own !== hh.other) return { name: o.name, ahead: hh.own > hh.other, decidedBy: 4, values: { ...values, h2h: [hh.own, hh.other] } };
        return { name: o.name, ahead: null, decidedBy: "full", values, h2hApplies: sub.find((s) => s.includes(r)).length === 2 };
      };
      ordered.forEach((r, i) => {
        const above = i > 0 ? compare(r, ordered[i - 1], true) : null;
        const below = i < ordered.length - 1 ? compare(r, ordered[i + 1], false) : null;
        r.tie = {
          withNames: ordered.filter((o) => o !== r).map((o) => o.name),
          decidedBy: (below || above).decidedBy,
          detail: { above, below },
        };
      });
    }
    out.push(...ordered);
  });
  return out;
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
/** Pre-5B rule (season from the date). Since 5B.2α only a FALLBACK for
 * old tournaments with no declared season, and for the very first default;
 * never used to suggest or check a tournament's season. */
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
  // 5B.2α: inherit only from an earlier season of the SAME competition
  // (season ids grow with creation order; see lib/seasonRegistry.js).
  const compOf = (k) => (sys && sys.seasons && sys.seasons[String(k)] && sys.seasons[String(k)].competitionId) || DEFAULT_COMPETITION_ID;
  const comp = compOf(y);
  // Qualification zones (Player of the Year / Round of 32 / 48) are a rule
  // of the season: explicit qualZones, else only the Premier League's
  // seasons have them (no database write needed for the existing ones).
  const withZones = (r) => ({ ...r, qualZones: typeof r.qualZones === "boolean" ? r.qualZones : comp === DEFAULT_COMPETITION_ID });
  if (all[String(y)]) return withZones({ ...DEFAULT_SEASON_RULES, ...all[String(y)], inherited: false, from: y });
  const earlier = Object.keys(all).map(Number).filter((k) => !isNaN(k) && k < y && compOf(k) === comp).sort((a, b) => b - a);
  if (earlier.length) return withZones({ ...DEFAULT_SEASON_RULES, ...all[String(earlier[0])], inherited: true, from: earlier[0] });
  return withZones({ ...DEFAULT_SEASON_RULES, inherited: true, from: null });
}

/** The stored copy of a season's rules (what createSeason / saveSeasonRules
 * pin): best-of, cut-offs and the zones switch. */
export function storedRules(r, setAt) {
  return { bestOf: r.bestOf, cutoffR32: r.cutoffR32, cutoffR48: r.cutoffR48, qualZones: !!r.qualZones, setAt };
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

