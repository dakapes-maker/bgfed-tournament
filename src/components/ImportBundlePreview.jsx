/** Διαχείριση → Εισαγωγές: preview of an import bundle (bgfed-import-bundle/1,
 * or a single bgfed-import/1 as a bundle of one). One row per tournament,
 * and above it the competition and season every tournament will get —
 * chosen explicitly, never guessed. «Εισαγωγή όλων» only when everything
 * checks out (all or nothing).
 * 2026-10-24.01: `standings` = { available (the competition keeps standings),
 * locked (the season is locked) } — the switch «Μετράει στη Βαθμολογία της
 * σεζόν» (target.countsInStandings); `calendar` = { options, links,
 * duplicates, label(entry) } (importCalendarLinks) — the calendar day each
 * tournament is linked to, changed with onItemCalendar(i, entryId | ""). */
export function ImportBundlePreview({ preview, competitions, seasonsOf, target, onTarget, busy, progress, onCancel, onConfirm, dateLabel, standings, calendar, onItemCalendar }) {
  const { items, problems, matching, title, fileName } = preview;
  const seasons = target.competitionId ? seasonsOf(target.competitionId) : [];
  const withProblems = items.filter((it) => it.problems.length > 0).length;
  const showCalendar = !!target.seasonYear && calendar && (calendar.options.length > 0 || calendar.links.some(Boolean));
  const ready = !!target.competitionId && !!target.seasonYear && withProblems === 0 && problems.length === 0 && items.length > 0 && !(calendar && calendar.duplicates);
  const sel = { width: "100%", fontSize: 15, padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface, #fff)" };
  return (
    <div className="control-sub-card">
      <strong>Προεπισκόπηση: {title || fileName}</strong>
      <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 10px 0" }}>
        {items.length === 1 ? "1 τουρνουά" : `${items.length} τουρνουά`}{matching ? " · με αποφάσεις αντιστοίχισης παικτών (θα ανοίξουν για έλεγχο μετά την εισαγωγή)" : ""}
      </p>
      <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ width: 260 }}>
          <label>Διοργάνωση</label>
          <select value={target.competitionId} onChange={(e) => onTarget({ competitionId: e.target.value, seasonYear: "" })} style={sel}>
            <option value="">— επίλεξε —</option>
            {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div style={{ width: 200 }}>
          <label>Σεζόν</label>
          <select value={target.seasonYear} onChange={(e) => onTarget({ ...target, seasonYear: e.target.value })} style={sel} disabled={!target.competitionId}>
            <option value="">— επίλεξε —</option>
            {seasons.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
          </select>
        </div>
      </div>
      {standings && standings.available && target.seasonYear && (
        <div style={{ marginTop: 10 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, cursor: standings.locked ? "default" : "pointer" }}>
            <input
              type="checkbox"
              checked={!!target.countsInStandings && !standings.locked}
              disabled={standings.locked}
              onChange={(e) => onTarget({ ...target, countsInStandings: e.target.checked })}
              data-testid="import-counts-standings"
            />
            Μετράει στη Βαθμολογία της σεζόν
          </label>
          {standings.locked ? (
            <p className="field-warning">Η σεζόν είναι κλειδωμένη· οι εισαγωγές της δεν μπορούν να μετρήσουν στη Βαθμολογία.</p>
          ) : (
            <p className="cal-note" style={{ margin: "2px 0 0 26px" }}>
              {target.countsInStandings
                ? "Κάθε τουρνουά του αρχείου θα μετρήσει στη Βαθμολογία όπως ένα τουρνουά της εφαρμογής, μόλις ολοκληρωθεί η αντιστοίχιση των παικτών."
                : "Τα τουρνουά θα μετρήσουν μόνο στην ELO και στα στατιστικά των παικτών."}
            </p>
          )}
        </div>
      )}
      {target.competitionId && seasons.length === 0 && (
        <p className="field-warning">Η διοργάνωση δεν έχει σεζόν. Άνοιξε πρώτα σεζόν από τη σελίδα της διοργάνωσης (Διαχείριση → Διοργανώσεις).</p>
      )}
      {problems.length > 0 && (
        <div className="field-warning">
          ⚠ Το αρχείο έχει προβλήματα και δεν μπορεί να εισαχθεί:
          <ul style={{ margin: "4px 0 0 0", paddingLeft: 18 }}>{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </div>
      )}
      {items.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table className="cal-table" data-testid="import-bundle-table">
            <thead>
              <tr><th>#</th><th>Τουρνουά</th><th>Ημερομηνία</th><th>Παίκτες</th><th>Αγώνες</th><th>Νικητής</th>{showCalendar && <th>Ημερολόγιο</th>}<th>Έλεγχος</th></tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>
                    {it.doc?.name || "—"}
                    {it.replaceId && <div className="cal-note">θα αντικαταστήσει την υπάρχουσα εισαγωγή (ίδιο link πηγής)</div>}
                  </td>
                  <td>{it.doc ? dateLabel(it.doc) : "—"}</td>
                  <td>{it.summary ? it.summary.players : "—"}</td>
                  <td>{it.summary ? `${it.summary.matches} + ${it.summary.byes} bye` : "—"}</td>
                  <td>{it.summary ? it.summary.winner : "—"}</td>
                  {showCalendar && (
                    <td>
                      <select
                        value={calendar.links[i] || ""}
                        onChange={(e) => onItemCalendar(i, e.target.value)}
                        style={{ fontSize: 13, padding: "4px 6px", border: "1px solid var(--border)", borderRadius: 6, maxWidth: 260 }}
                        data-testid="import-calendar-link"
                      >
                        <option value="">— χωρίς σύνδεση —</option>
                        {calendar.options.map((e) => <option key={e.id} value={e.id}>{calendar.label(e)}</option>)}
                      </select>
                      {calendar.links[i] && (
                        <div className="cal-note">Συνδέεται με: {calendar.label(calendar.options.find((e) => e.id === calendar.links[i]) || { id: calendar.links[i] })}</div>
                      )}
                    </td>
                  )}
                  <td>
                    {it.problems.length === 0 ? (
                      <span style={{ color: "var(--win)" }}>✓</span>
                    ) : (
                      <details>
                        <summary style={{ color: "var(--accent)", cursor: "pointer" }}>⚠ {it.problems.length}</summary>
                        <ul style={{ margin: "4px 0 0 0", paddingLeft: 18, fontSize: 12 }}>{it.problems.slice(0, 12).map((p, j) => <li key={j}>{p}</li>)}</ul>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {items.length > 0 && withProblems === 0 && problems.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--win)", margin: "8px 0 0 0" }}>
          ✓ Οι έλεγχοι πέρασαν: κανείς δεν παίζει δύο φορές στον ίδιο γύρο, και οι νίκες κάθε παίκτη συμφωνούν με την κατάταξη της πηγής.
        </p>
      )}
      {calendar && calendar.duplicates && <p className="field-warning">Δύο τουρνουά συνδέονται με την ίδια αγωνιστική του Ημερολογίου — άλλαξε τη μία σύνδεση.</p>}
      {withProblems > 0 && <p className="field-warning">{withProblems === 1 ? "Ένα τουρνουά έχει" : `${withProblems} τουρνουά έχουν`} προβλήματα — η εισαγωγή γίνεται μόνο όταν περνούν όλα.</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn-secondary" onClick={onCancel} disabled={busy}>Άκυρο</button>
        <button className="btn-primary" onClick={onConfirm} disabled={busy || !ready}>
          {busy ? `Αποθήκευση… ${progress || ""}` : `Εισαγωγή όλων (${items.length})`}
        </button>
        {!busy && (!target.competitionId || !target.seasonYear) && <span className="cal-note">Επίλεξε διοργάνωση και σεζόν.</span>}
      </div>
    </div>
  );
}
