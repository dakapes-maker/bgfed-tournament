import React from "react";

/* ---------------------------------------------------------------------- */
/* Players page count (2026-10-24)                                        */
/* «N παίκτες», or «M από N παίκτες · Σύλλογος: … · αναζήτηση: “…”» when  */
/* a club filter or a search is active. N = what the page shows with no   */
/* filter for the same viewer (the guests toggle stays part of N).        */
/* ---------------------------------------------------------------------- */

export function PlayersCount({ L, shown, total, clubLabel, search }) {
  const filtered = !!clubLabel || !!search;
  return (
    <p className="players-count">
      <strong>{shown}</strong>
      {filtered ? ` ${L.pcOf} ${total} ${L.pcPlayers(total)}` : ` ${L.pcPlayers(shown)}`}
      {clubLabel && <span className="players-count-note"> · {L.pcClub}: {clubLabel}</span>}
      {search && <span className="players-count-note"> · {L.pcSearch}: “{search}”</span>}
    </p>
  );
}
