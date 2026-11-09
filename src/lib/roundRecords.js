/* ---------------------------------------------------------------------- */
/* Ρεκόρ «πριν από τον γύρο» και σειρά των αγώνων (build 2026-11-09.03).  */
/* Μόνο για εμφάνιση: δεν αγγίζει ζευγαρώσεις, νίκες ή κριτήρια.          */
/* ---------------------------------------------------------------------- */

/** For every player, "W"/"L" per finished round before `round` (oldest
 * first). A bye and a win with A.A. count as W; a double A.A. as L for both. */
export function recordsBeforeRound(history, round) {
  const rec = {};
  const push = (id, v) => { if (id) (rec[id] = rec[id] || []).push(v); };
  [...(history || [])]
    .filter((h) => h && h.round < round)
    .sort((a, b) => a.round - b.round)
    .forEach((h) => {
      (h.pairs || []).forEach((pr) => {
        const r = pr.result;
        if (!r) return;
        if (r.method === "double_retirement") { push(pr.p1, "L"); push(pr.p2, "L"); return; }
        push(r.winnerId, "W");
        push(r.loserId, "L");
      });
      if (h.bye) push(h.bye, "W");
    });
  return rec;
}

const winsOf = (rec, id) => (rec[id] || []).filter((x) => x === "W").length;

/** Indices of `pairs` in display order: the match with the player with most
 * wins first, then the pair's total wins, then the match number. The match
 * number itself never changes. */
export function pairDisplayOrder(pairs, rec) {
  return (pairs || [])
    .map((pr, i) => ({ i, top: Math.max(winsOf(rec, pr.p1), winsOf(rec, pr.p2)), sum: winsOf(rec, pr.p1) + winsOf(rec, pr.p2) }))
    .sort((a, b) => b.top - a.top || b.sum - a.sum || a.i - b.i)
    .map((x) => x.i);
}
