/* ---------------------------------------------------------------------- */
/* Pairing / scoring helpers                                              */
/* ---------------------------------------------------------------------- */

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function shuffleWithinScoreGroups(sortedDesc) {
  const result = [];
  let i = 0;
  while (i < sortedDesc.length) {
    let j = i;
    while (j < sortedDesc.length && sortedDesc[j].wins === sortedDesc[i].wins) j++;
    result.push(...shuffle(sortedDesc.slice(i, j)));
    i = j;
  }
  return result;
}

/**
 * Round 1: fully random. Round 2+: players ordered by score (ties shuffled),
 * then greedily paired with the nearest not-yet-played opponent. Simplified
 * vs. full FIDE Swiss (no backtracking) — adequate for club-size fields.
 * Forced rematches (rare) are flagged via rematchCount.
 */
/**
 * Round 1: fully random. Round 2+: players ordered by score (ties shuffled),
 * then greedily paired with the nearest not-yet-played opponent. Simplified
 * vs. full FIDE Swiss (no backtracking) — adequate for club-size fields.
 * Forced rematches (rare) are flagged via rematchCount.
 *
 * Inactive players (excludedFromTournament) stay IN the pairing pool like
 * anyone else — they get a real opponent drawn normally — but any pair
 * involving one is auto-resolved right here as a retirement (or, if both
 * sides are inactive, a double retirement with no winner). This keeps the
 * bracket fully visible and honest: nothing is hidden from the pool, the
 * outcome is just already decided when the pairing appears.
 */
export function generatePairings(players, roundNumber) {
  const byId = {};
  players.forEach((p) => { byId[p.id] = p; });

  let pool = [...players];
  let bye = null;

  if (pool.length % 2 === 1) {
    const eligible = pool.filter((p) => !p.excludedFromTournament);
    const byeCandidates = eligible.length > 0 ? eligible : pool;
    const ascByWins = [...byeCandidates].sort((a, b) => a.wins - b.wins);
    bye = ascByWins.find((p) => !p.hadBye) || ascByWins[0];
    pool = pool.filter((p) => p.id !== bye.id);
  }

  const order =
    roundNumber === 1
      ? shuffle(pool)
      : shuffleWithinScoreGroups([...pool].sort((a, b) => b.wins - a.wins));

  const remaining = [...order];
  const pairs = [];
  let rematchCount = 0;

  while (remaining.length > 0) {
    const p = remaining.shift();
    let idx = remaining.findIndex((q) => !p.opponents.includes(q.id));
    if (idx === -1) {
      idx = 0;
      rematchCount++;
    }
    const opp = remaining.splice(idx, 1)[0];

    const p1Inactive = !!byId[p.id]?.excludedFromTournament;
    const p2Inactive = !!byId[opp.id]?.excludedFromTournament;
    let result = null;
    if (p1Inactive && p2Inactive) {
      result = { winnerId: null, loserId: null, method: "double_retirement" };
    } else if (p1Inactive) {
      result = { winnerId: opp.id, loserId: p.id, method: "retirement" };
    } else if (p2Inactive) {
      result = { winnerId: p.id, loserId: opp.id, method: "retirement" };
    }

    pairs.push({ p1: p.id, p2: opp.id, result });
  }

  return { pairs, bye: bye ? bye.id : null, rematchCount };
}

/** Rebuilds every player's wins/opponents/matchLog/withdrawn state from
 * scratch by replaying the tournament's history in round order. Used both
 * to let any past round's result stay editable (recompute after a fix)
 * and to power "redraw this round" (revert one round back). Static fields
 * (name, hasDiscount, discountAmount, wantsCup) are preserved from
 * basePlayers; only the round-derived fields are reset and replayed. */
export function replayPlayersFromHistory(basePlayers, history) {
  const byId = {};
  basePlayers.forEach((p) => {
    byId[p.id] = { ...p, wins: 0, opponents: [], hadBye: false, withdrawn: false, withdrawnRound: null, matchLog: [] };
  });
  const sorted = [...history].sort((a, b) => a.round - b.round);
  sorted.forEach((entry) => {
    entry.pairs.forEach((pr) => {
      if (!pr.result) return;
      const { winnerId, loserId, method } = pr.result;
      if (method === "double_retirement") {
        const a = byId[pr.p1];
        const b = byId[pr.p2];
        if (!a || !b) return;
        a.opponents.push(pr.p2);
        b.opponents.push(pr.p1);
        a.matchLog.push({ round: entry.round, opponentId: pr.p2, method: "double_retirement", result: "loss" });
        b.matchLog.push({ round: entry.round, opponentId: pr.p1, method: "double_retirement", result: "loss" });
        a.withdrawn = true; a.withdrawnRound = entry.round;
        b.withdrawn = true; b.withdrawnRound = entry.round;
        return;
      }
      const w = byId[winnerId];
      const l = byId[loserId];
      if (!w || !l) return;
      w.wins += 1;
      w.opponents.push(loserId);
      l.opponents.push(winnerId);
      const winMethod = method === "retirement" ? "retirement_win" : "normal";
      const loseMethod = method === "retirement" ? "retirement_loss" : "normal";
      w.matchLog.push({ round: entry.round, opponentId: loserId, method: winMethod, result: "win" });
      l.matchLog.push({ round: entry.round, opponentId: winnerId, method: loseMethod, result: "loss" });
      if (method === "retirement") {
        l.withdrawn = true;
        l.withdrawnRound = entry.round;
      }
    });
    if (entry.bye && byId[entry.bye]) {
      const b = byId[entry.bye];
      b.wins += 1;
      b.hadBye = true;
      b.matchLog.push({ round: entry.round, opponentId: null, method: "bye", result: "win" });
    }
  });
  return Object.values(byId);
}

export function computeBuchholz(players) {
  const finalWins = {};
  players.forEach((p) => (finalWins[p.id] = p.wins));
  const buchholz = {};
  players.forEach((p) => {
    let total = 0;
    p.matchLog.forEach((m) => {
      if (m.method === "bye") total += finalWins[p.id];
      else total += finalWins[m.opponentId] || 0;
    });
    buchholz[p.id] = total;
  });
  return buchholz;
}

export function sortStandings(players, buchholz) {
  return [...players].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    const bb = buchholz ? buchholz[b.id] || 0 : 0;
    const ba = buchholz ? buchholz[a.id] || 0 : 0;
    if (bb !== ba) return bb - ba;
    return a.name.localeCompare(b.name, "en");
  });
}
