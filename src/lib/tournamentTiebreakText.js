/* Explanation of a tie in a tournament's standings (build 2026-10-19.02):
 * from the `tie` of sortStandings (lib/swiss.js) and the player's
 * tie-break values. Never mentions how a shared place is ordered. */

/** "Α 3, Β 4, bye 3" — the values behind the player's Buchholz. */
function opponentsLine(tb, L) {
  if (!tb || !tb.oppValues.length) return null;
  const parts = [...tb.oppValues]
    .sort((a, b) => a.round - b.round)
    .map((v) => (v.opponentId === null ? L.ttBye(v.value) : `${v.opponentName} ${v.value}`));
  return L.ttOpponents(parts.join(", "));
}

function sentence(cmp, L) {
  const lead = L.tieAhead(cmp.ahead);
  const v = cmp.values;
  if (cmp.decidedBy === "buchholz") return L.ttByBuchholz(lead, v.buchholz[0], v.buchholz[1]);
  if (cmp.decidedBy === "cut1") return L.ttByCut1(lead, v.buchholz[0], v.cut1[0], v.cut1[1]);
  if (cmp.decidedBy === "median") return L.ttByMedian(lead, v.buchholz[0], v.cut1[0], v.median[0], v.median[1]);
  if (cmp.decidedBy === "h2h") {
    const r = cmp.h2h.rounds.find((x) => x.won === cmp.ahead) || cmp.h2h.rounds[0];
    return L.ttByH2h(cmp.ahead, cmp.name, r.round, r.retirement);
  }
  return null;
}

/** The lines explaining a row's tie, or [] when it is not level on wins. */
export function tournamentTieExplanation(row, tb, L) {
  const tie = row && row.tie;
  if (!tie) return [];
  const lines = [L.ttWith(tie.withNames, row.wins)];
  if (row.shared) {
    const cmp = [tie.detail.above, tie.detail.below].find((c) => c && c.decidedBy === "shared");
    lines.push(L.ttShared(tie.sharedNames.join(", "), cmp ? cmp.reason : "many", (tb && tb.buchholz) ?? 0));
  }
  const many = tie.withNames.length > 1;
  [tie.detail.above, tie.detail.below].filter((c) => c && c.decidedBy !== "shared").forEach((cmp) => {
    const s = sentence(cmp, L);
    if (many) lines.push(L.tieVs(cmp.name) + s.charAt(0).toLocaleLowerCase() + s.slice(1));
    else lines.push(s);
  });
  const opp = opponentsLine(tb, L);
  if (opp) lines.push(opp);
  return lines;
}

/** One line for the winner banner: how first place was decided, or null. */
export function winnerTieLine(standings, L) {
  const first = standings[0];
  if (!first || !first.tie) return null;
  if (first.shared) return L.ttWinnerShared;
  const below = first.tie.detail.below;
  return below ? L.ttWinnerBy(below.decidedBy) : null;
}
