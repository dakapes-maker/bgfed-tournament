import { clubDisplay } from "./clubs.js";

/* ---------------------------------------------------------------------- */
/* Competitions, seasons and the organising club (Build 2)                */
/* ---------------------------------------------------------------------- */

export const DEFAULT_COMPETITION_ID = "premier-league";
export const DEFAULT_COMPETITIONS = [
  { id: "premier-league", name: "Premier League", level: "club", pool: "club" },
  { id: "final-phase", name: "Τελική φάση", level: "national", pool: "national" },
  { id: "cup", name: "Κύπελλο", level: "national", pool: "national" },
];

/* ---- ELO pools (Build 3C) ---------------------------------------------
 * Each competition feeds one ELO pool. Only the club pool (Premier League)
 * is active today and it is the existing ELO, unchanged; the national pool
 * (Τελική φάση, Κύπελλο) gets its own ranking when the final phase arrives. */
export const ELO_POOLS = {
  club: { label: "Κατάταξη συλλόγων (Premier League)", active: true },
  national: { label: "Πανελλήνια ELO (Τελικές Φάσεις Κυπέλλου και Πρωταθλήματος)", active: true },
};

/* Competitions belong to a club (Build 4A). Each owner club is one ELO
 * ranking; the existing ELO is the ranking of the home club (Ομοσπονδία
 * Backgammon). The component keeps these two in step with the settings on
 * every render, so module-level helpers can use them. */
export let RUNTIME_COMPETITIONS = null;
export let RUNTIME_HOME_CLUB = null;

/** Keeps the two module-level values above in step with the settings; called
 * by the component on every render (the assignments it used to make itself). */
export function setRuntimeCompetitionState(sysState) {
  RUNTIME_COMPETITIONS = competitionsFrom(sysState);
  RUNTIME_HOME_CLUB = sysState.homeClubId || null;
}

export function competitionById(id) {
  const list = RUNTIME_COMPETITIONS || DEFAULT_COMPETITIONS;
  return list.find((c) => c.id === (id || DEFAULT_COMPETITION_ID)) || DEFAULT_COMPETITIONS.find((c) => c.id === (id || DEFAULT_COMPETITION_ID)) || null;
}

export function eloPoolOf(competitionId) {
  const comp = competitionById(competitionId);
  if (comp && comp.countsElo === false) return "none";
  if (comp && comp.ownerClubId) return comp.ownerClubId === RUNTIME_HOME_CLUB ? "club" : "national";
  const c = DEFAULT_COMPETITIONS.find((x) => x.id === (competitionId || DEFAULT_COMPETITION_ID));
  return c ? c.pool : "club";
}
export const COMPETITION_LEVEL_LABEL = { club: "επίπεδο συλλόγου", national: "εθνικό επίπεδο" };

export function competitionsFrom(sys) {
  return Array.isArray(sys?.competitions) && sys.competitions.length > 0 ? sys.competitions : DEFAULT_COMPETITIONS;
}

/** Until the separate ELO pools of Build 3, only official Premier League
 * tournaments feed the ELO and the season standings. A catalogue entry with
 * no competition yet (before the Build 2 migration) is Premier League. */
export function countsTowardRatings(t) {
  return !!t && !!t.isOfficial && eloPoolOf(t.competitionId) === "club" && ELO_POOLS.club.active;
}

/** "Premier League (Ομοσπονδία Backgammon)" — the owner club, once set. */
export function competitionLabel(sys, c) {
  const owner = c.ownerClubId ? clubDisplay(sys, c.ownerClubId, "") : "";
  return owner ? `${c.name} (${owner})` : c.name;
}

export function competitionName(competitions, id) {
  const c = (competitions || DEFAULT_COMPETITIONS).find((x) => x.id === id);
  return c ? c.name : id || "—";
}

/** 5B.2β: does this competition keep season standings (Βαθμολογία σεζόν)?
 * Explicit setting, else only the home competition (Premier League). */
export function competitionHasStandings(c) {
  if (!c) return false;
  if (typeof c.hasStandings === "boolean") return c.hasStandings;
  return c.id === DEFAULT_COMPETITION_ID;
}

/** 5B.3: a tournament counts toward the season standings of its season when
 * it is official and its competition keeps standings — independent of ELO.
 * For the Premier League this is exactly the old rule. */
export function countsTowardStandings(t) {
  return !!t && !!t.isOfficial && competitionHasStandings(competitionById(t.competitionId));
}

/* ---------------------------------------------------------------------- */
/* 5B.4: finances per competition                                         */
/* ---------------------------------------------------------------------- */
/* A competition either has financial management (buy-in, prizes, side bets,
 * Calcutta) or not. Amounts are parameters of the competition; each new
 * tournament keeps a COPY of them (`finance` in its document) when it
 * starts, so a later change applies only from the next tournament on.
 * Tournaments with no copy (before 5B.4) use DEFAULT_FINANCE — the Federation
 * amounts of 2026 — so their figures never change. The discount itself
 * (who and how much) stays on the person (registry → private contacts). */
export const DEFAULT_FINANCE = {
  buyIn: 40, // full buy-in
  potShare: 32, // of a full buy-in, to the prize pool
  orgShare: 6, // of a full buy-in, to the organising club (waived for discounted)
  venueShare: 2, // of a full buy-in, to the venue (waived for discounted)
  runnerUpPrize: 60, // fixed prize for one win short of a perfect score
  cupCost: 15, // deducted from a perfect-score winner's prize if they take a cup
};
export const FINANCE_FIELDS = [
  ["buyIn", "Συμμετοχή (buy-in)"],
  ["potShare", "— από αυτά στα έπαθλα"],
  ["orgShare", "— στον φορέα"],
  ["venueShare", "— στον χώρο"],
  ["runnerUpPrize", "Έπαθλο για μία νίκη λιγότερο από το τέλειο"],
  ["cupCost", "Κόστος κυπέλλου"],
];

export function competitionHasFinance(c) {
  if (!c) return false;
  if (typeof c.hasFinance === "boolean") return c.hasFinance;
  return c.id === DEFAULT_COMPETITION_ID;
}

/** The copy a new tournament keeps: { enabled, ...amounts }. */
export function financeSnapshotOf(c) {
  const enabled = competitionHasFinance(c);
  return { enabled, ...DEFAULT_FINANCE, ...((c && c.finance) || {}) };
}

/** Finance of a tournament from its copy; before 5B.4 (no copy) from the
 * competition's switch with the default amounts. */
export function tournamentFinance(copy, competitionId) {
  if (copy && typeof copy === "object") return { ...DEFAULT_FINANCE, ...copy, enabled: copy.enabled !== false };
  return { ...DEFAULT_FINANCE, enabled: competitionHasFinance(competitionById(competitionId)) };
}
