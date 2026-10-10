import { ELO_INITIAL, eloWinProbability } from "../lib/elo.js";
import { normalizeName } from "../lib/persons.js";
import { formatDate } from "../lib/utils.js";

export function formatMonthLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

export function AxisLineChart({ points, color, suffix = "" }) {
  if (!points || points.length < 2) return <p style={{ fontSize: 13, color: "var(--muted)" }}>Not enough history yet for a trend.</p>;
  const width = 560;
  const height = 240;
  const padL = 42, padR = 10, padT = 12, padB = 26;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const values = points.map((p) => p.y);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = points.length > 1 ? plotW / (points.length - 1) : 0;
  const coords = points.map((p, i) => ({
    x: padL + i * stepX,
    y: padT + plotH - ((p.y - min) / range) * plotH,
    label: p.label,
    full: p.full,
    val: p.y,
  }));
  const polyline = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const gridValues = [max, (max + min) / 2, min];
  const tickCount = Math.min(6, points.length);
  const tickIndices = [...new Set(Array.from({ length: tickCount }, (_, i) => Math.round((i * (points.length - 1)) / (tickCount - 1 || 1))))];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="axis-chart-svg">
      {gridValues.map((v, i) => {
        const y = padT + plotH - ((v - min) / range) * plotH;
        return (
          <g key={i}>
            <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="var(--border)" strokeWidth="1" />
            <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="11" fill="var(--muted)">{Math.round(v)}{suffix}</text>
          </g>
        );
      })}
      <polyline points={polyline} fill="none" stroke={color} strokeWidth="2" />
      {coords.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r="3" fill={color}>
          <title>{c.full}: {Math.round(c.val)}{suffix}</title>
        </circle>
      ))}
      {tickIndices.map((idx) => (
        <text key={idx} x={coords[idx].x} y={height - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">
          {coords[idx].label}
        </text>
      ))}
    </svg>
  );
}

/** Player card trends: the ELO of the chosen ranking (switch in its title)
 * and, next to it, the win rate over every match in every competition. */
export function PlayerTrendCharts({ eloRows, winRows, eloSwitch }) {
  const msg = (t) => <p style={{ fontSize: 13, color: "var(--muted)", margin: "12px 0" }}>{t}</p>;
  // Everyone starts at the initial rating, so the line begins there — a
  // player with a single tournament still gets a two-point chart.
  const eloPoints = (eloRows || []).map((r) => ({ y: r.rating, label: formatMonthLabel(r.date), full: formatDate(r.date) }));
  if (eloPoints.length > 0) eloPoints.unshift({ y: ELO_INITIAL, label: "Αφετηρία", full: `Αφετηρία (${ELO_INITIAL})` });
  const eloBody = !eloRows
    ? msg("Loading…")
    : eloRows.length === 0
    ? msg("Δεν υπάρχουν ακόμα αγώνες σε αυτή την κατάταξη.")
    : <AxisLineChart points={eloPoints} color="var(--accent)" />;
  const last = winRows && winRows.length ? winRows[winRows.length - 1] : null;
  const winBody = !winRows
    ? msg("Loading…")
    : winRows.length === 0
    ? msg("Δεν υπάρχουν ακόμα αγώνες.")
    : winRows.length < 2
    ? (
      <div style={{ margin: "14px 0" }}>
        <div style={{ fontSize: 30, fontWeight: 700, color: "var(--win)" }}>{Math.round(last.winRate * 10) / 10}%</div>
        <div className="cal-note">{last.wins} νίκες σε {last.games} αγώνες (ένα τουρνουά — το γράφημα εμφανίζεται από το δεύτερο)</div>
      </div>
    )
    : <AxisLineChart points={winRows.map((r) => ({ y: r.winRate, label: formatMonthLabel(r.date), full: formatDate(r.date) }))} color="var(--win)" suffix="%" />;
  return (
    <div className="trend-charts-grid">
      <div className="trend-chart-card">
        <p className="trend-chart-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span>ELO</span>
          {eloSwitch}
        </p>
        {eloBody}
      </div>
      <div className="trend-chart-card">
        <p className="trend-chart-title">Ποσοστό νικών <span className="cal-note">(όλες οι διοργανώσεις)</span></p>
        {winBody}
      </div>
    </div>
  );
}

export function WinProbabilityBar({ p1Name, p2Name, eloData, matchLength }) {
  const r1 = eloData.players?.[normalizeName(p1Name)]?.rating ?? ELO_INITIAL;
  const r2 = eloData.players?.[normalizeName(p2Name)]?.rating ?? ELO_INITIAL;
  const p1Prob = Math.round(eloWinProbability(r1, r2, matchLength || 7) * 100);
  const p2Prob = 100 - p1Prob;
  const p1Favored = p1Prob >= p2Prob;
  const favorite = p1Favored ? p1Name : p2Name;
  const favoriteProb = Math.max(p1Prob, p2Prob);
  return (
    <div className="win-prob">
      <p className="win-prob-headline" style={{ textAlign: p1Favored ? "left" : "right" }}>
        Predicted winner (ELO): <strong>{favorite}</strong> <span className="win-prob-pct">{favoriteProb}%</span>
      </p>
      <div className="win-prob-bar">
        <div className="win-prob-fill" style={{ width: `${p1Prob}%` }} />
      </div>
      <div className="win-prob-labels">
        <span>{p1Prob}%</span>
        <span>{p2Prob}%</span>
      </div>
    </div>
  );
}
