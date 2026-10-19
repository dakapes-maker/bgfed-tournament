import React, { useState } from "react";
import { Check } from "lucide-react";

import { normalizeName } from "../lib/persons.js";
import { tournamentTieExplanation, decidedByH2h } from "../lib/tournamentTiebreakText.js";
import { CriteriaNotice } from "./CriteriaNotice.jsx";

/* ---------------------------------------------------------------------- */
/* Standings table                                                        */
/* ---------------------------------------------------------------------- */

/** One round as a letter (W / L / B, * by withdrawal, · no result yet,
 * — after withdrawal) with a title naming the round and the opponent. */
export function roundCell(player, roundNumber, L, nameOf) {
  const entry = player.matchLog.find((m) => m.round === roundNumber);
  const title = (kind, id) => L.ttRound(roundNumber, kind, id ? nameOf(id) : "");
  if (!entry) {
    if (player.withdrawn && player.withdrawnRound && roundNumber > player.withdrawnRound) {
      return <span className="round-cell muted" title={title("after")}>—</span>;
    }
    return <span className="round-cell muted" title={title("pending")}>·</span>;
  }
  if (entry.method === "bye") return <span className="round-cell bye" title={title("bye")}>B</span>;
  if (entry.result === "win") {
    const ret = entry.method === "retirement_win";
    return <span className="round-cell win" title={title(ret ? "retWin" : "win", entry.opponentId)}>W{ret ? "*" : ""}</span>;
  }
  const ret = entry.method === "retirement_loss";
  const kind = ret ? "retLoss" : entry.method === "double_retirement" ? "double" : "loss";
  return <span className="round-cell loss" title={title(kind, entry.opponentId)}>L{ret ? "*" : ""}</span>;
}

/** The criteria that set this row apart from a neighbour level on wins
 * (none for a shared place) — their values are shown in bold. */
function decidingKeys(row) {
  const d = row.tie && !row.shared && row.tie.detail;
  if (!d) return new Set();
  return new Set([d.above, d.below].filter((c) => c && c.decidedBy !== "shared").map((c) => c.decidedBy));
}

export function StandingsTable({ standings, tiebreaks, L, totalRounds, sideBets, isAdmin, inProgress, onToggleExclusion, onOpenPlayer }) {
  // Explanation open under this player's row (tap on the rank).
  const [openTie, setOpenTie] = useState(null);
  const showCols = !!tiebreaks;
  const critKeys = ["buchholz", "cut1", "median", "h2h"];
  const rounds = Array.from({ length: totalRounds || 0 }, (_, i) => i + 1);
  const names = Object.fromEntries(standings.map((p) => [p.id, p.name]));
  const nameOf = (id) => names[id] || "?";
  const inAnySideBet = (playerId) => (sideBets || []).some((b) => b.participantIds.includes(playerId));
  // 5B.4: side bets are financial information — only the admin sees them.
  const showSideBets = !!isAdmin && (sideBets || []).length > 0;
  // The Active switch: admin only, while the tournament is running.
  const showActive = !!isAdmin && !!inProgress && !!onToggleExclusion;
  const colCount = 3 + (rounds.length > 0 ? 1 : 0) + (showCols ? 4 : 0) + (showActive ? 1 : 0) + (showSideBets ? 1 : 0);
  const critClass = (i) => `buchholz-cell crit-col${i === 0 ? " crit-first" : ""}${i === critKeys.length - 1 ? " crit-last" : ""}`;
  const span = showCols ? 2 : undefined;
  return (
    <>
    {tiebreaks && (
      <CriteriaNotice summary={L.ttSummary} moreLabel={L.critMore} lessLabel={L.critLess} definitions={L.ttDefs} closing={L.ttHowTo} />
    )}
    <div className="card" style={{ padding: 0, overflowX: "auto" }}>
      <table>
        <thead>
          <tr>
            <th className="rank" rowSpan={span}>Rank</th>
            <th rowSpan={span}>Player</th>
            {rounds.length > 0 && <th rowSpan={span} title={L.ttRoundsTitle}>{L.ttRounds}</th>}
            <th rowSpan={span} style={{ textAlign: "center" }}>Wins</th>
            {showCols && <th colSpan={4} className="crit-group">{L.ttGroup}</th>}
            {showActive && <th rowSpan={span} />}
            {showSideBets && <th rowSpan={span} style={{ textAlign: "center" }}>Side bet</th>}
          </tr>
          {showCols && (
            <tr>
              {critKeys.map((k, i) => (
                <th key={k} className={`buchholz-header ${critClass(i)}`} style={{ textAlign: "center" }} title={L.ttColTitles[k]}>{L.ttCols[k]}</th>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {standings.map((p) => {
            const tieLines = tiebreaks ? tournamentTieExplanation(p, tiebreaks[p.id], L) : [];
            const canOpen = tieLines.length > 0;
            const decided = decidingKeys(p);
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
              <td className="standings-name" style={{ cursor: "pointer" }} onClick={() => onOpenPlayer && onOpenPlayer(normalizeName(p.name))}>
                {p.name}
                {p.withdrawn && <span className="withdrawn-note">{L.ttWithdrawnIn(p.withdrawnRound)}</span>}
              </td>
              {rounds.length > 0 && (
                <td className="rounds-seq">{rounds.map((r) => <React.Fragment key={r}>{roundCell(p, r, L, nameOf)}</React.Fragment>)}</td>
              )}
              <td style={{ textAlign: "center" }}><span className="wins-highlight">{p.wins}</span></td>
              {showCols && critKeys.map((k, i) => {
                const isH2h = k === "h2h";
                const bold = decided.has(k);
                const value = isH2h ? (decidedByH2h(p) ? "✓" : "—") : tiebreaks[p.id]?.[k] ?? "—";
                return (
                  <td key={k} className={critClass(i)} style={{ textAlign: "center" }}>
                    {bold ? <span className="crit-decided">{value}</span> : value}
                  </td>
                );
              })}
              {showActive && (
              <td style={{ textAlign: "center" }}>
                <label className="active-toggle" title={p.excludedFromTournament ? "Ανενεργός — πάτα για να ξαναμπεί στις κληρώσεις" : "Ενεργός — πάτα για να τον αποσύρεις από τις επόμενες κληρώσεις"}>
                  <input
                    type="checkbox"
                    checked={!p.excludedFromTournament}
                    onChange={() => onToggleExclusion(p.id)}
                  />
                  <span className="active-toggle-slider" />
                </label>
              </td>
              )}
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
                <td colSpan={colCount} style={{ background: "var(--bg)", padding: "8px 14px", whiteSpace: "normal" }}>
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
