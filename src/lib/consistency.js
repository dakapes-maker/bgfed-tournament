import { stripAccents } from "./persons.js";
import { countsTowardRatings } from "./competitions.js";

/** "Backgammon Premier League 2026 - Ημέρα 7" -> "Ημέρα 7" (for compact lists). */
export function shortTournamentLabel(name) {
  const m = /Ημέρα\s*\d+/.exec(name || "");
  return m ? m[0] : name;
}

/** Compares what is stored (ELO, season standings) with the tournament
 * catalogue. Read-only: it never changes anything. */
export function buildConsistencyReport({ elo, seasons, index, display }) {
  const idx = new Map(index.map((t) => [t.id, t]));
  const finishedOfficial = index.filter((t) => countsTowardRatings(t) && t.status === "Completed");
  const report = {
    trackingMissing: !elo.appliedTournaments,
    eloExtra: [], eloMissing: [], seasonExtra: [], seasonMissing: [],
    winsMismatch: [], eloOnly: [], seasonOnly: [], lookalikes: [],
    unknownKeys: [], nameStale: [],
    seasonWrongYear: [], dateSeasonMismatch: [],
  };

  const applied = elo.appliedTournaments || {};
  Object.entries(applied).forEach(([id, a]) => {
    const t = idx.get(id);
    if (!t) report.eloExtra.push({ id, name: a.name, reason: "missing" });
    else if (!countsTowardRatings(t)) report.eloExtra.push({ id, name: t.name, reason: "unofficial" });
  });
  if (!report.trackingMissing) {
    finishedOfficial.forEach((t) => {
      if (!applied[t.id]) report.eloMissing.push({ id: t.id, name: t.name });
    });
  }

  const seasonIds = new Map();
  const seasonNames = {};
  const seasonWins = {};
  Object.entries(seasons).forEach(([year, s]) => {
    Object.entries(s.players || {}).forEach(([key, p]) => {
      const entries = Object.entries(p.entries || {});
      if (entries.length) seasonNames[key] = p.name;
      entries.forEach(([id, e]) => {
        if (!seasonIds.has(id)) seasonIds.set(id, { name: e.tournamentName, year, years: new Set() });
        seasonIds.get(id).years.add(Number(year));
        seasonWins[key] = (seasonWins[key] || 0) + (e.wins ?? e.points ?? 0);
      });
    });
  });
  seasonIds.forEach((info, id) => {
    const t = idx.get(id);
    if (!t) report.seasonExtra.push({ id, name: info.name, year: info.year, reason: "missing" });
    else if (!countsTowardRatings(t)) report.seasonExtra.push({ id, name: t.name, year: info.year, reason: "unofficial" });
  });
  finishedOfficial.forEach((t) => {
    if (!seasonIds.has(t.id)) report.seasonMissing.push({ id: t.id, name: t.name });
  });
  // Build 2: is each tournament in the season it belongs to?
  seasonIds.forEach((info, id) => {
    const t = idx.get(id);
    if (!t || !t.seasonYear) return;
    const wrong = [...info.years].filter((y) => y !== Number(t.seasonYear));
    if (wrong.length) report.seasonWrongYear.push({ id, name: t.name, expected: Number(t.seasonYear), found: wrong });
  });
  // 5B.2α: a season is not tied to dates, so there is no date check.

  const eloPlayers = elo.players || {};
  Object.entries(eloPlayers).forEach(([key, p]) => {
    if ((p.games ?? 0) > 0 && !seasonNames[key]) report.eloOnly.push({ name: p.name, games: p.games });
    if (seasonNames[key] && p.wins !== undefined && (p.wins ?? 0) !== (seasonWins[key] || 0)) {
      report.winsMismatch.push({ name: p.name, elo: p.wins ?? 0, season: seasonWins[key] || 0 });
    }
  });
  Object.keys(seasonNames).forEach((key) => {
    if (!eloPlayers[key]) report.seasonOnly.push({ name: seasonNames[key] });
  });

  const groups = {};
  const allNames = new Set([
    ...Object.values(eloPlayers).map((p) => p.name),
    ...Object.values(seasonNames),
  ]);
  allNames.forEach((n) => {
    const canon = stripAccents(n).toLowerCase().split(/\s+/).filter(Boolean).sort().join(" ");
    (groups[canon] = groups[canon] || new Set()).add(n.trim());
  });
  Object.values(groups).forEach((set) => {
    if (set.size > 1) report.lookalikes.push([...set]);
  });

  if (display && display.size > 0) {
    const unknown = new Set();
    Object.entries(eloPlayers).forEach(([key, p]) => {
      if (!display.has(key)) unknown.add(p.name);
      else if (display.get(key) !== p.name) report.nameStale.push({ from: p.name, to: display.get(key) });
    });
    Object.entries(seasonNames).forEach(([key, name]) => {
      if (!display.has(key)) unknown.add(name);
    });
    report.unknownKeys = [...unknown].map((name) => ({ name }));
  }

  report.needsRecompute =
    report.unknownKeys.length > 0 || report.nameStale.length > 0 ||
    report.trackingMissing || report.eloExtra.length > 0 || report.eloMissing.length > 0 ||
    report.seasonExtra.length > 0 || report.seasonMissing.length > 0 ||
    report.winsMismatch.length > 0 || report.eloOnly.length > 0;
  return report;
}

