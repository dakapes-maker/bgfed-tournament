import { replayPlayersFromHistory } from "./swiss.js";
import { loadSeasonStrict, saveSeason } from "../firebase.js";

/* ---------------------------------------------------------------------- */
/* Live season standings, per result (2026-10-19,                         */
/* docs/plan-live-season-per-match-2026-10-19.md). With «live update» on, */
/* every result of a running tournament is written to the season at once; */
/* the ELO stays per round.                                                */
/* ---------------------------------------------------------------------- */

/** How long a «live» mark of the season counts as a running tournament
 * (a tournament closed without a final season write, or moved to the
 * trash, would otherwise keep the sign on for good). */
export const LIVE_MARK_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** The players as they stand right now: the finished rounds (`history`)
 * plus the results of the current round already entered and its bye
 * (certain from the draw). Same replay as a round's close, so wins / A.A.
 * / bye / matches come out exactly the same. */
export function livePlayers(players, history, round, pairing) {
  if (!pairing) return replayPlayersFromHistory(players, history);
  const current = { round, pairs: pairing.pairs || [], bye: pairing.bye || null };
  return replayPlayersFromHistory(players, [...history, current]);
}

/** Serial writer for the season document: jobs (async () => true/false)
 * never run in parallel, since each one reads, changes and writes the whole
 * season. `schedule(job)` waits `delay` ms and keeps only the newest job
 * waiting (coalescing); `now(job)` drops any waiting job (this one is newer)
 * and runs right after the current write, resolving to its result.
 * `onFailure()` is called when a scheduled job fails and no newer one waits. */
export function createSerialWriter({ delay = 1000, onFailure } = {}) {
  let chain = Promise.resolve();
  let pending = null;
  let timer = null;
  let queued = false;

  function enqueue(run) {
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  }

  function fire() {
    timer = null;
    if (queued) return; // the job already in line will take the newest one
    queued = true;
    enqueue(async () => {
      queued = false;
      const job = pending;
      pending = null;
      if (!job) return true;
      let ok = false;
      try {
        ok = await job();
      } catch {
        ok = false;
      }
      if (!ok && !pending && onFailure) onFailure();
      return ok;
    });
  }

  return {
    schedule(job) {
      pending = job;
      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, delay);
    },
    now(job) {
      pending = null;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      return enqueue(async () => {
        try {
          return await job();
        } catch {
          return false;
        }
      });
    },
  };
}

/** Removes a tournament's entries from a season (a round 1 redrawn back to
 * Setup, after a live write). Strict read: on a failed read nothing is
 * written. A player left with no entries at all is dropped. */
export async function removeTournamentFromSeason(year, tournamentId) {
  let season;
  try {
    season = await loadSeasonStrict(year);
  } catch {
    return false;
  }
  let changed = false;
  Object.keys(season.players || {}).forEach((key) => {
    const entries = season.players[key].entries || {};
    if (!(tournamentId in entries)) return;
    delete entries[tournamentId];
    if (Object.keys(entries).length === 0) delete season.players[key];
    changed = true;
  });
  if (season.live && tournamentId in season.live) {
    delete season.live[tournamentId];
    if (Object.keys(season.live).length === 0) delete season.live;
    changed = true;
  }
  if (!changed) return true;
  return await saveSeason(year, season);
}

/** The «● Live» sign of the Standings page: the newest live write of a
 * tournament still running (mark younger than LIVE_MARK_MAX_AGE_MS, and not
 * Completed in the catalogue, when the catalogue knows it). → Date, or null. */
export function liveSeasonUpdatedAt(season, archive, now = Date.now()) {
  const marks = (season && season.live) || {};
  let newest = null;
  Object.entries(marks).forEach(([tid, at]) => {
    const t = new Date(at);
    if (isNaN(t)) return;
    if (now - t.getTime() > LIVE_MARK_MAX_AGE_MS) return;
    const entry = (archive || []).find((a) => a.id === tid);
    if (entry && entry.status === "Completed") return;
    if (!newest || t > newest) newest = t;
  });
  return newest;
}

/** Clears only the «live» mark of a tournament (it finished without a final
 * season write). Strict read: on a failed read nothing is written. */
export async function clearLiveMark(year, tournamentId) {
  let season;
  try {
    season = await loadSeasonStrict(year);
  } catch {
    return false;
  }
  if (!season.live || !(tournamentId in season.live)) return true;
  delete season.live[tournamentId];
  if (Object.keys(season.live).length === 0) delete season.live;
  return await saveSeason(year, season);
}
