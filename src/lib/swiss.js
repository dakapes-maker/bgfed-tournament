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

/* ---- Tournament tie-breaks (build 2026-10-19.02) -------------------------
 * Order: 1) wins, 2) Buchholz, 3) Buchholz Cut-1, 4) Median Buchholz,
 * 5) head-to-head — only when exactly two players are level after 1–4 and
 * they played each other (a win by retirement counts, a double retirement
 * doesn't), 6) otherwise a shared place ("3=", "3=", then 5). The name is
 * used only as a technical, stable order inside a shared place — never a
 * criterion. Computed from the current wins, so it works while the
 * tournament runs too; pairings don't use it. */

/** Per player: { buchholz, cut1, median, oppValues: [{ round, opponentId
 * (null for a bye), opponentName, value }] }. An opponent's value is their
 * (current) wins; a bye counts the player's own wins; retirements and double
 * retirements count the opponent normally. */
export function computeTiebreaks(players) {
  const byId = {};
  players.forEach((p) => (byId[p.id] = p));
  const out = {};
  players.forEach((p) => {
    const oppValues = (p.matchLog || []).map((m) => {
      if (m.method === "bye") return { round: m.round, opponentId: null, opponentName: null, value: p.wins };
      const o = byId[m.opponentId];
      return { round: m.round, opponentId: m.opponentId, opponentName: o ? o.name : "?", value: o ? o.wins : 0 };
    });
    const values = oppValues.map((v) => v.value).sort((a, b) => a - b);
    const buchholz = values.reduce((s, v) => s + v, 0);
    const cut1 = values.length ? buchholz - values[0] : 0;
    const median = values.length >= 3 ? cut1 - values[values.length - 1] : cut1;
    out[p.id] = { buchholz, cut1, median, oppValues };
  });
  return out;
}

/** Plain Buchholz per player id (kept for older callers). */
export function computeBuchholz(players) {
  const tb = computeTiebreaks(players);
  const buchholz = {};
  Object.keys(tb).forEach((id) => (buchholz[id] = tb[id].buchholz));
  return buchholz;
}

/** a's head-to-head against b in this tournament: { own, other, rounds:
 * [{ round, won, retirement }] } (double retirements left out). */
function headToHead(a, b) {
  const rounds = (a.matchLog || [])
    .filter((m) => m.opponentId === b.id && m.method !== "double_retirement" && m.method !== "bye")
    .map((m) => ({ round: m.round, won: m.result === "win", retirement: m.method === "retirement_win" || m.method === "retirement_loss" }));
  const own = rounds.filter((r) => r.won).length;
  return { own, other: rounds.length - own, rounds };
}

/** The standings, best first. Each row is a copy of the player with
 * `rank` (shared places get the same number), `shared` (bool) and `tie`
 * (null unless level on wins with someone): { withNames, decidedBy:
 * "buchholz"|"cut1"|"median"|"h2h"|"shared", sharedNames, detail: { above,
 * below } } — above/below compare with the neighbour on that side when it
 * has the same wins. With no result at all yet, every rank is null. */
export function sortStandings(players, tiebreaks) {
  const tb = tiebreaks || computeTiebreaks(players);
  const val = (p) => tb[p.id] || { buchholz: 0, cut1: 0, median: 0, oppValues: [] };
  const keys = ["buchholz", "cut1", "median"];
  const firstDiff = (a, b) => {
    for (const k of keys) {
      const d = val(b)[k] - val(a)[k];
      if (d !== 0) return { by: k, d };
    }
    return null;
  };
  const technical = (a, b) => String(a.name).localeCompare(String(b.name), "el");
  const anyResult = players.some((p) => (p.matchLog || []).length > 0);

  const out = [];
  const byWins = {};
  players.forEach((p) => { (byWins[p.wins] = byWins[p.wins] || []).push({ ...p, rank: null, shared: false, tie: null }); });
  Object.keys(byWins).map(Number).sort((a, b) => b - a).forEach((wins) => {
    const group = byWins[wins].sort((a, b) => (firstDiff(a, b)?.d ?? 0) || technical(a, b));
    // Still level after 1–4 → sub-groups; head-to-head only for exactly two.
    const sub = [];
    group.forEach((r) => {
      const last = sub[sub.length - 1];
      if (last && !firstDiff(last[0], r)) last.push(r);
      else sub.push([r]);
    });
    const h2h = new Map(); // row → its head-to-head with the other one
    const sharedSubs = new Set();
    sub.forEach((s) => {
      if (s.length === 1) return;
      if (s.length === 2) {
        const [a, b] = s;
        const ha = headToHead(a, b);
        h2h.set(a, ha);
        h2h.set(b, headToHead(b, a));
        if (ha.own !== ha.other) {
          if (ha.other > ha.own) s.reverse();
          return;
        }
      }
      sharedSubs.add(s);
    });
    const ordered = [];
    sub.forEach((s) => {
      const startRank = out.length + ordered.length + 1;
      s.forEach((r, k) => {
        r.shared = anyResult && sharedSubs.has(s);
        r.rank = !anyResult ? null : r.shared ? startRank : startRank + k;
        r.sub = s;
        ordered.push(r);
      });
    });
    if (anyResult && ordered.length > 1) {
      const compare = (r, o, sideAbove) => {
        const vr = val(r);
        const vo = val(o);
        const values = { buchholz: [vr.buchholz, vo.buchholz], cut1: [vr.cut1, vo.cut1], median: [vr.median, vo.median] };
        const f = firstDiff(r, o);
        if (f) return { name: o.name, ahead: !sideAbove, decidedBy: f.by, values };
        const hh = h2h.get(r);
        if (r.sub === o.sub && hh && hh.own !== hh.other) return { name: o.name, ahead: hh.own > hh.other, decidedBy: "h2h", values, h2h: hh };
        const reason = r.sub.length > 2 ? "many" : hh && hh.rounds.length ? "even" : "notPlayed";
        return { name: o.name, ahead: null, decidedBy: "shared", values, reason };
      };
      ordered.forEach((r, i) => {
        const above = i > 0 ? compare(r, ordered[i - 1], true) : null;
        const below = i < ordered.length - 1 ? compare(r, ordered[i + 1], false) : null;
        r.tie = {
          withNames: ordered.filter((o) => o !== r).map((o) => o.name),
          decidedBy: r.shared ? "shared" : (below || above).decidedBy,
          sharedNames: r.shared ? r.sub.filter((o) => o !== r).map((o) => o.name) : [],
          detail: { above, below },
        };
      });
    }
    ordered.forEach((r) => delete r.sub);
    out.push(...ordered);
  });
  return out;
}
