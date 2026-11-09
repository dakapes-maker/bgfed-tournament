/** Κουκκίδες νικών δίπλα στο όνομα (build 2026-11-09.03): μία ανά
 * προηγούμενο γύρο, γεμάτη = νίκη, άδεια = ήττα. */
export function WinDots({ rec }) {
  if (!rec || rec.length === 0) return null;
  const w = rec.filter((x) => x === "W").length;
  return (
    <span className="win-dots" title={`${w} ${w === 1 ? "νίκη" : "νίκες"} – ${rec.length - w} ${rec.length - w === 1 ? "ήττα" : "ήττες"} πριν από αυτόν τον γύρο`} aria-label={`${w} νίκες πριν από τον γύρο`}>
      {rec.map((x, i) => <span key={i} className={`win-dot ${x === "W" ? "w" : "l"}`} />)}
    </span>
  );
}