/** One short human sentence per reason the stored data may be out of date. */
export function describeStaleReasons(report) {
  const out = [];
  if (!report) return out;
  if (report.trackingMissing) out.push("Χρειάζεται ένα Recompute για να ξεκινήσει η καταγραφή προέλευσης (δεν είναι σφάλμα).");
  if (report.unknownKeys.length) out.push(`Το ELO ή η Βαθμολογία έχουν ονόματα που δεν αντιστοιχούν σε πρόσωπο του μητρώου (${report.unknownKeys.length}).`);
  if (report.nameStale.length) out.push(`Το όνομα ${report.nameStale.length === 1 ? "ενός παίκτη" : "κάποιων παικτών"} στο ELO/Βαθμολογία διαφέρει από το μητρώο (${report.nameStale.slice(0, 3).map((x) => `${x.from} → ${x.to}`).join(", ")}).`);
  const label = (x) => `"${x.name}"`;
  const uo = report.eloExtra.filter((x) => x.reason === "unofficial");
  const miss = report.eloExtra.filter((x) => x.reason === "missing");
  if (uo.length) out.push(`Το ELO περιλαμβάνει δοκιμαστικό ή εκτός Premier League τουρνουά: ${uo.map(label).join(", ")}.`);
  if (miss.length) out.push(`Το ELO περιλαμβάνει τουρνουά που δεν υπάρχει πια στον κατάλογο: ${miss.map(label).join(", ")}.`);
  const suo = report.seasonExtra.filter((x) => x.reason === "unofficial");
  const smiss = report.seasonExtra.filter((x) => x.reason === "missing");
  if (suo.length) out.push(`Η Βαθμολογία περιλαμβάνει δοκιμαστικό ή εκτός Premier League τουρνουά: ${suo.map(label).join(", ")}.`);
  if (smiss.length) out.push(`Η Βαθμολογία περιλαμβάνει τουρνουά που δεν υπάρχει πια: ${smiss.map(label).join(", ")}.`);
  if (report.eloMissing.length) out.push(`Επίσημο τουρνουά που δεν έχει περαστεί στο ELO: ${report.eloMissing.map(label).join(", ")}.`);
  if (report.seasonMissing.length) out.push(`Επίσημο τουρνουά που δεν έχει περαστεί στη Βαθμολογία: ${report.seasonMissing.map(label).join(", ")}.`);
  if ((report.seasonWrongYear || []).length) out.push(`Τουρνουά καταχωρημένο σε λάθος σεζόν: ${report.seasonWrongYear.map((x) => `${label(x)} (σε ${x.found.join(", ")} αντί ${x.expected})`).join(", ")}.`);
  if (report.eloOnly.length || report.winsMismatch.length) {
    out.push(`Το ELO δεν ταιριάζει με τη Βαθμολογία σε ${report.eloOnly.length + report.winsMismatch.length} παίκτες.`);
  }
  return out;
}
