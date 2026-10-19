import React, { useState } from "react";
import { Check } from "lucide-react";

import { TIEBREAK_COLUMNS_KEY } from "../config/constants.js";
import { normalizeName } from "../lib/persons.js";
import { tournamentTieExplanation, decidedByH2h } from "../lib/tournamentTiebreakText.js";
import { CriteriaNotice } from "./CriteriaNotice.jsx";

/* ---------------------------------------------------------------------- */
/* Standings table                                                        */
/* ---------------------------------------------------------------------- */

export function roundCell(player, roundNumber) {
  const entry = player.matchLog.find((m) => m.round === roundNumber);
  if (!entry) {
    if (player.withdrawn && player.withdrawnRound && roundNumber > player.withdrawnRound) {
      return <span className="round-cell muted">—</span>;
    }
    return <span className="round-cell muted">·</span>;
  }
  if (entry.method === "bye") return <span className="round-cell bye">BYE</span>;
  if (entry.result === "win") {
    return (
      <span className="round-cell win" title={entry.method === "retirement_win" ? "Win by opponent's withdrawal" : "Win"}>
        W{entry.method === "retirement_win" ? "*" : ""}
      </span>
    );
  }
  return (
    <span className="round-cell loss" title={entry.method === "retirement_loss" ? "Loss by withdrawal" : "Loss"}>
      L{entry.method === "retirement_loss" ? "*" : ""}
    </span>
  );
}

const readShowCriteria = () => {
  try { return localStorage.getItem(TIEBREAK_COLUMNS_KEY) === "1"; } catch { return false; }
};

export function StandingsTable({ standings, tiebreaks, L, totalRounds, sideBets, isAdmin, onToggleExclusion, onOpenPlayer }) {
  // Explanation open under this player's row (tap on the rank).
  const [openTie, setOpenTie] = useState(null);
  // "Tie-break criteria" switch: closed by default, remembered per device.
  const [showCriteria, setShowCriteria] = useState(readShowCriteria);
  const toggleCriteria = () => {
    const next = !showCriteria;
    setShowCriteria(next);
    try { localStorage.setItem(TIEBREAK_COLUMNS_KEY, next ? "1" : "0"); } catch { /* per-device convenience only */ }
  };
  const showCols = !!tiebreaks && showCriteria;
  const critKeys = ["buchholz", "cut1", "median"];
  const rounds = Array.from({ length: totalRounds || 0 }, (_, i) => i + 1);
  const inAnySideBet = (playerId) => (sideBets || []).some((b) => b.participantIds.includes(playerId));
  // 5B.4: side bets are financial information — only the admin sees them.
  const showSideBets = !!isAdmin && (sideBets || []).length > 0;
  return (
    <>
    {tiebreaks && (
      <CriteriaNotice summary={L.ttSummary} moreLabel={L.critMore} lessLabel={L.critLess} definitions={L.ttDefs} closing={L.ttHowTo} />
    )}
    <div className="card" style={{ padding: 0, overflowX: "auto" }}>
      {tiebreaks && (
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 12px 0 12px" }}>
          <button type="button" className={`tt-toggle${showCriteria ? " on" : ""}`} aria-pressed={showCriteria} title={L.ttToggleTitle} onClick={toggleCriteria}>
            {L.ttToggle}
          </button>
        </div>
      )}
      <table>
        <thead>
          <tr>
            <th className="rank">Rank</th>
            <th>Player</th>
            {rounds.map((r) => (
              <th key={r} style={{ textAlign: "center" }}>R{r}</th>
            ))}
            <th style={{ textAlign: "center" }}>Wins</th>
            {showCols && critKeys.concat("h2h").map((k) => (
              <th key={k} className="buchholz-header" style={{ textAlign: "center" }} title={L.ttColTitles[k]}>{L.ttCols[k]}</th>
            ))}
            <th>Active</th>
            {showSideBets && <th style={{ textAlign: "center" }}>Side bet</th>}
          </tr>
        </thead>
        <tbody>
          {standings.map((p) => {
            const tieLines = tiebreaks ? tournamentTieExplanation(p, tiebreaks[p.id], L) : [];
            const canOpen = tieLines.length > 0;
            return (
            <React.Fragment key={p.id}>
            <tr>
              <td
                className="rank"
                style={{ whiteSpace: "nowrap", cursor: canOpen ? "pointer" : undefined }}
                title={p.tie ? tieLines.join(" ") : canOpen ? L.ttRankTitle : undefined}
                onClick={canOpen ? () => setOpenTie(openTie === p.id ? null : p.id) : undefined}
              >
                {p.rank ?? "—"}{p.shared ? "=" : ""}
                {p.tie && !p.shared && <span className="tie-mark" aria-label={L.ttBadge}>=</span>}
              </td>
              <td className="standings-name" style={{ cursor: "pointer" }} onClick={() => onOpenPlayer && onOpenPlayer(normalizeName(p.name))}>{p.name}</td>
              {rounds.map((r) => (
                <td key={r} style={{ textAlign: "center" }}>{roundCell(p, r)}</td>
              ))}
              <td style={{ textAlign: "center" }}><span className="wins-highlight">{p.wins}</span></td>
              {showCols && critKeys.map((k) => (
                <td key={k} className="buchholz-cell" style={{ textAlign: "center" }}>{tiebreaks[p.id]?.[k] ?? "—"}</td>
              ))}
              {showCols && <td className="buchholz-cell" style={{ textAlign: "center" }}>{decidedByH2h(p) ? "✓" : ""}</td>}
              <td className="withdrawn-tag">
                <label className="active-toggle" title={p.excludedFromTournament ? "Ανενεργός — πάτα για να ξαναμπεί στις κληρώσεις" : "Ενεργός — πάτα για να τον αποσύρεις από τις επόμενες κληρώσεις"}>
                  <input
                    type="checkbox"
                    checked={!p.excludedFromTournament}
                    disabled={!isAdmin || !onToggleExclusion}
                    onChange={() => onToggleExclusion && onToggleExclusion(p.id)}
                  />
                  <span className="active-toggle-slider" />
                  <span className="active-toggle-label">{p.excludedFromTournament ? "Inactive" : "Active"}</span>
                </label>
                {p.withdrawn && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: "var(--loss)" }}>Α.Α. σε R{p.withdrawnRound}</span>
                )}
              </td>
              {showSideBets && (
              <td style={{ textAlign: "center" }}>
                <span style={{ display: "flex", justifyContent: "center" }}>
                  {inAnySideBet(p.id) ? <Check size={15} color="var(--win)" /> : "—"}
                </span>
              </td>
              )}
            </tr>
            {openTie === p.id && canOpen && (
              <tr>
                <td colSpan={rounds.length + (showCols ? 8 : 4) + (showSideBets ? 1 : 0)} style={{ background: "var(--bg)", padding: "8px 14px", whiteSpace: "normal" }}>
                  <div className="tie-explain" style={{ borderBottom: "none", marginBottom: 0, paddingBottom: 0 }}>
                    {tieLines.map((line, k) => <p key={k}>{line}</p>)}
                  </div>
                </td>
              </tr>
            )}
            </React.Fragment>
            );
          })}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: "var(--muted)", padding: "8px 12px 12px 12px", margin: 0 }}>
        {L.ttRetirementNote}
      </p>
    </div>
    </>
  );
}
