import { useState } from "react";
import { Plus, X, Info } from "lucide-react";

import { BUYIN_FULL, RUNNER_UP_PRIZE, CUP_COST } from "../config/constants.js";
import { computeTournamentFinance, computeSideBetResult, computeCalcuttaResult } from "../lib/finance.js";

export function CalcuttaTab({ players, totalRounds, entries, onAdd, onRemove }) {
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [buyer, setBuyer] = useState("");
  const [amount, setAmount] = useState(20);

  const boughtIds = new Set(entries.map((e) => e.playerId));
  const availablePlayers = players.filter((p) => !boughtIds.has(p.id)).sort((a, b) => a.name.localeCompare(b.name, "en"));
  const playersById = {};
  players.forEach((p) => (playersById[p.id] = p));
  const result = computeCalcuttaResult(entries, players, totalRounds);

  return (
    <>
      <div className="notice">
        <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>A separate pool from the official prize pool. Record who bought each player and for how much — the pool is paid out to whoever bought the eventual tournament winner(s), split evenly on a tie.</span>
      </div>

      <div className="finance-summary">
        <div className="finance-stat">
          <span className="finance-stat-label">Calcutta pool</span>
          <span className="finance-stat-value">{result.pool}€</span>
        </div>
        <div className="finance-stat">
          <span className="finance-stat-label">Players sold</span>
          <span className="finance-stat-value">{entries.length}</span>
        </div>
      </div>

      <div className="card">
        <p style={{ margin: "0 0 12px 0", fontWeight: 600 }}>Result</p>
        {result.winners.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 14 }}>No completed winner yet.</p>
        ) : (
          result.payouts.map((p) => (
            <div key={p.player.id} className="finance-row">
              <span>
                <span className="prize-badge win">{totalRounds}/{totalRounds}</span> {p.player.name}
                {p.sold ? <> — bought by <strong>{p.buyer}</strong></> : <span style={{ color: "var(--muted)" }}> — not sold</span>}
              </span>
              <strong>{p.sold ? `${p.amount.toFixed(2)}€` : "—"}</strong>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <p style={{ margin: "0 0 12px 0", fontWeight: 600 }}>Entries</p>
        {entries.length === 0 && <p style={{ color: "var(--muted)", fontSize: 14 }}>No players sold yet.</p>}
        {entries.map((e) => (
          <div key={e.id} className="finance-row">
            <span>{playersById[e.playerId]?.name || "Unknown"} <span style={{ color: "var(--muted)", fontSize: 12 }}>— {e.buyer}</span></span>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <strong>{e.amount}€</strong>
              <button className="btn-ghost" onClick={() => onRemove(e.id)}><X size={14} /></button>
            </span>
          </div>
        ))}

        <div className="row" style={{ marginTop: 16, alignItems: "center" }}>
          <div style={{ width: 200 }}>
            <select value={selectedPlayerId} onChange={(e) => setSelectedPlayerId(e.target.value)} style={{ width: "100%" }}>
              <option value="">Select player…</option>
              {availablePlayers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <input type="text" value={buyer} onChange={(e) => setBuyer(e.target.value)} placeholder="Buyer name" />
          </div>
          <div style={{ width: 90 }}>
            <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} placeholder="€" />
          </div>
          <button
            className="btn-secondary"
            disabled={!selectedPlayerId || !buyer.trim()}
            onClick={() => {
              onAdd(selectedPlayerId, buyer, amount);
              setSelectedPlayerId("");
              setBuyer("");
            }}
          >
            <Plus size={16} /> Add
          </button>
        </div>
      </div>
    </>
  );
}

export function FinanceTab({
  players, totalRounds, isAdmin, onToggleDiscount, onChangeDiscountAmount, onToggleCup,
  sideBets, onAddSideBet, onRemoveSideBet, onToggleSideBetParticipant, onChangeSideBetAmount,
}) {
  const f = computeTournamentFinance(players, totalRounds);
  const playersById = {};
  players.forEach((p) => (playersById[p.id] = p));
  const sideBetsTotal = sideBets.reduce((sum, bet) => sum + computeSideBetResult(bet, playersById).pool, 0);
  return (
    <>
      <div className="finance-summary">
        <div className="finance-stat">
          <span className="finance-stat-label">Total collected</span>
          <span className="finance-stat-value">{f.totalCollected}€</span>
        </div>
        <div className="finance-stat">
          <span className="finance-stat-label">Federation</span>
          <span className="finance-stat-value">{f.federationTotal}€</span>
        </div>
        <div className="finance-stat">
          <span className="finance-stat-label">Venue</span>
          <span className="finance-stat-value">{f.venueTotal}€</span>
        </div>
        <div className="finance-stat">
          <span className="finance-stat-label">Prize pool</span>
          <span className="finance-stat-value">{f.prizePool}€</span>
        </div>
        <div className="finance-stat">
          <span className="finance-stat-label">Side bets total</span>
          <span className="finance-stat-value">{sideBetsTotal}€</span>
        </div>
      </div>

      {f.shortfall && (
        <div className="notice" style={{ borderColor: "var(--accent)" }}>
          <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            The prize pool doesn't cover the fixed {RUNNER_UP_PRIZE}€ payouts this time ({f.runnerUps.length} runner(s)-up). This is
            mathematically very unlikely in a normal Swiss field — double check the results before paying out.
          </span>
        </div>
      )}

      <div className="card">
        <p style={{ margin: "0 0 12px 0", fontWeight: 600 }}>Winners</p>
        {f.runnerUps.length === 0 && f.perfects.length === 0 && sideBets.every((b) => computeSideBetResult(b, playersById).winners.length === 0) ? (
          <p style={{ color: "var(--muted)", fontSize: 14 }}>No results to pay out yet.</p>
        ) : (
          <div className="winners-columns">
            <div>
              <p className="winners-col-label">Tournament</p>
              {f.perfects.length === 0 && f.runnerUps.length === 0 && (
                <p style={{ color: "var(--muted)", fontSize: 13 }}>No results yet.</p>
              )}
              {f.perfects.map((p) => (
                <div key={`pf-${p.id}`} className="finance-row">
                  <span><span className="prize-badge win">{totalRounds}/{totalRounds}</span> {p.name}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {isAdmin && (
                      <label className="live-toggle" style={{ margin: 0 }}>
                        <input type="checkbox" checked={!!p.wantsCup} onChange={() => onToggleCup(p.id)} />
                        Cup (−{CUP_COST}€)
                      </label>
                    )}
                    <strong>{(p.wantsCup ? f.perfectShare - CUP_COST : f.perfectShare).toFixed(2)}€</strong>
                  </span>
                </div>
              ))}
              {f.runnerUps.map((p) => (
                <div key={`ru-${p.id}`} className="finance-row">
                  <span><span className="prize-badge">{totalRounds - 1}/{totalRounds}</span> {p.name}</span>
                  <strong>{RUNNER_UP_PRIZE}€</strong>
                </div>
              ))}
            </div>

            <div>
              <p className="winners-col-label">Side bets</p>
              {sideBets.every((b) => computeSideBetResult(b, playersById).winners.length === 0) && (
                <p style={{ color: "var(--muted)", fontSize: 13 }}>No results yet.</p>
              )}
              {sideBets.map((bet) => {
                const result = computeSideBetResult(bet, playersById);
                return result.winners.map((w) => (
                  <div key={`sb-${bet.id}-${w.id}`} className="finance-row">
                    <span><span className="prize-badge side">{bet.label}</span> {w.name}</span>
                    <strong>{result.share.toFixed(2)}€</strong>
                  </div>
                ));
              })}
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Buy-in</th>
              {isAdmin && <th>Discount</th>}
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.hasDiscount ? (p.discountAmount ?? 32) : BUYIN_FULL}€</td>
                {isAdmin && (
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <label className="live-toggle" style={{ margin: 0 }}>
                        <input type="checkbox" checked={!!p.hasDiscount} onChange={() => onToggleDiscount(p.id)} />
                      </label>
                      {p.hasDiscount && (
                        <input
                          type="number"
                          style={{ width: 60 }}
                          value={p.discountAmount ?? 32}
                          onChange={(e) => onChangeDiscountAmount(p.id, Number(e.target.value) || 0)}
                        />
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isAdmin && <SideBetsSection players={players} sideBets={sideBets} onAdd={onAddSideBet} onRemove={onRemoveSideBet} onToggleParticipant={onToggleSideBetParticipant} onChangeAmount={onChangeSideBetAmount} />}
    </>
  );
}

export function SideBetsSection({ players, sideBets, onAdd, onRemove, onToggleParticipant, onChangeAmount }) {
  const [newLabel, setNewLabel] = useState("");
  const [newAmount, setNewAmount] = useState(40);
  const playersById = {};
  players.forEach((p) => (playersById[p.id] = p));

  return (
    <div className="card">
      <p style={{ margin: "0 0 10px 0", fontWeight: 600 }}>Side bets</p>
      <p style={{ margin: "0 0 14px 0", fontSize: 13, color: "var(--muted)" }}>
        Separate from the official prize pool. Whoever has the most wins among the participants (byes and opponent-retirement wins count too) takes the whole side pool — ties split it evenly.
      </p>

      {sideBets.map((bet) => {
        const result = computeSideBetResult(bet, playersById);
        return (
          <div key={bet.id} className="finance-row">
            <span>{bet.label} <span style={{ color: "var(--muted)", fontSize: 12 }}>({bet.participantIds.length} participants, {result.pool}€ pool)</span></span>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>€</span>
              <input
                type="number"
                style={{ width: 60 }}
                value={bet.amountPerPlayer}
                onChange={(e) => onChangeAmount(bet.id, Number(e.target.value) || 0)}
              />
              <span style={{ fontSize: 13, color: "var(--muted)" }}>per player</span>
              <button className="btn-ghost" onClick={() => onRemove(bet.id)}><X size={14} /></button>
            </span>
          </div>
        );
      })}

      <div className="row" style={{ marginTop: 16 }}>
        <div className="field">
          <input type="text" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Label (e.g. 'The regulars')" />
        </div>
        <div style={{ width: 90 }}>
          <input type="number" value={newAmount} onChange={(e) => setNewAmount(Number(e.target.value) || 0)} placeholder="€" />
        </div>
        <button
          className="btn-secondary"
          onClick={() => {
            onAdd(newLabel.trim(), newAmount);
            setNewLabel("");
            setNewAmount(40);
          }}
        >
          <Plus size={15} /> Add side bet
        </button>
      </div>
    </div>
  );
}
