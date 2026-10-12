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

/* ---- Σ3: club colours (calendar and badges) ----------------------------
 * A club may have its own `color` (set by the super administrator in the
 * clubs list); otherwise it gets one from a palette of quiet tones that suit
 * the app, by its position in the list. The home club (the Federation) uses
 * the app's accent colour. */
export const CLUB_PALETTE = ["#2f6f8f", "#5b8a3c", "#b07a1e", "#7a4f9a", "#2e8577", "#a3504a", "#4a5f9e", "#8a6d3b", "#3f7f5f", "#9c5a86"];
export const HOME_CLUB_COLOR = "#7a2e2e";

export function clubColor(sys, clubId) {
  const clubs = clubsFrom(sys);
  const c = clubs.find((x) => x.id === clubId);
  if (c && c.color) return c.color;
  if (clubId && clubId === sys?.homeClubId) return HOME_CLUB_COLOR;
  const others = clubs.filter((x) => x.id !== sys?.homeClubId);
  const i = others.findIndex((x) => x.id === clubId);
  return i >= 0 ? CLUB_PALETTE[i % CLUB_PALETTE.length] : "#888888";
}
