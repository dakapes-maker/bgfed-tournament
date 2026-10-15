import React from "react";
import { Link as LinkIcon } from "lucide-react";
import { seasonPageLink } from "../lib/seasonView.js";

/* Season standings page: competition tabs (pills; a list when more than
 * six; nothing when only one) + season list + copy-link button. Sits at the
 * top of the content column, above the season notice. */
export function SeasonFilter({ L, comps, compId, seasons, seasonId, onCompetition, onSeason, onCopied }) {
  const comp = comps.find((c) => c.id === compId) || null;
  const season = seasons.find((s) => s.id === Number(seasonId)) || null;

  function copyLink() {
    if (!comp) return;
    const link = seasonPageLink(comp, season ? season.name : null);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(() => onCopied(L.stLinkCopied), () => onCopied(link));
    } else {
      onCopied(link);
    }
  }

  return (
    <div className="season-filter">
      {comps.length > 1 && comps.length <= 6 && (
        <div className="season-filter-comps" role="tablist" aria-label={L.stCompetition}>
          {comps.map((c) => (
            <button key={c.id} role="tab" aria-selected={c.id === compId} className={`round-pill ${c.id === compId ? "active" : ""}`} onClick={() => c.id !== compId && onCompetition(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      )}
      {comps.length > 6 && (
        <label className="season-filter-field">
          <span>{L.stCompetition}:</span>
          <select value={compId} onChange={(e) => onCompetition(e.target.value)}>
            {comps.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      )}
      <div className="season-filter-right">
        <label className="season-filter-field">
          <span>{L.stSeason}:</span>
          <select value={seasonId} onChange={(e) => onSeason(Number(e.target.value))}>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <button className="btn-ghost season-filter-link" title={L.stCopyLink} aria-label={L.stCopyLink} onClick={copyLink}>
          <LinkIcon size={14} />
        </button>
      </div>
    </div>
  );
}
