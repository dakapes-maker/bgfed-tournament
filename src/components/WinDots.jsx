import { useL } from "../config/langContext.js";
/** Κουκκίδες νικών δίπλα στο όνομα (build 2026-11-09.03): μία ανά
 * προηγούμενο γύρο, γεμάτη = νίκη, άδεια = ήττα. */
export function WinDots({ rec }) {
  const L = useL();
  if (!rec || rec.length === 0) return null;
  const w = rec.filter((x) => x === "W").length;
  return (
    <span className="win-dots" title={L.winsBefore(w, rec.length - w)} aria-label={L.winsBefore(w, rec.length - w)}>
      {rec.map((x, i) => <span key={i} className={`win-dot ${x === "W" ? "w" : "l"}`} />)}
    </span>
  );
}
