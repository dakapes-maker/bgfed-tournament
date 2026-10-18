/* Explanation of a tie on the standings page (build 2026-10-18.01): one
 * sentence per tied neighbour, from the `tie` of computeSeasonStandings.
 * Never mentions how a full tie is ordered in the table. */

/** Both percentages with one decimal; more decimals while they read the same. */
function formatPctPair(a, b, lang) {
  const sep = lang === "el" ? "," : ".";
  const fmt = (v, d) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(d).replace(".", sep)}%`);
  let d = 1;
  while (d < 4 && a !== null && b !== null && a !== b && fmt(a, d) === fmt(b, d)) d++;
  return [fmt(a, d), fmt(b, d)];
}

function sentence(cmp, row, L, lang, bestOf) {
  if (cmp.decidedBy === "full") return L.tieFull(cmp.name) + (cmp.h2hApplies ? "" : L.tieFullMany);
  const lead = L.tieAhead(cmp.ahead);
  const v = cmp.values;
  if (cmp.decidedBy === 1) return L.tieBy1(lead, v.sumAll[0], v.sumAll[1]);
  if (cmp.decidedBy === 2) return L.tieBy2(lead, row.sumAll, ...formatPctPair(v.pct[0], v.pct[1], lang));
  if (cmp.decidedBy === 3) return L.tieBy3(lead, row.sumAll, formatPctPair(row.pctExact, row.pctExact, lang)[0], bestOf, ...formatPctPair(v.pctBest[0], v.pctBest[1], lang));
  return L.tieBy4(lead, v.h2h[0], v.h2h[1]);
}

/** The lines explaining a row's tie, or [] when it is not tied on points. */
export function tieExplanation(row, L, lang, bestOf) {
  const tie = row && row.tie;
  if (!tie) return [];
  const many = tie.withNames.length > 1;
  const lines = [L.tieWith(tie.withNames.join(", "), row.total)];
  [tie.detail.above, tie.detail.below].filter(Boolean).forEach((cmp) => {
    const s = sentence(cmp, row, L, lang, bestOf);
    // With two or more tied neighbours, name the one each sentence is about
    // (a full tie already names them).
    if (many && cmp.decidedBy !== "full") lines.push(L.tieVs(cmp.name) + s.charAt(0).toLocaleLowerCase(lang) + s.slice(1));
    else lines.push(s);
  });
  return lines;
}
