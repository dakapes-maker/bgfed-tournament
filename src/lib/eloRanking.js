import { applyEloRoundBatch, ELO_INITIAL, eloWinProbability, eloPointsAtStake, isEloGuest } from "./elo.js";
import { normalizeName } from "./persons.js";
import { importCompetitionId, importDateIso } from "./imports.js";
import { DEFAULT_COMPETITION_ID } from "./competitions.js";
import { isMatchlist, countedMatchlistMatches } from "./matchlists.js";

/* ---------------------------------------------------------------------- */
/* 5D: one engine for every ELO ranking                                   */
/* ---------------------------------------------------------------------- */
/* Replays, in date order, the official in-app tournaments and the imported
 * tournaments of the ranking's member competitions — and every counted match
 * of their match lists (bgfed-matchlist/1) at its own date + time, as an
 * event of its own; walkovers never count. Used by Recompute (to
 * build what is stored) and, with withLedger, by the player card ("how this
 * rating was reached") — so the two can never disagree.
 *
 *   members        Set of competition ids
 *   catalogue      tournament index (in-app)
 *   importIds      ids of imported tournaments
 *   loadTournament async (id) => data   (should throw on a failed read)
 *   loadImport     async (id) => doc    (should throw on a failed read)
 *   registry       { players } — names of imported players
 * Returns { elo, applied, appliedImports, matches, ledger, timeline }. */
