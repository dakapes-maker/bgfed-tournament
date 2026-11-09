/** Κεφαλίδα τουρνουά (build 2026-11-09.03): ένδειξη κατάστασης, όνομα,
 * γραμμή στοιχείων και δύο μετρητές. */
export function TournamentHeader({ live, name, meta, counters }) {
  return (
    <div className="header t-header">
      <div className="t-header-main">
        <p className={`t-status ${live ? "live" : "done"}`}>
          {live && <span className="t-status-dot" aria-hidden="true" />}
          {live ? "Σε εξέλιξη" : "Ολοκληρώθηκε"}
        </p>
        <h1>{name}</h1>
        {meta && <p className="t-meta">{meta}</p>}
      </div>
      <div className="t-counters">
        {counters.map((c) => (
          <div key={c.label} className="t-counter">
            <span className="t-counter-label">{c.label}</span>
            <span className="t-counter-value">{c.value} <small>/ {c.of}</small></span>
            {c.bar !== undefined && <span className="t-counter-bar"><span style={{ width: `${Math.round(c.bar * 100)}%` }} /></span>}
          </div>
        ))}
      </div>
    </div>
  );
}
