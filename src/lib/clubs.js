import { stripAccents } from "./persons.js";

/* ---- Clubs (Build 3B3) --------------------------------------------------
 * A managed list in the system document: clubs = [{ id, name, aliases }],
 * homeClubId = the admin's own club. Players carry clubId (registry) and
 * tournaments carry organisationClubId; the old free-text values stay as a
 * fallback for display. Before the clubs migration everything is text. */
export function normClubKey(name) {
  return stripAccents(String(name || "").toLowerCase())
    .replace(/[«»"'`.,;:()/\u2013\u2014-]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ς/g, "σ")
    .trim();
}

export function newClubId() {
  return `club_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function clubsFrom(sys) {
  return Array.isArray(sys?.clubs) ? sys.clubs : [];
}

export function clubsActive(sys) {
  return sys?.clubsVersion === 1;
}

/** Name to show for a club reference, falling back to the stored text. */
export function clubDisplay(sys, id, fallback) {
  const c = id ? clubsFrom(sys).find((x) => x.id === id) : null;
  return c ? c.name : fallback || "";
}
