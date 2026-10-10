import { Check } from "lucide-react";

import { normalizeName } from "../lib/persons.js";

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

export function StandingsTable({ standings, buchholz, totalRounds, sideBets, isAdmin, onToggleExclusion, onOpenPlayer }) {
  const rounds = Array.from({ length: totalRounds || 0 }, (_, i) => i + 1);
  const inAnySideBet = (playerId) => (sideBets || []).some((b) => b.participantIds.includes(playerId));
  return (
    <div className="card" style={{ padding: 0, overflowX: "auto" }}>
      <table>
        <thead>
          <tr>
            <th className="rank">Rank</th>
            <th>Player</th>
            {rounds.map((r) => (
              <th key={r} style={{ textAlign: "center" }}>R{r}</th>
            ))}
            <th style={{ textAlign: "center" }}>Wins</th>
            {buchholz && <th className="buchholz-header">Buchholz</th>}
            <th>Active</th>
            <th style={{ textAlign: "center" }}>Side bet</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((p, i) => (
            <tr key={p.id}>
              <td className="rank">{i + 1}</td>
              <td className="standings-name" style={{ cursor: "pointer" }} onClick={() => onOpenPlayer && onOpenPlayer(normalizeName(p.name))}>{p.name}</td>
              {rounds.map((r) => (
                <td key={r} style={{ textAlign: "center" }}>{roundCell(p, r)}</td>
              ))}
              <td style={{ textAlign: "center" }}><span className="wins-highlight">{p.wins}</span></td>
              {buchholz && <td className="buchholz-cell">{buchholz[p.id] ?? "—"}</td>}
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
              <td style={{ textAlign: "center" }}>
                <span style={{ display: "flex", justifyContent: "center" }}>
                  {inAnySideBet(p.id) ? <Check size={15} color="var(--win)" /> : "—"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: "var(--muted)", padding: "8px 12px 12px 12px", margin: 0 }}>
        * = result due to opponent's withdrawal
      </p>
    </div>
  );
}