export async function buildRankingElo({ members, catalogue, importIds, loadTournament, loadImport, registry, withLedger = false }) {
  const elo = { players: {}, initialized: true };
  const applied = {};
  const appliedImports = {};
  const ledger = {};
  const timeline = {};
  let matches = 0;
  const builtAt = new Date().toISOString();

  const events = [];
  (catalogue || [])
    .filter((t) => t.isOfficial && members.has(t.competitionId || DEFAULT_COMPETITION_ID))
    .forEach((t) => events.push({ kind: "app", id: t.id, name: t.name, date: t.date }));
  for (const id of importIds || []) {
    const doc = await loadImport(id);
    if (!doc || !doc.personMap || !members.has(importCompetitionId(doc))) continue;
    if (isMatchlist(doc)) {
      countedMatchlistMatches(doc).forEach((m) => events.push({ kind: "listMatch", id, name: doc.name, date: m.iso, doc, m }));
      continue;
    }
    events.push({ kind: "import", id, name: doc.name, date: importDateIso(doc.date) || doc.importedAt, doc });
  }
  // Stable sort: same moment → in-app first, then imports in list order
  // (the matches of a list already in play order).
  events.sort((a, b) => new Date(a.date) - new Date(b.date));

  // One batch of simultaneous matches: rows for the ledger use the ratings
  // BEFORE the batch, exactly as applyEloRoundBatch does.
  function applyBatch(batch, ml, base, participants) {
    const pending = [];
    if (withLedger) {
      batch.forEach((m) => {
        const wKey = normalizeName(m.w);
        const lKey = normalizeName(m.l);
        const wR = isEloGuest(wKey) ? ELO_INITIAL : elo.players[wKey]?.rating ?? ELO_INITIAL;
        const lR = isEloGuest(lKey) ? ELO_INITIAL : elo.players[lKey]?.rating ?? ELO_INITIAL;
        const delta = m.ret ? 0 : (1 - eloWinProbability(wR, lR, ml)) * eloPointsAtStake(ml);
        const row = { ...base, round: m.round ?? base.round, matchLength: ml, ret: !!m.ret };
        pending.push([wKey, { ...row, opponent: m.l + (isEloGuest(lKey) ? " (φιλοξ.)" : ""), opponentRating: lR, result: "win", delta }]);
        pending.push([lKey, { ...row, opponent: m.w + (isEloGuest(wKey) ? " (φιλοξ.)" : ""), opponentRating: wR, result: "loss", delta: -delta }]);
      });
    }
    applyEloRoundBatch(elo, batch, ml);
    batch.forEach((m) => {
      if (m.ret) return;
      matches += 1;
      // Wins/games from imported tournaments are kept apart too, so the
      // consistency check can compare the rest with the season standings.
      if (base.imported) {
        const wk = normalizeName(m.w);
        const lk = normalizeName(m.l);
        if (elo.players[wk]) { elo.players[wk].impWins = (elo.players[wk].impWins || 0) + 1; elo.players[wk].impGames = (elo.players[wk].impGames || 0) + 1; }
        if (elo.players[lk]) elo.players[lk].impGames = (elo.players[lk].impGames || 0) + 1;
      }
      [m.w, m.l].forEach((n) => {
        const k = normalizeName(n);
        if (!isEloGuest(k)) participants.add(k);
      });
    });
    pending.forEach(([k, row]) => {
      if (isEloGuest(k)) return;
      if (!ledger[k]) ledger[k] = [];
      ledger[k].push({ ...row, ratingAfter: elo.players[k]?.rating ?? ELO_INITIAL });
    });
  }

  for (const ev of events) {
    const participants = new Set();
    if (ev.kind === "app") {
      const data = await loadTournament(ev.id);
      if (!data || !data.history || !data.players) continue;
      applied[ev.id] = { name: data.tournamentName || ev.name, mode: "recompute", at: builtAt };
      const ml = data.matchLength || 7;
      data.history.forEach((entry, idx) => {
        const batch = [];
        entry.pairs.forEach((pr) => {
          if (!pr.result) return;
          const w = data.players.find((p) => p.id === pr.result.winnerId);
          const l = data.players.find((p) => p.id === pr.result.loserId);
          if (!w || !l) return;
          batch.push({ w: w.name, l: l.name, ret: pr.result.method === "retirement" });
        });
        applyBatch(batch, ml, { date: ev.date, tournamentId: ev.id, tournamentName: ev.name, round: entry.round ?? idx + 1 }, participants);
      });
    } else if (ev.kind === "listMatch") {
      const d = ev.doc;
      const m = ev.m;
      appliedImports[ev.id] = { name: d.name, kind: "matchlist", at: builtAt };
      const W = registry.players[d.personMap[m.winner]];
      const Lp = registry.players[d.personMap[m.winner === m.p1 ? m.p2 : m.p1]];
      if (W && Lp) {
        const ml = Number(m.matchLength || d.matchLength || 7);
        applyBatch([{ w: W.name, l: Lp.name, ret: false }], ml, { date: ev.date, tournamentId: ev.id, tournamentName: d.name, round: m.label || "", imported: true, matchlist: true }, participants);
      }
    } else {
      const d = ev.doc;
      appliedImports[ev.id] = { name: d.name, at: builtAt };
      const groups = new Map(); // "slot|length" -> matches, in play order
      [...(d.matches || [])]
        .filter((m) => m.method !== "bye" && m.p2)
        .sort((a, b) => (a.slot ?? a.round) - (b.slot ?? b.round))
        .forEach((m) => {
          const g = `${m.slot ?? m.round}|${m.matchLength || d.matchLength || 7}`;
          if (!groups.has(g)) groups.set(g, []);
          groups.get(g).push(m);
        });
      groups.forEach((ms, g) => {
        const ml = Number(g.split("|")[1]);
        const batch = [];
        ms.forEach((m) => {
          const W = registry.players[d.personMap[m.winner]];
          const Lp = registry.players[d.personMap[m.winner === m.p1 ? m.p2 : m.p1]];
          if (!W || !Lp) return;
          batch.push({ w: W.name, l: Lp.name, ret: m.method === "retirement", round: m.roundLabel || m.round });
        });
        applyBatch(batch, ml, { date: ev.date, tournamentId: ev.id, tournamentName: d.name, round: "", imported: true }, participants);
      });
    }
    if (withLedger) {
      participants.forEach((k) => {
        const p = elo.players[k];
        if (!p) return;
        if (!timeline[k]) timeline[k] = [];
        timeline[k].push({ date: ev.date, rating: p.rating, winRate: p.games > 0 ? ((p.wins || 0) / p.games) * 100 : 0 });
      });
    }
  }
  return { elo, applied, appliedImports, matches, ledger, timeline };
}
