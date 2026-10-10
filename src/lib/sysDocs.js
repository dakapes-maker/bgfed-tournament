import { saveTournamentData, fetchTournamentData, fetchTournamentDataStrict } from "../firebase.js";

/* ---------------------------------------------------------------------- */
/* System documents + consistency checks (Build 1A)                        */
/* The trash list and the backup reminder are stored through the existing  */
/* tournament helpers, under reserved ids that never appear in the         */
/* tournament catalogue.                                                   */
/* ---------------------------------------------------------------------- */

export const SYS_TRASH_ID = "sys-trash";
export const SYS_STATE_ID = "sys-state";

export async function loadSysTrash() {
  const d = await fetchTournamentData(SYS_TRASH_ID);
  return d && Array.isArray(d.list) ? d.list : [];
}

export async function saveSysTrash(list) {
  return await saveTournamentData(SYS_TRASH_ID, { list });
}

export async function loadSysState() {
  const d = await fetchTournamentData(SYS_STATE_ID);
  return d && typeof d === "object" ? d : {};
}

export async function saveSysState(patch) {
  // Read strictly: if the read fails we must NOT write { ...{}, ...patch },
  // which would wipe lastExportAt, purgedIds and the other settings.
  let cur;
  try {
    const d = await fetchTournamentDataStrict(SYS_STATE_ID);
    cur = d && typeof d === "object" ? d : {};
  } catch {
    return false;
  }
  return await saveTournamentData(SYS_STATE_ID, { ...cur, ...patch });
}

/* ---- Imported tournaments (isolated preview) ----------------------------
 * Tournaments run outside the app (e.g. DrawBoss), stored in the generic
 * model — brackets, matches, final placements — as separate documents
 * ("imp-…") listed in "sys-imports". They are deliberately NOT in the
 * tournament catalogue and use plain player names, so no standings, ELO,
 * statistics, registry or consistency check ever sees them. */
export const SYS_IMPORTS_ID = "sys-imports";
