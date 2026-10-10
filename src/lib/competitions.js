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
