import { normalizeName, displayNameFor } from "./persons.js";

/* ---------------------------------------------------------------------- */
/* ELO rating (backgammon FIBS-style, match-length aware)                 */
/*                                                                        */
/* Win probability P and points-at-stake S are match-length aware:        */
/*   P(A beats B) = 1 / (1 + 10^(-(Ra-Rb) * sqrt(N) / 2000))               */
/*   S = ELO_K_BASE * sqrt(N)                                              */
/* where N = match length (points to win a single match).                 */
/* This shape (P scaled by sqrt(N)) is well-attested across independent    */
/* backgammon-Elo sources tracing to FIBS in the 1990s. The specific       */
/* constant below (ELO_K_BASE = 4) matches one documented implementation   */
/* of that family but is not verified against FIBS's original source —    */
/* treat it as a reasonable, sourced default rather than a guaranteed      */
/* historical constant. K is fixed for all players (no experience-based    */
/* acceleration), matching this project's current design choice.          */
/* ---------------------------------------------------------------------- */

export const ELO_INITIAL = 1500;
export const ELO_K_BASE = 4;

export function eloWinProbability(ratingA, ratingB, matchLength) {
  const D = ratingA - ratingB;
  return 1 / (1 + Math.pow(10, (-D * Math.sqrt(matchLength)) / 2000));
}

export function eloPointsAtStake(matchLength) {
  return ELO_K_BASE * Math.sqrt(matchLength);
}



export function ensureEloPlayer(elo, name) {
  const key = normalizeName(name);
  if (!elo.players[key]) elo.players[key] = { name: displayNameFor(key, name), rating: ELO_INITIAL, games: 0, experience: 0, wins: 0, matches: 0 };
  if (elo.players[key].experience === undefined) elo.players[key].experience = 0;
  if (elo.players[key].wins === undefined) elo.players[key].wins = 0;
  if (elo.players[key].matches === undefined) elo.players[key].matches = 0;
  elo.players[key].name = displayNameFor(key, name);
  return key;
}

/** Applies one batch of simultaneous matches (e.g. one Swiss round) to the
 * ELO state in place. Each match: { w: winnerName, l: loserName, ret: bool }.
 * Retirement-decided matches (ret: true) are excluded from rating entirely,
 * per the project's rule that a walkover isn't a real backgammon result —
 * but the loser's retirement still counts toward their all-time matches
 * total (same rule as Season Standings' %), so it's tracked here too, in
 * this same pass, rather than needing a separate heavy recompute. */
export function applyEloRoundBatch(elo, roundMatches, matchLength) {
  const S = eloPointsAtStake(matchLength);
  const deltas = {};
  roundMatches.forEach((m) => {
    const wKey = ensureEloPlayer(elo, m.w);
    const lKey = ensureEloPlayer(elo, m.l);
    if (m.ret) {
      elo.players[lKey].matches += 1;
      return;
    }
    const Pw = eloWinProbability(elo.players[wKey].rating, elo.players[lKey].rating, matchLength);
    const delta = (1 - Pw) * S;
    deltas[wKey] = (deltas[wKey] || 0) + delta;
    deltas[lKey] = (deltas[lKey] || 0) - delta;
    elo.players[wKey].games += 1;
    elo.players[lKey].games += 1;
    elo.players[wKey].experience += matchLength;
    elo.players[lKey].experience += matchLength;
    elo.players[wKey].wins += 1;
    elo.players[wKey].matches += 1;
    elo.players[lKey].matches += 1;
  });
  Object.entries(deltas).forEach(([key, d]) => {
    elo.players[key].rating += d;
  });
}

/** Converts one round's pairs into the {w, l, ret} shape applyEloRoundBatch
 * expects. Shared by the live per-round path and the end-of-tournament
 * batch-replay path, so both stay in exact agreement. Double retirements
 * carry no winner and are skipped, same as a single-sided retirement. */
export function buildEloRoundMatches(pairs, byId) {
  return pairs
    .filter((pr) => pr.result && pr.result.method !== "double_retirement")
    .map((pr) => ({
      w: byId[pr.result.winnerId].name,
      l: byId[pr.result.loserId].name,
      ret: pr.result.method === "retirement",
    }));
}

/** Remembers which tournament changed the stored ELO, so a later check can
 * tell whether the ELO contains a test or a since-deleted tournament. */
export function markEloApplied(elo, tournamentId, name, mode) {
  if (!tournamentId) return;
  if (!elo.appliedTournaments) elo.appliedTournaments = {};
  elo.appliedTournaments[tournamentId] = { name: name || "Untitled", mode, at: new Date().toISOString() };
}
