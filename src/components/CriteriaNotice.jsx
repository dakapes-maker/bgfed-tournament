import React, { useState } from "react";
import { Info } from "lucide-react";

/* ---------------------------------------------------------------------- */
/* Tie-break criteria notice (2026-10-19)                                 */
/* Info box above a standings table: the criteria in one line, and the    */
/* definitions behind «Τι σημαίνουν ▾». Shared by tournament and season.  */
/* ---------------------------------------------------------------------- */

export function CriteriaNotice({ lead, summary, moreLabel, lessLabel, definitions, closing, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="notice">
      <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
      <div className="crit-notice">
        {lead && <p>{lead}</p>}
        <p>
          {summary}{" "}
          <button type="button" className="crit-more" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? lessLabel : moreLabel}
          </button>
        </p>
        {open && (
          <>
            <ul className="crit-defs">
              {definitions.map((d) => (
                <li key={d.term}><b>{d.term}:</b> {d.text}</li>
              ))}
            </ul>
            {closing && <p>{closing}</p>}
          </>
        )}
        {children}
      </div>
    </div>
  );
}
