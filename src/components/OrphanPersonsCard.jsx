/** Διαχείριση → Εισαγωγές (2026-10-24.03): source names of imports whose
 * person no longer exists in the registry (e.g. merged away). Each row
 * proposes the likely person; «Εφαρμογή» relinks them all. */
export function OrphanPersonsCard({ rows, players, choices, onChoice, busy, onApply }) {
  const sorted = Object.entries(players).sort((a, b) => a[1].name.localeCompare(b[1].name, "el"));
  const label = (k) => `${players[k].name}${players[k].regNo ? ` #${String(players[k].regNo).padStart(3, "0")}` : ""}`;
  const ready = rows.every((r) => choices[r.id]);
  return (
    <div className="control-sub-card" style={{ borderColor: "var(--accent)" }}>
      <strong>⚠ Εισαγωγές με παίκτες που δεν υπάρχουν στο μητρώο ({rows.length})</strong>
      <p className="cal-note" style={{ margin: "4px 0 8px 0" }}>
        Συνήθως μετά από ένωση προσώπων πριν από το build 2026-10-24.03. Διάλεξε το πρόσωπο κάθε γραφής· με την «Εφαρμογή» διορθώνονται οι εισαγωγές
        και ξαναχτίζεται η Βαθμολογία των σεζόν τους όπου μετράνε. Μετά: Recompute της κατάταξης ELO.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="cal-table">
          <thead><tr><th>Εισαγωγή</th><th>Γραφή πηγής</th><th>Πρόσωπο</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.importName}</td>
                <td>{r.sourceName}</td>
                <td>
                  <select value={choices[r.id] || ""} onChange={(e) => onChoice(r.id, e.target.value)} style={{ fontSize: 13, padding: "4px 6px", border: "1px solid var(--border)", borderRadius: 6, maxWidth: 280 }}>
                    <option value="">— επίλεξε —</option>
                    {r.candidates.length > 0 && (
                      <optgroup label="Πιθανά">
                        {r.candidates.map((k) => <option key={k} value={k}>{label(k)}</option>)}
                      </optgroup>
                    )}
                    <optgroup label="Όλο το μητρώο">
                      {sorted.map(([k]) => <option key={k} value={k}>{label(k)}</option>)}
                    </optgroup>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
        <button className="btn-primary" onClick={onApply} disabled={busy || !ready}>{busy ? "Εφαρμογή…" : "Εφαρμογή"}</button>
        {!ready && <span className="cal-note">Διάλεξε πρόσωπο σε κάθε γραμμή.</span>}
      </div>
    </div>
  );
}
