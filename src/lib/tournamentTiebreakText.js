/* Explanation of a tie in a tournament's standings (builds 2026-10-19.02,
 * 2026-10-19.03): from the `tie` of sortStandings (lib/swiss.js) and the
 * player's tie-break values. Transparency rule: every criterion is shown in
 * order, with both players' values, up to the one that decided (or all of
 * them for a shared place). Never mentions how a shared place is ordered. */

const KEYS = ["buchholz", "cut1", "median"];

/** "1) Buchholz: 12 – 12 (ίσο) · 2) Buchholz Cut-1: 12 – 11 → προηγείται." */
function chain(cmp, L) {
  const steps = [];
  for (let i = 0; i < KEYS.length; i++) {
    const [a, b] = cmp.values[KEYS[i]];
    const head = `${i + 1}) ${L.ttLabels[KEYS[i]]}: ${a} – ${b} `;
    if (a !== b) {
      steps.push(head + L.ttLead(cmp.ahead));
      return steps.join(" · ") + ".";
    }
    steps.push(head + L.ttEqual);
  }
  const hh = cmp.h2h;
  let h2h;
  if (cmp.decidedBy === "h2h") {
    const r = hh.rounds.find((x) => x.won === cmp.ahead) || hh.rounds[0];
    h2h = `${L.ttH2hGame(cmp.ahead, cmp.name, r.round, r.retirement)} ${L.ttLead(cmp.ahead)}`;
  } else if (cmp.reason === "many") h2h = L.ttH2hMany(cmp.count);
  else if (cmp.reason === "even") h2h = L.ttH2hEven(hh.own, hh.other);
  else h2h = L.ttH2hNotPlayed;
  steps.push(`4) ${L.ttLabels.h2h}: ${h2h}`);
  return steps.join(" · ") + ".";
}

const label = (v) => `${v.opponentId === null ? "bye" : v.opponentName} ${v.value}`;

/** The opponents with their wins and what each criterion leaves out:
 * ["Αντίπαλοι (νίκες τους): Α 4 · Γ 3 · bye 3 (bye = 3, …).",
 *  "BH = 10 · BH-1 = 10 (χωρίς Ζ 0) · Med = 6 (χωρίς Ζ 0 και Α 4)."] */
export function opponentsBreakdown(tb, L) {
  if (!tb || !tb.oppValues.length) return [];
  const list = [...tb.oppValues].sort((a, b) => b.value - a.value || a.round - b.round);
  const bye = list.find((v) => v.opponentId === null);
  const lowest = list[list.length - 1];
  const highest = list[0];
  const few = list.length < 3;
  return [
    L.ttOpponents(list.map(label).join(" · "), bye ? bye.value : null),
    `BH = ${tb.buchholz} · BH-1 = ${tb.cut1} (${L.ttWithout([label(lowest)])}) · Med = ${tb.median} (${few ? L.ttFewGames : L.ttWithout([label(lowest), label(highest)])}).`,
  ];
}

/** The lines explaining a row: its tie (when level on wins with someone)
 * and the breakdown of its opponents. */
export function tournamentTieExplanation(row, tb, L) {
  const lines = [];
  const tie = row && row.tie;
  if (tie) {
    lines.push(L.ttWith(tie.withNames, row.wins));
    const many = tie.withNames.length > 1;
    const cmps = [tie.detail.above, tie.detail.below].filter(Boolean);
    const sharedCmp = cmps.find((c) => c.decidedBy === "shared");
    if (row.shared && sharedCmp) lines.push(L.ttSharedWith(tie.sharedNames.join(", ")) + chain(sharedCmp, L));
    cmps.filter((c) => c.decidedBy !== "shared").forEach((cmp) => {
      lines.push((many ? L.tieVs(cmp.name) : "") + chain(cmp, L));
    });
  }
  return lines.concat(opponentsBreakdown(tb, L));
}

/** True when head-to-head decided this row's place against a neighbour. */
export function decidedByH2h(row) {
  const d = row && row.tie && row.tie.detail;
  return !!d && [d.above, d.below].some((c) => c && c.decidedBy === "h2h");
}

/** One line for the winner banner: how first place was decided, or null. */
export function winnerTieLine(standings, L) {
  const first = standings[0];
  if (!first || !first.tie) return null;
  if (first.shared) return L.ttWinnerShared;
  const below = first.tie.detail.below;
  return below ? L.ttWinnerBy(below.decidedBy) : null;
}
